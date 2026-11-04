import os

os.environ["DATABASE_URL"] = "sqlite:///./test_notification.db"
os.environ["JWT_SECRET"] = "test-secret"
os.environ.pop("RABBITMQ_URL", None)

from fastapi.testclient import TestClient  # noqa: E402
from app.db import get_db  # noqa: E402
from app.main import app  # noqa: E402


def test_health_ok_and_db_failure_503():
    with TestClient(app) as c:
        r = c.get("/health")
        assert r.status_code == 200
        assert r.json() == {"status": "ok", "service": "notification"}

        class _FailingDB:
            def execute(self, *a, **k):
                raise RuntimeError("db down")

        def _bad_db():
            yield _FailingDB()

        app.dependency_overrides[get_db] = _bad_db
        try:
            r = c.get("/health")
            assert r.status_code == 503, r.text
            assert r.json() == {"status": "error", "service": "notification"}
        finally:
            app.dependency_overrides.pop(get_db, None)
        assert c.get("/health").status_code == 200
