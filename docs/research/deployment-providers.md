# Deployment: what HapieCoin needs and where to host it (25 Nov 2026)

Research and a recommendation only. Nothing was bought, signed up for, deployed, committed or pushed. This note is for a **private copy** for the owner and a few known people: plans stay off (`NEXT_PUBLIC_PLANS_ON_SALE` unset), no public launch.

How to read the marks: **VERIFIED** means read today in the repo, measured today on this laptop, or seen today on the provider's own page. **UNVERIFIED** means a third party, a search snippet, an inference, or something nobody could read. Prices exclude 18 % GST unless stated. INR figures use 1 USD = INR 92.92, derived from the ECB reference rates of 24 Nov 2026 (EUR/USD 1.0963, EUR/INR 101.8670); the cross rate is arithmetic, not a published rate.

## Summary

- **Update 26 Nov 2026: the owner chose Singapore**, because Mumbai has no stock; the decisions are at the end of section 10 and in ADR-148. The line below is the recommendation as first written.
- **Recommendation: one OVHcloud VPS-2 in Mumbai** (4 vCores, 8 GB, 75 GB), everything on it with Docker Compose, images built by GitHub Actions and pulled by the server. About **INR 1,125 a month with GST** (about USD 12) with no commitment. Runner-up: AWS Lightsail in Mumbai at USD 24 before GST. Details in section 9.
- **Stock check, 25 Nov 2026 about 17:40 IST: VPS-2 is out of stock in Mumbai.** OVHcloud's own stock service lists every plan of the current range (VPS-1 to VPS-4) as out of stock in Mumbai; VPS-2 is in stock only in Canada and France, VPS-3 also in Singapore. Stock changes, so check again on the order page before deciding; if Mumbai stays empty, the runner-up applies. Details at the end of section 9.
- **Three findings change the old plan** (`docs/deploy.md`, 11 Sep 2026):
  1. Delta Exchange India's data centres are in **AWS Tokyo**, behind CloudFront. The old plan said AWS Mumbai. An India server is near the users, not near the exchange.
  2. **TimescaleDB is installed but not used**: no migration creates a hypertable. Plain PostgreSQL 17 would run the app, so a managed database is possible. It is still not worth the money at this size.
  3. The database **stops growing at about 1.2 to 1.5 GB**: the big table keeps 7 days, the others 400 days.
- **The repo is not ready for a first deploy.** About 3 to 4 working days of small tasks remain (section 6). The largest risk is that the web image has never been built.

---

## Part 1. What is required

### 1. What must run

| Piece | State | Evidence |
|---|---|---|
| api (Hono, port 3001) | **Done** | `apps/api/Dockerfile` (tracked, built by CI: `.github/workflows/ci.yml:152`). Runs migrations at start (`apps/api/src/main.ts:64`). The local image is 2 months old (403 MB), older than migrations 0012 to 0031 (0032 and 0033 are uncommitted work in the tree today). |
| gateway (WebSocket, port 3002) | **Done** | `apps/gateway/Dockerfile` (tracked, CI `ci.yml:153`). Ran today from the 2-month-old image: loaded 1,195 instruments and opened the Delta socket. |
| ingest (analytics scheduler, `/healthz` on 3003) | **Partly** | `apps/ingest/Dockerfile` is **untracked**. An image built 3 days ago ran today and its jobs ran. It is not in CI. |
| web (Next 16, port 3000) | **Partly** | `apps/web/Dockerfile` is **untracked** and **has never been built** (no image exists on this laptop). Its runtime stage is the build stage (`apps/web/Dockerfile:33`), so the image carries the whole workspace and the dev dependencies. |
| Postgres | **Partly** | `deploy/compose.prod.yml:87-101` uses the same pinned TimescaleDB pg17 image as `docker-compose.yml:5`. No memory limit and no tuning are set. |
| Redis | **Done** | `deploy/compose.prod.yml:103-111`, no persistence, as in development. |
| Reverse proxy with HTTPS | **Partly** | `deploy/Caddyfile` (untracked): two host names, automatic certificates, and a password gate over the whole app (`Caddyfile:9-11`). The gate reads `basic-auth.caddy`, which a runbook is meant to create; **that runbook does not exist**. Never run. |
| Backups | **Partly** | `deploy/backup.sh` (untracked): nightly `pg_dump`, keeps 14, refuses a tiny dump. It writes to the same disk only; the off-server copy is a comment (`backup.sh:4-5`). Never run, and no restore has been tried. |
| Logs | **Partly** | Container logs are capped at 5 files of 20 MB (`compose.prod.yml:9-11`). Nothing ships them anywhere or alerts on them. |
| Error tracker | **Partly** | The code is done (ADR-081): set `ERROR_SINK_DSN` and errors go to any Sentry-protocol server. No tracker is chosen and no account exists. |
| Deploy pipeline | **Missing** | CI builds the api and gateway images and throws them away (`ci.yml:145-153`). No registry push, no web or ingest image, no deploy job. |

State of the unfinished files, as asked: `deploy/` and the web and ingest Dockerfiles are a first draft of the one-server shape. They read correctly but only the ingest image has ever run. The compose file builds all four images **on the server** (`compose.prod.yml:2`, `up -d --build`), which is the part I would change (section 5).

### 2. Measured needs

Measured today on this laptop (Docker Desktop with 7.4 GB; the dev stack had been up for 17 to 32 hours).

