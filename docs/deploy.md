# Deploying HapieCoin (plan, 11 Sep 2026)

Status: proposal for the go-live item in the post-Phase-5 order (memory `go-live-plan`). Nothing here is provisioned yet; the provider is the user's call (§4).

## 1. What runs
| Process | Package | Port | Needs | Notes |
|---|---|---|---|---|
| web | `@hapiecoin/web` (Next 16) | 3000 | `API_URL`, `NEXT_PUBLIC_GATEWAY_URL`, `NEXT_PUBLIC_GOOGLE_ENABLED`, `NEXT_PUBLIC_DEFAULT_EXPIRIES` | Same-origin `/v1/*` and `/api/auth/*` rewrites to the API (ADR-018/019). No Dockerfile yet. |
| api | `@hapiecoin/api` (Hono) | 3001 | `DATABASE_URL`, `REDIS_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` / `WEB_URL`, `CREDENTIALS_ENC_KEY` (+ `CREDENTIALS_ENC_KEYS_PREVIOUS` after a rotation, ADR-054), `RESEND_API_KEY`, `EMAIL_FROM`, `TELEGRAM_BOT_TOKEN` (optional, ADR-057), `IV_SNAPSHOT_MS` (0 on extra replicas, ADR-056), `RAZORPAY_*`, `GOOGLE_CLIENT_*`, `TRUSTED_PROXY_IPS`, `EGRESS_IP`, `DELTA_*_URL` | `apps/api/Dockerfile` (403 MB, runs migrations at boot). Refuses production without `DATABASE_URL` and `RESEND_API_KEY`. Reconciler runs inside the process (ADR-029). |
| gateway | `@hapiecoin/gateway` | 3002 (WS + `/healthz`, `/metrics`) | `WEB_URL`, `REDIS_URL` (only with >1 replica, GAPS #16), `METRICS_TOKEN` | `apps/gateway/Dockerfile` (247 MB). Opens one Delta Exchange India public feed per process. |
| ingest | `@hapiecoin/ingest` | none | `REDIS_URL`, `COINGECKO_API_KEY` (optional), venue REST reachability | Long-running scheduler (`src/index.ts`); one replica only. No Dockerfile yet. |
| postgres | TimescaleDB pg17 (compose pins the digest) | 5432 | volume, backups | `apps/api` migrations 0000..0011. |
| redis | 7 | 6379 | none (no persistence needed: rate limits, pub/sub, analytics snapshots) | Snapshots are re-fetched by ingest after a restart. |

Fixed egress IP matters: traders whitelist `EGRESS_IP` at Delta for their API keys (HC-SH-036). The API (and only the API) must make Delta private calls from that address.

## 2. Topology (one region, smallest honest shape)
```
hapiecoin.com ──TLS──▶ web (Next)            ──/v1, /api/auth──▶ api ──▶ postgres
                                                                  │  └──▶ redis ◀── ingest
ws.hapiecoin.com ──TLS──▶ gateway (WebSocket)                     └── Delta private REST (fixed egress IP)
                           └── Delta public WS
```
Two public hostnames: the app (`hapiecoin.com`) and the feed (`ws.hapiecoin.com`, or `/ws` behind the same proxy if it passes WebSockets). Everything else is private.

## 3. Steps
1. **Images.** Add `apps/web/Dockerfile` (Next `output: "standalone"`) and `apps/ingest/Dockerfile` on the pattern of the API one; tag by git SHA.
2. **CI.** `.github/workflows/ci.yml`: `pnpm ci` (typecheck, lint, coverage, build) on every PR; `docker build` of the four images on `main`; the smoke run (`pnpm --filter @hapiecoin/web test:smoke`, ADR-055) as a manual or nightly job because it needs Delta network access.
3. **Secrets.** Provider secret store → container env. Never in the repo (CLAUDE.md env list). Generate `BETTER_AUTH_SECRET` and `CREDENTIALS_ENC_KEY` once; rotate the vault key per ADR-054.
4. **Database.** Managed Postgres with TimescaleDB, or the compose image on a volume with nightly `pg_dump` to object storage; migrations run by the API at boot (single API replica during a deploy, or run `pnpm --filter @hapiecoin/api db:migrate` as a release step).
5. **Proxy and TLS.** Caddy or the provider's load balancer: HTTP/2, WebSocket upgrade to the gateway, `X-Forwarded-For` trusted via `TRUSTED_PROXY_IPS`.
6. **Observability.** Container logs shipped (pino JSON from the API, JSON from the gateway); uptime checks on `/healthz` of api and gateway; the gateway `/metrics` scraped with `METRICS_TOKEN`; an error tracker (Sentry or similar) is a separate decision.
7. **Release check.** After each deploy: api `/healthz` 200, gateway `/healthz` lists expiries, sign-in with OTP works (Resend), a paper trade from a canary account, alerts bell reads.

## 4. Provider options (pick one)
| Option | Fit | Monthly (rough) | Notes |
|---|---|---|---|
| **A. One VPS (Hetzner / DigitalOcean / Linode), Docker Compose + Caddy** | Simplest, fixed egress IP for free, all four services on one box | $12–40 | Backups are our job (`pg_dump` cron + object storage). Scale later by moving Postgres out. Recommended to start. |
| B. Railway / Render / Fly.io | Managed builds and Postgres, fast to set up | $30–80 | Fixed egress IP is an add-on (Fly static IPs, Render static outbound on paid tiers); WebSockets fine. |
| C. AWS (ECS Fargate + RDS + ElastiCache + NAT) | Scales, but the most moving parts | $120+ | Fixed egress via NAT gateway; overkill for launch. |

Recommendation: **A** for launch. India-region VPS keeps Delta latency low (Delta India is served from AWS Mumbai); Hetzner has no India region, so DigitalOcean BLR1 or Linode Mumbai.

## 5. Decisions needed from the user
- Provider and region (§4).
- Domain DNS control for `hapiecoin.com` (A/AAAA for the app, `ws.` for the gateway) and who holds the registrar.
- Resend sending domain verification (SPF/DKIM) and the `RESEND_API_KEY`.
- Razorpay live keys and the public webhook URL (GAPS #49).
- Whether to run the smoke job nightly against a staging stack or only before releases.
