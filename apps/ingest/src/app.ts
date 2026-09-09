/** Composition root: config → adapters, store, liquidation stream, scheduler, health server. `index.ts` boots it; tests inject fakes. */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { analyticsKey } from "@hapiecoin/schema";
import WebSocket from "ws";
import { BinanceAdapter } from "./adapters/binance.js";
import { BybitAdapter } from "./adapters/bybit.js";
import { CoinGeckoAdapter } from "./adapters/coingecko.js";
import { FearGreedAdapter } from "./adapters/feargreed.js";
import { OkxAdapter } from "./adapters/okx.js";
import type { IngestConfig } from "./config.js";
import { type FetchLike, JsonClient } from "./http.js";
import { type Adapters, buildFearGreed, buildFunding, buildLiquidations, buildLongShort, buildMarkets, buildOpenInterest, buildTakerVolume } from "./jobs.js";
import { ForceOrderStream, LiquidationBuffer, type SocketLike } from "./liquidations.js";
import { type Logger, createLogger } from "./log.js";
import { buildOverview } from "./overview.js";
import { Scheduler } from "./scheduler.js";
import { MemoryStore, RedisStore, type SnapshotStore } from "./store.js";

export interface AppDeps {
  fetch?: FetchLike;
  store?: SnapshotStore;
  log?: Logger;
  createSocket?: (url: string) => SocketLike;
  now?: () => number;
  /** Skip the Binance liquidation stream (tests without a fake socket). */
  stream?: boolean;
}

export interface App {
  readonly config: IngestConfig;
  readonly scheduler: Scheduler;
  readonly store: SnapshotStore;
  readonly log: Logger;
  readonly buffer: LiquidationBuffer;
  /** Bind the health port, open the stream, start the schedule. Resolves the bound port. */
  start(): Promise<number>;
  stop(): Promise<void>;
  /** Health payload also served at GET /healthz. */
  health(): { ok: boolean; store: "redis" | "memory"; stream: "open" | "closed" | "error" | "off"; jobs: ReturnType<Scheduler["statuses"]> };
}

export function createApp(config: IngestConfig, deps: AppDeps = {}): App {
  const log = deps.log ?? createLogger(config.LOG_LEVEL);
  const now = deps.now ?? Date.now;
  const store = deps.store ?? (config.REDIS_URL !== undefined ? new RedisStore({ url: config.REDIS_URL, onError: (error) => log.warn("redis error", { error }) }) : new MemoryStore(now));
  const http = new JsonClient({ ...(deps.fetch ? { fetch: deps.fetch } : {}), timeoutMs: config.HTTP_TIMEOUT_MS });
  const adapters: Adapters = {
    binance: new BinanceAdapter(http, config.BINANCE_FAPI_URL),
    bybit: new BybitAdapter(http, config.BYBIT_URL),
    okx: new OkxAdapter(http, config.OKX_URL),
    coingecko: config.COINGECKO_API_KEY !== undefined ? new CoinGeckoAdapter(http, config.COINGECKO_URL, config.COINGECKO_API_KEY) : null,
    fearGreed: new FearGreedAdapter(http, config.FNG_URL),
  };
  const tracked = new Set(config.ANALYTICS_SYMBOLS);
  const buffer = new LiquidationBuffer({ now });
  let streamState: "open" | "closed" | "error" | "off" = "off";
  const stream =
    deps.stream === false
      ? null
      : new ForceOrderStream({
          url: config.BINANCE_FSTREAM_URL,
          tracked,
          buffer,
          createSocket: deps.createSocket ?? ((url) => new WebSocket(url)),
          onState: (state, error) => {
            streamState = state;
            if (state === "error") log.warn("liquidation stream error", { error });
            else log.info("liquidation stream", { state });
          },
        });
  const scheduler = new Scheduler({ store, log, now });
  const ctx = (ttlMs: number) => ({ adapters, now, ttlMs });
  const d = config.DERIVATIVES_REFRESH_MS;
  for (const symbol of config.ANALYTICS_SYMBOLS) {
    scheduler.add({ name: analyticsKey("funding", symbol), intervalMs: d, run: () => buildFunding(ctx(d), symbol) });
    scheduler.add({ name: analyticsKey("open-interest", symbol), intervalMs: d, run: () => buildOpenInterest(ctx(d), symbol) });
    scheduler.add({ name: analyticsKey("long-short", symbol), intervalMs: d, run: () => buildLongShort(ctx(d), symbol) });
    scheduler.add({ name: analyticsKey("taker-volume", symbol), intervalMs: d, run: () => buildTakerVolume(ctx(d), symbol) });
  }
  scheduler.add({ name: analyticsKey("liquidations"), intervalMs: config.LIQUIDATIONS_FLUSH_MS, run: () => buildLiquidations(ctx(config.LIQUIDATIONS_FLUSH_MS), config.ANALYTICS_SYMBOLS, buffer, streamState === "open") });
  if (adapters.coingecko) scheduler.add({ name: analyticsKey("markets"), intervalMs: config.MARKETS_REFRESH_MS, run: () => buildMarkets(ctx(config.MARKETS_REFRESH_MS)) });
  else log.warn("COINGECKO_API_KEY not set: the markets dataset is skipped");
  scheduler.add({ name: analyticsKey("fear-greed"), intervalMs: config.FEAR_GREED_REFRESH_MS, run: () => buildFearGreed(ctx(config.FEAR_GREED_REFRESH_MS)) });
  // folds the snapshots above into the hub/overview payload; runs last on boot (stagger order) and then every derivatives interval
  scheduler.add({ name: analyticsKey("overview"), intervalMs: d, run: () => buildOverview(store, config.ANALYTICS_SYMBOLS, now, d) });

  const health: App["health"] = () => {
    const jobs = scheduler.statuses();
    const ok = jobs.every((j) => j.lastError === null || j.lastOkAt !== null);
    return { ok, store: config.REDIS_URL !== undefined && !deps.store ? "redis" : "memory", stream: streamState, jobs };
  };
  let server: Server | null = null;

  return {
    config,
    scheduler,
    store,
    log,
    buffer,
    health,
    start: () =>
      new Promise<number>((resolve, reject) => {
        server = createServer((req, res) => {
          if (req.url === "/healthz") {
            const h = health();
            res.writeHead(h.ok ? 200 : 503, { "content-type": "application/json" });
            res.end(JSON.stringify(h));
            return;
          }
          res.writeHead(404, { "content-type": "application/json" });
          res.end('{"error":"not found"}');
        });
        server.once("error", reject);
        server.listen(config.INGEST_PORT, config.INGEST_HOST, () => {
          const port = (server?.address() as AddressInfo).port;
          stream?.start();
          scheduler.start();
          log.info("ingest listening", { port, host: config.INGEST_HOST, store: health().store, symbols: config.ANALYTICS_SYMBOLS.length, markets: adapters.coingecko !== null });
          resolve(port);
        });
      }),
    stop: async () => {
      scheduler.stop();
      stream?.stop();
      await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
      await store.close();
      log.info("ingest stopped");
    },
  };
}
