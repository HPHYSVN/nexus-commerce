# Nexus Commerce

[![CI](https://github.com/HPHYSVN/nexus-commerce/actions/workflows/ci.yml/badge.svg)](https://github.com/HPHYSVN/nexus-commerce/actions/workflows/ci.yml)

E-commerce microservices platform (DDD + event-driven) built as a portfolio project. Repository: https://github.com/HPHYSVN/nexus-commerce

| Service | Stack | Port | Store |
|---|---|---|---|
| API Gateway | NestJS — JWT verify, rate limit, proxy | 3000 | — |
| Identity | Spring Boot — BCrypt, JWT + refresh rotation, RBAC | 8081 | PostgreSQL |
| Product | FastAPI — catalog, categories, search | 8001 | PostgreSQL |
| Cart | FastAPI | 8002 | Redis |
| Inventory | Go + Gin — atomic stock reservation | 8082 | PostgreSQL |
| Order | Go + Gin — checkout orchestration, snapshots | 8083 | PostgreSQL |
| Payment | Go + Gin — mock provider, idempotency | 8084 | PostgreSQL |
| Notification | FastAPI — RabbitMQ consumer, idempotent | 8003 | PostgreSQL |
| Frontend | React + TS + Vite + Tailwind (nginx) | 5173 | — |

## Run

```bash
cp .env.example .env   # optional; compose ships dev defaults
docker compose up --build
```

- Frontend: http://localhost:5173 · Gateway: http://localhost:3000/health · Products: http://localhost:3000/api/products
- Demo admin (seeded): `admin@nexus.local` / `Admin123!`
- Mock payment: in checkout choose "payment succeeds" (`tok_success`) or "payment fails" (`tok_fail`, verifies stock release). No real payments.

## Architecture

See [system overview](docs/architecture/system-overview.md), [bounded contexts](docs/architecture/bounded-contexts.md), [service communication](docs/architecture/service-communication.md), [deployment](docs/architecture/deployment-architecture.md), [ERDs](docs/database/erd.md), [API overview](docs/api/api-overview.md), [test strategy](docs/testing/test-strategy.md), [ADRs](docs/architecture/adr/).

Key decisions: database-per-service on one PostgreSQL instance with per-service users (ADR-0002); HS256 JWT verified at gateway **and** every service (ADR-0003); synchronous reserve→pay→confirm checkout with compensation, events published after for notifications (ADR-0004); oversell prevented by a single atomic `UPDATE ... WHERE quantity - reserved >= qty`.

## Tests

```bash
bash tests/e2e.sh          # full flow against a running stack (register → order → notification)
# unit: services/{product,cart,notification} pytest · services/{inventory,payment,order} go test ./...
#       services/identity mvn test · services/api-gateway npm test · frontend npm run build
```

CI (`.github/workflows/ci.yml`) runs all unit suites, builds every Docker image, and smoke-tests the composed stack.
