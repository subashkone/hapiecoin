/**
 * Composition root: config -> pubsub, market data, feed, role, server. `index.ts` boots it; tests inject fakes.
 * ADR-062: with REDIS_URL several gateways share one Redis; a leader lease decides which one runs the venue feed,
 * the others follow (registry + snapshot store) and every one of them serves clients. Without Redis the single
 * process is the leader through the memory lock.
 */
import Redis from "ioredis";
import type { GatewayConfig } from "./config.js";
import { type HoldRegistry, MemoryHoldRegistry, RedisHoldRegistry, type RedisRegistryClient } from "./coordination/registry.js";
import { MemorySnapshotStore, RedisSnapshotStore, type RedisStoreClient, type SnapshotStore } from "./coordination/snapshots.js";
import { MarketFeed } from "./feed/feed.js";
import type { MarketDataLike } from "./feed/market-data.js";
import type { Venue as VenueId } from "@hapiecoin/schema";
import { DEFAULT_VENUE } from "@hapiecoin/venues";
import { createMarketData } from "./feed/market-data.js";
import { RoleFeed } from "./feed/role.js";
import { type LeaderHandle, type LeaderLock, MemoryLeaderLock, RedisLeaderLock, type RedisLockClient, leaderOwnerId, runAsLeader } from "./leader.js";
import { type ErrorSink, captureFromLog, createErrorSink } from "./error-sink.js";
import type { Logger } from "./log.js";
import { createLogger } from "./log.js";
import { InProcessPubSub } from "./pubsub/in-process.js";
import { RedisPubSub } from "./pubsub/redis.js";
import type { PubSub } from "./pubsub/types.js";
import { GatewayServer } from "./server.js";
import type { SocketServerFactory } from "./transport/types.js";
import { createWsServer } from "./transport/ws.js";

export const GATEWAY_LEADER_KEY = "hapiecoin:leader:gateway-feed";

/** The ioredis slice the coordination pieces use; one client serves the lock, the registry and the store. */
export type CoordinationRedis = RedisLockClient & RedisRegistryClient & RedisStoreClient & { quit(): Promise<unknown> };

export interface AppDeps {
  transport?: SocketServerFactory;
  market?: MarketDataLike;
  /** ADR-067: sessions of the other enabled venues (tests inject fakes). */
  markets?: Partial<Record<VenueId, MarketDataLike>>;
  pubsub?: PubSub;
  log?: Logger;
  /** Coordination (ADR-062); defaults: Redis-backed when REDIS_URL is set, else in-memory. */
  lock?: LeaderLock;
  registry?: HoldRegistry;
  store?: SnapshotStore;
  redis?: CoordinationRedis;
  instanceId?: string;
  /** ADR-081: the error tracker (tests inject a fake); default from ERROR_SINK_DSN, off without it. */
  errors?: ErrorSink;
  /** ADR-081: the fetch the default sink posts with (tests inject a failing one). */
  fetch?: typeof fetch;
}

export interface App {
  readonly config: GatewayConfig;
  readonly feed: MarketFeed;
  readonly role: RoleFeed;
  readonly server: GatewayServer;
  readonly pubsub: PubSub;
  readonly log: Logger;
  /** ADR-081: every error-level log of this process reaches it; `index.ts` adds the process-level faults. */
  readonly errors: ErrorSink;
  readonly instanceId: string;
  /** Null before start and when GATEWAY_ROLE is follower. */
  leader(): LeaderHandle | null;
  /** Bind the port first (so `/healthz` answers 503 while loading), load instruments, then join the election. Resolves the bound port. */
  start(): Promise<number>;
  stop(): Promise<void>;
}

