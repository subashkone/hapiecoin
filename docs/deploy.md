# Deploying HapieCoin (plan, 11 Sep 2026)

Status: proposal for the go-live item in the post-Phase-5 order (memory `go-live-plan`). Nothing here is provisioned yet; the provider is the user's call (§4).

Checked against the repo on 25 Nov 2026: the lines that were wrong are corrected below and marked "(corrected 25 Nov 2026)". The measured needs, the full variable list, the work still missing and the provider comparison are in `docs/research/deployment-providers.md`, which supersedes §4 here.

## 1. What runs
| Process | Package | Port | Needs | Notes |
|---|---|---|---|---|
| web | `@hapiecoin/web` (Next 16) | 3000 | `API_URL`, `NEXT_PUBLIC_GATEWAY_URL`, `NEXT_PUBLIC_GOOGLE_ENABLED`, `NEXT_PUBLIC_DEFAULT_EXPIRIES`, `NEXT_PUBLIC_PLANS_ON_SALE` (off unless `true`, ADR-140) | Same-origin `/v1/*` and `/api/auth/*` rewrites to the API (ADR-018/019). `apps/web/Dockerfile` exists but is untracked and has never been built; all these values are fixed at build time (corrected 25 Nov 2026). |
| api | `@hapiecoin/api` (Hono) | 3001 | `DATABASE_URL`, `REDIS_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` / `WEB_URL`, `CREDENTIALS_ENC_KEY` (+ `CREDENTIALS_ENC_KEYS_PREVIOUS` after a rotation, ADR-054), `RESEND_API_KEY`, `EMAIL_FROM`, `TELEGRAM_BOT_TOKEN` (optional, ADR-057), `API_JOBS_ROLE` + `LEADER_TTL_MS` (ADR-062: extra replicas stand by for the jobs automatically), `RAZORPAY_*`, `GOOGLE_CLIENT_*`, `TRUSTED_PROXY_IPS`, `EGRESS_IP`, `DELTA_*_URL` | `apps/api/Dockerfile` (403 MB, runs migrations at boot). Refuses production without `DATABASE_URL` and `RESEND_API_KEY`. The background jobs run in the one replica holding the Redis lease (ADR-062); any number of replicas can serve HTTP. |
| gateway | `@hapiecoin/gateway` | 3002 (WS + `/healthz`, `/metrics`) | `WEB_URL`, `REDIS_URL` (required with >1 replica), `GATEWAY_ROLE`, `LEADER_TTL_MS`, `HOLD_SYNC_MS` (at most a third of the TTL), `GATEWAY_INSTANCE_ID` (a label; a unique suffix is always appended), `METRICS_TOKEN` | `apps/gateway/Dockerfile` (247 MB). With Redis, the replica holding the feed lease opens the one Delta Exchange India public feed; the others follow and serve clients from the shared snapshot store and the fan-out (ADR-062). |
| ingest | `@hapiecoin/ingest` | 3003 (`/healthz` only) | `REDIS_URL`, `COINGECKO_API_KEY` (optional), venue REST reachability | Long-running scheduler (`src/index.ts`); one replica only. `apps/ingest/Dockerfile` exists but is untracked and not in CI; an image built from it ran on 25 Nov 2026 (corrected 25 Nov 2026). |
| postgres | In development: TimescaleDB pg17 from `docker-compose.yml`. On the server: a managed PostgreSQL 17 outside the machine, without the TimescaleDB extension (ADR-152) | 5432 | `DATABASE_URL` ending in `?sslmode=require` | `apps/api` migrations 0000..0039 on `main` at 775f1ca (27 Nov 2026). No migration creates a hypertable, so the app also runs on plain PostgreSQL 17 (corrected 25 Nov 2026). |
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
1. **Images.** Done on `chore/deploy-private-copy` (ADR-151): all four Dockerfiles are in the repo. The api, gateway and ingest images were built and run on 26 Nov 2026; the web image built on GitHub on 27 Nov 2026 (2.28 GB) and has not been run yet; it is never built on the development laptop (GAPS #186). The web image runs `next start` on the built workspace, not the `standalone` output.
2. **CI.** `.github/workflows/ci.yml` runs `pnpm ci` (typecheck, lint, coverage, build) plus the bundle budget and the Playwright e2e on every PR (ADR-061). On a pull request the image job builds the four images without pushing them. On every merge to `main` it builds them, tags them with the commit and pushes them to GitHub's registry (`ghcr.io/<owner>/hapiecoin-{api,gateway,ingest,web}`); the web image is pushed only when the repository variable `GATEWAY_PUBLIC_URL` is set, because the feed address is fixed inside it. `smoke.yml` runs the real-API smoke (ADR-055) on manual dispatch. There is no deploy job: a release is run by hand on the server (§6).
3. **Secrets.** Provider secret store → container env. Never in the repo (CLAUDE.md env list). Generate `BETTER_AUTH_SECRET` and `CREDENTIALS_ENC_KEY` once; rotate the vault key per ADR-054.
4. **Database.** Managed Postgres with TimescaleDB, or the compose image on a volume with nightly `pg_dump` to object storage; migrations run by the API at boot (single API replica during a deploy, or run `pnpm --filter @hapiecoin/api db:migrate` as a release step).
5. **Proxy and TLS.** Caddy or the provider's load balancer: HTTP/2, WebSocket upgrade to the gateway, `X-Forwarded-For` trusted via `TRUSTED_PROXY_IPS`.
6. **Observability.** Container logs shipped (pino JSON from the API, JSON from the gateway); uptime checks on `/healthz` of api and gateway; `/metrics` of both the api and the gateway scraped with `METRICS_TOKEN` (ADR-081); an error tracker that speaks the Sentry envelope protocol (Sentry, self-hosted GlitchTip, Bugsink) reached through `ERROR_SINK_DSN` on the api and the gateway, with `RELEASE` set to the deployed git SHA so events name the build; browser errors arrive through the api (`POST /v1/client-errors`), so the browser needs no DSN. The tracker vendor is the one remaining pick; the code needs only the DSN.
7. **Release check.** After each deploy: api `/healthz` 200, gateway `/healthz` lists expiries, sign-in with OTP works (Resend), a paper trade from a canary account, alerts bell reads.

## 4. Provider options (pick one)
| Option | Fit | Monthly (rough) | Notes |
|---|---|---|---|
| **A. One VPS (Hetzner / DigitalOcean / Linode), Docker Compose + Caddy** | Simplest, fixed egress IP for free, all four services on one box | $12–40 | Backups are our job (`pg_dump` cron + object storage). Scale later by moving Postgres out. Recommended to start. |
| B. Railway / Render / Fly.io | Managed builds and Postgres, fast to set up | $30–80 | Fixed egress IP is an add-on (Fly static IPs, Render static outbound on paid tiers); WebSockets fine. |
| C. AWS (ECS Fargate + RDS + ElastiCache + NAT) | Scales, but the most moving parts | $120+ | Fixed egress via NAT gateway; overkill for launch. |

Recommendation: **A** for launch. Hetzner has no India region, so DigitalOcean BLR1 or Linode Mumbai.

Corrected 25 Nov 2026: this line used to say Delta India is served from AWS Mumbai. Delta's API documentation says its data centres are in AWS Tokyo, and its hosts answer through CloudFront. An India-region server is close to the users, not to the exchange. The current comparison and recommendation are in `docs/research/deployment-providers.md`.

## 5. Decisions needed from the user
- Provider and region (§4). Decided 27 Nov 2026: an Azure virtual machine in Japan East (Tokyo), created that day (ADR-151); OVHcloud VPS-2 stays the fallback when the credit ends.
- Domain DNS control for `hapiecoin.com` (A/AAAA for the app, `ws.` for the gateway) and who holds the registrar.
- Resend sending domain verification (SPF/DKIM) and the `RESEND_API_KEY`.
- Razorpay live keys and the public webhook URL (GAPS #49).
- Whether to run the smoke job nightly against a staging stack or only before releases.

## 6. Runbook: the private copy on one server (ADR-151, 26 Nov 2026)

One server runs everything but the database from `deploy/compose.prod.yml`; the database is a managed PostgreSQL 17 next to it (ADR-152: Azure Database for PostgreSQL in the same region, reachable only from the server's address, encrypted, with 14 days of point-in-time backups kept by the provider). The server builds nothing: it pulls the four images GitHub built. Every secret is typed on the server by the owner into `deploy/.env`; none is ever in the repo, in a log or in chat. `TRADING_DISABLED=true` stays set, so this copy cannot open a new live trade. It does not stop a close or a cancel on a live strategy that is already in the database: those still send a signed order to the exchange named by `DELTA_TRADING_REST_URL` (GAPS #186; see §6.3 step 2).

What was tried on 26 Nov 2026, on a laptop with dummy settings: the compose file is valid; the api, gateway and ingest images build; the api starts in production mode from this compose file, applies its migrations and answers `/healthz`; `backup.sh` then `restore.sh` moved a database into an empty one with the same row count in all 42 tables and no error, and the api started on the restored database. After that trial the code review tightened `restore.sh` (one transaction, stop on the first error, the file checked and a backup taken before a forced replace) and the proxy file (the manifest outside the gate, `/metrics` closed on the feed name); those changes have not been run, because Docker on the laptop was down. On 27 Nov 2026 the move to a managed database was tried on throwaway databases: the api applies its migrations on a plain PostgreSQL 17 with no TimescaleDB and is healthy; a dump of a TimescaleDB database taken with `--exclude-extension=timescaledb` restores into the plain one with the same row count in all 42 tables (without that flag it fails); `restore.sh` and `backup.sh` as they now are passed six cases (a dump that carries the extension refused, a clean restore, a second restore refused, a forced replace after a dump, a file cut short refused, a database that does not answer). The api image used was the one of 26 Nov 2026 (37 migrations), and nothing was run against the real managed database or over an encrypted connection. Not tried yet: the web image, Caddy with the password gate in front of sign-in and the installed app, and anything on a real server (GAPS #186).

### 6.1 Once, before the server exists
1. **Repository variable.** In GitHub, repository settings, Actions variables: `GATEWAY_PUBLIC_URL` = `wss://ws.hapiecoin.com`. The next merge to `main` then pushes all four images.
2. **Mail.** Create the Resend account, add the sending domain and put the DNS records it shows on the domain. The api refuses to start in production without `RESEND_API_KEY`.
3. **A read token for the images.** The images are private. Create a GitHub token that can only read packages; it is typed on the server in step 6.2.4.

### 6.2 First start
1. **Harden the server** (Ubuntu 24.04; on Azure the three ports are also opened in the network security group, and `ufw` on the machine is the second door): a non-root user with sudo, SSH by key only (`PasswordAuthentication no`, `PermitRootLogin no`), `ufw` allowing 22, 80 and 443 (and 443/udp), `unattended-upgrades` on, Docker Engine with the compose plugin from Docker's own repository.
2. **The four reachability checks.** All four should print 200:
   ```
   curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" https://api.bybit.com/v5/market/time
   curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" https://fapi.binance.com/fapi/v1/time
   curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" https://www.okx.com/api/v5/public/time
   curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" "https://api.india.delta.exchange/v2/products?page_size=1"
   ```
   If Delta does not answer, stop: this server cannot run HapieCoin.
3. **The files.** `git clone` the repository to `/opt/hapiecoin` (only `deploy/` is used). `cp deploy/env.example deploy/.env`, `chmod 600 deploy/.env`, and fill it in: the two names, `DATABASE_URL` (the managed database's whole address, written out in the file's comment; a password of letters and digits only saves percent-encoding), the secrets (the command for each is written above it in the file; they differ), `IMAGE_OWNER`, `EGRESS_IP` (this server's public IPv4), `DELTA_TRADING_REST_URL` and `RELEASE` (the full commit of `main` to run). When the database comes from the laptop (§6.3), `BETTER_AUTH_SECRET`, `CREDENTIALS_ENC_KEY` and `DELTA_TRADING_REST_URL` must be the laptop's values.
4. **Registry sign-in.** `docker login ghcr.io -u <github user>` and paste the read token when asked.
5. **The password gate.** `docker run --rm -it caddy:2-alpine caddy hash-password` and write one line, `<user> <hash>`, to `deploy/basic-auth.caddy` (`chmod 600`). The file is ignored by git.
6. **DNS.** Two A records, `app` and `ws`, pointing at the server. Caddy gets the certificates by itself once they resolve.
7. **The database, when it comes from the owner's laptop** (§6.3). Otherwise skip: the api creates its tables in the empty managed database.
8. **Start.** `docker compose -f deploy/compose.prod.yml --env-file deploy/.env pull`, then the same with `up -d`.
9. **Release check.** `docker compose ... ps` shows every service healthy; `https://ws.hapiecoin.com/healthz` lists expiries; the app asks for the gate password, then sign-in by emailed code works; the app can still be installed from the browser; a paper trade opens and shows its marks; the address shown under exchange keys is this server's.
10. **Nightly dump** (a second copy beside the provider's own backups). `crontab -e`: `15 21 * * * sh /opt/hapiecoin/deploy/backup.sh >> /var/log/hapiecoin-backup.log 2>&1` (through `sh`: the scripts are committed from Windows without the executable bit). Set `BACKUP_COPY_TO` in `deploy/.env` so each dump also leaves the server.

### 6.3 The one-time copy of the local database
The owner's decision (26 Nov 2026): the server starts with the whole local database, not an empty one. It is the last step before the first start, so nothing written locally is lost.

1. **The local database must match merged code.** Every migration applied locally has to be in `main` at the commit named by `RELEASE`. A local database that is ahead (a migration from an unmerged branch) must not be copied: the server's api would not know that migration.
2. **Live strategies.** Any strategy that is live in the local database arrives live on the server, with its stored keys, and the server's jobs (fills, reconcile, day P&L) sign calls for it every cycle; Close and Cancel on it send real orders to `DELTA_TRADING_REST_URL`. Before the dump, either close and archive every live strategy locally, or accept that and make sure the server's `DELTA_TRADING_REST_URL` is the laptop's value (the trades since 9 Sep 2026 went to the exchange's testnet, ADR-092).
3. **The same three values on the server** (§6.2 step 3), set before the restore: `CREDENTIALS_ENC_KEY` (otherwise stored exchange keys are unreadable and are entered again in the app), `BETTER_AUTH_SECRET` (whether two-factor codes survive a different one is not verified) and `DELTA_TRADING_REST_URL`.
4. **Stop every local writer**: the dev api, gateway and ingest (`pnpm dev`) and anything else using the database. From this moment nothing new is written.
5. **Dump** on the laptop, inside the container and then copied out (a `>` redirect in PowerShell damages the file). The flag that leaves TimescaleDB out is required: the managed database does not have that extension, the app uses none of it, and `restore.sh` refuses a dump that carries it:
   ```
   docker exec hapiecoin-postgres pg_dump -U hapiecoin -d hapiecoin -Fc --exclude-extension=timescaledb -f /tmp/hapiecoin-local.dump
   docker cp hapiecoin-postgres:/tmp/hapiecoin-local.dump .
   ```
6. **Copy** it to the server with `scp`. The file holds everything, including the encrypted exchange keys: treat it as a secret and delete the copies when done.
7. **Restore** on the server, before the app is started: `sh deploy/restore.sh /path/hapiecoin-local.dump`. It reads `DATABASE_URL` from `deploy/.env` and runs the PostgreSQL tools in a throwaway container. It checks the file first, refuses while the api runs, refuses a database that already has tables (`FORCE=1` replaces everything, after a backup), and loads the dump as one transaction: all of it or none.
8. **Start** the app (§6.2 step 8). Leave the laptop's copy stopped, or two copies trade on paper and both send Telegram messages. Autopilot comes across switched on.
9. The laptop's database is not changed by any of this: it is the fallback until the server is seen working.

### 6.4 Update
1. `sh deploy/backup.sh` (a dump before every release). If it does not end with `backup ok`, stop here.
2. Set `RELEASE` in `deploy/.env` to the new commit of `main`. Its images exist once the checks passed. Look at the e2e of that commit yourself before choosing it: the image job does not wait for the e2e, so a commit whose e2e failed for a real reason has images too.
3. `docker compose ... pull`, then `up -d`. The api applies new migrations as it starts; the site is away for a minute or two.
4. The release check (§6.2 step 9).

A merged migration is permanent once a server has run it: a clash of numbers is settled by renumbering the unmerged one, never the merged one.

### 6.5 Roll back
Set `RELEASE` back to the previous commit, `pull`, `up -d`. That is enough when the bad release added no migration. When it did, the older api may not run on the newer database: stop the app (`docker compose ... stop caddy web api gateway ingest`), run `FORCE=1 sh deploy/restore.sh` on the dump taken in §6.4 step 1 (everything written since that dump is lost), then start the previous release. The provider's point-in-time restore is the other way back: it creates a new database server as of a chosen minute, and `DATABASE_URL` is then pointed at it.

The database is no longer on the server, so `docker compose ... down -v` cannot delete it; it still deletes Caddy's certificates, so do not use `-v`.

### 6.6 Rotate a key
- **Vault key** (ADR-054): put the old `CREDENTIALS_ENC_KEY` into `CREDENTIALS_ENC_KEYS_PREVIOUS`, set the new one, `up -d`; reseal the stored keys with the api's `db:reseal` script, then empty the previous list. The script as named (`tsx src/db/reseal-cli.ts`) cannot run in the production image: `tsx` is a development dependency and the image carries production ones only. The compiled `dist/db/reseal-cli.js` is probably in the image, but running it there (`docker compose ... exec api node dist/db/reseal-cli.js`) is not verified. Do not rotate the vault key on the server until it is (GAPS #186).
- **`BETTER_AUTH_SECRET`**: everyone signs in again.
- **Gate password**: write a new line to `deploy/basic-auth.caddy`, `docker compose ... restart caddy`.
- **Registry token**: `docker login ghcr.io` again.
