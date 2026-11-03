# Bounded Contexts

```mermaid
flowchart LR
    subgraph Identity["1. Identity & Access"]
        U[User · Role<br/>CUSTOMER / ADMIN]
    end
    subgraph Catalog["2. Product Catalog"]
        P[Product · Category<br/>price, images]
    end
    subgraph Inv["3. Inventory"]
        S[StockItem · Reservation]
    end
    subgraph CartC["4. Shopping Cart"]
        C[Cart · CartItem<br/>Redis, ephemeral]
    end
    subgraph OrderC["5. Order Management"]
        O[Order · OrderItem<br/>price/name snapshots]
    end
    subgraph Pay["6. Payment"]
        PAY[Payment · idempotency key]
    end
    subgraph Notif["7. Notification"]
        N[Notification log]
    end
    Catalog -->|productId, price lookup at checkout| OrderC
    OrderC -->|reserve / release / confirm| Inv
    OrderC -->|charge| Pay
    OrderC -. events .-> Notif
    Pay -. events .-> Notif
    CartC -->|checkout handoff| OrderC
    Identity -. JWT (userId, role) .-> OrderC
```

| Context | Service | Store | Owns | Publishes | Consumes |
|---|---|---|---|---|---|
| Identity & Access | Identity (Spring Boot) | PostgreSQL `identity_db` | users, roles, refresh tokens | — (MVP) | — |
| Product Catalog | Product (FastAPI) | PostgreSQL `product_db` | products, categories | — (MVP) | — |
| Inventory | Inventory (Go) | PostgreSQL `inventory_db` | stock, reservations | InventoryReserved / ReservationFailed (Phase 5 saga) | — |
| Shopping Cart | Cart (FastAPI) | Redis | carts (TTL 7d) | — | — |
| Order Management | Order (Go) | PostgreSQL `order_db` | orders, order items | OrderCreated, OrderConfirmed, OrderCancelled | PaymentSucceeded / PaymentFailed (Phase 5) |
| Payment | Payment (Go) | PostgreSQL `payment_db` | payments, idempotency keys | PaymentSucceeded, PaymentFailed | — |
| Notification | Notification (FastAPI) | PostgreSQL `notification_db` | notification log | — | Order*, Payment*, NotificationRequested |

Anti-corruption rules: Order stores product name + unit-price snapshots; it never re-reads Product prices for existing orders. Cart holds only `productId + qty`; prices are resolved at checkout from Product, then snapshotted into the order.
