#!/bin/bash
# Manual backup: source .env first or export DB_USER / DB_PASSWORD / DB_NAME / DB_HOST
set -e

BACKUP_DIR="$(dirname "$0")"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUTFILE="$BACKUP_DIR/iris_${TIMESTAMP}.sql"

mysqldump -h "${DB_HOST:-db}" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" > "$OUTFILE"
echo "Backup saved: $OUTFILE"

find "$BACKUP_DIR" -name "*.sql" -mtime +7 -delete
echo "Old backups pruned."
