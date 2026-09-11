import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeRedis } from "../test-support/fake-redis.js";
import { MemoryHoldRegistry, RedisHoldRegistry } from "./registry.js";
import { MemorySnapshotStore, RedisSnapshotStore } from "./snapshots.js";

const T1 = "chain:delta_india:BTC:2026-09-25";
const T2 = "chain:delta_india:ETH:2026-09-25";
let t = 1_000_000;

beforeEach(() => {
  FakeRedis.reset();
  t = 1_000_000;
  FakeRedis.now = () => t;
});
afterEach(() => FakeRedis.reset());

describe("[GATEWAY] held-topic registry (ADR-062)", () => {
  it("unions live holds across instances, lets a dead instance's leases lapse, and clears on shutdown", async () => {
    const redis = new FakeRedis("redis://x");
    const a = new RedisHoldRegistry({ redis, instance: "a", leaseMs: 1_000, now: () => t });
    const b = new RedisHoldRegistry({ redis, instance: "b", leaseMs: 1_000, now: () => t });
    await a.hold(T1);
    await b.hold(T1);
    await b.hold(T2);
    expect([...(await a.liveTopics())].sort()).toEqual([T1, T2]);
    await a.drop(T1);
    expect([...(await a.liveTopics())].sort()).toEqual([T1, T2]); // b still holds T1
    // b stops heartbeating: its leases lapse; a keeps re-leasing
    t += 900;
    await a.heartbeat();
    t += 200;
    expect([...(await a.liveTopics())]).toEqual([]);
    expect(Object.keys(await redis.hgetall("hapiecoin:gw:holds"))).toEqual([]); // lapsed fields pruned
    await a.hold(T2);
    await a.heartbeat();
    expect([...(await a.liveTopics())]).toEqual([T2]);
    await a.clear();
    expect((await a.liveTopics()).size).toBe(0);
    await a.heartbeat(); // nothing held: no command
    // a malformed field is dropped rather than read
    await redis.hset("hapiecoin:gw:holds", "garbage", "1");
    expect((await a.liveTopics()).size).toBe(0);
  });

  it("memory registry: the held set is the live set", async () => {
    const r = new MemoryHoldRegistry();
    await r.hold(T1);
    await r.hold(T1);
    await r.heartbeat();
    expect([...(await r.liveTopics())]).toEqual([T1]);
    await r.drop(T1);
    expect((await r.liveTopics()).size).toBe(0);
    await r.hold(T2);
    await r.clear();
    expect((await r.liveTopics()).size).toBe(0);
  });
});

describe("[GATEWAY] snapshot store (ADR-062)", () => {
  it("round-trips snapshots and spots with expiry, ignores malformed entries", async () => {
    const redis = new FakeRedis("redis://x");
    const s = new RedisSnapshotStore({ redis, snapshotTtlMs: 1_000, spotTtlMs: 500 });
    expect(await s.getSnapshot(T1)).toBeNull();
    await s.putSnapshot(T1, { seq: 3, rows: [{ strike: "80000" }], ts: t });
    await s.putSpot("BTC", { p: "80000", ts: t });
    expect(await s.getSnapshot(T1)).toEqual({ seq: 3, rows: [{ strike: "80000" }], ts: t });
    expect(await s.getSpot("BTC")).toEqual({ p: "80000", ts: t });
    t += 600;
    expect(await s.getSpot("BTC")).toBeNull();
    expect(await s.getSnapshot(T1)).not.toBeNull();
    t += 500;
    expect(await s.getSnapshot(T1)).toBeNull();
    await redis.set("hapiecoin:gw:snap:x", "{not json", "PX", 1_000);
    await redis.set("hapiecoin:gw:snap:y", JSON.stringify({ seq: "3" }), "PX", 1_000);
    expect(await s.getSnapshot("x")).toBeNull();
    expect(await s.getSnapshot("y")).toBeNull();
    const m = new MemorySnapshotStore();
    await m.putSnapshot(T1, { seq: 1, rows: [], ts: t });
    await m.putSpot("ETH", { p: "3000", ts: t });
    expect(await m.getSnapshot(T1)).toEqual({ seq: 1, rows: [], ts: t });
    expect(await m.getSpot("ETH")).toEqual({ p: "3000", ts: t });
    expect(await m.getSnapshot(T2)).toBeNull();
  });
});
