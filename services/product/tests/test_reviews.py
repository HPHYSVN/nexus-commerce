import os
import uuid
from datetime import datetime, timedelta, timezone

os.environ["DATABASE_URL"] = "sqlite:///./test_product.db"
os.environ["JWT_SECRET"] = "test-secret"

import jwt  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from app.db import get_db  # noqa: E402
from app.main import app  # noqa: E402


def _token(sub, role="CUSTOMER", **extra):
    payload = {"sub": sub, "role": role,
               "exp": datetime.now(timezone.utc) + timedelta(hours=1), **extra}
    return jwt.encode(payload, "test-secret", algorithm="HS256")


def _headers(sub, **extra):
    return {"Authorization": f"Bearer {_token(sub, **extra)}"}


def _admin_headers():
    return {"Authorization": f"Bearer {_token('admin-1', role='ADMIN')}"}


def _make_product(c):
    suffix = uuid.uuid4().hex[:8]
    r = c.post("/products", json={"name": f"ReviewWidget {suffix}", "slug": f"review-widget-{suffix}",
                                  "price": 10, "description": "d", "image_url": ""},
               headers=_admin_headers())
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_create_review_auth_and_shape():
    with TestClient(app) as c:
        pid = _make_product(c)
        try:
            body = {"rating": 5, "comment": "Great"}
            assert c.post(f"/products/{pid}/reviews", json=body).status_code == 401
            sub = f"user-{uuid.uuid4().hex[:8]}"
            r = c.post(f"/products/{pid}/reviews", json=body,
                       headers=_headers(sub, email="alice@example.com"))
            assert r.status_code == 201, r.text
            data = r.json()
            assert data["productId"] == pid
            assert data["userId"] == sub
            assert data["userName"] == "alice@example.com"
            assert data["rating"] == 5 and data["comment"] == "Great"
            assert data["id"] and data["createdAt"]
            # fallback userName when no email/name claim
            r2 = c.post(f"/products/{pid}/reviews", json={"rating": 4, "comment": "Ok"},
                        headers=_headers(f"user-{uuid.uuid4().hex[:8]}"))
            assert r2.status_code == 201, r2.text
            assert r2.json()["userName"] == "Customer"
            assert c.post("/products/does-not-exist/reviews", json=body,
                          headers=_headers("u-x")).status_code == 404
            assert c.get("/products/does-not-exist/reviews").status_code == 404
        finally:
            c.delete(f"/products/{pid}", headers=_admin_headers())


def test_duplicate_review_409():
    with TestClient(app) as c:
        pid = _make_product(c)
        try:
            sub = f"user-{uuid.uuid4().hex[:8]}"
            body = {"rating": 4, "comment": "Nice"}
            assert c.post(f"/products/{pid}/reviews", json=body, headers=_headers(sub)).status_code == 201
            dup = c.post(f"/products/{pid}/reviews", json=body, headers=_headers(sub))
            assert dup.status_code == 409, dup.text
            assert dup.json()["error"]["code"] == "DUPLICATE_REVIEW"
        finally:
            c.delete(f"/products/{pid}", headers=_admin_headers())


def test_rating_validation_422():
    with TestClient(app) as c:
        pid = _make_product(c)
        try:
            sub = f"user-{uuid.uuid4().hex[:8]}"
            for bad in ({"rating": 0, "comment": "x"}, {"rating": 6, "comment": "x"},
                        {"rating": 5, "comment": ""}, {"rating": 5, "comment": "x" * 1001}):
                r = c.post(f"/products/{pid}/reviews", json=bad, headers=_headers(sub))
                assert r.status_code == 422, (bad, r.text)
                assert r.json()["error"]["code"] == "VALIDATION_ERROR"
        finally:
            c.delete(f"/products/{pid}", headers=_admin_headers())


def test_summary_math_and_newest_first():
    with TestClient(app) as c:
        pid = _make_product(c)
        try:
            empty = c.get(f"/products/{pid}/reviews")
            assert empty.status_code == 200
            assert empty.json() == {"items": [], "average": 0.0, "count": 0}
            u1, u2 = f"u-{uuid.uuid4().hex[:8]}", f"u-{uuid.uuid4().hex[:8]}"
            assert c.post(f"/products/{pid}/reviews", json={"rating": 5, "comment": "first"},
                          headers=_headers(u1)).status_code == 201
            assert c.post(f"/products/{pid}/reviews", json={"rating": 4, "comment": "second"},
                          headers=_headers(u2)).status_code == 201
            r = c.get(f"/products/{pid}/reviews")
            assert r.status_code == 200, r.text
            data = r.json()
            assert data["count"] == 2
            assert data["average"] == 4.5
            assert [i["comment"] for i in data["items"]] == ["second", "first"]
        finally:
            c.delete(f"/products/{pid}", headers=_admin_headers())


def test_product_list_and_detail_include_rating_fields():
    with TestClient(app) as c:
        pid = _make_product(c)
        try:
            sub = f"user-{uuid.uuid4().hex[:8]}"
            assert c.post(f"/products/{pid}/reviews", json={"rating": 3, "comment": "Meh"},
                          headers=_headers(sub)).status_code == 201
            items = c.get("/products").json()
            mine = [p for p in items if p["id"] == pid]
            assert len(mine) == 1
            assert mine[0]["ratingAverage"] == 3.0
            assert mine[0]["ratingCount"] == 1
            one = c.get(f"/products/{pid}").json()
            assert one["ratingAverage"] == 3.0 and one["ratingCount"] == 1
        finally:
            c.delete(f"/products/{pid}", headers=_admin_headers())


def test_health_ok_and_db_failure_503():
    with TestClient(app) as c:
        r = c.get("/health")
        assert r.status_code == 200
        assert r.json() == {"status": "ok", "service": "product"}

        class _FailingDB:
            def execute(self, *a, **k):
                raise RuntimeError("db down")

        def _bad_db():
            yield _FailingDB()

        app.dependency_overrides[get_db] = _bad_db
        try:
            r = c.get("/health")
            assert r.status_code == 503, r.text
            assert r.json() == {"status": "error", "service": "product"}
        finally:
            app.dependency_overrides.pop(get_db, None)
        assert c.get("/health").status_code == 200
