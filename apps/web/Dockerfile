# HapieCoin web (Next). Build from the repository root:
#   docker build -f apps/web/Dockerfile -t hapiecoin-web \
#     --build-arg NEXT_PUBLIC_GATEWAY_URL=wss://ws.example.com .
# Two values are fixed at build time, so the image belongs to one deployment:
#   API_URL                  where the Next server reaches the API (the /v1 and /api/auth rewrites are written at build)
#   NEXT_PUBLIC_GATEWAY_URL  the price feed's public WebSocket address (inlined into the browser bundle)
# The image keeps the built workspace and runs `next start`: larger than a standalone output, and it needs no
# change to next.config.ts or to how the e2e suites start the app.

FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@12.3.4 --activate
WORKDIR /repo

FROM base AS build
ARG API_URL=http://api:3001
ARG NEXT_PUBLIC_GATEWAY_URL=ws://localhost:3002
ARG NEXT_PUBLIC_GOOGLE_ENABLED=false
ARG NEXT_PUBLIC_DEFAULT_EXPIRIES=
# Plans are not on sale unless this is "true" (ADR-140)
ARG NEXT_PUBLIC_PLANS_ON_SALE=false
ENV API_URL=$API_URL \
    NEXT_PUBLIC_PLANS_ON_SALE=$NEXT_PUBLIC_PLANS_ON_SALE \
    NEXT_PUBLIC_GATEWAY_URL=$NEXT_PUBLIC_GATEWAY_URL \
    NEXT_PUBLIC_GOOGLE_ENABLED=$NEXT_PUBLIC_GOOGLE_ENABLED \
    NEXT_PUBLIC_DEFAULT_EXPIRIES=$NEXT_PUBLIC_DEFAULT_EXPIRIES \
    NEXT_TELEMETRY_DISABLED=1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
# Dev dependencies are needed for the build (tsc, tailwind, next's compiler); NODE_ENV is unset here so pnpm installs them.
RUN pnpm install --frozen-lockfile --filter @hapiecoin/web...
RUN pnpm --filter @hapiecoin/web... build
# next start writes its cache under .next
RUN chown -R node:node apps/web/.next

FROM build AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /repo/apps/web
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/auth >/dev/null || exit 1
CMD ["node_modules/.bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
