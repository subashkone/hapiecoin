/**
 * Snapshot store: the ingest side of the contract with the API. Keys are `hapiecoin:an:{dataset}:{symbol|-}`
 * (see `analyticsKey` in @hapiecoin/schema); values are the JSON envelope. Redis in deployments, memory in tests
 * and in a dev shell without REDIS_URL. A snapshot is written with a TTL well above its refresh interval so a
 * short outage serves stale data (flagged) rather than nothing.
 */
import type { AnalyticsSnapshot } from "@hapiecoin/schema";
import Redis from "ioredis";

export const KEY_PREFIX = "hapiecoin:an:";
/** Keep a snapshot this many refresh intervals after the last successful write. */
export const TTL_MULTIPLIER = 20;

export interface SnapshotStore {
  get(key: string): Promise<AnalyticsSnapshot | null>;
  set(snapshot: AnalyticsSnapshot, ttlMs: number): Promise<void>;
  close(): Promise<void>;
}

export class MemoryStore implements SnapshotStore {
  private readonly map = new Map<string, { snapshot: AnalyticsSnapshot; expiresAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  get(key: string): Promise<AnalyticsSnapshot | null> {
    const hit = this.map.get(key);
    if (!hit) return Promise.resolve(null);
    if (hit.expiresAt <= this.now()) {
      this.map.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(hit.snapshot);
  }
  set(snapshot: AnalyticsSnapshot, ttlMs: number): Promise<void> {
    this.map.set(snapshot.key, { snapshot, expiresAt: this.now() + ttlMs });
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.map.clear();
    return Promise.resolve();
  }
  size(): number {
    return this.map.size;
  }
}

/** The slice of ioredis this store uses; tests pass a fake through `createClient`. */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "PX", ttl: number): Promise<unknown>;
  quit(): Promise<unknown>;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export interface RedisStoreOptions {
  url: string;
  prefix?: string;
  createClient?: (url: string) => RedisLike;
  onError?: (error: Error) => void;
}

export class RedisStore implements SnapshotStore {
  private readonly client: RedisLike;
  private readonly prefix: string;
  constructor(options: RedisStoreOptions) {
    const create = options.createClient ?? ((url: string) => new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 3 }));
    this.client = create(options.url);
    this.prefix = options.prefix ?? KEY_PREFIX;
    this.client.on("error", options.onError ?? (() => undefined));
  }
  async get(key: string): Promise<AnalyticsSnapshot | null> {
    const raw = await this.client.get(this.prefix + key);
    return raw === null ? null : (JSON.parse(raw) as AnalyticsSnapshot);
  }
  async set(snapshot: AnalyticsSnapshot, ttlMs: number): Promise<void> {
    await this.client.set(this.prefix + snapshot.key, JSON.stringify(snapshot), "PX", ttlMs);
  }
  async close(): Promise<void> {
    await this.client.quit();
  }
}
