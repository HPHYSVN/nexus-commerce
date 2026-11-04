import os
import re
from contextlib import asynccontextmanager
from datetime import datetime
from decimal import Decimal
import jwt
from fastapi import FastAPI, Depends, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy import select, func, text
from .db import Base, engine, get_db
from .models import Category, Product, Review

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


def require_user(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer ") or not auth[7:].strip():
        raise HTTPException(status_code=401, detail=_err("UNAUTHORIZED", "Missing bearer token"))
    secret = os.getenv("JWT_SECRET", "")
    try:
        payload = jwt.decode(auth[7:].strip(), secret, algorithms=["HS256"])
    except Exception:
        raise HTTPException(status_code=401, detail=_err("UNAUTHORIZED", "Invalid or expired token"))
    if not payload.get("sub"):
        raise HTTPException(status_code=401, detail=_err("UNAUTHORIZED", "Token missing sub"))
    return payload


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "product"


class ProductOut(BaseModel):
    id: str; name: str; slug: str; description: str; price: float
    image_url: str; category: str | None = None
    ratingAverage: float = 0.0; ratingCount: int = 0

def _ratings(db: Session, product_ids: list[str]) -> dict[str, tuple[float, int]]:
    if not product_ids:
        return {}
    rows = db.execute(
        select(Review.product_id, func.avg(Review.rating), func.count(Review.id))
        .where(Review.product_id.in_(product_ids))
        .group_by(Review.product_id)).all()
    return {pid: (round(float(avg or 0), 1), int(count)) for pid, avg, count in rows}

def to_out(p: Product, rating: tuple[float, int] = (0.0, 0)) -> ProductOut:
    return ProductOut(id=p.id, name=p.name, slug=p.slug, description=p.description,
                      price=float(p.price), image_url=p.image_url,
                      category=p.category.name if p.category else None,
                      ratingAverage=rating[0], ratingCount=rating[1])

def _to_out_with_rating(db: Session, p: Product) -> ProductOut:
    return to_out(p, _ratings(db, [p.id]).get(p.id, (0.0, 0)))

@app.get("/health")
def health(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        return JSONResponse(status_code=503, content={"status": "error", "service": "product"})
    return {"status": "ok", "service": "product"}

@app.get("/products", response_model=list[ProductOut])
def list_products(db: Session = Depends(get_db), q: str | None = Query(default=None),
                  page: int = Query(default=1, ge=1), size: int = Query(default=20, ge=1, le=100)):
    stmt = select(Product).where(Product.is_active.is_(True))
    if q:
        stmt = stmt.where(Product.name.ilike(f"%{q}%"))
    rows = db.scalars(stmt.order_by(Product.created_at).offset((page - 1) * size).limit(size)).all()
    ratings = _ratings(db, [p.id for p in rows])
    return [to_out(p, ratings.get(p.id, (0.0, 0))) for p in rows]

@app.get("/products/{product_id}", response_model=ProductOut)
def get_product(product_id: str, db: Session = Depends(get_db)):
    p = db.get(Product, product_id)
    if not p or not p.is_active:
        raise HTTPException(status_code=404, detail={"error": {"code": "PRODUCT_NOT_FOUND", "message": "Product not found"}})
    return _to_out_with_rating(db, p)


class ReviewCreate(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str = Field(min_length=1, max_length=1000)

    @field_validator("comment", mode="before")
    @classmethod
    def _strip_comment(cls, v):
        if isinstance(v, str):
            v = v.strip()
            if not v:
                raise ValueError("must not be empty")
        return v


class ReviewOut(BaseModel):
    id: str
    productId: str
    userId: str
    userName: str
    rating: int
    comment: str
    createdAt: datetime | None = None


class ReviewListOut(BaseModel):
    items: list[ReviewOut]
    average: float = 0.0
    count: int = 0


def _review_out(r: Review) -> ReviewOut:
    return ReviewOut(id=r.id, productId=r.product_id, userId=r.user_id,
                     userName=r.user_name, rating=r.rating, comment=r.comment,
                     createdAt=r.created_at)


def _active_product(db: Session, product_id: str) -> Product:
    p = db.get(Product, product_id)
    if not p or not p.is_active:
        raise HTTPException(status_code=404, detail=_err("PRODUCT_NOT_FOUND", "Product not found"))
    return p


@app.post("/products/{product_id}/reviews", response_model=ReviewOut, status_code=201)
def create_review(product_id: str, body: ReviewCreate, db: Session = Depends(get_db),
                  user: dict = Depends(require_user)):
    _active_product(db, product_id)
    user_id = str(user["sub"])
    existing = db.scalar(select(Review).where(Review.product_id == product_id,
                                              Review.user_id == user_id))
    if existing:
        raise HTTPException(status_code=409, detail=_err("DUPLICATE_REVIEW", "User has already reviewed this product"))
    review = Review(product_id=product_id, user_id=user_id,
                    user_name=str(user.get("email") or user.get("name") or "Customer"),
                    rating=body.rating, comment=body.comment)
    db.add(review)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=_err("DUPLICATE_REVIEW", "User has already reviewed this product"))
    db.refresh(review)
    return _review_out(review)


@app.get("/products/{product_id}/reviews", response_model=ReviewListOut)
def list_reviews(product_id: str, db: Session = Depends(get_db)):
    _active_product(db, product_id)
    rows = db.scalars(select(Review).where(Review.product_id == product_id)
                      .order_by(Review.created_at.desc())).all()
    average = round(sum(r.rating for r in rows) / len(rows), 1) if rows else 0.0
    return ReviewListOut(items=[_review_out(r) for r in rows], average=float(average), count=len(rows))


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
    return _to_out_with_rating(db, p)


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
    return _to_out_with_rating(db, p)


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
