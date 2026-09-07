/** Composition root: config -> pubsub, market data, feed, server. `index.ts` boots it; tests inject fakes. */
import type { GatewayConfig } from "./config.js";
import { MarketFeed } from "./feed/feed.js";
import type { MarketDataLike } from "./feed/market-data.js";
import { createMarketData } from "./feed/market-data.js";
import type { Logger } from "./log.js";
import { createLogger } from "./log.js";
import { InProcessPubSub } from "./pubsub/in-process.js";
import { RedisPubSub } from "./pubsub/redis.js";
import type { PubSub } from "./pubsub/types.js";
import { GatewayServer } from "./server.js";
import type { SocketServerFactory } from "./transport/types.js";
import { createWsServer } from "./transport/ws.js";

export interface AppDeps {
  transport?: SocketServerFactory;
  market?: MarketDataLike;
  pubsub?: PubSub;
  log?: Logger;
}

export interface App {
  readonly config: GatewayConfig;
  readonly feed: MarketFeed;
  readonly server: GatewayServer;
  readonly pubsub: PubSub;
  readonly log: Logger;
  /** Bind the port first (so `/healthz` answers 503 while loading), then start the feed. Resolves the bound port. */
  start(): Promise<number>;
  stop(): Promise<void>;
}

export function createApp(config: GatewayConfig, deps: AppDeps = {}): App {
  const log = deps.log ?? createLogger(config.LOG_LEVEL);
  const pubsub =
    deps.pubsub ??
    (config.REDIS_URL !== undefined
      ? new RedisPubSub({
          url: config.REDIS_URL,
          onError: (error) => log.warn("redis pubsub error", { error }),
        })
      : new InProcessPubSub());
  const market = deps.market ?? createMarketData(config);
  const feed = new MarketFeed({
    market,
    pubsub,
    coalesceMs: config.COALESCE_MS,
    graceMs: config.UNSUBSCRIBE_GRACE_MS,
    refreshMs: config.INSTRUMENT_REFRESH_MS,
    log,
  });
  const server = new GatewayServer({
    config,
    feed,
    pubsub,
    transport: deps.transport ?? createWsServer,
    log,
  });
  return {
    config,
    feed,
    server,
    pubsub,
    log,
    start: async () => {
      const port = await server.listen(config.GATEWAY_PORT, config.GATEWAY_HOST);
      log.info("gateway listening", {
        port,
        host: config.GATEWAY_HOST,
        pubsub: config.REDIS_URL === undefined ? "in-process" : "redis",
      });
      await feed.start();
      return port;
    },
    stop: async () => {
      await server.close();
      feed.stop();
      await pubsub.close();
      log.info("gateway stopped");
    },
  };
}
