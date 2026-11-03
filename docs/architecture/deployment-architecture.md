# Deployment Architecture

MVP target: **one free-tier VM** (or local demo) running Docker Compose. No Kubernetes.

```mermaid
flowchart TB
    I[Internet] -->|80/443| VM[Single VM / local host]
    subgraph VM
        NG[Frontend container<br/>Vite build served by nginx<br/>:3000 → host :5173 dev]
        GW[api-gateway :3000]
        ID[identity :8081] & PR[product :8001] & CA[cart :8002]
        IN[inventory :8082] & OR[order :8083] & PA[payment :8084] & NO[notification :8003]
        PG[(postgres :5432<br/>7 databases)] & RD[(redis :6379)] & MQ[rabbitmq :5672/:15672]
        NG --> GW
        GW --> ID & PR & CA & OR
        OR --> IN & PA
    end
```

Rules: only Frontend and Gateway ports are published to the host in production profile; infra ports (5432/6379/15672) are published only in the dev profile. All services: `restart: unless-stopped`, healthchecks, `depends_on: condition: service_healthy`, named volumes for PostgreSQL/Redis/RabbitMQ, secrets only via `.env` (see `.env.example`). CI (GitHub Actions) builds + tests each service; image publishing to GHCR and VM deploy are Week 7 tasks.
