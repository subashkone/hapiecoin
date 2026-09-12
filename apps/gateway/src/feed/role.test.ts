import type { Topic } from "@hapiecoin/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type HoldRegistry, MemoryHoldRegistry } from "../coordination/registry.js";
import { MemorySnapshotStore } from "../coordination/snapshots.js";
import { createLogger } from "../log.js";
import { InProcessPubSub } from "../pubsub/in-process.js";
import { FakeMarketData } from "../test-support/fake-market.js";
import { NOW } from "../test-support/fixtures.js";
import { MarketFeed } from "./feed.js";
import { RoleFeed } from "./role.js";

const TOPIC: Topic = "chain:delta_india:BTC:2026-09-25";
const NOV: Topic = "chain:delta_india:BTC:2026-11-27";
const CALL = "C-BTC-80000-250926";

function make(shared: { registry?: MemoryHoldRegistry; store?: MemorySnapshotStore } = {}) {
  const market = new FakeMarketData();
  const pubsub = new InProcessPubSub();
  const store = shared.store ?? new MemorySnapshotStore();
  const registry = shared.registry ?? new MemoryHoldRegistry();
  const lines: string[] = [];
  const log = createLogger("debug", (line) => lines.push(line), () => NOW);
  const feed = new MarketFeed({ market, pubsub, coalesceMs: 250, graceMs: 0, store, snapshotWriteMs: 100, now: () => NOW, log });
  const role = new RoleFeed({ feed, registry, store, syncMs: 1_000, waitMs: 500, pollMs: 100, log });
  return { market, pubsub, store, registry, feed, role, lines };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("[GATEWAY] RoleFeed (ADR-062)", () => {
  it("starts as a follower: instruments load over REST, no socket, holds go to the registry, nothing is watched or published", async () => {
    const { market, role, registry, feed } = make();
    await role.start();
    expect(role.role()).toBe("follower");
    expect(role.status()).toMatchObject({ ready: true, role: "follower" });
    expect(market.socket).toBe("idle");
    expect(feed.isUpstream()).toBe(false);
    role.acquire(TOPIC);
    role.acquire(TOPIC);
    await vi.advanceTimersByTimeAsync(0);
    expect([...(await registry.liveTopics())]).toEqual([TOPIC]);
    expect(market.watchCalls).toEqual([]);
    // a seeded tick as a follower updates the caches but publishes nothing
    market.tick(market.later(CALL, { mark: "1300" }));
    await vi.advanceTimersByTimeAsync(300);
    expect(feed.seq(TOPIC)).toBe(0);
    role.release(TOPIC);
    expect([...(await registry.liveTopics())]).toEqual([TOPIC]); // one holder left
    role.release(TOPIC);
    await vi.advanceTimersByTimeAsync(0);
    expect((await registry.liveTopics()).size).toBe(0);
    await role.stop();
  });

  it("a follower serves the leader's stored snapshot and spot, waiting briefly for them, else local rows at seq 0", async () => {
    const { role, store, market } = make();
    await role.start();
    // nothing stored: after the wait the local REST rows go out with seq 0
    const local = await waitSnapshot(role, TOPIC);
    expect(local).not.toBeNull();
    expect(local?.seq).toBe(0);
    expect(local?.rows.length).toBeGreaterThan(0);
    expect(await role.spot("ETH")).toBeNull();
    // the leader wrote a snapshot meanwhile: served as is, with its seq
    await store.putSnapshot(TOPIC, { seq: 7, rows: local!.rows.slice(0, 3), ts: NOW });
    await store.putSpot("delta_india", "BTC", { p: "81000", ts: NOW });
    const stored = await waitSnapshot(role, TOPIC);
    expect(stored).toEqual({ seq: 7, rows: local!.rows.slice(0, 3) });
    expect(await role.spot("BTC")).toEqual({ p: "81000", ts: NOW });
    // an unknown expiry is null either way
    expect(await waitSnapshot(role, "chain:delta_india:BTC:2030-01-01")).toBeNull();
    expect(market.socket).toBe("idle");
    await role.stop();
  });

  it("becomeLeader opens the socket, watches local and remote holds, writes snapshots and spots to the store; becomeFollower drops them", async () => {
    const registry = new MemoryHoldRegistry();
    const store = new MemorySnapshotStore();
    const a = make({ registry, store });
    const b = make({ registry, store });
    await a.role.start();
    await b.role.start();
    a.role.acquire(TOPIC); // a's own client
    b.role.acquire(NOV); // another gateway's client, same registry
    await vi.advanceTimersByTimeAsync(0);
    await a.role.becomeLeader();
    expect(a.role.role()).toBe("leader");
    expect(a.market.socket).toBe("open");
    expect(a.market.watchCalls).toEqual(["BTC:2026-09-25", "BTC:2026-11-27"]);
    // the leader answers synchronously
    const snap = a.role.snapshot(TOPIC);
    expect(snap).not.toBeInstanceOf(Promise);
    expect((snap as { seq: number }).seq).toBe(0);
    // a tick on the remote-held topic is published and the snapshot store gets both topics
    a.market.tick(a.market.later(CALL, { mark: "1300" }));
    await vi.advanceTimersByTimeAsync(400);
    expect(a.feed.seq(TOPIC)).toBe(1);
    expect(store.snapshots.get(TOPIC)?.seq).toBe(1);
    expect(store.snapshots.has(NOV)).toBe(true);
    expect(store.spots.get("delta_india:BTC")?.p).toMatch(/^\d/);
    // the other gateway drops its hold: the next sync unwatches it
    b.role.release(NOV);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(a.market.unwatchCalls).toEqual(["BTC:2026-11-27"]);
    // losing the lease closes the socket and every subscription; the local hold survives for the next leader
    a.role.becomeFollower();
    expect(a.role.role()).toBe("follower");
    expect(a.market.socket).toBe("closed");
    expect(a.market.unwatchCalls).toEqual(["BTC:2026-11-27", "BTC:2026-09-25"]);
    expect([...(await registry.liveTopics())]).toEqual([TOPIC]);
    await a.role.becomeLeader();
    expect(a.market.watchCalls.at(-1)).toBe("BTC:2026-09-25");
    await a.role.stop();
    await b.role.stop();
    expect((await registry.liveTopics()).size).toBe(0);
  });

  it("registry failures are logged, not thrown; sync is re-entrant safe", async () => {
    const registry = new MemoryHoldRegistry();
    const failing = { ...registry, hold: () => Promise.reject(new Error("redis down")), drop: () => Promise.reject(new Error("redis down")), heartbeat: () => Promise.reject(new Error("redis down")), liveTopics: () => registry.liveTopics(), clear: () => Promise.reject(new Error("redis down")) };
    const { role, lines } = make({ registry: failing as unknown as MemoryHoldRegistry });
    await role.start();
    role.acquire(TOPIC);
    role.release(TOPIC);
    await Promise.all([role.sync(), role.sync()]);
    await vi.advanceTimersByTimeAsync(0);
    await role.stop();
    expect(lines.filter((l) => l.includes("registry")).length).toBeGreaterThanOrEqual(3);
  });
});

/** The follower's snapshot polls with sleeps; drive the fake clock while it waits. */
async function waitSnapshot(role: RoleFeed, topic: Topic) {
  const answer = role.snapshot(topic);
  if (!(answer instanceof Promise)) return answer;
  let settled = false;
  const result = answer.then((v) => {
    settled = true;
    return v;
  });
  while (!settled) await vi.advanceTimersByTimeAsync(100);
  return result;
}

describe("[GATEWAY] RoleFeed edges", () => {
  it("idempotent role changes, leader-side acquire/release, unknown release, seq, store failures and promotion while waiting", async () => {
    const market = new FakeMarketData();
    const feed = new MarketFeed({ market, pubsub: new InProcessPubSub(), coalesceMs: 250, graceMs: 0, now: () => NOW });
    const store = new MemorySnapshotStore();
    const registry = new MemoryHoldRegistry();
    const role = new RoleFeed({ feed, registry, store }); // defaults: syncMs, waitMs, pollMs, logger
    await role.start();
    role.becomeFollower(); // already a follower
    role.release(TOPIC); // never held
    expect(role.seq(TOPIC)).toBe(0);
    await role.becomeLeader();
    await role.becomeLeader(); // already the leader
    role.acquire(TOPIC);
    expect(market.watchCalls).toEqual(["BTC:2026-09-25"]);
    expect(role.spot("BTC")).not.toBeInstanceOf(Promise);
    role.acquire("spot:BTC");
    role.acquire("spot:delta_india:BTC"); // HC-SH-126: the same hold under its canonical spelling
    expect(market.symbolCalls.filter((c) => c.op === "sub")).toHaveLength(1);
    role.release("spot:BTC");
    vi.advanceTimersByTime(0);
    expect(market.symbolCalls.filter((c) => c.op === "unsub")).toHaveLength(0);
    role.release("spot:delta_india:BTC");
    vi.advanceTimersByTime(0);
    expect(market.symbolCalls.filter((c) => c.op === "unsub")).toHaveLength(1);
    role.release(TOPIC);
    vi.advanceTimersByTime(0);
    expect(market.unwatchCalls).toEqual(["BTC:2026-09-25"]);
    // a store that fails to read: the follower falls back to local rows and logs
    role.becomeFollower();
    const lines: string[] = [];
    const failing = new RoleFeed({
      feed,
      registry,
      store: { ...store, getSnapshot: () => Promise.reject(new Error("redis down")), getSpot: () => Promise.reject(new Error("redis down")), putSnapshot: () => Promise.resolve(), putSpot: () => Promise.resolve() },
      waitMs: 100,
      pollMs: 50,
      log: createLogger("debug", (l) => lines.push(l), () => NOW),
    });
    await failing.start();
    const fallback = await waitSnapshot(failing, TOPIC);
    expect(fallback?.seq).toBe(0);
    expect(await failing.spot("BTC")).toEqual(feed.spot("BTC"));
    expect(lines.some((l) => l.includes("snapshot store read failed"))).toBe(true);
    // promoted while a follower snapshot is waiting: the leader's live rows come back
    const waiting = role.snapshot(TOPIC) as Promise<{ seq: number } | null>;
    await vi.advanceTimersByTimeAsync(0);
    await role.becomeLeader();
    let settled: { seq: number } | null | undefined;
    void waiting.then((v) => (settled = v));
    while (settled === undefined) await vi.advanceTimersByTimeAsync(100);
    expect(settled).not.toBeNull();
    await role.stop();
    await failing.stop();
  });

  it("toError wraps non-Error failures from the registry", async () => {
    const lines: string[] = [];
    const registry = new MemoryHoldRegistry();
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- exercises the non-Error rejection path
    const raw: HoldRegistry = { hold: () => Promise.reject("nope"), drop: () => registry.drop(TOPIC), heartbeat: () => registry.heartbeat(), liveTopics: () => registry.liveTopics(), clear: () => registry.clear() };
    const feed = new MarketFeed({ market: new FakeMarketData(), pubsub: new InProcessPubSub(), coalesceMs: 250, now: () => NOW });
    const role = new RoleFeed({ feed, registry: raw, store: new MemorySnapshotStore(), log: createLogger("debug", (l) => lines.push(l), () => NOW) });
    await role.start();
    role.acquire(TOPIC);
    await vi.advanceTimersByTimeAsync(0);
    expect(lines.some((l) => l.includes("registry hold failed") && l.includes("nope"))).toBe(true);
    await role.stop();
  });
});

describe("[GATEWAY] RoleFeed shutdown during a sync", () => {
  it("a sync that completes after stop does not re-arm the loop", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const base = new MemoryHoldRegistry();
    const slow: HoldRegistry = { hold: (t) => base.hold(t), drop: (t) => base.drop(t), heartbeat: () => gate, liveTopics: () => base.liveTopics(), clear: () => base.clear() };
    const feed = new MarketFeed({ market: new FakeMarketData(), pubsub: new InProcessPubSub(), coalesceMs: 250, now: () => NOW });
    const timers: (() => void)[] = [];
    const role = new RoleFeed({ feed, registry: slow, store: new MemorySnapshotStore(), setTimer: (fn) => (timers.push(fn), timers.length as unknown as ReturnType<typeof setTimeout>), clearTimer: () => undefined });
    await role.start();
    expect(timers).toHaveLength(1);
    timers[0]!(); // the sync starts and waits on the heartbeat
    await role.stop();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(timers).toHaveLength(1); // not re-armed after stop
  });
});

