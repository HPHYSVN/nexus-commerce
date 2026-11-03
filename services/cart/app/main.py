import os

import jwt
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .store import make_store

app = FastAPI(title="Nexus Cart Service", version="0.1.0")
store = make_store()


def _err(code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message}}


@app.exception_handler(HTTPException)
async def http_exception_handler(_: Request, exc: HTTPException):
    if isinstance(exc.detail, dict) and "error" in exc.detail:
        return JSONResponse(status_code=exc.status_code, content=exc.detail)
    return JSONResponse(status_code=exc.status_code, content=_err("HTTP_ERROR", str(exc.detail)))


@app.exception_handler(RequestValidationError)
async def validation_handler(_: Request, exc: RequestValidationError):
    return JSONResponse(status_code=422, content=_err("VALIDATION_ERROR", str(exc.errors())))


def require_user(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer ") or not auth[7:].strip():
        raise HTTPException(status_code=401, detail=_err("UNAUTHORIZED", "Missing bearer token"))
    try:
        payload = jwt.decode(auth[7:].strip(), os.getenv("JWT_SECRET", ""), algorithms=["HS256"])
    except Exception:
        raise HTTPException(status_code=401, detail=_err("UNAUTHORIZED", "Invalid or expired token"))
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail=_err("UNAUTHORIZED", "Token missing sub"))
    return str(user_id)


class CartItemIn(BaseModel):
    productId: str = Field(min_length=1)
    productName: str = Field(min_length=1)
    unitPrice: float = Field(ge=0)
    quantity: int = Field(gt=0)


class CartItemUpdate(BaseModel):
    quantity: int = Field(ge=0)


def _cart_out(user_id: str, cart: dict) -> dict:
    items = cart.get("items", [])
    subtotal = round(sum(float(i["unitPrice"]) * int(i["quantity"]) for i in items), 2)
    return {"userId": user_id, "items": items, "subtotal": subtotal}


@app.get("/health")
def health():
    return {"status": "ok", "service": "cart"}


@app.get("/cart")
def get_cart(user_id: str = Depends(require_user)):
    return _cart_out(user_id, store.get_cart(user_id))


@app.post("/cart/items")
def add_item(body: CartItemIn, user_id: str = Depends(require_user)):
    cart = store.get_cart(user_id)
    for item in cart["items"]:
        if item["productId"] == body.productId:
            item["quantity"] += body.quantity
            item["productName"] = body.productName
            item["unitPrice"] = body.unitPrice
            break
    else:
        cart["items"].append(body.model_dump())
    store.set_cart(user_id, cart)
    return _cart_out(user_id, cart)


@app.put("/cart/items/{product_id}")
def update_item(product_id: str, body: CartItemUpdate, user_id: str = Depends(require_user)):
    cart = store.get_cart(user_id)
    if body.quantity == 0:
        cart["items"] = [i for i in cart["items"] if i["productId"] != product_id]
    else:
        found = False
        for item in cart["items"]:
            if item["productId"] == product_id:
                item["quantity"] = body.quantity
                found = True
        if not found:
            raise HTTPException(status_code=404, detail=_err("ITEM_NOT_FOUND", "Cart item not found"))
    store.set_cart(user_id, cart)
    return _cart_out(user_id, cart)


@app.delete("/cart/items/{product_id}")
def remove_item(product_id: str, user_id: str = Depends(require_user)):
    cart = store.get_cart(user_id)
    cart["items"] = [i for i in cart["items"] if i["productId"] != product_id]
    store.set_cart(user_id, cart)
    return _cart_out(user_id, cart)


@app.delete("/cart")
def clear_cart(user_id: str = Depends(require_user)):
    store.delete_cart(user_id)
    return _cart_out(user_id, {"items": []})
