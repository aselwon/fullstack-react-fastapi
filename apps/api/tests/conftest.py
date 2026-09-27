import os
from pathlib import Path
import tempfile

_test_dir = tempfile.TemporaryDirectory()
os.environ["DATABASE_URL"] = f"sqlite:///{_test_dir.name}/test.db"
os.environ["UPLOAD_DIR"] = f"{_test_dir.name}/uploads"
os.environ["WEBHOOK_ALLOW_PRIVATE"] = "true"

import pytest
from fastapi.testclient import TestClient
from app.db import Base, engine, SessionLocal
from app.main import app
from app.seed import seed


@pytest.fixture(autouse=True)
def clean_db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    seed()
    yield


@pytest.fixture
def client():
    with TestClient(app) as client:
        yield client


@pytest.fixture
def headers(client):
    return {
        role: {
            "Authorization": "Bearer "
            + client.post(
                "/auth/login",
                json={"email": f"{role}@relaydesk.local", "password": "RelayDesk123!"},
            ).json()["access_token"]
        }
        for role in ["admin", "agent", "customer"]
    }
