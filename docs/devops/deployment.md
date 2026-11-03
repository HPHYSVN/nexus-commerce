# Deployment

## Local / demo (verified)

```bash
cp .env.example .env
docker compose up --build
bash tests/e2e.sh          # end-to-end smoke
bash tests/concurrency.sh  # oversell/concurrency check
```

## Single VM (free tier)

Target: any small Linux VM with Docker (e.g. Oracle Cloud Always Free, a university server, or a home server with a tunnel). Verified procedure:

```bash
git clone https://github.com/HPHYSVN/nexus-commerce.git
cd nexus-commerce
cp .env.example .env   # set strong JWT_SECRET (>=32 chars) and DB passwords
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
curl http://localhost:3000/health
```

Put the VM's reverse proxy (Caddy/nginx with TLS, e.g. Caddy `reverse_proxy localhost:5173`) in front of port 5173 for HTTPS. Only 80/443 should be public; PostgreSQL/Redis/RabbitMQ ports are never published.

## Status

- CI on GitHub Actions: **green** (all unit jobs + Docker build + composed smoke test) — see badge in README.
- Public cloud deployment: **not yet performed** (no cloud account/CLI available in the dev environment). The Compose stack above is the deployment artifact; no live URL is claimed until one is actually provisioned and verified.
