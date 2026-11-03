# ADR-0002: Database-per-service on one PostgreSQL instance

Status: Accepted (proposed for approval) · 2026-11-03

Context: Database-per-service is required; 6 PostgreSQL containers would exhaust free-tier RAM and add ops burden.

Decision: One PostgreSQL container with a separate database **and a separate least-privilege user** per service (`identity_db`, `product_db`, `inventory_db`, `order_db`, `payment_db`, `notification_db`). Each service's credentials grant access only to its own database — cross-service queries are impossible at the DB level, not just by convention. Cart uses Redis only.

Consequences: (+) real isolation boundary, one backup/volume. (−) single point of failure; acceptable for MVP/demo. Upgrade path: split instances per service unchanged (only connection strings move).