| Service | Memory | CPU | How it was measured |
|---|---|---|---|
| Postgres | 846 MiB | 4 % of one core | `docker stats` on the dev container. Its cache is tuned for a 7.4 GB host (`shared_buffers` 1,889 MB); on a smaller server the image tunes itself down. |
| Redis | 9 MiB (1.8 MB of data, 17 keys) | 3 % | `docker stats`, `redis-cli info memory` |
| api | 294 MB working set, 357 MB private | about 11 % of one core on average | The dev process under `tsx` (6,894 CPU-seconds over 17.6 hours). The production image was **not** measured; `tsx` overstates it. |
| gateway | 61 to 66 MiB | under 4 % | The production image, run for 3 minutes with no browser connected. |
| ingest | 197 MiB | 3 to 10 % | The production image, run for 3 minutes. Binance calls were failing on this network, so real use may be a little higher. |
| web | **Not measured in production mode** | not measured | `next dev` used 503 MB working set (1,069 MB private). `next start` is normally well below that, but I have no figure. |
| Caddy | 12 MiB idle | 0 % | The stock image, idle, no sites. |
| **Total running** | **about 1.7 to 2.0 GB** | **well under one core** | Sum of the above, with web assumed at 300 to 400 MB (UNVERIFIED). |

**Build memory.** Not measured: I did not build the web image, because the laptop is short of memory and a second session is working in the same tree. The evidence that exists: the production build ran this laptop out of memory twice (`docs/GO-LIVE-READINESS.md:51`). A 4 GB server that is also running the stack cannot be trusted to build it.

**Database disk** (read-only queries on the local database):

| Table | Size now | Rows | Keeps | Growth |
|---|---|---|---|---|
| `instrument_marks` | 676 MB (283 MB data, 393 MB indexes) | 2.27 million | 7 days (`apps/api/src/iv-snapshot.ts:33`) | About 370,000 rows on a full day. Flat at roughly 0.8 GB once the server runs all week. |
| `chain_eod` | 82 MB | 293,498 (380 days, backfilled) | 400 days (`apps/api/src/chain-eod.ts:17`) | Close to its cap already. |
| `iv_snapshots` | 45 MB | 245,131 in 76 days | 400 days (`iv-snapshot.ts:32`) | About 18 MB a month, flat at about 240 MB. |
| Everything else | under 10 MB | | | User data; negligible at this size. |

- The whole database is **819 MB** today, plus 208 MB of write-ahead log. It levels off at about **1.2 to 1.5 GB**; until then it grows by roughly 20 to 30 MB a month.
- The laptop was not on all day on 18 to 21 Nov, so the 0.8 GB figure for `instrument_marks` is scaled from the three full days.
- The ingest app writes **only to Redis** (`apps/ingest/src/store.ts:8`), so it adds nothing to the database.
- Images on disk: TimescaleDB 2.06 GB, api 403 MB, ingest 255 MB, gateway 247 MB, Redis 58 MB; web unknown.
- Fourteen nightly dumps: size not measured (no dump was taken).

**What this means for the server:** 2 vCPU and 4 GB of memory run it if the images are built elsewhere; 40 GB of disk is enough and 80 GB is comfortable.

### 3. Environment variables (names only)

Taken from the env schemas. No `.env` file was read.

