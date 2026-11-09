#!/usr/bin/env bash
# Daily logical backup, encrypted with age, 30-day retention (matches the privacy notice).
# Optional off-site copy: set RCLONE_REMOTE (e.g. "s3eu:cardvault-backups") and configure rclone.
# Restore:
#   age -d -i /path/to/cardvault-backup.key FILE.dump.age > db.dump
#   pg_restore --clean --if-exists -d cardvault db.dump
set -euo pipefail

DB_NAME=${DB_NAME:-cardvault}
DIR=/var/backups/cardvault
KEEP_DAYS=${KEEP_DAYS:-30}
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$DIR/$DB_NAME-$STAMP.dump.age"

sudo -u postgres pg_dump -Fc "$DB_NAME" | age -R /etc/cardvault-backup.pub -o "$OUT"
chmod 600 "$OUT"
# refuse to report success on an empty dump
[ "$(stat -c %s "$OUT")" -gt 1024 ] || { echo "backup troppo piccolo: $OUT"; exit 1; }

find "$DIR" -name "$DB_NAME-*.dump.age" -mtime +"$KEEP_DAYS" -delete

if [ -n "${RCLONE_REMOTE:-}" ]; then
  rclone copy "$OUT" "$RCLONE_REMOTE/" && rclone delete --min-age "${KEEP_DAYS}d" "$RCLONE_REMOTE/"
fi
echo "$(date -Is) ok $OUT"
