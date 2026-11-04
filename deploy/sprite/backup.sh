#!/bin/bash
# Daily PostgreSQL backups for the Sprite deployment (keeps 7 days x 6 DBs).
set -uo pipefail
DIR=$HOME/backups/nexus
mkdir -p "$DIR"
STAMP=$(date +%Y%m%d-%H%M)
for db in identity_db product_db inventory_db order_db payment_db notification_db; do
  sudo -u postgres pg_dump "$db" | gzip > "$DIR/$db-$STAMP.sql.gz" || echo "backup failed: $db"
done
find "$DIR" -name '*.sql.gz' -mtime +7 -delete
echo "backup done: $STAMP ($(ls "$DIR" | wc -l) files retained)"
