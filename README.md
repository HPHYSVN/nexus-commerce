# Nexus Commerce

E-commerce microservices platform (DDD + event-driven) built as a portfolio project: NestJS Gateway, Spring Boot Identity, FastAPI Product/Cart/Notification, Go Inventory/Order/Payment, PostgreSQL per-service databases, Redis cart, RabbitMQ events, React frontend.

**Status: Phase 1 Week 1 walking skeleton working** (Frontend → Gateway → Product → PostgreSQL, verified in Docker). Start with [docs/architecture/system-overview.md](docs/architecture/system-overview.md), then [bounded contexts](docs/architecture/bounded-contexts.md), [service communication](docs/architecture/service-communication.md), [ERDs](docs/database/erd.md), and [ADRs](docs/architecture/adr/).

## Run locally

```bash
cp .env.example .env   # optional; compose has dev defaults
docker compose up --build
```

- Frontend: http://localhost:5173
- Gateway health: http://localhost:3000/health
- Products via gateway: http://localhost:3000/api/products

Tests: `services/product` → `pytest`; `services/api-gateway` → `npm test`; `frontend` → `npm run build`.
