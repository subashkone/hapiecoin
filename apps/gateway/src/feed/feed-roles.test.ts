/** MarketFeed in follower and leader modes (ADR-062): what a follower must not do, and what the leader writes to the store. */
import type { ServerMessage, Topic } from "@hapiecoin/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemorySnapshotStore, type SnapshotStore } from "../coordination/snapshots.js";
import { createLogger } from "../log.js";
import { InProcessPubSub } from "../pubsub/in-process.js";
import { FakeMarketData } from "../test-support/fake-market.js";
import { NOW } from "../test-support/fixtures.js";
import { MarketFeed } from "./feed.js";

const TOPIC: Topic = "chain:delta_india:BTC:2026-09-25";
const NOV: Topic = "chain:delta_india:BTC:2026-11-27";
const CALL = "C-BTC-80000-250926";

function make(store: SnapshotStore | undefined, graceMs = 0) {
  const market = new FakeMarketData();
  const pubsub = new InProcessPubSub();
  const published: ServerMessage[] = [];
  for (const topic of [TOPIC, NOV, "spot:BTC"]) pubsub.subscribe(topic, (m) => published.push(m));
  const lines: string[] = [];
  const log = createLogger("debug", (line) => lines.push(line), () => NOW);
  const feed = new MarketFeed({ market, pubsub, coalesceMs: 250, graceMs, store, snapshotWriteMs: 100, now: () => NOW, log });
  return { market, feed, published, lines, store };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("[GATEWAY] MarketFeed follower mode", () => {
  it("startFollower loads once, watches nothing, publishes nothing, keeps holders for a later promotion; stop clears graces", async () => {
    const { market, feed, published } = make(new MemorySnapshotStore(), 1_000);
    await feed.startFollower();
    await feed.startFollower(); // idempotent
    expect(market.loads).toBe(1);
    expect(market.socket).toBe("idle");
    expect(feed.isUpstream()).toBe(false);
    feed.acquire(TOPIC);
    feed.acquire("spot:BTC");
    feed.acquire("fut:delta_india:BTCUSD");
    expect(market.watchCalls).toEqual([]);
    expect(market.symbolCalls).toEqual([]);
    market.tick(market.later(CALL, { mark: "1300", spot: "80500" }));
    vi.advanceTimersByTime(300);
    expect(published).toEqual([]);
    expect(feed.spot("BTC")?.p).toBe("80500"); // caches still follow the venue
    feed.release(NOV); // not held: no-op
    feed.release(TOPIC); // grace timer pending
    // promotion watches what is still held: the spot, the chain in grace stays until it lapses; fut is skipped
    feed.promote();
    feed.promote();
    expect(market.socket).toBe("open");
    expect(market.watchCalls).toEqual(["BTC:2026-09-25"]);
    expect(market.symbolCalls).toEqual([{ op: "sub", symbols: ["BTCUSD"] }]);
    vi.advanceTimersByTime(1_000);
    expect(market.unwatchCalls).toEqual(["BTC:2026-09-25"]);
    feed.stop();
    expect(market.socket).toBe("closed");
  });

  it("a grace that lapses keeps the upstream subscription while another gateway holds the topic; remote topics come and go with the registry", async () => {
    const { market, feed } = make(new MemorySnapshotStore(), 500);
    await feed.start();
    feed.acquire(TOPIC);
    feed.setRemoteTopics(new Set([TOPIC, NOV]));
    expect(market.watchCalls).toEqual(["BTC:2026-09-25", "BTC:2026-11-27"]);
    feed.release(TOPIC);
    vi.advanceTimersByTime(500);
    expect(market.unwatchCalls).toEqual([]); // still remote-held
    feed.acquire(NOV); // now also local
    feed.setRemoteTopics(new Set([TOPIC]));
    expect(market.unwatchCalls).toEqual([]); // NOV stays: a local client holds it
    feed.setRemoteTopics(new Set());
    expect(market.unwatchCalls).toEqual(["BTC:2026-09-25"]);
    feed.setRemoteTopics(new Set(["fut:delta_india:BTCUSD", "chain:delta_india:BTC:2030-01-01"]));
    expect(market.watchCalls).toEqual(["BTC:2026-09-25", "BTC:2026-11-27", "BTC:2030-01-01"]); // unknown expiry: watched, snapshot withheld
    vi.advanceTimersByTime(200);
    feed.stop();
  });

  it("the leader writes snapshots of held topics and spots to the store, throttled, and logs store failures", async () => {
    const store = new MemorySnapshotStore();
    const { market, feed, published } = make(store);
    await feed.start();
    feed.acquire(TOPIC);
    vi.advanceTimersByTime(100);
    expect(store.snapshots.get(TOPIC)?.seq).toBe(0); // written on watch
    expect(store.spots.get("BTC")?.p).toMatch(/^\d/); // known spots go out on promotion
    market.tick(market.later(CALL, { mark: "1300", spot: "80600" }));
    vi.advanceTimersByTime(250);
    feed.setRemoteTopics(new Set([TOPIC])); // a remote hold on a topic already dirty: the pending write covers it
    expect(published.map((m) => m.t)).toEqual(["snap", "q", "spot"]); // the watch announces a snapshot, then the deltas
    expect(published[0]).toMatchObject({ t: "snap", topic: TOPIC, seq: 0 });
    expect(store.spots.get("BTC")?.p).toBe("80600");
    vi.advanceTimersByTime(100);
    expect(store.snapshots.get(TOPIC)?.seq).toBe(1);
    feed.setRemoteTopics(new Set()); // the remote hold goes away; the local one remains
    // a topic released before the write is skipped
    feed.acquire(NOV);
    feed.release(NOV);
    vi.advanceTimersByTime(0);
    feed.release(TOPIC);
    market.tick(market.later(CALL, { mark: "1301" }, 2_000));
    vi.advanceTimersByTime(400);
    expect(store.snapshots.get(TOPIC)?.seq).toBe(1);
    feed.stop();

    const failing: SnapshotStore = {
      putSnapshot: () => Promise.reject(new Error("redis down")),
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- exercises the non-Error rejection path
      putSpot: () => Promise.reject("raw failure"),
      getSnapshot: () => Promise.resolve(null),
      getSpot: () => Promise.resolve(null),
    };
    const bad = make(failing);
    await bad.feed.start();
    bad.feed.acquire(TOPIC);
    bad.market.tick(bad.market.later(CALL, { mark: "1300", spot: "80700" }));
    await vi.advanceTimersByTimeAsync(400);
    expect(bad.lines.filter((l) => l.includes("store write failed")).length).toBeGreaterThanOrEqual(2);
    bad.feed.stop();
  });
});

describe("[GATEWAY] MarketFeed follower graces", () => {
  it("a grace that lapses as a follower unwatches nothing; stop clears a pending grace without a socket", async () => {
    const lapsed = make(undefined, 100);
    await lapsed.feed.startFollower();
    lapsed.feed.acquire(TOPIC);
    lapsed.feed.release(TOPIC);
    vi.advanceTimersByTime(100);
    expect(lapsed.market.unwatchCalls).toEqual([]);
    expect(lapsed.feed.holders(TOPIC)).toBe(0);
    const pending = make(undefined, 10_000);
    await pending.feed.startFollower();
    pending.feed.acquire(TOPIC);
    pending.feed.release(TOPIC);
    pending.feed.stop();
    vi.advanceTimersByTime(10_000);
    expect(pending.market.unwatchCalls).toEqual([]);
    expect(pending.market.socket).toBe("idle");
    // without a store nothing is marked for writing, whichever way a topic becomes held
    const bare = make(undefined);
    await bare.feed.start();
    bare.feed.acquire(TOPIC);
    bare.feed.setRemoteTopics(new Set([TOPIC, NOV]));
    bare.feed.setRemoteTopics(new Set([NOV]));
    bare.feed.release(TOPIC);
    bare.feed.acquire(NOV);
    bare.feed.stop();
  });
});

describe("[GATEWAY] MarketFeed snapshot keepalive", () => {
  it("rewrites every held chain on the keepalive interval without ticks, and stops on demote", async () => {
    let writes = 0;
    const store = new MemorySnapshotStore();
    const counting: SnapshotStore = { ...store, putSnapshot: (t, s) => (writes += 1, store.putSnapshot(t, s)), putSpot: (u, s) => store.putSpot(u, s), getSnapshot: (t) => store.getSnapshot(t), getSpot: (u) => store.getSpot(u) };
    const market = new FakeMarketData();
    const feed = new MarketFeed({ market, pubsub: new InProcessPubSub(), coalesceMs: 250, graceMs: 0, store: counting, snapshotWriteMs: 100, snapshotKeepaliveMs: 1_000, now: () => NOW });
    await feed.start();
    feed.acquire(TOPIC);
    feed.setRemoteTopics(new Set([NOV, "spot:BTC"]));
    const afterWatch = writes; // both chains written at once when watched
    expect(afterWatch).toBe(2);
    vi.advanceTimersByTime(3_000);
    expect(writes).toBe(afterWatch + 6); // two chains, three keepalive passes; the spot topic is not a chain
    feed.demote();
    vi.advanceTimersByTime(3_000);
    expect(writes).toBe(afterWatch + 6);
    feed.stop();
  });
});
