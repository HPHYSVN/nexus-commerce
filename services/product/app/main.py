import os
import re
from contextlib import asynccontextmanager
from decimal import Decimal
import jwt
from fastapi import FastAPI, Depends, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy import select, func
from .db import Base, engine, get_db
from .models import Category, Product

SEED = [
    ("Electronics", "electronics", "Wireless Headphones", "wireless-headphones", "Noise-cancelling over-ear headphones", "79.99", "https://picsum.photos/seed/headphones/600/400"),
    ("Electronics", "electronics", "Mechanical Keyboard", "mechanical-keyboard", "Hot-swappable mechanical keyboard", "119.00", "https://picsum.photos/seed/keyboard/600/400"),
    ("Home", "home", "Ceramic Mug Set", "ceramic-mug-set", "Set of 4 stoneware mugs", "34.50", "https://picsum.photos/seed/mugs/600/400"),
]

def seed(db: Session) -> None:
    if db.scalar(select(func.count()).select_from(Product)):
        return
    cats: dict[str, Category] = {}
    for cat_name, cat_slug, name, slug, desc, price, img in SEED:
        if cat_slug not in cats:
            cats[cat_slug] = db.scalar(select(Category).where(Category.slug == cat_slug)) or Category(name=cat_name, slug=cat_slug)
            db.add(cats[cat_slug]); db.flush()
        db.add(Product(category_id=cats[cat_slug].id, name=name, slug=slug, description=desc, price=Decimal(price), image_url=img))
    db.commit()

@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    from .db import SessionLocal
    db = SessionLocal()
    try: seed(db)
    finally: db.close()
    yield

app = FastAPI(title="Nexus Product Service", version="0.1.0", lifespan=lifespan)


def _err(code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message}}


@app.exception_handler(HTTPException)
async def http_exception_handler(_: Request, exc: HTTPException):
    if isinstance(exc.detail, dict) and "error" in exc.detail:
        return JSONResponse(status_code=exc.status_code, content=exc.detail)
    return JSONResponse(status_code=exc.status_code,
                        content=_err("HTTP_ERROR", str(exc.detail)))


@app.exception_handler(RequestValidationError)
async def validation_handler(_: Request, exc: RequestValidationError):
    return JSONResponse(status_code=422, content=_err("VALIDATION_ERROR", str(exc.errors())))


def require_admin(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer ") or not auth[7:].strip():
        raise HTTPException(status_code=401, detail=_err("UNAUTHORIZED", "Missing bearer token"))
    secret = os.getenv("JWT_SECRET", "")
    try:
        payload = jwt.decode(auth[7:].strip(), secret, algorithms=["HS256"])
    except Exception:
        raise HTTPException(status_code=401, detail=_err("UNAUTHORIZED", "Invalid or expired token"))
    role = payload.get("role")
    roles = payload.get("roles") or ([role] if role else [])
    if "ADMIN" not in roles:
        raise HTTPException(status_code=403, detail=_err("FORBIDDEN", "Admin role required"))
    return payload


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "product"


class ProductOut(BaseModel):
    id: str; name: str; slug: str; description: str; price: float
    image_url: str; category: str | None = None

def to_out(p: Product) -> ProductOut:
    return ProductOut(id=p.id, name=p.name, slug=p.slug, description=p.description,
                      price=float(p.price), image_url=p.image_url,
                      category=p.category.name if p.category else None)

@app.get("/health")
def health():
    return {"status": "ok", "service": "product"}

@app.get("/products", response_model=list[ProductOut])
def list_products(db: Session = Depends(get_db), q: str | None = Query(default=None),
                  page: int = Query(default=1, ge=1), size: int = Query(default=20, ge=1, le=100)):
    stmt = select(Product).where(Product.is_active.is_(True))
    if q:
        stmt = stmt.where(Product.name.ilike(f"%{q}%"))
    rows = db.scalars(stmt.order_by(Product.created_at).offset((page - 1) * size).limit(size)).all()
    return [to_out(p) for p in rows]

@app.get("/products/{product_id}", response_model=ProductOut)
def get_product(product_id: str, db: Session = Depends(get_db)):
    p = db.get(Product, product_id)
    if not p or not p.is_active:
        raise HTTPException(status_code=404, detail={"error": {"code": "PRODUCT_NOT_FOUND", "message": "Product not found"}})
    return to_out(p)


class ProductCreate(BaseModel):
    name: str = Field(min_length=1)
    slug: str | None = None
    description: str = ""
    price: float = Field(ge=0)
    image_url: str = ""
    category_id: str | None = None
    category: str | None = None

    @field_validator("name", "slug", mode="before")
    @classmethod
    def _strip(cls, v):
        if isinstance(v, str):
            v = v.strip()
            if not v:
                raise ValueError("must not be empty")
        return v


class ProductUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    slug: str | None = None
    description: str | None = None
    price: float | None = Field(default=None, ge=0)
    image_url: str | None = None
    category_id: str | None = None
    category: str | None = None

    @field_validator("name", "slug", mode="before")
    @classmethod
    def _strip(cls, v):
        if isinstance(v, str):
            v = v.strip()
            if not v:
                raise ValueError("must not be empty")
        return v


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1)
    slug: str | None = None

    @field_validator("name", "slug", mode="before")
    @classmethod
    def _strip(cls, v):
        if isinstance(v, str):
            v = v.strip()
            if not v:
                raise ValueError("must not be empty")
        return v


