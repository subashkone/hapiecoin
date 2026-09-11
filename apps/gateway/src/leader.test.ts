import { describe, expect, it } from "vitest";
import { type LeaderLock, MemoryLeaderLock, RedisLeaderLock, type RedisLockClient, leaderOwnerId, runAsLeader } from "./leader.js";

/** ioredis slice with PX expiry on an injected clock and the two compare-and-set scripts. */
class FakeLockRedis implements RedisLockClient {
  readonly keys = new Map<string, { value: string; until: number }>();
  fail = false;
  constructor(private readonly now: () => number) {}
  private live(key: string) {
    const k = this.keys.get(key);
    if (k && k.until <= this.now()) this.keys.delete(key);
    return this.keys.get(key);
  }
  set(key: string, value: string, _px: "PX", ttlMs: number): Promise<"OK" | null> {
    if (this.fail) return Promise.reject(new Error("redis down"));
    if (this.live(key)) return Promise.resolve(null);
    this.keys.set(key, { value, until: this.now() + ttlMs });
    return Promise.resolve("OK");
  }
  eval(script: string, _n: number, key: string, owner: string, ttl?: string | number): Promise<unknown> {
    if (this.fail) return Promise.reject(new Error("redis down"));
    const k = this.live(key);
    if (!k || k.value !== owner) return Promise.resolve(0);
    if (script.includes("pexpire")) k.until = this.now() + Number(ttl);
    else this.keys.delete(key);
    return Promise.resolve(1);
  }
}

