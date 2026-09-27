"""Real HTTP acceptance check. Run after docker compose up --build -d."""

import json
import os
import time
import urllib.request
import uuid

BASE = os.environ.get("API_URL", "http://localhost:8000")


def call(path, method="GET", data=None, token=None, content_type="application/json"):
    headers = {"Content-Type": content_type}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if data is not None and not isinstance(data, bytes):
        data = json.dumps(data).encode()
    with urllib.request.urlopen(
        urllib.request.Request(BASE + path, data=data, headers=headers, method=method),
        timeout=15,
    ) as response:
        body = response.read()
        return json.loads(body) if body and content_type == "application/json" else body


def login(role):
    return call(
        "/auth/login",
        "POST",
        {"email": f"{role}@relaydesk.local", "password": "RelayDesk123!"},
    )["access_token"]


customer, agent, admin = [login(role) for role in ["customer", "agent", "admin"]]
ticket = call(
    "/requests",
    "POST",
    {
        "title": "Acceptance smoke " + uuid.uuid4().hex[:8],
        "description": "Real HTTP flow: login, request, attachment, status, webhook.",
    },
    customer,
)
request_id = ticket["id"]
boundary = uuid.uuid4().hex
body = f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="evidence.txt"\r\nContent-Type: text/plain\r\n\r\nAcceptance evidence\r\n--{boundary}--\r\n'.encode()
upload = json.loads(
    call(
        f"/requests/{request_id}/attachments",
        "POST",
        body,
        customer,
        f"multipart/form-data; boundary={boundary}",
    )
)
assert (
    call(
        f"/attachments/{upload['id']}",
        token=customer,
        content_type="application/octet-stream",
    )
    == b"Acceptance evidence"
)
call(f"/requests/{request_id}/status", "PATCH", {"status": "in_progress"}, agent)
for _ in range(30):
    logs = call("/webhooks/deliveries", token=admin)
    matches = [
        item
        for item in logs
        if json.loads(item["payload"])["data"]["request_id"] == request_id
    ]
    if any(item["status"] == "success" for item in matches):
        print(
            f"PASS: login → request #{request_id} → upload/download → status → signed webhook success"
        )
        break
    time.sleep(1)
else:
    raise SystemExit("FAIL: no successful webhook delivery within 30 seconds")