class CategoryOut(BaseModel):
    id: str
    name: str
    slug: str


def _resolve_category(db: Session, category_id: str | None, category: str | None) -> str | None:
    if category_id:
        if not db.get(Category, category_id):
            raise HTTPException(status_code=422, detail=_err("VALIDATION_ERROR", "Category not found"))
        return category_id
    if category:
        existing = db.scalar(select(Category).where(Category.name == category))
        if existing:
            return existing.id
        cat = Category(name=category, slug=_slugify(category))
        db.add(cat)
        db.flush()
        return cat.id
    return None


@app.post("/products", response_model=ProductOut, status_code=201)
def create_product(body: ProductCreate, db: Session = Depends(get_db), _: dict = Depends(require_admin)):
    slug = body.slug or _slugify(body.name)
    if db.scalar(select(Product).where(Product.slug == slug)):
        raise HTTPException(status_code=409, detail=_err("DUPLICATE_SLUG", "Product slug already exists"))
    p = Product(name=body.name, slug=slug, description=body.description,
                price=Decimal(str(body.price)), image_url=body.image_url,
                category_id=_resolve_category(db, body.category_id, body.category))
    db.add(p)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=_err("DUPLICATE_SLUG", "Product slug already exists"))
    db.refresh(p)
    return to_out(p)


@app.put("/products/{product_id}", response_model=ProductOut)
def update_product(product_id: str, body: ProductUpdate, db: Session = Depends(get_db), _: dict = Depends(require_admin)):
    p = db.get(Product, product_id)
    if not p or not p.is_active:
        raise HTTPException(status_code=404, detail=_err("PRODUCT_NOT_FOUND", "Product not found"))
    data = body.model_dump(exclude_unset=True)
    category_marker = ("category_id" in data) or ("category" in data)
    cat_id = data.pop("category_id", None)
    cat_name = data.pop("category", None)
    if "slug" in data and data["slug"]:
        clash = db.scalar(select(Product).where(Product.slug == data["slug"], Product.id != product_id))
        if clash:
            raise HTTPException(status_code=409, detail=_err("DUPLICATE_SLUG", "Product slug already exists"))
    if category_marker:
        p.category_id = _resolve_category(db, cat_id, cat_name)
    for field, value in data.items():
        if value is None:
            continue
        setattr(p, field, Decimal(str(value)) if field == "price" else value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=_err("DUPLICATE_SLUG", "Product slug already exists"))
    db.refresh(p)
    return to_out(p)


@app.delete("/products/{product_id}", status_code=204)
def delete_product(product_id: str, db: Session = Depends(get_db), _: dict = Depends(require_admin)):
    p = db.get(Product, product_id)
    if not p or not p.is_active:
        raise HTTPException(status_code=404, detail=_err("PRODUCT_NOT_FOUND", "Product not found"))
    p.is_active = False
    db.commit()
    return Response(status_code=204)


@app.get("/categories", response_model=list[CategoryOut])
def list_categories(db: Session = Depends(get_db)):
    rows = db.scalars(select(Category).order_by(Category.name)).all()
    return [CategoryOut(id=c.id, name=c.name, slug=c.slug) for c in rows]


@app.post("/categories", response_model=CategoryOut, status_code=201)
def create_category(body: CategoryCreate, db: Session = Depends(get_db), _: dict = Depends(require_admin)):
    slug = body.slug or _slugify(body.name)
    if db.scalar(select(Category).where((Category.slug == slug) | (Category.name == body.name))):
        raise HTTPException(status_code=409, detail=_err("DUPLICATE_SLUG", "Category slug or name already exists"))
    cat = Category(name=body.name, slug=slug)
    db.add(cat)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=_err("DUPLICATE_SLUG", "Category slug or name already exists"))
    db.refresh(cat)
    return CategoryOut(id=cat.id, name=cat.name, slug=cat.slug)
