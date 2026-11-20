#!/usr/bin/env bash
# Builds the PWA locally and ships it, with the API image, to the app server over SSH.
#   DEPLOY_HOST=root@cardvault.example.it ./deploy/deploy.sh
# Needs: pnpm, ssh, tar (Git Bash on Windows is enough). The API image is built locally when
# Docker is available, otherwise on the server (DEPLOY_BUILD=local|remote to force one).
set -euo pipefail
: "${DEPLOY_HOST:?set DEPLOY_HOST=user@host}"
cd "$(dirname "$0")/.."

VERSION=$(git describe --tags --always --dirty)
if [ -z "${DEPLOY_BUILD:-}" ]; then
  if command -v docker >/dev/null 2>&1; then DEPLOY_BUILD=local; else DEPLOY_BUILD=remote; fi
fi
echo "==> versione $VERSION (immagine API: build $DEPLOY_BUILD)"

echo "==> test"
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test

echo "==> PWA"
VITE_APP_VERSION=$VERSION pnpm --filter @cardvault/web build
# unpack next to the live folder, then swap: visitors never see a half-copied site
tar -C apps/web/dist -czf - . | ssh "$DEPLOY_HOST" 'set -e
  rm -rf /var/www/cardvault.new && mkdir -p /var/www/cardvault.new
  tar -xzf - -C /var/www/cardvault.new
  chmod -R a+rX /var/www/cardvault.new
  rm -rf /var/www/cardvault.old
  [ -d /var/www/cardvault ] && mv /var/www/cardvault /var/www/cardvault.old
  mv /var/www/cardvault.new /var/www/cardvault'

echo "==> API image"
if [ "$DEPLOY_BUILD" = local ]; then
  docker buildx build --platform linux/amd64 -f apps/api/Dockerfile -t "cardvault-api:$VERSION" --load .
  docker save "cardvault-api:$VERSION" | gzip | ssh "$DEPLOY_HOST" 'gunzip | docker load'
else
  # only what apps/api/Dockerfile copies: the server builds the image from it
  tar -czf - --exclude=node_modules --exclude=dist --exclude=.pgdata --exclude=.env --exclude='.env.*' \
    package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json packages/shared apps/api |
    ssh "$DEPLOY_HOST" "set -e
      rm -rf /opt/cardvault/build && mkdir -p /opt/cardvault/build
      tar -xzf - -C /opt/cardvault/build
      docker build -f /opt/cardvault/build/apps/api/Dockerfile -t cardvault-api:$VERSION /opt/cardvault/build
      rm -rf /opt/cardvault/build"
fi
ssh "$DEPLOY_HOST" "cd /opt/cardvault && CARDVAULT_IMAGE=cardvault-api:$VERSION docker compose up -d && \
  touch .env && sed -i '/^CARDVAULT_IMAGE=/d' .env && echo CARDVAULT_IMAGE=cardvault-api:$VERSION >> .env && \
  docker image prune -f >/dev/null"

echo "==> smoke test"
HOST=${PUBLIC_HOST:-${DEPLOY_HOST#*@}}
for i in $(seq 1 20); do
  if curl -fsS "https://$HOST/api/health" >/dev/null; then echo "OK: https://$HOST"; exit 0; fi
  sleep 3
done
echo "API non risponde: controlla 'docker compose logs api' sul server" >&2
exit 1
