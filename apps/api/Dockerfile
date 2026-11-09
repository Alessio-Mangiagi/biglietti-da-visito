# syntax=docker/dockerfile:1.7
# Build from the repository root:  docker build -f apps/api/Dockerfile -t cardvault-api .
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/

# runtime dependencies only, as plain folders (no pnpm symlinks to carry over)
FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter @cardvault/api --config.node-linker=hoisted --ignore-scripts \
 && mkdir -p /out/node_modules \
 && cp -r node_modules/. /out/node_modules/ \
 && if [ -d apps/api/node_modules ]; then cp -rn apps/api/node_modules/. /out/node_modules/; fi \
 && rm -rf /out/node_modules/@cardvault

# bundle: workspace packages are inlined by tsup, npm dependencies stay external
FROM base AS build
RUN pnpm install --frozen-lockfile --filter @cardvault/api... --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @cardvault/api build

FROM node:22-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=prod-deps /out/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY apps/api/package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
