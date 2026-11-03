import json
import os


class MemoryStore:
    def __init__(self):
        self._data: dict[str, dict] = {}

    def get_cart(self, user_id: str) -> dict:
        cart = self._data.get(user_id)
        return json.loads(json.dumps(cart)) if cart else {"items": []}

    def set_cart(self, user_id: str, cart: dict) -> None:
        self._data[user_id] = json.loads(json.dumps(cart))

    def delete_cart(self, user_id: str) -> None:
        self._data.pop(user_id, None)


class RedisStore:
    def __init__(self, url: str | None = None):
        import redis
        self._client = redis.Redis.from_url(
            url or os.getenv("REDIS_URL", "redis://localhost:6379/0"),
            decode_responses=True)

    def _key(self, user_id: str) -> str:
        return f"cart:{user_id}"

    def get_cart(self, user_id: str) -> dict:
        raw = self._client.get(self._key(user_id))
        return json.loads(raw) if raw else {"items": []}

    def set_cart(self, user_id: str, cart: dict) -> None:
        self._client.set(self._key(user_id), json.dumps(cart))

    def delete_cart(self, user_id: str) -> None:
        self._client.delete(self._key(user_id))


def make_store():
    if os.getenv("CART_STORE", "").lower() == "memory":
        return MemoryStore()
    return RedisStore()
