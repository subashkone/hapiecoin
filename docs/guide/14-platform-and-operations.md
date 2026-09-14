# Platform and operations

Part of the [HapieCoin feature guide](README.md). 11 traced features on 10 screens; 11 built and tested, 0 still mock-only (listed in the backlog).

## What it does

Not screens but guarantees: request body limits and per-route rate limits on the order routes, one API replica running the background jobs and one gateway feeding, the venue port that lets a second exchange be added without touching the apps (Deribit is wired data-only), error tracking through a Sentry-protocol sink with browser errors relayed through the API, and Prometheus-style metrics on the API and the gateway behind a token.

## Try it

1. `GET /healthz` on the API and the gateway; `GET /metrics` with the bearer token; trigger a browser error (the error screen offers a report).
2. Switch venue in the header to Deribit (data-only) and back.

## Every feature, in detail

Each row is one traced feature from the build spec: the id, what it is, how it behaves (the acceptance rule the tests check), and how it is tested. Status "mock-only" means the screen exists but the data feed behind it is not connected yet.

### API · hardening

| ID | Feature | How it behaves | Status | Tested by |
|---|---|---|---|---|
| HC-SH-114 | Every request body bounded | A 1 MB cap (env API_BODY_LIMIT_BYTES) on every request body, applied before the auth handler, the guards and the validators; over the cap the API answers 413 PAYLOAD_TOO_LARGE in the error envelope; the banner image upload keeps its own 5 MB limit | built | unit (api) |
| HC-SH-115 | Order-route budget per user | The live placement, retry, batch and positions-exit routes accept 20 requests per minute per signed-in user (env ORDER_RATE_MAX_PER_MIN) on top of the global 300 per minute per IP; the 21st answers 429 ORDER_RATE_LIMITED with Retry-After before the executor runs; X-Order-RateLimit-* headers carry the budget | built | unit (api) |

### API · replicas

| ID | Feature | How it behaves | Status | Tested by |
|---|---|---|---|---|
| HC-SH-116 | Background jobs run in one API replica | The reconciler, IV snapshotter (+ alerts) and Telegram linker start only in the replica holding the Redis lease hapiecoin:leader:api-jobs (API_JOBS_ROLE leader / always / off, LEADER_TTL_MS); a standby replica takes over within the lease; /healthz reports jobs { role, active } | built | unit (api) |

### Gateway · replicas

| ID | Feature | How it behaves | Status | Tested by |
|---|---|---|---|---|
| HC-SH-117 | One venue feed across several gateways | The gateway holding the feed lease runs the Delta socket and publishes; followers register their clients' topics in a Redis hash so the leader watches them, serve first snapshots from the store the leader writes and live frames from the fan-out; takeover within LEADER_TTL_MS; GATEWAY_ROLE auto / follower; /healthz role, /metrics hapiecoin_gateway_leader | built | unit (gateway) |

### Venues · port

| ID | Feature | How it behaves | Status | Tested by |
|---|---|---|---|---|
| HC-SH-118 | One venue port in front of Delta India | The API and the gateway take their REST, trading and market-data clients, the schema mapping, lot-size defaults, seed fees and the venue id from getVenue(DEFAULT_VENUE) in @hapiecoin/venues; DELTA_INDIA carries the contract specs (0.001 BTC / 0.01 ETH / 0.001 XAUT, ticks 0.1 / 0.01 / 0.01, settlement 12:00 UTC, XAUT 16:00, USD), the symbol codec, fee defaults 0.05 / 18 / 10 and capability flags; an unknown venue or a missing trading client is a typed error | built | unit (venues) |

### Venues · port (web)

| ID | Feature | How it behaves | Status | Tested by |
|---|---|---|---|---|
| HC-SH-119 | The web client asks the venue port, never Delta | @hapiecoin/venues/core is the browser-safe part of the port (no client factory, no node:crypto); the web client formats and parses symbols through the codec (venueSymbol, parseVenueSymbol), takes lot defaults from defaultLotSizes, the settlement hour from the venue calendar and the venue id from DEFAULT_VENUE; an impossible calendar date in an exchange position symbol is refused | built | unit (web) |

