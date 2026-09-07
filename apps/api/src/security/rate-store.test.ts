import { describe, expect, it } from "vitest";
import { MemoryRateStore, RedisRateStore, type RedisLike, type RedisPipelineLike } from "./rate-store.js";

describe("[RATE] MemoryRateStore sliding window", () => {
  it("allows up to max hits then blocks with a retry hint, and frees as the window slides", async () => {
    let t = 1_000_000;
    const store = new MemoryRateStore({ now: () => t });
    for (let i = 1; i <= 3; i += 1) {
      const r = await store.consume("k", 1000, 3);
      expect(r).toEqual({ allowed: true, count: i, retryAfterMs: 0 });
      t += 100;
    }
    const blocked = await store.consume("k", 1000, 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.count).toBe(4);
    expect(blocked.retryAfterMs).toBe(700);
    expect(await store.peek("k", 1000)).toBe(3);
    t += 701;
    expect(await store.peek("k", 1000)).toBe(2);
    expect((await store.consume("k", 1000, 3)).allowed).toBe(true);
    await store.reset("k");
    expect(await store.peek("k", 1000)).toBe(0);
  });

  it("sweeps idle keys", async () => {
    let t = 0;
    const store = new MemoryRateStore({ now: () => t, sweepAfterMs: 50 });
    await store.consume("old", 10, 5);
    t = 100;
    await store.consume("new", 10, 5);
    expect(await store.peek("old", 10_000)).toBe(0);
    expect(await store.peek("new", 10_000)).toBe(1);
  });

  it("uses Date.now by default", async () => {
    const store = new MemoryRateStore();
    expect((await store.consume("x", 1000, 1)).allowed).toBe(true);
    expect((await store.consume("x", 1000, 1)).allowed).toBe(false);
  });
});

/** Tiny in-process model of the Redis commands the store uses (sorted sets). */
class FakeRedis implements RedisLike {
  readonly sets = new Map<string, Map<string, number>>();
  readonly calls: string[] = [];
  abortNext = false;

  private set(key: string) {
    let s = this.sets.get(key);
    if (!s) {
      s = new Map();
      this.sets.set(key, s);
    }
    return s;
  }

  private removeRange(key: string, min: number | string, max: number | string): number {
    const s = this.set(key);
    let n = 0;
    for (const [m, score] of s) {
      if (score >= Number(min) && score <= Number(max)) {
        s.delete(m);
        n += 1;
      }
    }
    return n;
  }

  multi(): RedisPipelineLike {
    const ops: (() => unknown)[] = [];
    const pipe: RedisPipelineLike = {
      zremrangebyscore: (key, min, max) => {
        ops.push(() => this.removeRange(key, min, max));
        return pipe;
      },
      zadd: (key, score, member) => {
        ops.push(() => {
          this.set(key).set(member, score);
          return 1;
        });
        return pipe;
      },
      zcard: (key) => {
        ops.push(() => this.set(key).size);
        return pipe;
      },
      zrange: (key, start, stop) => {
        ops.push(() =>
          [...this.set(key).entries()]
            .sort((a, b) => a[1] - b[1])
            .slice(start, stop + 1)
            .map(([m]) => m),
        );
        return pipe;
      },
      pexpire: (key, ms) => {
        ops.push(() => {
          this.calls.push(`pexpire ${key} ${ms}`);
          return 1;
        });
        return pipe;
      },
      exec: () => {
        if (this.abortNext) {
          this.abortNext = false;
          return Promise.resolve(null);
        }
        return Promise.resolve(ops.map((op) => [null, op()] as [Error | null, unknown]));
      },
    };
    return pipe;
  }

  del(key: string): Promise<number> {
    return Promise.resolve(this.sets.delete(key) ? 1 : 0);
  }

  zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number> {
    return Promise.resolve(this.removeRange(key, min, max));
  }

  zcard(key: string): Promise<number> {
    return Promise.resolve(this.set(key).size);
  }
}

describe("[RATE] RedisRateStore sorted-set window", () => {
  it("counts, blocks over the limit without extending the lockout, and expires keys", async () => {
    let t = 5_000;
    const redis = new FakeRedis();
    const store = new RedisRateStore(redis, { now: () => t });
    expect((await store.consume("k", 1000, 2)).allowed).toBe(true);
    t += 100;
    expect((await store.consume("k", 1000, 2)).allowed).toBe(true);
    t += 100;
    const blocked = await store.consume("k", 1000, 2);
    expect(blocked.allowed).toBe(false);
    expect(blocked.count).toBe(3);
    expect(blocked.retryAfterMs).toBe(800);
    expect(await store.peek("k", 1000)).toBe(2);
    expect(redis.calls.some((c) => c.startsWith("pexpire hc:rl:k 1000"))).toBe(true);
    t += 801;
    expect(await store.peek("k", 1000)).toBe(1);
    await store.reset("k");
    expect(await store.peek("k", 1000)).toBe(0);
  });

  it("falls back to `now` when the oldest member cannot be read and surfaces aborted transactions", async () => {
    const redis = new FakeRedis();
    const store = new RedisRateStore(redis, { now: () => 10, prefix: "p:" });
    await store.consume("k", 1000, 0);
    redis.abortNext = true;
    await expect(store.consume("k", 1000, 5)).rejects.toThrow(/aborted/);
    expect(new RedisRateStore(redis)).toBeInstanceOf(RedisRateStore);
  });
});
