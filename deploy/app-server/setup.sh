#!/usr/bin/env bash
# CardVault — APP server (Ubuntu 24.04): nginx (PWA + /api proxy, HTTPS) and the API in Docker.
# Run as root:   DOMAIN=cardvault.example.it EMAIL=admin@example.it ./setup.sh
set -euo pipefail
: "${DOMAIN:?set DOMAIN}"
: "${EMAIL:?set EMAIL for Let's Encrypt}"
HERE=$(cd "$(dirname "$0")" && pwd)

echo "==> packages"
apt-get update -qq
apt-get install -y -qq ca-certificates curl nginx certbot python3-certbot-nginx ufw
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

echo "==> folders"
install -d -m 755 /var/www/cardvault /var/www/certbot
install -d -m 750 /opt/cardvault /opt/cardvault/secrets
cp "$HERE/docker-compose.yml" /opt/cardvault/docker-compose.yml
[ -f /opt/cardvault/.env.production ] || cp "$HERE/.env.production.example" /opt/cardvault/.env.production
chmod 600 /opt/cardvault/.env.production

echo "==> nginx"
cp "$HERE/../nginx/cardvault-proxy.conf" /etc/nginx/snippets/cardvault-proxy.conf
cp "$HERE/../nginx/cardvault-security.conf" /etc/nginx/snippets/cardvault-security.conf
sed "s/cardvault.example.it/$DOMAIN/g" "$HERE/../nginx/cardvault.conf" > /etc/nginx/sites-available/cardvault.conf
ln -sf /etc/nginx/sites-available/cardvault.conf /etc/nginx/sites-enabled/cardvault.conf
rm -f /etc/nginx/sites-enabled/default

# first certificate: temporary HTTP-only server for the ACME challenge
if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  cat > /etc/nginx/sites-enabled/cardvault.conf <<EOF
server { listen 80; server_name $DOMAIN; location /.well-known/acme-challenge/ { root /var/www/certbot; } }
EOF
  nginx -t && systemctl reload nginx
  certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" --email "$EMAIL" --agree-tos --non-interactive
  ln -sf /etc/nginx/sites-available/cardvault.conf /etc/nginx/sites-enabled/cardvault.conf
fi
nginx -t && systemctl reload nginx
# renewals reload nginx
echo 'deploy-hook = systemctl reload nginx' >> /etc/letsencrypt/cli.ini

echo "==> firewall (the API port 3000 stays on localhost)"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

cat <<EOF

================================================================
 Server app pronto. Ora:
 1) copia la CA del database in /opt/cardvault/secrets/db-ca.crt
 2) compila /opt/cardvault/.env.production (DATABASE_URL, segreti, SMTP)
 3) dal tuo PC:  DEPLOY_HOST=root@$DOMAIN ./deploy/deploy.sh
================================================================
EOF
