#!/usr/bin/env bash
# Builds the PWA and the API image locally and ships both to the app server over SSH.
#   DEPLOY_HOST=root@cardvault.example.it ./deploy/deploy.sh
# Needs: pnpm, docker (buildx), ssh/rsync access to the server prepared by app-server/setup.sh.
set -euo pipefail
: "${DEPLOY_HOST:?set DEPLOY_HOST=user@host}"
cd "$(dirname "$0")/.."

VERSION=$(git describe --tags --always --dirty)
echo "==> versione $VERSION"

echo "==> test"
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test

echo "==> PWA"
VITE_APP_VERSION=$VERSION pnpm --filter @cardvault/web build
rsync -az --delete apps/web/dist/ "$DEPLOY_HOST:/var/www/cardvault/"

echo "==> API image"
docker buildx build --platform linux/amd64 -f apps/api/Dockerfile -t "cardvault-api:$VERSION" --load .
docker save "cardvault-api:$VERSION" | gzip | ssh "$DEPLOY_HOST" 'gunzip | docker load'
ssh "$DEPLOY_HOST" "cd /opt/cardvault && CARDVAULT_IMAGE=cardvault-api:$VERSION docker compose up -d && \
  sed -i '/^CARDVAULT_IMAGE=/d' .env && echo CARDVAULT_IMAGE=cardvault-api:$VERSION >> .env"

echo "==> smoke test"
HOST=${DEPLOY_HOST#*@}
for i in $(seq 1 20); do
  if curl -fsS "https://$HOST/api/health" >/dev/null; then echo "OK: https://$HOST"; exit 0; fi
  sleep 3
done
echo "API non risponde: controlla 'docker compose logs api' sul server" >&2
exit 1
