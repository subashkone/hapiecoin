# HapieCoin analytics ingest (one replica only). Build from the repository root:
#   docker build -f apps/ingest/Dockerfile -t hapiecoin-ingest .
# Same shape as the gateway image.

FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@12.3.4 --activate
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages/config ./packages/config
COPY packages/schema ./packages/schema
COPY apps/ingest ./apps/ingest
RUN pnpm install --frozen-lockfile --filter @hapiecoin/ingest...
RUN pnpm --filter @hapiecoin/ingest... build
# Production-only tree of the ingest service and its workspace dependencies (dist + package.json each).
RUN pnpm --filter @hapiecoin/ingest --prod --legacy deploy /out

FROM base AS runtime
ENV NODE_ENV=production INGEST_PORT=3003 INGEST_HOST=0.0.0.0
WORKDIR /app
COPY --from=build /out ./
USER node
EXPOSE 3003
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD wget -qO- http://127.0.0.1:3003/healthz >/dev/null || exit 1
CMD ["node", "dist/index.js"]
