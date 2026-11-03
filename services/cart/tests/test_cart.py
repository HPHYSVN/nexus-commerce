import os
from datetime import datetime, timedelta, timezone

os.environ["CART_STORE"] = "memory"
os.environ["JWT_SECRET"] = "test-secret"

import jwt  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402


def _headers(sub="user-1"):
    token = jwt.encode({"sub": sub, "role": "CUSTOMER",
                        "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
                       "test-secret", algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def test_cart_requires_auth():
    with TestClient(app) as c:
        assert c.get("/health").json()["status"] == "ok"
        r = c.get("/cart")
        assert r.status_code == 401
        assert r.json()["error"]["code"] == "UNAUTHORIZED"
        assert c.post("/cart/items", json={"productId": "p1", "productName": "A",
                                           "unitPrice": 1, "quantity": 1}).status_code == 401


def test_add_merge_update_remove_subtotal():
    h = _headers("user-flow")
    with TestClient(app) as c:
        c.delete("/cart", headers=h)
        r = c.post("/cart/items", json={"productId": "p1", "productName": "Widget",
                                        "unitPrice": 10.50, "quantity": 2}, headers=h)
        assert r.status_code == 200, r.text
        assert r.json()["subtotal"] == 21.0

        r = c.post("/cart/items", json={"productId": "p1", "productName": "Widget",
                                        "unitPrice": 10.50, "quantity": 1}, headers=h)
        assert len(r.json()["items"]) == 1
        assert r.json()["items"][0]["quantity"] == 3
        assert r.json()["subtotal"] == 31.5

        r = c.post("/cart/items", json={"productId": "p2", "productName": "Gadget",
                                        "unitPrice": 0.10, "quantity": 3}, headers=h)
        assert r.json()["subtotal"] == 31.8

        assert c.post("/cart/items", json={"productId": "p3", "productName": "Bad",
                                           "unitPrice": 1, "quantity": 0}, headers=h).status_code == 422

        r = c.put("/cart/items/p1", json={"quantity": 1}, headers=h)
        assert r.json()["items"][0]["quantity"] == 1
        assert r.json()["subtotal"] == 10.8

        r = c.put("/cart/items/p2", json={"quantity": 0}, headers=h)
        assert [i["productId"] for i in r.json()["items"]] == ["p1"]

        r = c.delete("/cart/items/p1", headers=h)
        assert r.json()["items"] == []
        assert r.json()["subtotal"] == 0

        c.post("/cart/items", json={"productId": "p9", "productName": "X",
                                    "unitPrice": 5, "quantity": 1}, headers=h)
        r = c.delete("/cart", headers=h)
        assert r.json()["items"] == []
        assert c.get("/cart", headers=h).json()["userId"] == "user-flow"


def test_carts_isolated_per_user():
    with TestClient(app) as c:
        c.delete("/cart", headers=_headers("alice"))
        c.post("/cart/items", json={"productId": "p1", "productName": "A",
                                    "unitPrice": 2, "quantity": 1}, headers=_headers("alice"))
        assert c.get("/cart", headers=_headers("bob")).json()["items"] == []
        c.delete("/cart", headers=_headers("alice"))