### Venues · column

| ID | Feature | How it behaves | Status | Tested by |
|---|---|---|---|---|
| HC-SH-120 | Every strategy, exchange, alert and history row names its venue | Migration 0016 adds venue (default delta_india) to strategies, brokers, alerts, iv_snapshots and instrument_marks; Strategy / Alert / Broker / IvHistory / MarkHistory carry venue; a P&L alert takes its strategy's venue; history reads and the market routes are scoped to a venue (?venue=, unknown is 400); paper start and live placement refuse an exchange of another venue with a 409; the web client sends its venue on create and the workbench sizes lots by the strategy's venue | built | unit (api) |

### Venues · Deribit (data-only)

| ID | Feature | How it behaves | Status | Tested by |
|---|---|---|---|---|
| HC-SH-122 | Deribit BTC and ETH option chains behind the venue port, data-only | packages/venues gains a Deribit adapter (public REST and JSON-RPC socket, no key): inverse coin contracts are converted to USD per underlying unit with the index at the adapter, greeks pass through, names round-trip, settlement 08:00 UTC; VENUES lists deribit; the gateway opens one session per venue in GATEWAY_VENUES and routes chain:deribit:* topics to it (healthz feed.venues); the API accepts Deribit exchanges and paper strategies but refuses API keys and live orders for a data-only venue with a 409 | built | unit (venues) |

### Venues · API per venue

| ID | Feature | How it behaves | Status | Tested by |
|---|---|---|---|---|
| HC-SH-125 | The API trades, values and settles each strategy on its own venue: trading client per broker venue, lot defaults per strategy venue, market-data jobs per venue | apps/api/src/venues.ts builds the venue clients from the port: a trading client for every venue that trades (deps.tradingFor; a data-only venue has none) and, for every venue in API_VENUES (default delta_india; DERIBIT_REST_URL), a public REST client, an IV snapshotter source, a settlement spot and a rules tick; lotSizeFor takes the strategy's venue (Settings lots on Delta India, the venue's listed lot elsewhere); the rules tick is read once per venue and asset and a venue the API does not read leaves its rules waiting; the positions payload names the account's venue | built | unit (api) |

### Shared chrome · Error screen · browser error report

| ID | Feature | How it behaves | Status | Tested by |
|---|---|---|---|---|
| HC-SH-132 | A page error is reported and the trader sees a reference, Try again and Reload; uncaught browser errors are reported once a minute per message | app/error.tsx (and global-error.tsx for the root layout): 'Something broke on our side. It has been reported.', a reference (the tracker's event id, else Next's digest), Try again (the boundary reset) and Reload, and the plain sentence that a page error cannot change strategies or orders on the exchange. The shell mounts window error + unhandledrejection listeners once; reports go to POST /v1/client-errors (message, name, stack ≤ 4000, path, kind), one per message per minute; a failed report is swallowed | built | unit (api + web) |

### Ops · API /metrics and the error sink

| ID | Feature | How it behaves | Status | Tested by |
|---|---|---|---|---|
| HC-SH-133 | Error tracking for the API and the gateway through one DSN, and Prometheus request metrics on the API | ERROR_SINK_DSN (Sentry envelope protocol; no SDK) turns on an in-process sink that posts scrubbed events (tags, extra, path query redacted; no body, cookie or authorization; user id only) with a 3 s timeout and a 60-a-minute cap; every error-level log line is the capture seam (pino hook in the API, the gateway logger's error level), so 500s, job failures, feed faults and process-level faults reach the tracker once. GET /metrics on the API: requests by method, route pattern and status, a latency histogram per route, errors by kind, sink counts, jobs active, uptime, process memory; METRICS_TOKEN guards it with a bearer like the gateway | built | unit (api + gateway) |

