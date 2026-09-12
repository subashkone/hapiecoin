// ADR-067: one feed, one session per enabled venue. Deribit chain topics route to the Deribit session, its
// snapshots and deltas carry the Deribit venue and USD marks, the venue-free spot stays Delta's, and a venue
// this gateway does not open is simply unsupported.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerMessage, Topic } from "@hapiecoin/schema";
import { createLogger } from "../log.js";
import { InProcessPubSub } from "../pubsub/in-process.js";
import { FakeMarketData } from "../test-support/fake-market.js";
import { NOW, deribitFixtureInstruments, deribitFixtureQuotes } from "../test-support/fixtures.js";
import { MarketFeed } from "./feed.js";

const DERIBIT_TOPIC: Topic = "chain:deribit:BTC:2026-09-12";
const DELTA_TOPIC: Topic = "chain:delta_india:BTC:2026-09-25";
const DERIBIT_CALL = "BTC-12SEP26-69000-C";

function make(withDeribit = true) {
  const delta = new FakeMarketData();
  const instruments = deribitFixtureInstruments();
  const deribit = new FakeMarketData({ instruments, quotes: deribitFixtureQuotes(instruments) });
  const pubsub = new InProcessPubSub();
  const published: { topic: string; message: ServerMessage }[] = [];
  for (const topic of [DERIBIT_TOPIC, DELTA_TOPIC, "spot:delta_india:BTC", "spot:deribit:BTC"]) pubsub.subscribe(topic, (message) => published.push({ topic, message }));
  const lines: string[] = [];
  const log = createLogger("debug", (line) => lines.push(line), () => NOW);
  const feed = new MarketFeed({ market: delta, ...(withDeribit ? { markets: { deribit } } : {}), pubsub, coalesceMs: 250, graceMs: 30_000, refreshMs: 0, retryMs: 10_000, now: () => NOW, log });
  return { delta, deribit, pubsub, published, feed, lines };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("HC-SH-122 [GATEWAY] the feed routes every venue's topics to that venue's session", () => {
  it("HC-SH-126 loads both sessions, reports both in the status, watches a Deribit chain on the Deribit session only, and serves each venue its own spot (ADR-071)", async () => {
    const { feed, delta, deribit, published } = make();
    await feed.start();
    const status = feed.status();
    expect(status.ready).toBe(true);
    expect(Object.keys(status.venues)).toEqual(["delta_india", "deribit"]);
    expect(status.venues["deribit"]?.market.instruments).toBe(950);
    expect(status.venues["deribit"]?.expiries.BTC[0]).toBe("2026-09-12");
    expect(status.venues["deribit"]?.expiries.XAUT).toEqual([]);
    expect(status.expiries.BTC).toContain("2026-09-25"); // the top-level expiries stay the default venue's
    expect(feed.supports(DERIBIT_TOPIC)).toBe(true);
    feed.acquire(DERIBIT_TOPIC);
    expect(deribit.watchCalls).toEqual(["BTC:2026-09-12"]);
    expect(delta.watchCalls).toEqual([]);
    // the announced snapshot carries the Deribit venue and the seeded USD marks
    const snap = published.find((p) => p.topic === DERIBIT_TOPIC && p.message.t === "snap");
    expect(snap).toBeDefined();
    const snapshot = feed.snapshot(DERIBIT_TOPIC);
    expect(snapshot?.rows).toHaveLength(27);
    const row = snapshot?.rows.find((r) => r.strike === "69000");
    expect(row?.call?.instrumentId).toBe("deribit:BTC-12SEP26-69000-C");
    expect(Number(row?.call?.mark)).toBeGreaterThan(8_000); // 0.11 BTC × the index, in USD
    // a live tick on the Deribit session becomes a delta on the Deribit topic and moves the Deribit spot, never Delta's (ADR-071)
    const seed = deribit.quote(DERIBIT_CALL)!;
    deribit.tick({ ...seed, mark: "8700", venueTs: seed.venueTs + 1_000_000, spot: "77000" }); // newer than every seeded quote
    vi.advanceTimersByTime(300);
    const delta1 = published.find((p) => p.topic === DERIBIT_TOPIC && p.message.t === "q");
    expect(delta1).toBeDefined();
    expect(feed.spot("BTC")?.p).not.toBe("77000");
    expect(feed.spot("BTC", "deribit")?.p).toBe("77000");
    expect(feed.status().venues["deribit"]?.spot.BTC).toBe("77000");
    expect(feed.status().spot.BTC).not.toBe("77000");
    // the Deribit perpetual (known by symbol only) feeds the Deribit spot; a held spot topic publishes it on its own venue topic
    feed.acquire("spot:deribit:BTC");
    expect(deribit.symbolCalls.at(-1)).toEqual({ op: "sub", symbols: ["BTC-PERPETUAL"] });
    deribit.tick({ ...seed, symbol: "BTC-PERPETUAL", instrumentId: 1, spot: "77010", venueTs: seed.venueTs + 1_000_001 });
    vi.advanceTimersByTime(300);
    expect(published.filter((p) => p.topic === DERIBIT_TOPIC && p.message.t === "q")).toHaveLength(1);
    expect(published.filter((p) => p.topic === "spot:deribit:BTC").map((p) => p.message)).toEqual([
      { t: "spot", s: "BTC", v: "deribit", p: "77000" }, // learnt from the option quote above
      { t: "spot", s: "BTC", v: "deribit", p: "77010" }, // then from the perpetual
    ]);
    expect(published.some((p) => p.topic === "spot:delta_india:BTC" && (p.message as { p: string }).p.startsWith("770"))).toBe(false);
    feed.release("spot:deribit:BTC");
    feed.release(DERIBIT_TOPIC);
    vi.advanceTimersByTime(30_001);
    expect(deribit.unwatchCalls).toEqual(["BTC:2026-09-12"]);
    feed.stop();
    expect(deribit.socket).toBe("closed");
    expect(delta.socket).toBe("closed");
  });

  it("a venue this gateway does not open is unsupported, and a failed secondary load leaves the feed ready", async () => {
    const solo = make(false);
    solo.feed.acquire(DERIBIT_TOPIC); // held before the load: the re-watch pass skips a venue without a session
    await solo.feed.start();
    expect(solo.feed.supports(DERIBIT_TOPIC)).toBe(false);
    expect(solo.feed.supports(DELTA_TOPIC)).toBe(true);
    expect(solo.feed.supports("spot:deribit:BTC")).toBe(false); // no Deribit session here
    expect(solo.feed.supports("spot:BTC")).toBe(true);
    expect(solo.feed.snapshot(DERIBIT_TOPIC)).toBeNull();
    solo.feed.acquire("chain:deribit:ETH:2026-09-12"); // a fresh topic after the load: watch finds no session, no throw
    solo.feed.acquire("spot:deribit:BTC"); // a spot topic of a venue not open here: nothing to subscribe, no throw
    expect(solo.feed.status().venues["deribit"]).toBeUndefined();
    solo.feed.stop();
    const { feed, deribit, lines } = make();
    deribit.failLoad = true;
    await feed.start();
    expect(feed.status().ready).toBe(true);
    expect(feed.status().lastError).toBe("rest down");
    expect(feed.status().venues["deribit"]?.expiries.BTC).toEqual([]);
    expect(lines.some((l) => l.includes("instrument load failed") && l.includes("deribit"))).toBe(true);
    feed.stop();
  });

  it("retries only the failed venue after retryMs and reloads every venue when the refresh is due", async () => {
    const delta = new FakeMarketData();
    const instruments = deribitFixtureInstruments();
    const deribit = new FakeMarketData({ instruments, quotes: deribitFixtureQuotes(instruments) });
    let now = NOW;
    const feed = new MarketFeed({ market: delta, markets: { deribit }, pubsub: new InProcessPubSub(), coalesceMs: 250, refreshMs: 300_000, retryMs: 10_000, now: () => now, log: createLogger("silent", () => undefined) });
    deribit.failLoad = true;
    await feed.start();
    expect([delta.loads, deribit.loads]).toEqual([1, 1]);
    await vi.advanceTimersByTimeAsync(10_000); // the retry pass loads the failed venue only
    expect([delta.loads, deribit.loads]).toEqual([1, 2]);
    deribit.failLoad = false;
    now += 300_000; // the refresh is due: the retry pass becomes a full pass
    await vi.advanceTimersByTimeAsync(10_000);
    expect([delta.loads, deribit.loads]).toEqual([2, 3]);
    expect(feed.status().venues["deribit"]?.expiries.BTC[0]).toBe("2026-09-12");
    await vi.advanceTimersByTimeAsync(10_000); // healthy again: back on the refresh cadence
    expect([delta.loads, deribit.loads]).toEqual([2, 3]);
    await vi.advanceTimersByTimeAsync(290_000);
    expect([delta.loads, deribit.loads]).toEqual([3, 4]);
    feed.stop();
  });
});
