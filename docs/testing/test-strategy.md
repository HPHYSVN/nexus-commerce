# Test Strategy

| Layer | Tools | Scope |
|---|---|---|
| Unit | Jest (Gateway), JUnit (Identity), pytest (FastAPI), Go test | business logic, lifecycle transitions, idempotency keys |
| Integration | Testcontainers / Compose test profile | DB ops, atomic stock update under concurrency, RabbitMQ consume |
| API/E2E | pytest or Playwright (later) against Compose stack | 9 spec scenarios (§9 of the brief) |

Priority scenarios: register→login; browse→cart→order→reserve→pay-success→confirmed→notification; pay-failure→stock release + `PAYMENT_FAILED`; duplicate event delivery (same `eventId` twice = one notification); duplicate payment (same idempotency key = one charge); concurrent reservations cannot oversell. Tests must run in CI per service; no phase is "done" with red tests.
