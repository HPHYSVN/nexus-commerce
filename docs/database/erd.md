# Entity-Relationship Diagrams (draft — finalized per service in its phase)

## Identity (`identity_db`)

```mermaid
erDiagram
    USERS ||--o{ REFRESH_TOKENS : has
    USERS {
        uuid id PK
        varchar email UK
        varchar password_hash
        varchar full_name
        varchar role "CUSTOMER|ADMIN"
        timestamptz created_at
    }
    REFRESH_TOKENS {
        uuid id PK
        uuid user_id FK
        varchar token_hash UK
        timestamptz expires_at
        timestamptz revoked_at
    }
```

## Product (`product_db`)

```mermaid
erDiagram
    CATEGORIES ||--o{ PRODUCTS : contains
    PRODUCTS ||--o{ PRODUCT_IMAGES : has
    CATEGORIES { uuid id PK, varchar name UK, varchar slug UK }
    PRODUCTS {
        uuid id PK
        uuid category_id FK
        varchar name
        varchar slug UK
        text description
        numeric price ">= 0"
        boolean is_active
        timestamptz created_at
    }
    PRODUCT_IMAGES { uuid id PK, uuid product_id FK, varchar url, int sort_order }
```

Indexes: `products(name)` trigram for search, `products(category_id)`.

## Inventory (`inventory_db`)

```mermaid
erDiagram
    STOCK_ITEMS ||--o{ RESERVATIONS : holds
    STOCK_ITEMS {
        uuid product_id PK "no FK - other service's id, by value"
        int quantity ">= 0"
        int reserved ">= 0, reserved <= quantity"
        timestamptz updated_at
    }
    RESERVATIONS {
        uuid id PK
        uuid product_id FK
        uuid order_id "by value"
        int quantity
        varchar status "ACTIVE|CONFIRMED|RELEASED"
        timestamptz expires_at
    }
```

Oversell prevention: single atomic `UPDATE ... WHERE quantity - reserved >= $qty`, row count checked.

## Cart (Redis)

Key `cart:{userId}` → hash/JSON `{ items: [{productId, quantity}] }`, TTL 7 days. No relational ERD; prices are **not** stored (resolved at checkout).

## Order (`order_db`)

```mermaid
erDiagram
    ORDERS ||--o{ ORDER_ITEMS : contains
    ORDERS {
        uuid id PK
        uuid user_id "by value"
        varchar status "PENDING|CONFIRMED|PROCESSING|SHIPPED|DELIVERED|PAYMENT_FAILED|CANCELLED"
        numeric total_amount
        timestamptz created_at
    }
    ORDER_ITEMS {
        uuid id PK
        uuid order_id FK
        uuid product_id "by value"
        varchar product_name_snapshot
        numeric unit_price_snapshot
        int quantity
    }
```

## Payment (`payment_db`)

```mermaid
erDiagram
    PAYMENTS {
        uuid id PK
        uuid order_id UK "idempotency: one payment per order"
        uuid user_id "by value"
        numeric amount
        varchar status "PENDING|SUCCEEDED|FAILED"
        varchar provider "MOCK"
        varchar idempotency_key UK
        timestamptz created_at
    }
```

## Notification (`notification_db`)

```mermaid
erDiagram
    NOTIFICATIONS {
        uuid id PK
        uuid user_id "by value, nullable"
        varchar event_type
        varchar channel "LOG (MVP)"
        text message
        varchar status "SENT|FAILED"
        timestamptz created_at
    }
    PROCESSED_EVENTS { varchar event_id PK, timestamptz processed_at }
```
