import { describe, expect, it } from "vitest";
import { type JobStarter, startJobs } from "./jobs.js";
import { MemoryLeaderLock } from "./leader.js";

const log = { info: () => undefined, warn: () => undefined, error: () => undefined };

function starter(name: string, calls: string[], failStart = false): JobStarter {
  return {
    name,
    start: () => {
      if (failStart) throw new Error(`${name} cannot start`);
      calls.push(`start:${name}`);
      return () => calls.push(`stop:${name}`);
    },
  };
}

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
      queue.shift()?.();
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

describe("[JOBS] ADR-062 background jobs under the leader lease", () => {
  it("off runs nothing; always runs everything at once and stops on stop", async () => {
    const calls: string[] = [];
    const off = startJobs({ role: "off", lock: new MemoryLeaderLock(), starters: [starter("a", calls)], log });
    expect(off.status()).toEqual({ role: "off", active: false });
    await off.stop();
    expect(calls).toEqual([]);
    const always = startJobs({ role: "always", lock: new MemoryLeaderLock(), starters: [starter("a", calls), starter("b", calls)], log });
    expect(always.status()).toEqual({ role: "always", active: true });
    await always.stop();
    expect(calls).toEqual(["start:a", "start:b", "stop:a", "stop:b"]);
    expect(always.status().active).toBe(false);
  });

  it("leader: starts the jobs when the lease is taken, stops them when it is lost, starts again on re-acquire; a starter that throws is skipped", async () => {
    let t = 0;
    const lock = new MemoryLeaderLock(() => t);
    const calls: string[] = [];
    const timers = manualTimers();
    const jobs = startJobs({ role: "leader", lock, key: "k", ttlMs: 3_000, renewMs: 1_000, starters: [starter("a", calls), starter("broken", calls, true), starter("b", calls)], log, ...timers });
    await jobs.tick();
    expect(jobs.status()).toEqual({ role: "leader", active: true });
    expect(calls).toEqual(["start:a", "start:b"]);
    // another replica holds the lease after ours lapsed: stop everything
    t = 10_000;
    expect(await lock.acquire("k", "other", 3_000)).toBe(true);
    await timers.fire();
    expect(jobs.status().active).toBe(false);
    expect(calls.slice(2)).toEqual(["stop:a", "stop:b"]);
    // it goes away: we lead again
    await lock.release("k", "other");
    await timers.fire();
    expect(jobs.status().active).toBe(true);
    expect(calls.slice(4)).toEqual(["start:a", "start:b"]);
    await jobs.stop();
    expect(jobs.status().active).toBe(false);
    expect(calls.slice(6)).toEqual(["stop:a", "stop:b"]);
  });

  it("a second replica with the same lock stays standby until the first stops", async () => {
    const lock = new MemoryLeaderLock(() => 0);
    const calls: string[] = [];
    const t1 = manualTimers();
    const t2 = manualTimers();
    const first = startJobs({ role: "leader", lock, key: "k", ttlMs: 60_000, starters: [starter("one", calls)], log, ...t1 });
    await first.tick();
    const second = startJobs({ role: "leader", lock, key: "k", ttlMs: 60_000, starters: [starter("two", calls)], log, ...t2 });
    await second.tick();
    expect(first.status().active).toBe(true);
    expect(second.status().active).toBe(false);
    await first.stop();
    await t2.fire();
    expect(second.status().active).toBe(true);
    expect(calls).toEqual(["start:one", "stop:one", "start:two"]);
    await second.stop();
  });
});

describe("[JOBS] failure paths", () => {
  it("a job whose stop throws is logged and the others still stop; the lock erroring is reported and drops the role; always exposes tick", async () => {
    const logged: string[] = [];
    const log = { info: () => undefined, warn: (_o: object, m: string) => void logged.push(m), error: (_o: object, m: string) => void logged.push(m) };
    const calls: string[] = [];
    const bad: JobStarter = { name: "bad", start: () => () => { throw new Error("cannot stop"); } };
    const always = startJobs({ role: "always", lock: new MemoryLeaderLock(), starters: [bad, starter("ok", calls)], log });
    await always.tick();
    await always.stop();
    expect(calls).toEqual(["start:ok", "stop:ok"]);
    expect(logged).toContain("job failed to stop");
    // a lock that throws: the role is lost (jobs stop) and the error logged; recovery re-acquires
    let fail = false;
    const inner = new MemoryLeaderLock(() => 0);
    const flaky = { acquire: (k: string, o: string, t: number) => (fail ? Promise.reject(new Error("redis down")) : inner.acquire(k, o, t)), renew: (k: string, o: string, t: number) => (fail ? Promise.reject(new Error("redis down")) : inner.renew(k, o, t)), release: (k: string, o: string) => inner.release(k, o) };
    const timers = manualTimers();
    const jobs = startJobs({ role: "leader", lock: flaky, key: "k", ttlMs: 3_000, renewMs: 1_000, starters: [starter("j", calls)], log, ...timers });
    await jobs.tick();
    expect(jobs.status().active).toBe(true);
    fail = true;
    await timers.fire();
    expect(jobs.status().active).toBe(false);
    expect(logged).toContain("jobs lease error");
    fail = false;
    await timers.fire();
    expect(jobs.status().active).toBe(true);
    await jobs.stop();
  });
});

describe("[JOBS] defaults", () => {
  it("leader with no lease options uses the default key, ttl and real timers; stopping twice is harmless", async () => {
    const calls: string[] = [];
    const jobs = startJobs({ role: "leader", lock: new MemoryLeaderLock(), starters: [starter("d", calls)], log });
    await jobs.tick();
    expect(jobs.status()).toEqual({ role: "leader", active: true });
    await jobs.stop();
    await jobs.stop();
    expect(calls).toEqual(["start:d", "stop:d"]);
    const always = startJobs({ role: "always", lock: new MemoryLeaderLock(), starters: [starter("e", calls)], log });
    await always.stop();
    await always.stop();
    expect(calls.slice(2)).toEqual(["start:e", "stop:e"]);
  });
});
