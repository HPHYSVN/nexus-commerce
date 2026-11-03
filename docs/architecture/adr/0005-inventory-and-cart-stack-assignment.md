# ADR-0005: Inventory = Go+Gin, Cart = Python+FastAPI

Status: Accepted (proposed for approval) · 2026-11-03

Context: The spec's stack table assigns languages to only 5 of 7 contexts; Inventory and Cart are unassigned. No new languages allowed.

Decision: **Inventory → Go+Gin**: stock reservation needs atomic conditional updates (`UPDATE ... SET reserved = reserved + $q WHERE quantity - reserved >= $q`); Go reuses Order/Payment patterns, clients, and test helpers. **Cart → Python+FastAPI**: Redis-only CRUD, no relational logic; reuses Product/Notification FastAPI scaffolding.

Consequences: (+) no new ecosystem, maximum code-pattern reuse. (−) Cart could arguably fold into the Gateway; kept separate to preserve the bounded context and independent deployability required by the spec.
