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

## Live deployment — Fly.io Sprite (verified 2026-11-04)

**URL: https://my-first-sprite-b5urg.sprites.app** (free `sprites.app` subdomain, HTTPS, public)

A Sprite is a persistent Linux VM, so the stack runs **natively** there (`deploy/sprite/deploy.sh`): PostgreSQL/Redis/RabbitMQ from apt, Identity (jar), Product/Cart/Notification (uvicorn), Inventory/Payment/Order (Go binaries), Gateway (node), Frontend served by nginx on port 8080 — the one port the Sprite URL routes to. Strong secrets live only in the Sprite's `.env`.

Why not Docker-in-Sprite: the sandbox blocks `setns`/netns bind mounts, so `docker exec` healthchecks fail and container startup is flaky (documented in `docker-compose.sprite.yml`, kept for reference). The native path is stable and was verified end-to-end inside the Sprite: `tests/e2e.sh` DONE, `tests/concurrency.sh` PASSED (no oversell), `tests/security.sh` 15/15 — and the security suite also passes from the internet against the public URL. A Sprite checkpoint (`v3`) snapshots the deployed state; restore with `sprite restore v3`.

Persistence caveat: the Sprite sleeps when idle; processes resume on wake (first request may be slow). If processes ever need a restart: `sprite exec -s my-first-sprite -- bash deploy/sprite/deploy.sh`.

Custom free domain: not attached — a custom DNS name (e.g. DuckDNS) can CNAME to the host, but the Sprite serves TLS only for `*.sprites.app`, so a custom name would fail TLS/routing. The free `sprites.app` subdomain is the domain for this deployment.

## Public demo (ephemeral tunnel, verified 2026-11-03, superseded by Sprite above)

The hardened stack (strong generated `.env`, fresh volumes) is exposed over HTTPS via a Cloudflare quick tunnel to the frontend container only (backend ports are not tunneled):

- Demo URL pattern: `https://<random>.trycloudflare.com` — get the current URL with `grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' /tmp/opencode/cloudflared.log`
- Start: `/tmp/opencode/cloudflared tunnel --url http://127.0.0.1:5173 --no-autoupdate`
- Verified from the public URL: frontend 200, `/api/products` 200, unauthenticated `/api/cart` 401, admin login + notifications OK.
- Caveat: the tunnel lives only while the host machine and the `cloudflared` process are running; the URL changes on restart. This is a demo channel, not a persistent VM.

## Free-VM evaluation

| Option | Blocker for autonomous deploy |
|---|---|
| Oracle Cloud Always Free (Ampere VM) | Signup requires personal identity + payment-card verification — must be done by the account owner |
| Fly.io / Railway | Require account + card on file |
| Render free web services | Account signup required; free tier sleeps and is not suited to a 12-container Compose stack (would need per-service plans + managed Postgres/Redis/RabbitMQ) |
| AWS/GCP/Azure free tiers | Account + card verification required |

Next step for a persistent deployment: owner creates one of the above accounts, then follows "Single VM" above. No credentials were created or used by the agent.

## Status

- CI on GitHub Actions: **green** (all unit jobs + Docker build + composed smoke test) — see badge in README.
- Security: compose fails closed without a strong `.env` (no default secrets); verified by `tests/security.sh` (15/15) and `tests/concurrency.sh`.
