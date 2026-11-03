#!/bin/bash
set -e
# One PostgreSQL instance, one DB + least-privilege user per service (ADR-0002).
create_db() {
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-SQL
    DO \$\$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$1') THEN
        CREATE USER $1 WITH PASSWORD '$2';
      END IF;
    END \$\$;
    SELECT 'CREATE DATABASE $3 OWNER $1' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$3')\gexec
SQL
}
create_db product_user "$PRODUCT_DB_PASSWORD" product_db
create_db identity_user "$IDENTITY_DB_PASSWORD" identity_db
create_db inventory_user "$INVENTORY_DB_PASSWORD" inventory_db
create_db order_user "$ORDER_DB_PASSWORD" order_db
create_db payment_user "$PAYMENT_DB_PASSWORD" payment_db
create_db notification_user "$NOTIFICATION_DB_PASSWORD" notification_db
