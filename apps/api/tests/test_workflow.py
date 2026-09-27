import hashlib
import hmac
import json
from datetime import timedelta
import httpx
from sqlalchemy import select
from app.db import SessionLocal
from app.models import Delivery, Subscription, now
from app.webhooks import deliver_pending


def create(client, headers):
    response = client.post(
        "/requests",
        headers=headers,
        json={"title": "Export error", "description": "Duplicate rows in export"},
    )
    assert response.status_code == 201
    return response.json()["id"]


def test_full_workflow_and_hmac(client, headers, monkeypatch):
    request_id = create(client, headers["customer"])
    result = client.post(
        f"/requests/{request_id}/attachments",
        headers=headers["customer"],
        files={"file": ("details.txt", b"example", "text/plain")},
    )
    assert result.status_code == 201
    attachment = result.json()["id"]
    assert (
        client.get(f"/attachments/{attachment}", headers=headers["customer"]).content
        == b"example"
    )
    response = client.patch(
        f"/requests/{request_id}/status",
        headers=headers["agent"],
        json={"status": "in_progress"},
    )
    assert response.status_code == 200
    delivered = []

    def send(url, **kwargs):
        payload = kwargs["content"]
        signature = (
            "sha256="
            + hmac.new(
                b"demo-webhook-secret-change-me", payload.encode(), hashlib.sha256
            ).hexdigest()
        )
        assert kwargs["headers"]["X-RelayDesk-Signature"] == signature
        assert json.loads(payload)["data"] == {
            "request_id": request_id,
            "previous_status": "new",
            "status": "in_progress",
        }
        delivered.append(payload)
        return httpx.Response(204, request=httpx.Request("POST", url))

    monkeypatch.setattr("app.webhooks.httpx.post", send)
    deliver_pending()
    log = client.get("/webhooks/deliveries", headers=headers["admin"]).json()
    assert len(log) == 1 and log[0]["status"] == "success" and log[0]["attempts"] == 1
    deliver_pending()
    assert len(delivered) == 1
    assert (
        client.patch(
            f"/requests/{request_id}/status",
            headers=headers["agent"],
            json={"status": "done"},
        ).status_code
        == 200
    )
    assert (
        client.patch(
            f"/requests/{request_id}/status",
            headers=headers["agent"],
            json={"status": "new"},
        ).status_code
        == 409
    )


def test_authorization_isolation_and_crud(client, headers):
    request_id = create(client, headers["admin"])
    for path in ["/users", "/webhooks", "/webhooks/deliveries"]:
        assert client.get(path, headers=headers["customer"]).status_code == 403
    assert (
        client.get(f"/requests/{request_id}", headers=headers["customer"]).status_code
        == 404
    )
    assert (
        client.patch(
            f"/requests/{request_id}",
            headers=headers["customer"],
            json={"title": "Stolen", "description": "x"},
        ).status_code
        == 404
    )
    assert (
        client.delete(
            f"/requests/{request_id}", headers=headers["customer"]
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"/requests/{request_id}/attachments",
            headers=headers["customer"],
            files={"file": ("x.txt", b"x", "text/plain")},
        ).status_code
        == 404
    )
    attachment = client.post(
        f"/requests/{request_id}/attachments",
        headers=headers["admin"],
        files={"file": ("x.txt", b"x", "text/plain")},
    ).json()["id"]
    assert (
        client.get(
            f"/attachments/{attachment}", headers=headers["customer"]
        ).status_code
        == 404
    )
    own_id = create(client, headers["customer"])
    assert (
        client.patch(
            f"/requests/{own_id}/status",
            headers=headers["customer"],
            json={"status": "in_progress"},
        ).status_code
        == 403
    )
    assert (
        client.patch(
            f"/requests/{own_id}",
            headers=headers["customer"],
            json={"title": "Updated", "description": "More details"},
        ).json()["title"]
        == "Updated"
    )
    assert (
        client.delete(f"/requests/{own_id}", headers=headers["customer"]).status_code
        == 204
    )
    assert (
        client.get(f"/requests/{own_id}", headers=headers["customer"]).status_code
        == 404
    )
    assert (
        client.get("/requests", headers={"Authorization": "Bearer invalid"}).status_code
        == 401
    )
    assert (
        client.post(
            "/auth/login", json={"email": "admin@relaydesk.local", "password": "wrong"}
        ).status_code
        == 401
    )


def test_file_limits_and_types(client, headers):
    request_id = create(client, headers["customer"])
    endpoint = f"/requests/{request_id}/attachments"
    for filename, data, content_type, code in [
        ("x.html", b"<script/>", "text/html", 415),
        ("x.pdf", b"not pdf", "application/pdf", 415),
        ("x.txt", b"x" * (5 * 1024 * 1024 + 1), "text/plain", 413),
        ("empty.txt", b"", "text/plain", 413),
        ("x.txt", b"\xff", "text/plain", 415),
    ]:
        assert (
            client.post(
                endpoint,
                headers=headers["customer"],
                files={"file": (filename, data, content_type)},
            ).status_code
            == code
        )
    result = client.post(
        endpoint,
        headers=headers["customer"],
        files={"file": ("../../safe.txt", b"hello", "text/plain")},
    )
    assert result.json()["filename"] == "safe.txt"