**api** (`apps/api/src/config.ts:22-109`)
- Refuses to start in production without: `DATABASE_URL`, `BETTER_AUTH_SECRET` (32+ characters), `CREDENTIALS_ENC_KEY` (32 bytes, base64), `RESEND_API_KEY` (`config.ts:253, 262, 282, 285`).
- Needed in practice: `NODE_ENV`, `REDIS_URL` (only a warning without it, `config.ts:288`), `WEB_URL`, `BETTER_AUTH_URL`, `EMAIL_FROM`, `METRICS_TOKEN`, `RELEASE`, `TRADING_DISABLED`, `TRUSTED_PROXY_IPS`, `EGRESS_IP`.
- Optional accounts: `TELEGRAM_BOT_TOKEN`, `ERROR_SINK_DSN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `CREDENTIALS_ENC_KEYS_PREVIOUS` (after a key rotation, ADR-054).
- Invoice details (have defaults): `INVOICE_SELLER_NAME`, `INVOICE_SELLER_ADDRESS`, `INVOICE_SELLER_GSTIN`, `INVOICE_SELLER_EMAIL`.
- Tuning (all have defaults): `API_PORT`, `API_VENUES`, `API_JOBS_ROLE`, `LEADER_TTL_MS`, `LOG_LEVEL`, `DELTA_REST_URL`, `DELTA_TRADING_REST_URL`, `DERIBIT_REST_URL`, `TRADING_MAX_NOTIONAL_USD`, `TRADING_MAX_LEGS`, `TRADING_MARK_BAND_PCT`, `TRADING_RECONCILE_MS`, `IV_SNAPSHOT_MS`, `DAY_PNL_MS`, `SETTLEMENT_MS`, `RULES_TICK_MS`, `FILLS_INGEST_MS`, `CHAIN_HISTORY_DAYS`, `PLAYBOOK_RECORDS_MS`, `PROPOSALS_TELEGRAM_CAP`, `API_BODY_LIMIT_BYTES`, `ORDER_RATE_MAX_PER_MIN`.
- Development and tests only: `PGLITE_DATA_DIR`, `DELTA_API_KEY`, `DELTA_API_SECRET` (the last two must be absent in tests, `config.ts:233`).

**gateway** (`apps/gateway/src/config.ts:12-74`): `NODE_ENV`, `GATEWAY_PORT`, `GATEWAY_HOST`, `WEB_URL`, `REDIS_URL`, `METRICS_TOKEN`, `ERROR_SINK_DSN`, `RELEASE`, `GATEWAY_VENUES`, `GATEWAY_ROLE`, `GATEWAY_INSTANCE_ID`, `LEADER_TTL_MS`, `HOLD_SYNC_MS`, `DELTA_REST_URL`, `DELTA_WS_URL`, `DELTA_WS_CHANNEL`, `DERIBIT_REST_URL`, `DERIBIT_WS_URL`, `DERIBIT_WS_INTERVAL`, `COALESCE_MS`, `MAX_TOPICS_PER_CONN`, `MAX_CONNECTIONS_PER_IP`, `MAX_BUFFERED_BYTES`, `UNSUBSCRIBE_GRACE_MS`, `INSTRUMENT_REFRESH_MS`, `LOG_LEVEL`. None is a secret except `METRICS_TOKEN` and `ERROR_SINK_DSN`.

**ingest** (`apps/ingest/src/config.ts:20-70`): `NODE_ENV`, `INGEST_PORT`, `INGEST_HOST`, `REDIS_URL`, `COINGECKO_API_KEY` (optional; without it the markets job is skipped), `ANALYTICS_SYMBOLS`, `OPTIONS_SYMBOLS`, `WHALE_WALLETS`, `WHALE_CANDIDATES`, `WHALE_ALERT_USD`, `WALL_USD`, `HTTP_TIMEOUT_MS`, `LOG_LEVEL`, the source addresses `BINANCE_FAPI_URL`, `BINANCE_FSTREAM_URL`, `BYBIT_URL`, `BYBIT_WS_URL`, `OKX_URL`, `COINGECKO_URL`, `DERIBIT_URL`, `DELTA_URL`, `HYPERLIQUID_URL`, `HYPERLIQUID_LEADERBOARD_URL`, `FNG_URL`, and the intervals `DERIVATIVES_REFRESH_MS`, `MARKETS_REFRESH_MS`, `FEAR_GREED_REFRESH_MS`, `LIQUIDATIONS_FLUSH_MS`, `OPTIONS_REFRESH_MS`, `WHALES_REFRESH_MS`, `RSI_REFRESH_MS`, `CYCLE_REFRESH_MS`, `PREMIUM_REFRESH_MS`.

**web** (`apps/web/src/lib/env.ts`, `apps/web/next.config.ts:18`): `API_URL`, `NEXT_PUBLIC_GATEWAY_URL`, `NEXT_PUBLIC_GOOGLE_ENABLED`, `NEXT_PUBLIC_DEFAULT_EXPIRIES`, `NEXT_PUBLIC_PLANS_ON_SALE`. These are the ones a deployment sets (`NEXT_DIST_DIR` in `next.config.ts:26` is for the visual tests only). All are fixed **when the image is built**, so the web image belongs to one deployment.

**Compose only** (`deploy/env.example`): `APP_DOMAIN`, `WS_DOMAIN`, `POSTGRES_PASSWORD`.

You enter the secrets on the server yourself. The ones to generate once and keep safe: `BETTER_AUTH_SECRET`, `CREDENTIALS_ENC_KEY` (losing it makes stored exchange keys unreadable), `POSTGRES_PASSWORD`, `METRICS_TOKEN`.

### 4. Outside accounts

| Account | Needed for the private copy? | Notes |
|---|---|---|
| Domain and DNS | **Yes** | Two names pointing at the server: the app and the price feed. Who holds the registrar for `hapiecoin.com` is your call. |
| Mail sender (Resend) | **Yes, a hard requirement** | The api will not start in production without `RESEND_API_KEY` (`config.ts:285`), and sign-in codes go by email. A verified sending domain is required to mail anyone but yourself (VERIFIED, resend.com/docs). Free tier: 3,000 emails a month, 100 a day (VERIFIED, resend.com/pricing). |
| Telegram bot | Optional | Without `TELEGRAM_BOT_TOKEN` the channel is simply not offered (`config.ts:44`). Free. It uses long polling, so it needs no public address (`apps/api/src/telegram.ts:3`). |
| Payment provider (Razorpay) | **No** | **Confirmed in code:** the keys are optional (`config.ts:46-48`), the client is `null` without them (`main.ts:95`), and checkout answers 503 (`apps/api/src/routes/checkout.ts:6`). I did not start a production container to watch it boot. |
| Error tracker | Optional, recommended | Sentry's free Developer plan: 1 user, 5,000 errors a month (VERIFIED, sentry.io/pricing). Self-hosting GlitchTip needs 256 to 512 MB more memory (VERIFIED, glitchtip.com). |
| CoinGecko Demo key | Optional | Without it the markets job is skipped. Free: 10,000 calls a month (VERIFIED, coingecko.com). |
| Container registry | Yes, if CI builds the images | GitHub's registry comes with the existing GitHub account. |
| Google sign-in | No | Off unless both client values are set (`config.ts:292`). |

### 5. Hard requirements on a provider

**A fixed public IPv4 for outgoing traffic.** Delta's docs: "API requests using this API key will only succeed, if made from a machine with an IP address that was whitelisted", several addresses per key, IPv4 and IPv6 both accepted (VERIFIED, docs.delta.exchange). The maximum per key is not published.
- On an ordinary VPS the server's own address is the outgoing address and stays until the server is deleted. The danger is a rebuild or a move, which is why a *reserved* address matters.
- The private copy runs with `TRADING_DISABLED=true` (`compose.prod.yml:60`), so this matters from the first live key, not from day one.
- The app tells each user which address to whitelist from `EGRESS_IP`, whose default is a placeholder (`config.ts:63`). The compose file does not set it. It must be set before anyone connects a trading key.

**Delta reachable with low delay.**
- Delta's docs say "Delta Exchange data centers are in AWS Tokyo" (VERIFIED, docs.delta.exchange). All three hosts are CloudFront names (VERIFIED by DNS today). From Bengaluru the request ended at CloudFront's Hyderabad edge and a public call took 0.37 s in total (measured on this laptop, not from a data centre).
- So an India server reaches a nearby CloudFront edge, and the request then travels to Tokyo. I could **not** measure the server-to-Tokyo delay from any candidate region; that needs a test from the server itself.
- For paper trading and a rules check every 2 seconds (`RULES_TICK_MS`, `config.ts:90`) an India region is fine. When live stops matter, Tokyo or Singapore would be closer to the exchange and further from the users.
- One thing to watch: Delta's changelog planned to remove the public channels on `socket.india.delta.exchange` on 31 Jul 2026 in favour of `public-socket.india.delta.exchange` (VERIFIED on the docs page). The gateway still defaults to the old host (`apps/gateway/src/config.ts:18`) and it connected today, so it still works, but the default should move.

**Market data sources reachable.** What the code calls, and what happened from this network today:

| Source | Used by | From this network | From a data centre |
|---|---|---|---|
| Delta Exchange India | api, gateway, ingest | 200 | Not tested |
| Bybit | ingest (funding, open interest, RSI, cycle, walls, liquidation fallback) | 200 | India not on Bybit's excluded list; US and mainland China IPs get 403 (VERIFIED, Bybit API docs). Singapore is on Bybit's excluded-countries list for service; whether its market data answers there is unknown. |
| Binance futures | ingest (funding, open interest, long/short, taker volume, liquidations) | **Fails** (TLS cut) | UNVERIFIED everywhere: Binance's own pages could not be read from here. US IPs are reported blocked. |
| OKX | ingest (funding, open interest) | **Fails** | UNVERIFIED everywhere. |
| Deribit | gateway, api, ingest (only when the venue is switched on) | 200 | Not tested |
| Hyperliquid | ingest (whales) | Answers | Not tested |
| CoinGecko, alternative.me | ingest | 200 | Not tested |

- The code survives without Binance and OKX: funding and open interest use whichever venues answer, long/short falls back to Bybit (`apps/ingest/src/jobs.ts:169-189`), liquidations fall back to Bybit (ADR-041).
- **Taker volume has no fallback** (`jobs.ts:194`): it stays empty wherever Binance is blocked. That is the state of the local copy today.
- Whether an Indian data centre can reach Binance and OKX is the one open question I could not answer from here. It takes two `curl` commands on the server in its first minute, before anything is paid for beyond an hour.

**Tested from inside OVHcloud's network without buying a server (25 Nov 2026, about 18:10 IST).** The public Globalping service (`https://api.globalping.io`) ran one HTTPS request per host from two probes in OVHcloud's network (AS16276) in each city. Two samples each; first-byte time in milliseconds.

