import os
import uuid
from datetime import datetime, timedelta, timezone

os.environ["DATABASE_URL"] = "sqlite:///./test_notification.db"
os.environ["JWT_SECRET"] = "test-secret"
os.environ.pop("RABBITMQ_URL", None)

import jwt  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import func, select  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.main import app, consume_message  # noqa: E402
from app.models import Notification  # noqa: E402


def _headers(sub="user-1", role="CUSTOMER"):
    token = jwt.encode({"sub": sub, "role": role,
                        "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
                       "test-secret", algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def _envelope(user_id):
    return {"eventId": f"evt-{uuid.uuid4().hex}", "eventType": "OrderCreated",
            "aggregateId": "order-123", "payload": {"userId": user_id}}


def test_consume_message_inserts_once_and_dedups():
    with TestClient(app):  # triggers lifespan/create_all without RabbitMQ
        db = SessionLocal()
        try:
            before = db.scalar(select(func.count()).select_from(Notification))
            env = _envelope("user-dedup")
            first = consume_message(env, db)
            assert first is not None
            assert first.user_id == "user-dedup"
            assert first.message == "OrderCreated for order order-123"
            assert first.channel == "LOG" and first.status == "SENT"
            assert consume_message(env, db) is None
            after = db.scalar(select(func.count()).select_from(Notification))
            assert after == before + 1
        finally:
            db.close()


def test_get_notifications_requires_auth_and_scopes_to_user():
    user_id = f"user-{uuid.uuid4().hex[:8]}"
    with TestClient(app) as c:
        assert c.get("/health").json()["status"] == "ok"
        r = c.get("/notifications")
        assert r.status_code == 401
        assert r.json()["error"]["code"] == "UNAUTHORIZED"

        db = SessionLocal()
        try:
            consume_message(_envelope(user_id), db)
            consume_message(_envelope("someone-else"), db)
        finally:
            db.close()

        mine = c.get("/notifications", headers=_headers(user_id))
        assert mine.status_code == 200
        assert len(mine.json()) == 1
        assert mine.json()[0]["userId"] == user_id

        limited = c.get("/notifications?limit=1", headers=_headers("admin-1", "ADMIN"))
        assert limited.status_code == 200
        assert len(limited.json()) == 1
