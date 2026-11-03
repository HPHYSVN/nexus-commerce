from contextlib import asynccontextmanager
from decimal import Decimal
from fastapi import FastAPI, Depends, HTTPException, Query
from pydantic import BaseModel
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
