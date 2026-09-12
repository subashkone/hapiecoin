# System patterns · HapieCoin

## Stack (ADR-004, ADR-005)
- Monorepo: pnpm + Turborepo. `apps/web` (Next.js 16, React 19 + React Compiler, TS, Tailwind v4, shadcn), `apps/api` (Hono on Node 24, Zod + OpenAPI, Drizzle; the IV snapshotter, alerts evaluator, reconciler and Telegram poller run inside this process), `apps/gateway` (market data over `ws`; one session per venue in `GATEWAY_VENUES` in the gateway holding the feed lease, topics routed by venue, followers serve from the Redis fan-out, ADR-062 / ADR-067), `apps/ingest` (analytics jobs on a hand-rolled scheduler; no queue, no BullMQ). `packages/pricing` (Black-76 and BSM-with-carry on an injected `TradingCalendar`, ADR-066; runs in a Web Worker), `packages/schema` (shared Zod), `packages/venues` (the venue port: `VenueCore` for the browser via `@hapiecoin/venues/core`, `VenueAdapter` with the client factories for the servers, `VENUE_REGISTRY` keyed by the schema venue id, `DELTA_INDIA` and the data-only `DERIBIT` behind it (inverse contracts priced in USD at the adapter, ADR-067), Binance spot fallback; ADR-063 / ADR-064; strategies, brokers, alerts and the IV / mark history rows carry a `venue` column and the shared objects a `venue` field, ADR-065; the `venue` column, a carry-rate pricing calendar and Deribit data-only are E20 steps 2-4; in `apps/web` the workspace store owns the venue (`UiState.venue`, header chip) and binds it into `lib/venue.ts`, every chain / leg-quote subscription, expiry list and create body follows it, ADR-069; in `apps/api` `venues.ts` builds a trading client per trading venue (`deps.tradingFor`), and a public REST client, snapshotter, settlement spot and rules tick per venue in `API_VENUES`, lot defaults per strategy venue, ADR-070), `packages/ui`, `packages/config`.
- Data: PostgreSQL 17 + TimescaleDB, Redis 7. Auth: Better Auth. Payments: Razorpay. Deploy: Docker behind Cloudflare.
- Client state: TanStack Query for server data, Zustand for UI state, TanStack Virtual for the chain, hand-written canvas charts (no chart library).

## Market data (see auto-memory `coingreeks-original-site-facts`)
- Delta Exchange India public REST `/v2/products`, `/v2/tickers`, `/v2/history/candles`; WS `wss://socket.india.delta.exchange` channel `v2/ticker`. Binance `<sym>usdt@miniTicker` for spot.
- Lot sizes BTC 0.001, ETH 0.01, XAUT 0.001. Tickers carry greeks, mark IV, bid/ask IV, OI.

## Conventions
- Strikes and expiries come from the instrument list; the chain is one table with a fixed centre strike column so calls and puts scroll together (ADR-006).
- Money and quantities: never floating point for currency totals; use integer minor units or decimal strings; Black-76 math lives only in `packages/pricing`.
- Validate every external boundary (HTTP, WS, env) with Zod schemas from `packages/schema`.
- Paper and live trading share one order model but different executors; the live executor is the only code that may call an order endpoint.
- Tests: Vitest for units, Playwright for e2e and visual diffs; each test title carries its traceability ID.
- Design tokens live in one file; amber is only for spot/ATM/primary action; green/red only for P&L and side (ADR-003).
- Templates carry `risk` ("defined" = finite loss at expiry, proven by the invariants test); the Strategy Wizard (ADR-072, Builder sub-tab `wizard`, `W`) prices the eligible templates once per chain snapshot and derives every thesis figure from the expiry curve (`lib/strategy/wizard.ts`), loading a card through the same `useTemplateLoader().load` as the Templates tab.

## Mocks (pre-build reference)
- `mockup-clone/`: faithful clone of the original, hash-routed single HTML. Read-only reference (ADR-002).
- `mockup-v2/`: HapieCoin improved mock. Edit sources in `parts/`, `parts-src/`, `src-trd/`, `chrome-src/`, `public-src/`, `adm-src/`, `_analytics-src/`, then `node assemble.js`. Never hand-edit the generated `hapiecoin-v2*.html`.

## Knowledge graph
- graphify indexes this folder into `graphify-out/`. Ask structural questions through `/graphify` before grepping large mock bundles.
