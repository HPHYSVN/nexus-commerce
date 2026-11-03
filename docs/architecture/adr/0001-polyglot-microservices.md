# ADR-0001: Polyglot microservices (4 stacks)

Status: Accepted (proposed for approval) · 2026-11-03

Context: Learning goal is exposure to NestJS, Spring Boot, FastAPI, and Go (Gin) in one system, for a final-year portfolio. Constraint: one developer, ~120 h.

Decision: Keep all four stacks, one per service group (Gateway=NestJS, Identity=Spring, Product/Cart/Notification=FastAPI, Inventory/Order/Payment=Go) to cap per-language boilerplate at shared patterns within each group.

Consequences: (+) portfolio value, right-tool-per-context. (−) 4 Docker/CI pipelines, 4 JWT-verification implementations, slower context switching. Mitigation: shared event-envelope and error-format contracts documented in `docs/api/api-overview.md`; no Rust or further languages.
