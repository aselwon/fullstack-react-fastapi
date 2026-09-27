"""Local demo receiver: rejects invalid signatures; stores no customer payloads."""

import hashlib
import hmac
import os
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        expected = (
            "sha256="
            + hmac.new(
                os.environ.get(
                    "WEBHOOK_SECRET", "demo-webhook-secret-change-me"
                ).encode(),
                body,
                hashlib.sha256,
            ).hexdigest()
        )
        valid = self.path == "/events" and hmac.compare_digest(
            self.headers.get("X-RelayDesk-Signature", ""), expected
        )
        self.send_response(204 if valid else 401)
        self.end_headers()


HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