describe("[GATEWAY] RoleFeed holds across role changes", () => {
  it("counts each hold once whatever the role at the time, and a follower prunes the registry every tenth sync", async () => {
    const market = new FakeMarketData();
    const feed = new MarketFeed({ market, pubsub: new InProcessPubSub(), coalesceMs: 250, graceMs: 0, now: () => NOW });
    const base = new MemoryHoldRegistry();
    let reads = 0;
    const counting: HoldRegistry = { hold: (t) => base.hold(t), drop: (t) => base.drop(t), heartbeat: () => base.heartbeat(), liveTopics: () => (reads += 1, base.liveTopics()), clear: () => base.clear() };
    const role = new RoleFeed({ feed, registry: counting, store: new MemorySnapshotStore(), syncMs: 100 });
    await role.start();
    // held as a leader, lease lost and regained, released as a follower: the feed ends with no holders
    await role.becomeLeader();
    role.acquire(TOPIC);
    role.acquire(TOPIC);
    expect(feed.holders(TOPIC)).toBe(2);
    role.becomeFollower();
    await role.becomeLeader();
    expect(feed.holders(TOPIC)).toBe(2);
    expect(market.watchCalls.filter((w) => w === "BTC:2026-09-25")).toHaveLength(2); // once per promotion, not per hold
    role.becomeFollower();
    role.release(TOPIC);
    role.release(TOPIC);
    vi.advanceTimersByTime(0);
    expect(feed.holders(TOPIC)).toBe(0);
    expect((await base.liveTopics()).size).toBe(0);
    await role.becomeLeader();
    expect(market.watchCalls.filter((w) => w === "BTC:2026-09-25")).toHaveLength(2); // nothing held: nothing watched
    // a follower reads (and thereby prunes) the registry once every ten syncs
    role.becomeFollower();
    reads = 0;
    await vi.advanceTimersByTimeAsync(100 * 25);
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(reads).toBeLessThanOrEqual(3);
    await role.stop();
  });

  it("a venue session that fails to start leaves the role with the caller (mode stays follower)", async () => {
    const market = new FakeMarketData();
    market.start = () => {
      throw new Error("socket refused");
    };
    const feed = new MarketFeed({ market, pubsub: new InProcessPubSub(), coalesceMs: 250, now: () => NOW });
    const role = new RoleFeed({ feed, registry: new MemoryHoldRegistry(), store: new MemorySnapshotStore() });
    await role.start();
    await expect(role.becomeLeader()).rejects.toThrow("socket refused");
    expect(role.role()).toBe("follower");
    await role.stop();
  });
});
