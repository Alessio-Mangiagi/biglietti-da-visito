#!/usr/bin/env bash
# CardVault — DATABASE server (Ubuntu 24.04). Run as root:
#   APP_SERVER_IP=203.0.113.10 DB_HOST=10.0.0.2 ./setup.sh
#
# - PostgreSQL 17 from the PGDG repository
# - TLS with a private CA; the API verifies it (DATABASE_SSL=verify-full)
# - port 5432 reachable ONLY from the app server, only over TLS, only with SCRAM
# - daily encrypted backups (see backup.sh), 30-day retention
set -euo pipefail

: "${APP_SERVER_IP:?set APP_SERVER_IP to the API server address}"
: "${DB_HOST:?set DB_HOST to the address/name the API will connect to (goes in the certificate)}"
DB_NAME=${DB_NAME:-cardvault}
DB_USER=${DB_USER:-cardvault}
PG_VERSION=17
PG_ETC=/etc/postgresql/$PG_VERSION/main
PKI=/etc/postgresql/cardvault-pki

echo "==> packages"
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg ufw openssl age
install -d /usr/share/postgresql-common/pgdg
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo "$VERSION_CODENAME")-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list
apt-get update -qq
apt-get install -y -qq "postgresql-$PG_VERSION" "postgresql-contrib-$PG_VERSION" || apt-get install -y -qq "postgresql-$PG_VERSION"

echo "==> TLS: private CA + server certificate for $DB_HOST"
install -d -m 700 -o postgres -g postgres "$PKI"
if [ ! -f "$PKI/ca.key" ]; then
  openssl req -x509 -new -nodes -newkey ec -pkeyopt ec_paramgen_curve:P-256 -days 3650 \
    -keyout "$PKI/ca.key" -out "$PKI/ca.crt" -subj "/CN=CardVault DB CA"
fi
SAN="DNS:$DB_HOST"
[[ "$DB_HOST" =~ ^[0-9.]+$ ]] && SAN="IP:$DB_HOST"
openssl req -new -nodes -newkey ec -pkeyopt ec_paramgen_curve:P-256 \
  -keyout "$PKI/server.key" -out "$PKI/server.csr" -subj "/CN=$DB_HOST"
openssl x509 -req -in "$PKI/server.csr" -CA "$PKI/ca.crt" -CAkey "$PKI/ca.key" -CAcreateserial \
  -days 825 -out "$PKI/server.crt" -extfile <(printf "subjectAltName=%s\nextendedKeyUsage=serverAuth" "$SAN")
chown postgres:postgres "$PKI"/*
chmod 600 "$PKI"/*.key

echo "==> postgresql.conf"
cat > "$PG_ETC/conf.d/cardvault.conf" <<EOF
listen_addresses = '*'
ssl = on
ssl_cert_file = '$PKI/server.crt'
ssl_key_file = '$PKI/server.key'
ssl_min_protocol_version = 'TLSv1.2'
password_encryption = scram-sha-256
log_connections = on
log_disconnections = on
EOF

echo "==> pg_hba: TLS + SCRAM from the app server only"
cat > "$PG_ETC/pg_hba.conf" <<EOF
local   all             postgres                                peer
local   all             all                                     scram-sha-256
hostssl $DB_NAME        $DB_USER        $APP_SERVER_IP/32       scram-sha-256
host    all             all             0.0.0.0/0               reject
host    all             all             ::/0                    reject
EOF

systemctl restart postgresql

echo "==> role and database"
DB_PASSWORD=${DB_PASSWORD:-$(openssl rand -base64 33 | tr -d '/+=' | cut -c1-40)}
sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<EOF
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DB_USER') THEN
    CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASSWORD';
  ELSE
    ALTER ROLE $DB_USER PASSWORD '$DB_PASSWORD';
  END IF;
END \$\$;
SELECT 'CREATE DATABASE $DB_NAME OWNER $DB_USER' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DB_NAME')\gexec
\c $DB_NAME
-- extensions need a superuser once; afterwards the app role only uses them
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
REVOKE ALL ON DATABASE $DB_NAME FROM PUBLIC;
EOF

echo "==> firewall"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow from "$APP_SERVER_IP" to any port 5432 proto tcp
ufw --force enable

echo "==> backups"
install -m 750 "$(dirname "$0")/backup.sh" /usr/local/bin/cardvault-backup
install -d -m 700 -o postgres -g postgres /var/backups/cardvault
if [ ! -f /etc/cardvault-backup.key ]; then
  age-keygen -o /etc/cardvault-backup.key 2>/dev/null
  chmod 600 /etc/cardvault-backup.key
fi
grep '^# public key' /etc/cardvault-backup.key | awk '{print $4}' > /etc/cardvault-backup.pub
cat > /etc/cron.d/cardvault-backup <<EOF
# daily at 02:30
30 2 * * * root DB_NAME=$DB_NAME /usr/local/bin/cardvault-backup >> /var/log/cardvault-backup.log 2>&1
EOF

cat <<EOF

================================================================
 Database pronto.
 1) Copia sul server API il certificato della CA:
      $PKI/ca.crt   →   /opt/cardvault/secrets/db-ca.crt
 2) Nel file .env.production del server API:
      DATABASE_URL=postgres://$DB_USER:$DB_PASSWORD@$DB_HOST:5432/$DB_NAME
      DATABASE_SSL=verify-full
 3) CONSERVA FUORI DA QUESTO SERVER la chiave dei backup:
      /etc/cardvault-backup.key
    (senza di essa i backup non si possono ripristinare)
================================================================
EOF