/** Manual timers so the loop advances only when a test says so. */
function manualTimers() {
  const queue: (() => void)[] = [];
  return {
    setTimer: (fn: () => void) => {
      queue.push(fn);
      return queue.length as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => {
      queue.length = 0;
    },
    fire: async () => {
      const fn = queue.shift();
      fn?.();
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

function lockCases(name: string, make: (now: () => number) => { lock: LeaderLock; redis?: FakeLockRedis }) {
  describe(`[LEADER] ${name}`, () => {
    it("one owner at a time; the owner renews and releases, nobody else can", async () => {
      let t = 1_000;
      const { lock } = make(() => t);
      expect(await lock.acquire("k", "a", 1_000)).toBe(true);
      expect(await lock.acquire("k", "b", 1_000)).toBe(false);
      expect(await lock.renew("k", "b", 1_000)).toBe(false);
      expect(await lock.renew("k", "a", 1_000)).toBe(true);
      await lock.release("k", "b"); // not the owner: no effect
      expect(await lock.acquire("k", "b", 1_000)).toBe(false);
      await lock.release("k", "a");
      expect(await lock.acquire("k", "b", 1_000)).toBe(true);
      // a lapsed lease is free again, and the old owner cannot renew it
      t += 5_000;
      expect(await lock.renew("k", "b", 1_000)).toBe(false);
      expect(await lock.acquire("k", "a", 1_000)).toBe(true);
      // the owner acquiring again keeps the lease
      expect(await lock.acquire("k", "a", 1_000)).toBe(true);
    });
  });
}
lockCases("memory lock", (now) => ({ lock: new MemoryLeaderLock(now) }));
lockCases("redis lock", (now) => {
  const redis = new FakeLockRedis(now);
  return { lock: new RedisLeaderLock(redis), redis };
});

describe("[LEADER] runAsLeader", () => {
  it("acquires, renews, loses the role when the lease is gone, re-acquires, and releases on stop", async () => {
    let t = 0;
    const redis = new FakeLockRedis(() => t);
    const lock = new RedisLeaderLock(redis);
    const timers = manualTimers();
    const events: string[] = [];
    const errors: unknown[] = [];
    const h = runAsLeader({
      lock,
      key: "hapiecoin:leader:test",
      owner: "me",
      ttlMs: 3_000,
      renewMs: 1_000,
      onAcquire: () => void events.push("acquire"),
      onLose: () => void events.push("lose"),
      onError: (e) => void errors.push(e),
      ...timers,
    });
    await h.tick();
    expect(h.isLeader()).toBe(true);
    expect(events).toEqual(["acquire"]);
    // renew keeps it
    t = 1_000;
    await timers.fire();
    expect(h.isLeader()).toBe(true);
    // someone else took the key (our lease lapsed while we were paused): the next renew fails
    t = 10_000;
    expect(await lock.acquire("hapiecoin:leader:test", "other", 3_000)).toBe(true);
    await timers.fire();
    expect(h.isLeader()).toBe(false);
    expect(events).toEqual(["acquire", "lose"]);
    // the other leader goes away: we take it back
    await lock.release("hapiecoin:leader:test", "other");
    await timers.fire();
    expect(h.isLeader()).toBe(true);
    expect(events).toEqual(["acquire", "lose", "acquire"]);
    // a Redis error counts as lost; recovery re-acquires
    redis.fail = true;
    await timers.fire();
    expect(h.isLeader()).toBe(false);
    expect(errors).toHaveLength(1);
    redis.fail = false;
    t = 20_000;
    await timers.fire();
    expect(h.isLeader()).toBe(true);
    await h.stop();
    expect(h.isLeader()).toBe(false);
    expect(events).toEqual(["acquire", "lose", "acquire", "lose", "acquire", "lose"]);
    expect(await lock.acquire("hapiecoin:leader:test", "other", 1_000)).toBe(true); // released
  });

  it("a standby keeps retrying without calling onAcquire, and stop on a standby releases nothing", async () => {
    const lock = new MemoryLeaderLock(() => 0);
    await lock.acquire("k", "boss", 60_000);
    const timers = manualTimers();
    const events: string[] = [];
    const h = runAsLeader({ lock, key: "k", owner: "me", ttlMs: 3_000, onAcquire: () => void events.push("acquire"), onLose: () => void events.push("lose"), ...timers });
    await h.tick();
    await timers.fire();
    expect(h.isLeader()).toBe(false);
    expect(events).toEqual([]);
    await h.stop();
    expect(events).toEqual([]);
    expect(await lock.renew("k", "boss", 1_000)).toBe(true); // still the boss's
  });

  it("an exception in onAcquire or onLose is reported and does not end the loop; owner ids are unique", async () => {
    const lock = new MemoryLeaderLock(() => 0);
    const timers = manualTimers();
    const errors: unknown[] = [];
    let calls = 0;
    const h = runAsLeader({
      lock,
      key: "k",
      ttlMs: 3_000,
      onAcquire: () => {
        calls += 1;
        if (calls === 1) throw new Error("boom");
      },
      onLose: () => {
        throw new Error("bust");
      },
      onError: (e) => void errors.push(e),
      ...timers,
    });
    await h.tick();
    // the role was not taken: the lease went back, so another process could take it; the next tick retries
    expect(h.isLeader()).toBe(false);
    expect(calls).toBe(1);
    expect(await lock.acquire("k", "other", 1_000)).toBe(true);
    await lock.release("k", "other");
    await timers.fire();
    expect(calls).toBe(2);
    expect(h.isLeader()).toBe(true);
    await h.stop(); // onLose throws "bust": reported, the lease still released
    expect(errors.map((e) => (e as Error).message)).toEqual(["boom", "bust"]);
    expect(await lock.acquire("k", "other", 1_000)).toBe(true);
    expect(leaderOwnerId()).not.toBe(leaderOwnerId());
  });
});

describe("[LEADER] runAsLeader edges", () => {
  it("defaults (real timers, no onError) work; stop before the first step ends cleanly; a failing release on stop is reported", async () => {
    const quick = runAsLeader({ lock: new MemoryLeaderLock(), key: "d", onAcquire: () => undefined, onLose: () => undefined });
    await quick.tick();
    expect(quick.isLeader()).toBe(true);
    await quick.stop();
    expect(quick.isLeader()).toBe(false);
    // stop while the first acquire is still in flight: no acquire callback afterwards
    const events: string[] = [];
    const slow: LeaderLock = {
      acquire: () => new Promise((resolve) => setTimeout(() => resolve(true), 5)),
      renew: () => Promise.resolve(true),
      release: () => Promise.reject(new Error("release failed")),
    };
    const errors: unknown[] = [];
    const h = runAsLeader({ lock: slow, key: "s", ttlMs: 3_000, onAcquire: () => void events.push("acquire"), onLose: () => void events.push("lose"), onError: (e) => void errors.push(e) });
    await h.stop();
    expect(events).toEqual([]);
    // a leader whose release rejects at stop still ends as a non-leader and reports the error
    const held = runAsLeader({ lock: { ...slow, acquire: () => Promise.resolve(true) }, key: "r", ttlMs: 3_000, onAcquire: () => void events.push("acquire"), onLose: () => void events.push("lose"), onError: (e) => void errors.push(e) });
    await held.tick();
    expect(held.isLeader()).toBe(true);
    await held.stop();
    expect(events).toEqual(["acquire", "lose"]);
    expect((errors.at(-1) as Error).message).toBe("release failed");
  });
});

describe("[LEADER] runAsLeader last edges", () => {
  it("without onError a failing lock is silently retried; a timer that fires after stop does nothing", async () => {
    const failing: LeaderLock = { acquire: () => Promise.reject(new Error("down")), renew: () => Promise.resolve(false), release: () => Promise.resolve() };
    const queue: (() => void)[] = [];
    const h = runAsLeader({ lock: failing, key: "q", ttlMs: 3_000, onAcquire: () => undefined, onLose: () => undefined, setTimer: (fn) => (queue.push(fn), 1 as unknown as ReturnType<typeof setTimeout>), clearTimer: () => undefined });
    await h.tick();
    expect(h.isLeader()).toBe(false);
    await h.stop();
    // the scheduled retry survives the (no-op) clearTimer and fires after stop: the step returns at once
    const events: string[] = [];
    const later = queue.pop(); // the retry (the guard of the failed call sits before it)
    later?.();
    await h.tick();
    expect(events).toEqual([]);
    expect(h.isLeader()).toBe(false);
    for (const guard of queue) guard(); // a guard firing after its call answered changes nothing
    expect(h.isLeader()).toBe(false);
  });
});

describe("[LEADER] bounded lock calls", () => {
  it("a renew that never answers counts as a lost lease after timeoutMs; a non-Error rejection is wrapped", async () => {
    let hang: "no" | "resolve-late" | "reject-late" = "no";
    const late: { resolve: (v: boolean) => void; reject: (e: Error) => void }[] = [];
    const inner = new MemoryLeaderLock(() => 0);
    const lock: LeaderLock = {
      acquire: (k, o, t) => inner.acquire(k, o, t),
      renew: (k, o, t) => (hang === "no" ? inner.renew(k, o, t) : new Promise<boolean>((resolve, reject) => late.push({ resolve, reject }))),
      release: (k, o) => inner.release(k, o),
    };
    const timers = manualTimers();
    const events: string[] = [];
    const errors: unknown[] = [];
    const h = runAsLeader({ lock, key: "t", owner: "me", ttlMs: 3_000, renewMs: 1_000, timeoutMs: 500, onAcquire: () => void events.push("acquire"), onLose: () => void events.push("lose"), onError: (e) => void errors.push(e), ...timers });
    await h.tick();
    expect(h.isLeader()).toBe(true);
    hang = "resolve-late";
    await timers.fire(); // the renew starts and hangs; the next queued timer is its guard
    await timers.fire();
    expect(h.isLeader()).toBe(false);
    expect(events).toEqual(["acquire", "lose"]);
    expect((errors[0] as Error).message).toContain("timed out");
    // the hung call answering afterwards changes nothing
    late.shift()?.resolve(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.isLeader()).toBe(false);
    hang = "no";
    await timers.fire(); // re-acquired
    expect(h.isLeader()).toBe(true);
    hang = "reject-late";
    await timers.fire();
    await timers.fire();
    expect(h.isLeader()).toBe(false);
    late.shift()?.reject(new Error("too late"));
    await new Promise((r) => setTimeout(r, 0));
    expect(errors.filter((e) => (e as Error).message === "too late")).toHaveLength(0);
    hang = "no";
    await h.stop();
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- exercises the non-Error rejection path
    const raw: LeaderLock = { acquire: () => Promise.reject("nope"), renew: () => Promise.resolve(false), release: () => Promise.resolve() };
    const r = runAsLeader({ lock: raw, key: "r", ttlMs: 3_000, onAcquire: () => undefined, onLose: () => undefined, onError: (e) => void errors.push(e), ...manualTimers() });
    await r.tick();
    expect((errors.at(-1) as Error).message).toBe("nope");
    await r.stop();
  });
});
