/**
 * Sliding-window rate counters used by the global limiter, the OTP limiter and Better Auth's
 * `rateLimit.customStorage`. In-memory when there is no REDIS_URL, Redis sorted sets otherwise.
 */

export interface ConsumeResult {
  allowed: boolean;
  /** Requests counted in the window including this one (capped at max + 1). */
  count: number;
  /** Milliseconds until a slot frees up; 0 when allowed. */
  retryAfterMs: number;
}

export interface RateStore {
  /** Count one hit against `key` and report whether it stays within `max` per `windowMs`. */
  consume(key: string, windowMs: number, max: number): Promise<ConsumeResult>;
  /** Number of hits recorded in the window without adding one. */
  peek(key: string, windowMs: number): Promise<number>;
  /** Forget every hit for `key`. */
  reset(key: string): Promise<void>;
}

export interface MemoryRateStoreOptions {
  now?: () => number;
  /** Keys idle for longer than this are swept on the next call (default 1 hour). */
  sweepAfterMs?: number;
}

export class MemoryRateStore implements RateStore {
  private readonly hits = new Map<string, number[]>();
  private readonly now: () => number;
  private readonly sweepAfterMs: number;
  private lastSweep: number;

  constructor(opts: MemoryRateStoreOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.sweepAfterMs = opts.sweepAfterMs ?? 60 * 60 * 1000;
    this.lastSweep = this.now();
  }

  private window(key: string, windowMs: number, at: number): number[] {
    const floor = at - windowMs;
    const kept = (this.hits.get(key) ?? []).filter((t) => t > floor);
    if (kept.length === 0) this.hits.delete(key);
    else this.hits.set(key, kept);
    return kept;
  }

  private sweep(at: number): void {
    if (at - this.lastSweep < this.sweepAfterMs) return;
    this.lastSweep = at;
    for (const [key, times] of this.hits) {
      const last = times[times.length - 1];
      if (last === undefined || at - last > this.sweepAfterMs) this.hits.delete(key);
    }
  }

  consume(key: string, windowMs: number, max: number): Promise<ConsumeResult> {
    const at = this.now();
    this.sweep(at);
    const times = this.window(key, windowMs, at);
    if (times.length >= max) {
      const oldest = times[0] ?? at;
      return Promise.resolve({
        allowed: false,
        count: times.length + 1,
        retryAfterMs: Math.max(1, oldest + windowMs - at),
      });
    }
    times.push(at);
    this.hits.set(key, times);
    return Promise.resolve({ allowed: true, count: times.length, retryAfterMs: 0 });
  }

  peek(key: string, windowMs: number): Promise<number> {
    return Promise.resolve(this.window(key, windowMs, this.now()).length);
  }

  reset(key: string): Promise<void> {
    this.hits.delete(key);
    return Promise.resolve();
  }
}

/** The subset of ioredis we use, so tests can pass a fake and production passes a real client. */
export interface RedisLike {
  multi(): RedisPipelineLike;
  del(key: string): Promise<number>;
  zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number>;
  zcard(key: string): Promise<number>;
}

export interface RedisPipelineLike {
  zremrangebyscore(key: string, min: number | string, max: number | string): RedisPipelineLike;
  zadd(key: string, score: number, member: string): RedisPipelineLike;
  zcard(key: string): RedisPipelineLike;
  zrange(key: string, start: number, stop: number): RedisPipelineLike;
  pexpire(key: string, ms: number): RedisPipelineLike;
  exec(): Promise<[Error | null, unknown][] | null>;
}

export class RedisRateStore implements RateStore {
  private readonly now: () => number;
  private seq = 0;

  constructor(
    private readonly redis: RedisLike,
    opts: { now?: () => number; prefix?: string } = {},
    private readonly prefix = opts.prefix ?? "hc:rl:",
  ) {
    this.now = opts.now ?? Date.now;
  }

  async consume(key: string, windowMs: number, max: number): Promise<ConsumeResult> {
    const at = this.now();
    const k = this.prefix + key;
    const member = `${at}-${++this.seq}`;
    const results = await this.redis
      .multi()
      .zremrangebyscore(k, 0, at - windowMs)
      .zadd(k, at, member)
      .zcard(k)
      .zrange(k, 0, 0)
      .pexpire(k, windowMs)
      .exec();
    if (!results) throw new Error("redis transaction aborted");
    const count = Number(results[2]?.[1] ?? 0);
    if (count > max) {
      // Over the limit: undo this hit so a blocked client does not extend its own lockout.
      const oldestRaw = results[3]?.[1];
      const oldest =
        Array.isArray(oldestRaw) && typeof oldestRaw[0] === "string"
          ? Number(oldestRaw[0].split("-")[0])
          : at;
      await this.redis.multi().zremrangebyscore(k, at, at).exec();
      return { allowed: false, count, retryAfterMs: Math.max(1, oldest + windowMs - at) };
    }
    return { allowed: true, count, retryAfterMs: 0 };
  }

  async peek(key: string, windowMs: number): Promise<number> {
    const at = this.now();
    const k = this.prefix + key;
    await this.redis.zremrangebyscore(k, 0, at - windowMs);
    return this.redis.zcard(k);
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(this.prefix + key);
  }
}
