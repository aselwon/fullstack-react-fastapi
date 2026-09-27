import hashlib
import hmac
import ipaddress
import json
import socket
import time
import uuid
from datetime import timedelta
from urllib.parse import urlsplit
import httpx
import redis
from sqlalchemy import select
from .config import settings
from .db import SessionLocal
from .models import Delivery, Subscription, now


def validate_url(url):
    parts = urlsplit(url)
    if (
        parts.scheme not in ("http", "https")
        or not parts.hostname
        or parts.username
        or parts.password
        or parts.fragment
    ):
        raise ValueError("Use an HTTP(S) URL without credentials or fragment")
    if not settings.webhook_allow_private:
        if parts.scheme != "https":
            raise ValueError("Public webhooks require HTTPS")
        try:
            addresses = socket.getaddrinfo(parts.hostname, parts.port or 443)
        except OSError as exc:
            raise ValueError("Webhook hostname cannot be resolved") from exc
        if any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
            raise ValueError("Private webhook addresses are disabled")


def enqueue(db, request, previous):
    payload = json.dumps(
        {
            "id": str(uuid.uuid4()),
            "event": "request.status_changed",
            "created_at": now().isoformat(),
            "data": {
                "request_id": request.id,
                "previous_status": previous,
                "status": request.status,
            },
        },
        separators=(",", ":"),
    )
    for subscription in db.scalars(
        select(Subscription).where(Subscription.active.is_(True))
    ):
        db.add(Delivery(subscription_id=subscription.id, payload=payload))


def deliver_pending():
    # PostgreSQL row locks make multiple worker instances safe. The outbox survives Redis restarts.
    with SessionLocal() as db:
        deliveries = db.scalars(
            select(Delivery)
            .where(
                Delivery.status.in_(["pending", "retrying"]),
                Delivery.next_attempt_at <= now(),
            )
            .with_for_update(skip_locked=True)
            .limit(20)
        ).all()
        for delivery in deliveries:
            subscription = db.get(Subscription, delivery.subscription_id)
            try:
                if not subscription.active:
                    delivery.status = "cancelled"
                    continue
                delivery.attempts += 1
                delivery.response_code = None
                validate_url(subscription.url)
                signature = hmac.new(
                    subscription.secret.encode(),
                    delivery.payload.encode(),
                    hashlib.sha256,
                ).hexdigest()
                response = httpx.post(
                    subscription.url,
                    content=delivery.payload,
                    headers={
                        "Content-Type": "application/json",
                        "X-RelayDesk-Signature": f"sha256={signature}",
                        "X-RelayDesk-Delivery": str(delivery.id),
                    },
                    timeout=5,
                    follow_redirects=False,
                )
                delivery.response_code = response.status_code
                response.raise_for_status()
                delivery.status = "success"
                delivery.error = None
            except (httpx.HTTPError, ValueError) as exc:
                delivery.error = type(exc).__name__
                delivery.status = "retrying" if delivery.attempts < 2 else "failed"
                delivery.next_attempt_at = now() + timedelta(seconds=5)
        db.commit()


if __name__ == "__main__":
    notifications = None
    while True:
        try:
            deliver_pending()
        except Exception:
            import logging

            logging.exception("Webhook worker iteration failed")
        try:
            if notifications is None:
                notifications = redis.Redis.from_url(
                    settings.redis_url, socket_connect_timeout=1, socket_timeout=2
                ).pubsub()
                notifications.subscribe("relaydesk:deliveries")
            # Wake promptly on status changes, but poll the durable outbox even when no hint arrives.
            notifications.get_message(ignore_subscribe_messages=True, timeout=1)
        except redis.RedisError:
            if notifications is not None:
                notifications.close()
                notifications = None
            time.sleep(1)
