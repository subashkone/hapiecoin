/**
 * Snapshot store (ADR-062): the leader writes each held chain's latest rows with the coalescer `seq` they
 * correspond to, and the latest spot per underlying, so a follower gateway can answer a client's first frame
 * without an upstream socket. Entries expire on their own; a topic nobody holds simply disappears.
 */
import type { ChainRow, Topic, Underlying } from "@hapiecoin/schema";

export interface StoredSnapshot {
  seq: number;
  rows: ChainRow[];
  ts: number;
}

export interface StoredSpot {
  p: string;
  ts: number;
}

export interface SnapshotStore {
  putSnapshot(topic: Topic, snapshot: StoredSnapshot): Promise<void>;
  getSnapshot(topic: Topic): Promise<StoredSnapshot | null>;
  /** ADR-071: one spot per venue and underlying. */
  putSpot(venue: string, underlying: Underlying, spot: StoredSpot): Promise<void>;
  getSpot(venue: string, underlying: Underlying): Promise<StoredSpot | null>;
}

export interface RedisStoreClient {
  set(key: string, value: string, px: "PX", ttlMs: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
}

export interface RedisSnapshotStoreOptions {
  redis: RedisStoreClient;
  /** Key prefix (default "hapiecoin:gw:"). */
  prefix?: string;
  /** Snapshot lifetime (default 60 s: the leader rewrites a held topic at least every second while it changes). */
  snapshotTtlMs?: number;
  spotTtlMs?: number;
}

export class RedisSnapshotStore implements SnapshotStore {
  private readonly redis: RedisStoreClient;
  private readonly prefix: string;
  private readonly snapshotTtlMs: number;
  private readonly spotTtlMs: number;

  constructor(options: RedisSnapshotStoreOptions) {
    this.redis = options.redis;
    this.prefix = options.prefix ?? "hapiecoin:gw:";
    this.snapshotTtlMs = options.snapshotTtlMs ?? 60_000;
    this.spotTtlMs = options.spotTtlMs ?? 120_000;
  }

  async putSnapshot(topic: Topic, snapshot: StoredSnapshot): Promise<void> {
    await this.redis.set(`${this.prefix}snap:${topic}`, JSON.stringify(snapshot), "PX", this.snapshotTtlMs);
  }

  async getSnapshot(topic: Topic): Promise<StoredSnapshot | null> {
    return parse<StoredSnapshot>(await this.redis.get(`${this.prefix}snap:${topic}`), (v) => typeof v.seq === "number" && Array.isArray(v.rows));
  }

  async putSpot(venue: string, underlying: Underlying, spot: StoredSpot): Promise<void> {
    await this.redis.set(`${this.prefix}spot:${venue}:${underlying}`, JSON.stringify(spot), "PX", this.spotTtlMs);
  }

  async getSpot(venue: string, underlying: Underlying): Promise<StoredSpot | null> {
    return parse<StoredSpot>(await this.redis.get(`${this.prefix}spot:${venue}:${underlying}`), (v) => typeof v.p === "string");
  }
}

function parse<T>(raw: string | null, valid: (v: Record<string, unknown>) => boolean): T | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === "object" && v !== null && valid(v as Record<string, unknown>) ? (v as T) : null;
  } catch {
    return null;
  }
}

/** Single process: nothing to share, but the leader still writes and reads its own entries in tests. */
export class MemorySnapshotStore implements SnapshotStore {
  readonly snapshots = new Map<Topic, StoredSnapshot>();
  /** Keyed `${venue}:${underlying}` (ADR-071). */
  readonly spots = new Map<string, StoredSpot>();
  putSnapshot(topic: Topic, snapshot: StoredSnapshot): Promise<void> {
    this.snapshots.set(topic, snapshot);
    return Promise.resolve();
  }
  getSnapshot(topic: Topic): Promise<StoredSnapshot | null> {
    return Promise.resolve(this.snapshots.get(topic) ?? null);
  }
  putSpot(venue: string, underlying: Underlying, spot: StoredSpot): Promise<void> {
    this.spots.set(`${venue}:${underlying}`, spot);
    return Promise.resolve();
  }
  getSpot(venue: string, underlying: Underlying): Promise<StoredSpot | null> {
    return Promise.resolve(this.spots.get(`${venue}:${underlying}`) ?? null);
  }
}
