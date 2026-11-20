#!/usr/bin/env bash
# CardVault — copy the live data (users, cards, photos, teams…) from the current database
# (Neon, used by the Vercel deploy) into this server's database. Run as root on the DB server,
# after setup.sh, with the API on the app server NOT started yet:
#   SOURCE_URL='postgres://user:pass@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require' ./import-from-neon.sh
#
# The photos are stored encrypted in the database: the app server needs the SAME
# IMAGE_ENCRYPTION_KEY as Vercel, or they cannot be opened.
set -euo pipefail
: "${SOURCE_URL:?set SOURCE_URL to the Neon connection string (Vercel → Storage → .env.local)}"
DB_NAME=${DB_NAME:-cardvault}
DB_USER=${DB_USER:-cardvault}
WORK=$(mktemp -d /var/tmp/cardvault-import.XXXXXX)
chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT

echo "==> client matching the source version"
SRC_MAJOR=$(psql "$SOURCE_URL" -Atc 'SHOW server_version_num' | cut -c1-2)
LOCAL_MAJOR=$(pg_dump --version | grep -oE '[0-9]+' | head -1)
PG_BIN=/usr/lib/postgresql/$LOCAL_MAJOR/bin
if [ "$SRC_MAJOR" -gt "$LOCAL_MAJOR" ]; then
  apt-get install -y -qq "postgresql-client-$SRC_MAJOR"
  PG_BIN=/usr/lib/postgresql/$SRC_MAJOR/bin
fi
echo "    sorgente PostgreSQL $SRC_MAJOR, uso $PG_BIN"

echo "==> target must be empty"
TABLES=$(sudo -u postgres psql -d "$DB_NAME" -Atc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")
if [ "$TABLES" != 0 ] && [ "${FORCE:-}" != 1 ]; then
  echo "Il database $DB_NAME ha già $TABLES tabelle (forse l'API è già partita)." >&2
  echo "Svuotalo:  sudo -u postgres psql -d $DB_NAME -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public AUTHORIZATION $DB_USER;'" >&2
  echo "e ricrea le estensioni (pg_trgm, unaccent), oppure rilancia con FORCE=1." >&2
  exit 1
fi

echo "==> dump from the source"
"$PG_BIN/pg_dump" "$SOURCE_URL" --format=custom --no-owner --no-acl --no-publications --no-subscriptions \
  --exclude-table-data=rate_limits --file="$WORK/db.dump"
ls -lh "$WORK/db.dump" | awk '{print "    " $5}'

echo "==> restore (objects owned by $DB_USER; extensions already created by setup.sh)"
"$PG_BIN/pg_restore" --list "$WORK/db.dump" | grep -vE ' EXTENSION | SCHEMA - public ' > "$WORK/toc.list"
sudo -u postgres "$PG_BIN/pg_restore" --dbname="$DB_NAME" --role="$DB_USER" --no-owner --no-acl \
  --single-transaction --exit-on-error --use-list="$WORK/toc.list" "$WORK/db.dump"
sudo -u postgres psql -d "$DB_NAME" -qc "ALTER SCHEMA public OWNER TO $DB_USER"

echo "==> compare row counts"
COUNT_SQL="SELECT string_agg(format('%s=%s', t, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', t), false, true, '')))[1]::text), ' ' ORDER BY t)
           FROM unnest(ARRAY(SELECT tablename::text FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'rate_limits')) t"
SRC=$(psql "$SOURCE_URL" -Atc "$COUNT_SQL")
DST=$(sudo -u postgres psql -d "$DB_NAME" -Atc "$COUNT_SQL")
echo "    sorgente:    $SRC"
echo "    questo DB:   $DST"
if [ "$SRC" != "$DST" ]; then
  echo "ATTENZIONE: i conteggi differiscono: qualcuno ha usato l'app su Vercel durante la copia." >&2
  echo "Per una copia esatta rilancia con FORCE=1 quando nessuno la usa." >&2
fi

cat <<EOF

================================================================
 Dati copiati. Sul server APP usa in .env.production gli stessi
 IMAGE_ENCRYPTION_KEY e JWT_SECRET di Vercel, poi avvia il deploy.
================================================================
EOF
