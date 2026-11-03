import os
os.environ["DATABASE_URL"] = "sqlite:///./test_product.db"
from fastapi.testclient import TestClient
from app.main import app

def test_health_and_seeded_products():
    with TestClient(app) as c:
        assert c.get("/health").json()["status"] == "ok"
        r = c.get("/products")
        assert r.status_code == 200
        items = r.json()
        assert len(items) == 3
        assert items[0]["price"] > 0
        one = c.get(f"/products/{items[0]['id']}")
        assert one.status_code == 200
        assert c.get("/products/does-not-exist").status_code == 404
        assert len(c.get("/products?q=headphones").json()) == 1
