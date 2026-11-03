# Deployment

Local/demo (MVP): `cp .env.example .env && docker compose up --build` (full commands land with the Week 1 Compose file). GitHub Actions: per-service build + unit tests, frontend build, Docker image builds; GHCR publish + single-VM deploy in Week 7. Secrets only via environment / GitHub Secrets — never committed. Free-tier target: one small VM (e.g. Oracle Cloud Always Free / Fly.io / Render free web service for the frontend) — chosen in Week 7 based on what is actually available; no deployment is claimed until verified live.
