# ADR-0004: Checkout — synchronous reserve+charge first, saga later

Status: Accepted (proposed for approval) · 2026-11-03

Context: Spec asks for both sync Order→Inventory/Payment calls and an event-driven saga. Implementing both double-processes payments/reservations. Spec §10 also says: saga "only when the basic workflow is stable".

Decision (MVP): Orchestrated synchronous checkout in Order Service: reserve → charge (idempotency key = orderId) → confirm reservation, with compensations (release on payment failure, cancel on user request). Domain events are published after each transition for Notification/audit, consumed idempotently. Phase 5 stretch: convert reservation/payment steps to choreographed saga events (`InventoryReserved`, `PaymentFailed` → compensation) behind the same Order API.

Consequences: (+) one code path, immediate checkout response, testable failure modes. (−) Order is coupled to Inventory/Payment availability at checkout; timeouts bounded (3 s/5 s) and failure leaves a compensatable `PENDING`/`PAYMENT_FAILED` order, never a charged-but-unreserved one (charge happens only after reservation succeeds).
