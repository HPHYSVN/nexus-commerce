# Product Gap Analysis — Nexus Commerce vs a Real Store

Audited 2026-11-04 (backend, frontend, infra/security/testing — code-inspected, `file:line` evidence in audit). Verdict: happy-path checkout is well built; this is a strong **demo**, not yet a shippable store.

## P0 — exploitable / money-loss / blocking

| # | Gap | Evidence |
|---|---|---|
| 1 | Payment service has no auth at all; trusts client `userId`/`amount`; internal inventory endpoints (`/internal/*`, `/internal/restock`) unauthenticated, restock not idempotent — safety is topology-only | `services/payment/main.go:79-82`, `services/inventory/main.go:108-113` |
| 2 | No refund anywhere; cancelling a CONFIRMED order restocks but keeps the money | `services/order/handlers.go:298-307` |
| 3 | Payment is mock-only (`tok_fail` decides status), no PSP/webhook/reconciliation | `services/payment/handlers.go:11-17` |
| 4 | Crash windows in checkout: paid order can stick in PENDING forever; `_ = updateStatus(...)` errors discarded; reservations never expire | `services/order/handlers.go:185-222`, `services/inventory/main.go:71` |
| 5 | No transactional outbox — events dropped on broker failure ("dropping event", log-only); no DLQ | `services/order/events.go:78-93` |
| 6 | HS256 shared secret everywhere; Go verifiers accept tokens **without `exp`** forever | `services/order/auth.go:69-71` |
| 7 | Fail-open code defaults: `Admin123!` + dev JWT secret if env missing (safe on Sprite only because deploy passes env) | `services/identity/.../application.yml:22-28`, `services/api-gateway/src/main.ts:9` |
| 8 | Frontend checkout: no address/shipping/tax at all; cart is cleared even on PAYMENT_FAILED; order create has no idempotency key (double-click = double charge) | `frontend/src/pages/CartCheckout.tsx:46-52`, `services/order/handlers.go:122-135` |
| 9 | Frontend tokens (incl. refresh) in `localStorage`; demo admin creds printed on login page + README | `frontend/src/store.ts:14-21`, `frontend/src/pages/Auth.tsx:33` |
| 10 | Ops: no process supervision on Sprite (bare `nohup`, reboot = downtime), deploy script can ship **stale binaries** (build-only-if-missing), no backups at all, events lost silently | `deploy/sprite/deploy.sh:19-21,52-55` |

## P1 — launch-blocking

- Order lifecycle dead-ends at CONFIRMED (PROCESSING/SHIPPED/DELIVERED are docs-only, no endpoints, no admin order management) — `services/order/handlers.go:69-81`
- Orders carry no checkout data (address/shipping/tax/currency columns don't exist) — `services/order/main.go:72`
- Identity: no email verification, password reset, change-password, profile, user admin — `AuthController.java:23-51`; User has no `emailVerified`/`provider` fields and `passwordHash NOT NULL` (`User.java:9-35`)
- Notification never sends anything (channel hard-coded `LOG`, status `SENT` regardless) — `services/notification/app/main.py:45-47`
- Cart: client-trusted prices, read-modify-write race, no TTL, no guest cart/merge — `services/cart/app/main.py:72-84`
- No DB migrations anywhere (Hibernate update / `create_all` / `CREATE TABLE IF NOT EXISTS`)
- Health checks are static `ok` (never touch DB); no metrics/tracing; correlation IDs die at gateway
- Refresh rotation race (non-atomic), no reuse detection / session list
- Frontend: category filter wrong past page 1; stock invisible in UI; admin sees only 20 products & no orders/users; no error boundary; **zero frontend tests/lint**; admin stock form can silently zero inventory
- Redis has no password (defined in `.env.example`, never used); no CD, no dependency/SAST scanning, images run as root, no staging

## P2/P3 — scale & completeness (summary)

No audit log, no soft-delete/restore (except products), no product↔stock sync or low-stock alerts, no API versioning/OpenAPI through gateway, inconsistent pagination (orders unpaginated + N+1), money as float at API edges, categories can't be edited, no coupons/tax/shipping-rates/returns/wishlist/reviews/variants, no i18n/SEO/PWA, docs stale in places (README says ".env optional" — false), no runbook/CONTRIBUTING.

## Google login & email verification — can it be free? YES

**Google login: $0.** Creating an OAuth client in Google Cloud Console is free (no billing account needed for `openid/email/profile`). Best fit for this architecture (SPA + stateless JWT):

1. Frontend: Google Identity Services button → receives Google **ID token**
2. `POST /api/auth/google {idToken}` on Identity: verify signature/audience (`GOOGLE_CLIENT_ID`) against Google keys
3. Find-or-create user by verified email, link provider, issue our existing JWT + refresh pair

Needed changes: `User.provider/googleSubject/emailVerified`, `passwordHash` → nullable, one endpoint in Identity, button in frontend, `GOOGLE_CLIENT_ID` env. No change to gateway/other services (they consume our JWT as today). Linking policy: auto-link an existing password account only when Google says the email is verified.

**Email verification & password reset: free to build, delivery is the caveat.** Token flow + SMTP sending via Spring Mail costs nothing to implement. Free sending options: Gmail SMTP with an app password (~500/day, demo-grade), Brevo free (300/day, sender verification without owning a domain), Resend free (3,000/mo but custom-domain sending needs a domain we can put DNS records on — the `sprites.app` subdomain is not ours to verify). Recommendation: sender abstraction + Gmail/Brevo SMTP now, swap to Resend/SES when a real domain exists. Verification policy: soft-gate (login allowed, checkout requires verified) so the demo never locks anyone out.

## Development plan (proposed order)

| Phase | Scope | Gate |
|---|---|---|
| **A. P0 security & money safety** | internal service-to-service token on `/internal/*` + payment; Go JWT requires `exp`; refund endpoint + cancel-refund; restock idempotency; remove fail-open defaults & demo creds from UI; cart cleared only on success; order idempotency key | security suite + new tests green, redeploy Sprite |
| **B. Identity completeness** | Google login (above), email verification + password reset (SMTP abstraction), profile GET/PUT, change-password | manual Google sign-in verified on live site; verify/reset emails delivered in demo |
| **C. Real commerce core** | checkout address/shipping data, order lifecycle transitions + admin order management, guest cart + login merge, stock shown on products, server-side cart repricing | full order lifecycle E2E (PENDING→…→DELIVERED) |
| **D. Operability** | migrations (Flyway/Alembic/golang-migrate), transactional outbox + DLQ, Sprite supervision (systemd/supervisor + auto-restart, stale-build fix), pg_dump backup schedule, deep health checks, Dependabot/Trivy, frontend Vitest + ESLint, CD job to Sprite | kill-a-service recovery test; restore-from-backup test |
| **E. Product features** | reviews/wishlist/coupons, admin orders/users dashboard, i18n (vi/en), SEO basics | per-feature tests |

Payments with a real PSP (Stripe/VNPay sandbox) slot into Phase C/D once a provider account exists — still mock by default.
