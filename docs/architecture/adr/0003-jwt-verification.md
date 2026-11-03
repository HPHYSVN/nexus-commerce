# ADR-0003: JWT — HS256 shared secret, verified at gateway AND each service

Status: Accepted (proposed for approval) · 2026-11-03

Context: Spec requires gateway JWT verification but also forbids blindly trusting identity headers. RS256 + JWKS from Identity is the stronger design but requires JWKS fetching/caching in 4 stacks.

Decision (MVP): Identity issues HS256 access tokens (15 min) + rotating refresh tokens (7 d, stored hashed, revocable). Secret via `JWT_SECRET` env, shared with Gateway and every service. Gateway verifies and forwards the original `Authorization` header plus convenience headers (`X-User-Id`, `X-User-Role`). **Each service independently verifies the signature** and derives identity from the token, never from headers alone. RBAC enforced per-service (`ADMIN`-only routes).

Consequences: (+) one verification snippet per stack (~20 lines each), no JWKS infra. (−) shared secret = any service can mint tokens; secret rotation is all-or-nothing. Upgrade path (recorded, post-MVP): RS256 with Identity-published JWKS.
