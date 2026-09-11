/**
 * Held-topic registry (ADR-062): every gateway records which topics its clients hold, with a lease, so the leader
 * can watch upstream the union across all gateways, not only what its own clients hold. One Redis hash, one field
 * per (topic, instance) holding the lease expiry; a gateway that dies stops renewing and its holds lapse.
 */
import type { Topic } from "@hapiecoin/schema";

export interface HoldRegistry {
  /** This instance now holds `topic` (idempotent). */
  hold(topic: Topic): Promise<void>;
  /** This instance no longer holds `topic`. */
  drop(topic: Topic): Promise<void>;
  /** Re-lease every topic this instance holds; call every `leaseMs / 3`. */
  heartbeat(): Promise<void>;
  /** Topics held by any live instance (the leader watches these). */
  liveTopics(): Promise<Set<Topic>>;
  /** Forget every hold of this instance (shutdown). */
  clear(): Promise<void>;
}

export interface RedisRegistryClient {
  hset(key: string, ...fieldValues: (string | number)[]): Promise<number>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
}

const SEP = "";

export interface RedisHoldRegistryOptions {
  redis: RedisRegistryClient;
  instance: string;
  /** Hash key (default "hapiecoin:gw:holds"). */
  key?: string;
  /** Lease per heartbeat (default 15 s). */
  leaseMs?: number;
  now?: () => number;
}

export class RedisHoldRegistry implements HoldRegistry {
  private readonly redis: RedisRegistryClient;
  private readonly instance: string;
  private readonly key: string;
  private readonly leaseMs: number;
  private readonly now: () => number;
  private readonly held = new Set<Topic>();

  constructor(options: RedisHoldRegistryOptions) {
    this.redis = options.redis;
    this.instance = options.instance;
    this.key = options.key ?? "hapiecoin:gw:holds";
    this.leaseMs = options.leaseMs ?? 15_000;
    this.now = options.now ?? Date.now;
  }

  private field(topic: Topic): string {
    return `${topic}${SEP}${this.instance}`;
  }

  async hold(topic: Topic): Promise<void> {
    this.held.add(topic);
    await this.redis.hset(this.key, this.field(topic), String(this.now() + this.leaseMs));
  }

  async drop(topic: Topic): Promise<void> {
    this.held.delete(topic);
    await this.redis.hdel(this.key, this.field(topic));
  }

  async heartbeat(): Promise<void> {
    if (this.held.size === 0) return;
    const until = String(this.now() + this.leaseMs);
    const args: string[] = [];
    for (const topic of this.held) args.push(this.field(topic), until);
    await this.redis.hset(this.key, ...args);
  }

  async liveTopics(): Promise<Set<Topic>> {
    const all = await this.redis.hgetall(this.key);
    const now = this.now();
    const live = new Set<Topic>();
    const stale: string[] = [];
    for (const [field, until] of Object.entries(all)) {
      const at = field.indexOf(SEP);
      if (at < 0) {
        stale.push(field);
        continue;
      }
      if (Number(until) > now) live.add(field.slice(0, at));
      else stale.push(field);
    }
    if (stale.length) await this.redis.hdel(this.key, ...stale); // best effort: a dead instance's lapsed leases
    return live;
  }

  async clear(): Promise<void> {
    if (this.held.size === 0) return;
    const fields = [...this.held].map((t) => this.field(t));
    this.held.clear();
    await this.redis.hdel(this.key, ...fields);
  }
}

/** Single process: the held set is the live set. */
export class MemoryHoldRegistry implements HoldRegistry {
  private readonly held = new Set<Topic>();
  hold(topic: Topic): Promise<void> {
    this.held.add(topic);
    return Promise.resolve();
  }
  drop(topic: Topic): Promise<void> {
    this.held.delete(topic);
    return Promise.resolve();
  }
  heartbeat(): Promise<void> {
    return Promise.resolve();
  }
  liveTopics(): Promise<Set<Topic>> {
    return Promise.resolve(new Set(this.held));
  }
  clear(): Promise<void> {
    this.held.clear();
    return Promise.resolve();
  }
}
