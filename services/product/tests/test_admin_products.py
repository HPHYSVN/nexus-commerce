import os
import uuid
from datetime import datetime, timedelta, timezone

os.environ["DATABASE_URL"] = "sqlite:///./test_product.db"
os.environ["JWT_SECRET"] = "test-secret"

import jwt  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402


def _token(role="ADMIN", sub="admin-1"):
    payload = {"sub": sub, "role": role,
               "exp": datetime.now(timezone.utc) + timedelta(hours=1)}
    return jwt.encode(payload, "test-secret", algorithm="HS256")


def _headers(role="ADMIN"):
    return {"Authorization": f"Bearer {_token(role)}"}


def test_admin_create_requires_token_and_role():
    with TestClient(app) as c:
        body = {"name": "Guarded", "slug": f"guarded-{uuid.uuid4().hex[:8]}", "price": 1}
        r = c.post("/products", json=body)
        assert r.status_code == 401
        assert r.json()["error"]["code"] == "UNAUTHORIZED"
        r = c.post("/products", json=body, headers=_headers("CUSTOMER"))
        assert r.status_code == 403
        assert r.json()["error"]["code"] == "FORBIDDEN"
        assert c.post("/categories", json={"name": "GuardedCat"}).status_code == 401


def test_admin_create_update_delete_flow():
    suffix = uuid.uuid4().hex[:8]
    slug = f"widget-{suffix}"
    product_id = None
    with TestClient(app) as c:
        try:
            r = c.post("/products", json={"name": "Widget", "slug": slug, "price": 9.99,
                                          "description": "d", "image_url": ""},
                       headers=_headers())
            assert r.status_code == 201, r.text
            product_id = r.json()["id"]
            assert r.json()["slug"] == slug

            dup = c.post("/products", json={"name": "Widget2", "slug": slug, "price": 1},
                         headers=_headers())
            assert dup.status_code == 409

            bad = c.post("/products", json={"name": "", "price": -1}, headers=_headers())
            assert bad.status_code == 422

            upd = c.put(f"/products/{product_id}", json={"name": "Widget Pro", "price": 19.5},
                        headers=_headers())
            assert upd.status_code == 200, upd.text
            assert upd.json()["name"] == "Widget Pro"
            assert upd.json()["price"] == 19.5

            cat = c.post("/categories", json={"name": f"Cat {suffix}", "slug": f"cat-{suffix}"},
                         headers=_headers())
            assert cat.status_code == 201, cat.text
            assert any(x["slug"] == f"cat-{suffix}" for x in c.get("/categories").json())

            dele = c.delete(f"/products/{product_id}", headers=_headers())
            assert dele.status_code == 204
            product_id = None
            assert c.get(f"/products/{r.json()['id']}").status_code == 404
        finally:
            if product_id:
                c.delete(f"/products/{product_id}", headers=_headers())
