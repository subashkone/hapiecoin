/**
 * Read side of the analytics contract (ADR-038): the ingest service writes `hapiecoin:an:{dataset}:{key}` snapshots
 * into Redis; the API only reads and re-validates them. Without Redis (tests, a dev shell) a memory reader is used
 * and tests seed it directly.
 */
import { AnalyticsSnapshot } from "@hapiecoin/schema";

export const ANALYTICS_KEY_PREFIX = "hapiecoin:an:";

export interface AnalyticsReader {
  get(key: string): Promise<AnalyticsSnapshot | null>;
}

export interface RedisGetLike {
  get(key: string): Promise<string | null>;
}

export class RedisAnalyticsReader implements AnalyticsReader {
  constructor(
    private readonly redis: RedisGetLike,
    private readonly prefix = ANALYTICS_KEY_PREFIX,
  ) {}
  async get(key: string): Promise<AnalyticsSnapshot | null> {
    const raw = await this.redis.get(this.prefix + key);
    if (raw === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const out = AnalyticsSnapshot.safeParse(parsed);
    return out.success ? out.data : null;
  }
}

export class MemoryAnalyticsReader implements AnalyticsReader {
  private readonly map = new Map<string, AnalyticsSnapshot>();
  get(key: string): Promise<AnalyticsSnapshot | null> {
    return Promise.resolve(this.map.get(key) ?? null);
  }
  seed(snapshot: AnalyticsSnapshot): void {
    this.map.set(snapshot.key, snapshot);
  }
  clear(): void {
    this.map.clear();
  }
}
