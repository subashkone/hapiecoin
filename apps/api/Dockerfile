# HapieCoin API — multi-stage build. Build context is the repository root:
#   docker build -f apps/api/Dockerfile -t hapiecoin-api .
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@12.3.4 --activate
WORKDIR /repo

# 1. Install with the lockfile (all workspaces the API depends on).
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/config/package.json packages/config/
COPY packages/schema/package.json packages/schema/
COPY packages/venues/package.json packages/venues/
COPY packages/pricing/package.json packages/pricing/
COPY apps/api/package.json apps/api/
# Dev dependencies are needed here (tsc, drizzle-kit); NODE_ENV is unset in this stage so pnpm installs them.
RUN pnpm install --frozen-lockfile --filter @hapiecoin/api...

# 2. Build the workspace packages the API depends on (config, schema, venues, pricing), then the API.
FROM deps AS build
COPY packages/config packages/config
COPY packages/schema packages/schema
COPY packages/venues packages/venues
COPY packages/pricing packages/pricing
COPY apps/api apps/api
COPY tsconfig.base.json ./
RUN pnpm --filter @hapiecoin/api... build
# Production-only tree of the API and its workspace dependencies (single project; `...` would select many).
RUN pnpm --filter @hapiecoin/api --prod --legacy deploy /out

# 3. Runtime: production deps only, non-root, migrations included. PGlite is a devDependency and never
#    loads here (DATABASE_URL is required in production), though drizzle-orm still peer-links it into the
#    pnpm store (GAPS #30).
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out /app
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3001/healthz || exit 1
CMD ["node", "dist/main.js"]