| Host | OVHcloud Singapore | OVHcloud Mumbai |
|---|---|---|
| Delta REST `api.india.delta.exchange` (`/v2/tickers/BTCUSD`) | 200 (6 and 170; served from CloudFront's cache) | 200 (8 and 8; cached) |
| Delta socket `socket.india.delta.exchange` | 426, the expected answer to a plain request (221, 222) | 426 (554, 630) |
| Delta socket `public-socket.india.delta.exchange` | 426 (264, 320) | 426 (634, 616) |
| Bybit `api.bybit.com` | **200** (76, 78) | 200 (144, 143) |
| Binance futures `fapi.binance.com` | **200** (75, 77) | **200** (157, 144) |
| OKX `www.okx.com` | **200** (86, 95) | **200** (391, 146) |
| Deribit `www.deribit.com` | 200 (171, 164) | 200 (206, 207) |

- Every source answers from both cities, including Bybit from Singapore, and Binance and OKX from India. The block on the owner's own network is that network's, not India's.
- The socket hosts are not cached, so their first-byte time is the nearest thing here to the real trip to Delta: Singapore was two to three times quicker than Mumbai. Two samples each; treat it as a direction, not a figure.
- Limits: the probes sit in OVHcloud's network in that city, not necessarily in the address range a new VPS gets; a 426 shows the socket host answers but no subscription was opened; a provider can still treat one address differently. Repeat the four `curl` checks on the real server.

**Memory for the Next.js build: I chose building elsewhere.** GitHub Actions builds the four images and pushes them to GitHub's registry; the server only pulls and runs them. Reasons: the build has already run a laptop out of memory twice, CI already builds two of the four images, and a small server then stays small. The cost: the web image has the public addresses baked in, so CI needs them as repository variables.

### 6. What is missing before a first deploy

In order. Sizes are working time, not calendar time.

| # | Work | Size |
|---|---|---|
| 1 | Build the web image once and fix what breaks; slim it (Next `standalone` output, or at least drop the dev dependencies) | Half a day to 1 day. The largest unknown. |
| 2 | CI: build all four images on `main`, push to the registry tagged by commit; pass the web build values | Half a day |
| 3 | `compose.prod.yml`: pull images in place of `build:`; add `TRUSTED_PROXY_IPS` and `EGRESS_IP` to the api (missing today, so every visitor shares one address for rate limits); memory limits; a health check for web | 2 to 3 hours |
| 4 | Decide how the copy is kept private. The Caddy password gate covers the whole app; it has not been tried with the installed app (PWA), the service worker or sign-in. The alternative is a small "sign-up closed" switch in the api | Half a day, including the test |
| 5 | Backups off the server (object storage or a second machine) and **one restore actually tried** | Half a day |
| 6 | The runbook in `docs/deploy.md`: server hardening (firewall, SSH keys only, updates), first start, update, rollback, key rotation | Half a day |
| 7 | First start on the server: DNS, certificates, Resend domain records, one sign-in, one paper trade, the two reachability checks, the delay to Delta | Half a day |
| 8 | Move the gateway's default Delta socket to the new public host (see section 5) | 1 to 2 hours, its own small change |
| 9 | Uptime check and an alert when the nightly backup fails | 1 to 2 hours |

Not needed for the private copy: Razorpay, Google sign-in, a second replica of anything.

---

## Part 2. Providers

All prices were fetched on 25 Nov 2026 from the pages linked in section 11. They are monthly, before GST. "Fits" means at least 2 vCPU, 4 GB and 40 GB.

### 7. Comparison

| Provider | Smallest plan that fits | Server price | Fixed IPv4 | Backups | Traffic included | India region | Paying from India |
|---|---|---|---|---|---|---|---|
| **OVHcloud** | VPS-1: 2 vCores, 4 GB, 40 GB. VPS-2: 4 vCores, 8 GB, 75 GB | VPS-1 **INR 504** (USD 5.42). VPS-2 **INR 953** (USD 10.26). No commitment; INR 420 / 810 on 12 months | Included. Wording on it never changing: UNVERIFIED | Daily backup (last 24 h) free. 7-day backup INR 124 / 207. Snapshot INR 34 / 57 | 500 GB (VPS-1), 1 TB (VPS-2) in Mumbai; then slowed to 10 Mbps, no charge | **Mumbai**, same price (checkout total not seen) | INR prices, 18 % GST quoted, Visa, Mastercard, RuPay. No UPI listed. Invoicing entity and GSTIN field: UNVERIFIED |
| **Hetzner** | CPX22: 2 vCPU, 4 GB, 80 GB (Singapore) | **EUR 26.99** (USD 29.59, INR 2,749) | Included; a separate resource that survives the server | 20 % of the server (EUR 5.40) | 1 TB, then EUR 7.40 per TB | **None.** Singapore is nearest | Cards, PayPal. No UPI, no Indian entity found. May ask for ID before the order |
| **DigitalOcean** | Basic: 2 vCPU, 4 GB, 80 GB | **USD 24** (INR 2,230) | Included. A reserved IP is free while attached but is **not** the outgoing address without a manual route change | 20 % weekly (USD 4.80), 30 % daily | 4,000 GiB, then USD 0.01 per GiB | **Bangalore (BLR1)** | International cards only, **no UPI**. USD invoices. GST 18 %, or none with a GSTIN (reverse charge) |
| **Vultr** | vc2-2c-4gb: 2 vCPU, 4 GB, 80 GB | **USD 20** (INR 1,858) | "Static" until the server is deleted. Reserved IP USD 3; whether it is the outgoing address: UNVERIFIED | 20 % (USD 4) | 3,072 GB, then USD 0.01 per GB | **Mumbai, Bangalore, Delhi** | Cards, PayPal, **no UPI**. GST 18 % |
| **Akamai / Linode** | Linode 4 GB: 2 vCPU, 4 GB, 80 GB | **USD 24** (INR 2,230) | Included. The address in use can be reserved for about USD 4.96 and survives the server | USD 5 flat | 4 TB, then USD 0.005 per GB | **Mumbai (two sites), Chennai** | Cards, PayPal, **no UPI**. USD. GST 18 %; a tax ID can be added |
| **AWS Lightsail** | 2 vCPU, 4 GB, 80 GB | **USD 24** (INR 2,230) | **Static IP free while attached; can be moved to a new server** | Snapshots USD 0.05 per GB | 2 TB in Mumbai (half the usual), then USD 0.13 per GB | **Mumbai** | **AWS India bills in INR with a GST invoice; cards, RuPay, UPI, net banking** |
| **Oracle free tier** | A1 Flex: 2 OCPU, 12 GB, ARM | **USD 0** | Keeps its address until deleted; reserved address on the free tier: UNVERIFIED | 5 volume backups free | 10 TB | **Mumbai, Hyderabad** | Indian debit and RuPay cards reported to fail (UNVERIFIED) |
| **Contabo** | Cloud VPS 4: 4 vCPU, 8 GB, 100 GB (nothing smaller) | **EUR 7.90** with the India fee (USD 8.66, INR 805), plus EUR 2 once on a monthly term | Included; changes if the region is changed | EUR 1.65 | "Unlimited", fair use, 200 Mbit/s | **Navi Mumbai**, EUR 2.40 a month extra | EUR, USD or GBP only. No UPI, no GST invoice found. Some orders held for ID |
| **E2E Networks** (Indian) | C3.8GB: 4 vCPU, 8 GB, 100 GB (nothing smaller that I trust) | **INR 3,422** (USD 36.83) | Included on C3; reserved IP INR 199 | Snapshots about INR 5 per GB | Not stated | **Indian company** | Cards, UPI, net banking, 18 % GST |
| **Hostinger** (added) | KVM 2: 2 vCPU, 8 GB, 100 GB | **INR 779** only as **INR 18,696 paid for 24 months**; renews at INR 1,199 | "Dedicated IP"; details not stated | Weekly, free | 8 TB | India (city not named) | Cards, RuPay, UPI. GST invoice: UNVERIFIED |
| **Utho** (Indian) | 2 vCPU, 4 GB, 80 GB | About INR 1,410 to 1,495: **UNVERIFIED**, its site refused every fetch | Unknown | Unknown | Unknown | Mumbai, Noida, Bangalore, Indore (UNVERIFIED) | Unknown |

**What rules each one out, or holds it back**

- **OVHcloud.** Nothing found that rules it out. Open points: the 1 TB monthly traffic limit in Mumbai (then 10 Mbps); a smaller plan needs a new server, a larger one is one click; OVH may ask for photo ID when the order is checked (UNVERIFIED).
- **Hetzner.** No India region. Singapore costs four to five times its European plans, and Bybit lists Singapore among its excluded countries. No managed database.
- **DigitalOcean.** No UPI. Keeping the outgoing address through a rebuild needs a manual network change.
- **Vultr.** Its pricing pages refused every fetch, so the prices come from its public price API. Reserved-address behaviour for outgoing traffic is unconfirmed.
- **Akamai / Linode.** Nothing rules it out for one server. Its managed Postgres has no confirmed TimescaleDB.
- **AWS Lightsail.** Nothing rules it out. It is the dearest of the plain servers once backups and GST are added, and traffic beyond 2 TB is costly.
- **Oracle free tier.** I would not build on it. The free allowance was cut to 2 OCPU and 12 GB (VERIFIED in Oracle's docs). Oracle may reclaim an instance that stays under 20 % CPU, network and memory for 7 days, which a private copy would. Free capacity in Mumbai is often unavailable (UNVERIFIED, third party). The home region can never be changed. It is ARM, so every image must be built for ARM.
- **Contabo.** Cheapest in euros, but no INR, no GST invoice, slow port, and a region change costs EUR 33 and changes the address.
- **E2E Networks.** Three to four times OVHcloud's price for the same size. Its cheaper E1 plans start with a private address only, and their listed monthly prices do not add up.
- **Hostinger.** The price needs 24 months paid in advance.
- **Utho.** Could not be verified at all.

**Reachability of Binance and OKX is unknown for every provider.** None could be tested without a server.

### 8. Two shapes

Shape A is everything on one server with Docker Compose. Shape B is one server plus the provider's managed Postgres. Both include the provider's own backup option.

| Provider | Shape A: one server | Shape B: server plus managed Postgres | Managed Postgres notes |
|---|---|---|---|
| OVHcloud VPS-1 | INR 628 (USD 6.76) | INR 6,024 (USD 64.83) | Smallest is 4 GB at about INR 5,520. In Mumbai. TimescaleDB listed |
| OVHcloud VPS-2 | **INR 1,160 (USD 12.48)** | INR 6,473 (USD 69.66) | Same |
| Hetzner Singapore | USD 35.51 (INR 3,299) | Not sold | |
| DigitalOcean BLR1 | USD 28.80 (INR 2,676) | USD 39.15 (INR 3,638) | 1 GB at USD 15.15; 2 GB at USD 30.45. In BLR1. TimescaleDB listed |
| Vultr Mumbai | USD 24 (INR 2,230) | About USD 35 (UNVERIFIED) | "From USD 15" is a search snippet |
| Akamai / Linode Mumbai | USD 33.96 (INR 3,156) with the reserved address | USD 44.96 (INR 4,178) | 1 GB at USD 16. TimescaleDB not confirmed |
| AWS Lightsail Mumbai | About USD 25 (INR 2,323) with 20 GB of snapshots | About USD 39 (INR 3,624) | 1 GB at USD 15. Offered in Mumbai: UNVERIFIED. No TimescaleDB expected |
| Oracle free tier | USD 0 | Not on the free tier | |
| Contabo India | EUR 9.55 (USD 10.47, INR 973) | Not sold | |
| E2E Networks | INR 3,621 (USD 38.97) with the reserved address | INR 9,992 (USD 107.53) | Smallest listed is 16 GB at INR 6,570 |
| Hostinger India | INR 779 on 24 months | Not sold | |

- Shape B's totals drop the server's own backup where the database is the only thing worth backing up; the difference is a few dollars either way.
- **TimescaleDB does not decide this.** The image is TimescaleDB, but no migration creates a hypertable and nothing in `apps/` or `packages/` mentions it. Any PostgreSQL 17 would do. I did not run the migrations against plain Postgres to prove it.
- A 1 GB managed database is tight: the local database process used 846 MiB (with a large cache setting). 2 GB is the honest size, which adds USD 30 on DigitalOcean.

**Shape A is the right one now.** The database is about 1 GB and stops growing; a managed database costs more than the whole server and buys little for a handful of users. What it would buy is point-in-time recovery, and a tested nightly dump copied off the server covers a private copy.

### 9. Recommendation

**OVHcloud, VPS-2, Mumbai, everything on the one server (shape A), images built by GitHub Actions.**

| | Monthly |
|---|---|
| VPS-2, no commitment | INR 953 |
| 7-day automatic backup (optional, recommended) | INR 207 |
| GST 18 % | INR 209 |
| **Total** | **about INR 1,369 (USD 14.73)**; INR 1,125 (USD 12.10) without the backup option |
| Domain, mail (Resend free tier), error tracker (Sentry free plan), Telegram | INR 0 beyond the domain's yearly fee |

Why:
- It is the cheapest server that has an India region, INR prices and GST on the quote, and it is the one you leaned towards.
- 8 GB against a measured 1.7 to 2.0 GB leaves room for the database cache and for surprises; 75 GB of disk holds the images, the database and two weeks of dumps. VPS-1 (INR 504) would run it today with little spare; the difference is INR 449 a month.
- A dedicated IPv4 is included.
- Start with **no commitment**. The first hour on the server settles the open questions; commit to 12 months (INR 810) only after that.

**Check in the first hour, before relying on it:**
1. `curl` to Binance futures and OKX from the server: do they answer?
2. The delay from the server to Delta (and what a rules tick costs in practice).
3. That the address shown in the control panel is the address Delta sees.
4. Ask OVHcloud support in writing whether the VPS address ever changes, and whether an Additional IP (INR 210) can be moved to a replacement VPS.
5. That the invoice carries GST in the form you need.

**Runner-up: AWS Lightsail, Mumbai, 2 vCPU / 4 GB / 80 GB, USD 24** (about INR 2,740 with GST and snapshots). Choose it over OVHcloud if the fixed address matters most: its static IP is a separate thing you keep and re-attach to a new server, which no OVHcloud page promised. It also pays by UPI with an AWS India GST invoice, and it is the same cloud Delta runs on, so a later move of the trading part to Tokyo stays in one account. It costs about twice as much for half the memory.

**Growing to about 100 users.** Not measured; this is an estimate.
- The price feed is one shared connection to Delta whatever the number of users, and the database stays small, so one larger server should hold it: OVHcloud VPS-3 (6 vCores, 12 GB, from INR 1,160) or VPS-4 (8 vCores, 24 GB, 3 TB of traffic, from INR 2,240).
- The first limits likely to bite are the traffic quota (1 TB on VPS-2 and VPS-3) and Resend's free 100 emails a day; Resend Pro is USD 20.
- Expect roughly **INR 3,000 to 5,000 a month** all in. A managed database or a second server is not needed at that size.

**Moving away later: easy, with one sticky part.**
- The whole deployment is a compose file, four images in a registry, and one database dump. Moving is: start a server elsewhere, restore the dump, copy the two secrets, change two DNS records. A couple of hours.
- The sticky part is the outgoing address. Every user with a live trading key has whitelisted it at Delta. Delta allows several addresses per key, so the new address can be added before the move. With trading off, as in the private copy, there is nothing to migrate.

**Stock and price re-check (25 Nov 2026, about 17:40 IST), read directly from OVHcloud.**
- Price and size confirmed: VPS-2 is 4 vCores, 8 GB, 75 GB NVMe, 1 Gbps, 1 IPv4 and IPv6, at INR 953 a month with no commitment (GST INR 171.54), INR 900 on 6 months, INR 810 on 12 months, no installation fee (`https://ca.api.ovh.com/v1/order/catalog/public/vps?ovhSubsidiary=IN`, plan `vps-2027-model2`; the same figures on `https://www.ovhcloud.com/en-in/vps/`).
- **Availability: out of stock in Mumbai.** `https://ca.api.ovh.com/v1/vps/order/rule/datacenter?ovhSubsidiary=IN&planCode=vps-2027-model2` answered `YNM: out-of-stock` (YNM is the Mumbai code in the catalogue). In stock for VPS-2: BHS (Canada) and GRA (France) only. VPS-1 and VPS-4: out of stock everywhere. VPS-3: in stock in Singapore, Canada and France, not Mumbai. I take this endpoint to be the one the order page uses; I did not open the order page itself, which is JavaScript.
- One price detail disagrees between OVHcloud's two sources: the page says the standard daily backup is "included for free", while the catalogue lists "Automated Backup Standard" for VPS-2 at INR 57 a month. Until the basket is seen, allow for INR 1,010 before GST in place of INR 953.
- What follows from it: either wait for Mumbai stock (ask OVHcloud when), or take the runner-up, AWS Lightsail in Mumbai. An OVHcloud server in France or Canada is not a substitute: it is far from the users and from Delta.

### 10. Decisions needed from you

1. **Provider, plan and region.** My pick: OVHcloud VPS-2, Mumbai, no commitment for the first month.
2. **Domain.** Which two names (for example `app.` and `ws.` under `hapiecoin.com`), and who holds the registrar and DNS.
3. **Mail sender.** Resend with a verified sending domain (it adds DNS records to that domain), and the from address. The api will not start without it.
4. **Who builds the images.** My pick: GitHub Actions builds and pushes to GitHub's registry; the server only pulls.
5. **How the copy stays private.** The password gate in Caddy as drafted, or a "sign-up closed" switch in the app. I would test the gate first because it is already written.
6. **Error tracker.** Sentry's free plan, a self-hosted one on the same server, or none for now.
7. **Where the off-server backup copy goes.** A storage bucket or a second machine.

**Decided by the owner in chat, 26 to 27 Nov 2026** (not yet an ADR; nothing bought or deployed by this session):

- Region: Singapore instead of Mumbai, because Mumbai is out of stock (section 9) and the reachability test in section 5 passed from Singapore. The order waits on OVHcloud's identity check.
- Domain: `hapiecoin.com` (found unregistered on 25 Nov 2026 through Verisign's registry lookup). The name HapieCoin stays. To be registered at GoDaddy rather than OVHcloud, because OVHcloud's identity check delays the order; DNS there points at the server.
- Database: the whole local database is restored to the server once at go-live, instead of starting empty. Conditions: the local database must be at a migration that is merged to `main` at that moment; the server needs the same `CREDENTIALS_ENC_KEY` for stored exchange keys to stay readable; Autopilot is on in the local data, so it keeps trading on paper on the server from the first start.

### 11. Sources (all fetched 25 Nov 2026)

- OVHcloud: https://www.ovhcloud.com/en-in/vps/ · https://ca.api.ovh.com/v1/order/catalog/public/vps?ovhSubsidiary=IN · https://www.ovhcloud.com/en-in/public-cloud/prices/ · https://www.ovhcloud.com/en-in/public-cloud/postgresql/ · https://www.ovhcloud.com/en-in/public-cloud/regions-availability/ · https://www.ovhcloud.com/en-in/network/additional-ip/ · https://www.ovhcloud.com/en-in/terms-and-conditions/payment/
- Hetzner: https://www.hetzner.com/cloud/regular-performance/ · https://www.hetzner.com/cloud/cost-optimized/ · https://docs.hetzner.com/cloud/servers/primary-ips/faq/ · https://docs.hetzner.com/cloud/billing/faq/ · https://docs.hetzner.com/general/security-and-identify/fraud-prevention-faq/
- DigitalOcean: https://www.digitalocean.com/pricing/droplets · https://www.digitalocean.com/pricing/managed-databases · https://docs.digitalocean.com/products/networking/reserved-ips/how-to/outbound-traffic/ · https://docs.digitalocean.com/platform/regional-availability/ · https://docs.digitalocean.com/platform/billing/taxes/ind/ · https://docs.digitalocean.com/platform/billing/manage-payment-methods/ · https://docs.digitalocean.com/products/databases/postgresql/details/supported-extensions/
- Vultr: https://api.vultr.com/v2/plans · https://api.vultr.com/v2/regions · https://docs.vultr.com/products/network/reserved-ips/faq · https://docs.vultr.com/support/platform/billing/what-payment-methods-do-you-accept (the pricing pages on vultr.com returned 403)
- Akamai / Linode: https://www.akamai.com/cloud/pricing/cpu · https://www.akamai.com/cloud/pricing/databases · https://api.linode.com/v4/linode/types · https://api.linode.com/v4/regions · https://techdocs.akamai.com/cloud-computing/docs/reserved-ips · https://techdocs.akamai.com/cloud-computing/docs/tax-information
- AWS Lightsail: https://aws.amazon.com/lightsail/pricing/ · https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-faq-data-transfer-allowance.html · https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-static-ip-addresses-in-amazon-lightsail.html · https://aws.amazon.com/tax-help/india/ · https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/edit-aispl-payment-method.html
- Oracle: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm · https://docs.oracle.com/en-us/iaas/Content/Identity/Tasks/managingregions.htm
- Contabo: https://contabo.com/en/vps/ · https://contabo.com/en/locations/india/
- E2E Networks: https://www.e2enetworks.com/pricing · https://docs.e2enetworks.com/myaccount/node/concepts/public-and-private-ips/
- Hostinger: https://www.hostinger.com/in/vps-hosting · https://www.hostinger.com/in/payment-methods
- Utho: https://utho.com/pricing returned 403; figures from https://getdeploying.com/utho (third party)
- Delta Exchange: https://docs.delta.exchange/
- Bybit: https://bybit-exchange.github.io/docs/v5/guide · https://www.bybit.com/en/help-center/article/Service-Restricted-Countries
- Services: https://resend.com/pricing · https://resend.com/docs/dashboard/domains/introduction · https://sentry.io/pricing/ · https://glitchtip.com/documentation/install · https://www.coingecko.com/en/api/pricing
- Exchange rate: https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html

The provider pages were read by research agents through a fetch tool that summarises pages. Open the page yourself for any figure a decision rests on.

### 12. Not verified

- Whether a data centre reaches Binance futures and OKX: now tested for OVHcloud Singapore and Mumbai only (section 5, both answer); untested for every other provider.
- The delay from any candidate server to Delta's Tokyo origin: only the two-sample probe in section 5.
- OVHcloud: the checkout total for Mumbai, the wording on the address never changing, the invoicing entity, a GSTIN field, UPI.
- The web image: it has never been built; its size, its build memory and its running memory are unknown.
- The api's memory in the production image (measured only in development).
- That the api starts in production mode without Razorpay keys: read in the code, not run.
- That the migrations run on PostgreSQL without TimescaleDB: inferred from the migrations, not run.
- The size of a database dump, and that a restore works.
- The Caddy password gate together with sign-in, the service worker and the installed app.
- Vultr's and Utho's prices from their own pricing pages; Lightsail managed Postgres in Mumbai; Resend's free domain count (the page said 3).
- All "100 users" figures.
