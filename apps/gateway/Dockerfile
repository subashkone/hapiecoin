# HapieCoin market-data gateway. Build from the repository root:
#   docker build -f apps/gateway/Dockerfile -t hapiecoin-gateway .
# The image runs on Alpine (musl): the transport is `ws`, which needs no native binary (see src/transport/ws.ts).
# Built and smoke-tested on 07 Sep 2026 (GAPS #17).

FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /repo

# --- build: install the workspace slice the gateway needs, compile it and its workspace dependencies ---
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/config ./packages/config
COPY packages/schema ./packages/schema
COPY packages/venues ./packages/venues
COPY apps/gateway ./apps/gateway
RUN pnpm install --frozen-lockfile --filter @hapiecoin/gateway...
RUN pnpm --filter @hapiecoin/gateway... build
# Production-only tree of the gateway and its workspace dependencies (dist + package.json each).
RUN pnpm --filter @hapiecoin/gateway --prod --legacy deploy /out

# --- runtime ---
FROM base AS runtime
ENV NODE_ENV=production GATEWAY_PORT=3002 GATEWAY_HOST=0.0.0.0
WORKDIR /app
COPY --from=build /out ./
USER node
EXPOSE 3002
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3002/healthz >/dev/null || exit 1
CMD ["node", "dist/index.js"]