export function createApp(config: GatewayConfig, deps: AppDeps = {}): App {
  // ADR-081: one error tracker per process; the default logger hands it every error-level record
  const errors =
    deps.errors ??
    createErrorSink({
      dsn: config.ERROR_SINK_DSN,
      environment: config.NODE_ENV,
      release: config.RELEASE,
      client: "hapiecoin-gateway",
      fetch: deps.fetch,
      onFailure: (message) => log.warn("error sink", { sink: message }), // warn, never error: no loop through the hook
    });
  const log = deps.log ?? createLogger(config.LOG_LEVEL, undefined, undefined, (record) => captureFromLog(errors, record));
  // always unique per process: a shared GATEWAY_INSTANCE_ID (one env file, several replicas) must never share a lock owner or registry entries
  const instanceId = deps.instanceId ?? (config.GATEWAY_INSTANCE_ID !== undefined ? `${config.GATEWAY_INSTANCE_ID}:${leaderOwnerId()}` : leaderOwnerId());
  const pubsub =
    deps.pubsub ??
    (config.REDIS_URL !== undefined
      ? new RedisPubSub({
          url: config.REDIS_URL,
          onError: (error) => log.warn("redis pubsub error", { error }),
        })
      : new InProcessPubSub());
  const needRedis = config.REDIS_URL !== undefined && deps.redis === undefined && (deps.lock === undefined || deps.registry === undefined || deps.store === undefined);
  const ownRedis: CoordinationRedis | null = needRedis && config.REDIS_URL !== undefined ? new Redis(config.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 3 }) : null;
  const redis: CoordinationRedis | null = deps.redis ?? ownRedis;
  const lock: LeaderLock = deps.lock ?? (redis ? new RedisLeaderLock(redis) : new MemoryLeaderLock());
  const registry: HoldRegistry = deps.registry ?? (redis ? new RedisHoldRegistry({ redis, instance: instanceId, leaseMs: config.LEADER_TTL_MS }) : new MemoryHoldRegistry());
  const store: SnapshotStore = deps.store ?? (redis ? new RedisSnapshotStore({ redis }) : new MemorySnapshotStore());
  const market = deps.market ?? createMarketData(config, DEFAULT_VENUE);
  const markets: Partial<Record<VenueId, MarketDataLike>> = deps.markets ?? Object.fromEntries(config.GATEWAY_VENUES.filter((v) => v !== DEFAULT_VENUE).map((v) => [v, createMarketData(config, v)]));
  const feed = new MarketFeed({
    market,
    markets,
    pubsub,
    coalesceMs: config.COALESCE_MS,
    graceMs: config.UNSUBSCRIBE_GRACE_MS,
    refreshMs: config.INSTRUMENT_REFRESH_MS,
    store,
    log,
  });
  const role = new RoleFeed({ feed, registry, store, syncMs: config.HOLD_SYNC_MS, log });
  const server = new GatewayServer({
    config,
    feed: role,
    pubsub,
    transport: deps.transport ?? createWsServer,
    log,
    errors,
  });
  let leader: LeaderHandle | null = null;
  return {
    config,
    feed,
    role,
    server,
    pubsub,
    log,
    errors,
    instanceId,
    leader: () => leader,
    start: async () => {
      const port = await server.listen(config.GATEWAY_PORT, config.GATEWAY_HOST);
      log.info("gateway listening", {
        port,
        host: config.GATEWAY_HOST,
        pubsub: config.REDIS_URL === undefined ? "in-process" : "redis",
        role: config.GATEWAY_ROLE,
        instance: instanceId,
        venues: config.GATEWAY_VENUES,
      });
      await role.start();
      if (config.GATEWAY_ROLE === "auto") {
        leader = runAsLeader({
          lock,
          key: GATEWAY_LEADER_KEY,
          owner: instanceId,
          ttlMs: config.LEADER_TTL_MS,
          onAcquire: () => role.becomeLeader(),
          onLose: () => role.becomeFollower(),
          onError: (error) => log.warn("feed lease error", { error: error instanceof Error ? error : new Error(String(error)) }),
        });
        await leader.tick(); // the first attempt: a lone gateway is the leader before start() resolves
      }
      return port;
    },
    stop: async () => {
      if (leader !== null) {
        await leader.stop();
        leader = null;
      }
      await server.close();
      await role.stop();
      await pubsub.close();
      if (ownRedis !== null) await ownRedis.quit().catch(() => undefined);
      log.info("gateway stopped");
      await errors.flush();
    },
  };
}
