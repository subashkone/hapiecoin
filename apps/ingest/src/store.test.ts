import type { AnalyticsSnapshot } from "@hapiecoin/schema";
import { describe, expect, it, vi } from "vitest";

const { FakeRedis } = vi.hoisted(() => {
  class FakeRedis {
    static last: FakeRedis | null = null;
    readonly listeners: ((error: Error) => void)[] = [];
    constructor(
      readonly url: string,
      readonly options: unknown,
    ) {
      FakeRedis.last = this;
    }
    get(): Promise<string | null> {
      return Promise.resolve(null);
    }
    set(): Promise<string> {
      return Promise.resolve("OK");
    }
    on(event: string, listener: (error: Error) => void): this {
      if (event === "error") this.listeners.push(listener);
      return this;
    }
    quit(): Promise<string> {
      return Promise.resolve("OK");
    }
  }
  return { FakeRedis };
});
vi.mock("ioredis", () => ({ default: FakeRedis }));
import { KEY_PREFIX, MemoryStore, RedisStore, type RedisLike } from "./store.js";

const snap: AnalyticsSnapshot = { dataset: "fear-greed", key: "fear-greed:-", source: "alternative.me", asOf: 1000, ttlMs: 60_000, stale: false, data: { points: [{ t: 1, v: 50 }], latest: { value: 50, label: "Neutral", at: 1 } } };

describe("[INGEST] MemoryStore", () => {
  it("keeps small series in memory, deduped on time and capped", async () => {
    const s = new MemoryStore();
    expect(await s.appendSeries("p", { t: 5, v: 1 }, 2)).toEqual([{ t: 5, v: 1 }]);
    expect(await s.appendSeries("p", { t: 4, v: 0 }, 2)).toEqual([{ t: 4, v: 0 }, { t: 5, v: 1 }]);
    expect(await s.appendSeries("p", { t: 6, v: 2 }, 2)).toEqual([{ t: 5, v: 1 }, { t: 6, v: 2 }]);
    await s.close();
    expect(await s.appendSeries("p", { t: 7, v: 3 }, 2)).toEqual([{ t: 7, v: 3 }]);
  });
  it("stores, serves until the TTL passes, then forgets", async () => {
    let now = 1000;
    const s = new MemoryStore(() => now);
    expect(await s.get(snap.key)).toBeNull();
    await s.set(snap, 500);
    expect(await s.get(snap.key)).toEqual(snap);
    expect(s.size()).toBe(1);
    now = 1500;
    expect(await s.get(snap.key)).toBeNull();
    expect(s.size()).toBe(0);
    await s.set(snap, 500);
    await s.close();
    expect(s.size()).toBe(0);
  });
});

describe("[INGEST] RedisStore", () => {
  it("prefixes keys, writes with PX, parses on read and quits on close", async () => {
    const map = new Map<string, string>();
    const calls: unknown[][] = [];
    const on = vi.fn();
    const client: RedisLike = {
      get: (k) => Promise.resolve(map.get(k) ?? null),
      set: (k: string, v: string, mode?: "PX", ttl?: number) => {
        calls.push([k, mode, ttl]);
        map.set(k, v);
        return Promise.resolve("OK");
      },
      quit: () => {
        calls.push(["quit"]);
        return Promise.resolve("OK");
      },
      on,
    };
    const onError = vi.fn();
    const s = new RedisStore({ url: "redis://x", createClient: () => client, onError });
    await s.set(snap, 1234);
    expect(calls[0]).toEqual([`${KEY_PREFIX}fear-greed:-`, "PX", 1234]);
    expect(await s.get("fear-greed:-")).toEqual(snap);
    expect(await s.appendSeries("premium:BTC", { t: 2, v: 2 }, 3)).toEqual([{ t: 2, v: 2 }]);
    expect(await s.appendSeries("premium:BTC", { t: 1, v: 1 }, 3)).toEqual([{ t: 1, v: 1 }, { t: 2, v: 2 }]);
    expect(await s.appendSeries("premium:BTC", { t: 2, v: 9 }, 3)).toEqual([{ t: 1, v: 1 }, { t: 2, v: 9 }]);
    expect(await s.appendSeries("premium:BTC", { t: 3, v: 3 }, 2)).toEqual([{ t: 2, v: 9 }, { t: 3, v: 3 }]);
    expect(map.has("hapiecoin:an:series:premium:BTC")).toBe(true);
    expect(calls.some((c) => c[0] === "hapiecoin:an:series:premium:BTC" && c[1] === undefined)).toBe(true); // no TTL on series
    expect(await s.get("nope")).toBeNull();
    await s.close();
    expect(calls.at(-1)).toEqual(["quit"]);
    expect(on).toHaveBeenCalledWith("error", onError);
    // default error handler is a no-op
    const s2 = new RedisStore({ url: "redis://x", createClient: () => client, prefix: "p:" });
    await s2.set(snap, 1);
    expect(map.has("p:fear-greed:-")).toBe(true);
  });
  it("builds an ioredis client by default and ignores errors unless a handler is given", async () => {
    const s = new RedisStore({ url: "redis://example:6379" });
    expect(FakeRedis.last?.url).toBe("redis://example:6379");
    expect(FakeRedis.last?.options).toEqual({ lazyConnect: false, maxRetriesPerRequest: 3 });
    expect(() => FakeRedis.last?.listeners[0]?.(new Error("ignored"))).not.toThrow();
    expect(await s.get("x")).toBeNull();
    await s.close();
  });
});