def test_webhook_retry_exactly_once(client, headers, monkeypatch):
    request_id = create(client, headers["customer"])
    client.patch(
        f"/requests/{request_id}/status",
        headers=headers["agent"],
        json={"status": "in_progress"},
    )
    sent = []

    def fail(url, **kwargs):
        sent.append(kwargs["content"])
        return httpx.Response(503, request=httpx.Request("POST", url))

    monkeypatch.setattr("app.webhooks.httpx.post", fail)
    deliver_pending()
    with SessionLocal() as db:
        item = db.scalar(select(Delivery))
        assert item.status == "retrying" and item.attempts == 1
        item.next_attempt_at = now() - timedelta(seconds=1)
        db.commit()
    deliver_pending()
    deliver_pending()
    log = client.get("/webhooks/deliveries", headers=headers["admin"]).json()[0]
    assert log["status"] == "failed" and log["attempts"] == 2
    assert len(sent) == 2 and sent[0] == sent[1]


def test_users_and_subscriptions(client, headers):
    data = {
        "email": "new@example.test",
        "name": "New user",
        "password": "long-enough-password",
        "role": "customer",
    }
    assert client.post("/users", headers=headers["agent"], json=data).status_code == 403
    result = client.post("/users", headers=headers["admin"], json=data)
    assert result.status_code == 201 and "password_hash" not in result.json()
    assert client.post("/users", headers=headers["admin"], json=data).status_code == 409
    new_id = result.json()["id"]
    token = client.post(
        "/auth/login", json={"email": data["email"], "password": data["password"]}
    ).json()["access_token"]
    assert (
        client.patch(
            f"/users/{new_id}", headers=headers["admin"], json={"role": "agent"}
        ).json()["role"]
        == "agent"
    )
    assert (
        client.get("/auth/me", headers={"Authorization": f"Bearer {token}"}).json()[
            "role"
        ]
        == "agent"
    )
    admin_id = client.get("/auth/me", headers=headers["admin"]).json()["id"]
    assert (
        client.patch(
            f"/users/{admin_id}", headers=headers["admin"], json={"role": "customer"}
        ).status_code
        == 409
    )
    result = client.post(
        "/webhooks",
        headers=headers["admin"],
        json={"url": "http://localhost:9999/events", "secret": "a-long-signing-secret"},
    )
    assert result.status_code == 201 and "secret" not in result.json()
    assert (
        client.delete(
            f"/webhooks/{result.json()['id']}", headers=headers["admin"]
        ).status_code
        == 204
    )
    assert (
        client.get("/webhooks", headers=headers["admin"]).json()[-1]["active"] is False
    )


def test_private_webhook_rejected_by_default(client, headers, monkeypatch):
    monkeypatch.setattr("app.webhooks.settings.webhook_allow_private", False)
    response = client.post(
        "/webhooks",
        headers=headers["admin"],
        json={"url": "http://127.0.0.1/events", "secret": "a-long-signing-secret"},
    )
    assert response.status_code == 422


def test_retry_can_succeed_and_disabled_subscription_cancels(
    client, headers, monkeypatch
):
    request_id = create(client, headers["customer"])
    client.patch(
        f"/requests/{request_id}/status",
        headers=headers["agent"],
        json={"status": "in_progress"},
    )
    codes = iter([500, 204])
    monkeypatch.setattr(
        "app.webhooks.httpx.post",
        lambda url, **kwargs: httpx.Response(
            next(codes), request=httpx.Request("POST", url)
        ),
    )
    deliver_pending()
    with SessionLocal() as db:
        item = db.scalar(select(Delivery))
        item.next_attempt_at = now() - timedelta(seconds=1)
        db.commit()
    deliver_pending()
    assert (
        client.get("/webhooks/deliveries", headers=headers["admin"]).json()[0]["status"]
        == "success"
    )
    client.patch(
        f"/requests/{request_id}/status",
        headers=headers["agent"],
        json={"status": "done"},
    )
    client.delete("/webhooks/1", headers=headers["admin"])
    deliver_pending()
    assert (
        client.get("/webhooks/deliveries", headers=headers["admin"]).json()[0]["status"]
        == "cancelled"
    )


def test_invalid_transition_has_no_outbox_event(client, headers):
    request_id = create(client, headers["customer"])
    assert (
        client.patch(
            f"/requests/{request_id}/status",
            headers=headers["agent"],
            json={"status": "done"},
        ).status_code
        == 409
    )
    assert client.get("/webhooks/deliveries", headers=headers["admin"]).json() == []
    assert (
        client.get(f"/requests/{request_id}", headers=headers["agent"]).json()["status"]
        == "new"
    )
