import { ChainRow, ChainSnapshot, QuoteDelta, ServerMessage } from "@hapiecoin/schema";
import type { Topic } from "@hapiecoin/schema";
import type { Instrument, Quote } from "@hapiecoin/venues";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../log.js";
import { InProcessPubSub } from "../pubsub/in-process.js";
import { FakeMarketData } from "../test-support/fake-market.js";
import { NOW, fixtureQuotes } from "../test-support/fixtures.js";
import { MarketFeed, SPOT_SYMBOLS } from "./feed.js";

const TOPIC: Topic = "chain:delta_india:BTC:2026-09-25";
const NOV: Topic = "chain:delta_india:BTC:2026-11-27";
const SPOT_BTC: Topic = "spot:BTC";
const CALL = "C-BTC-80000-250926";

function make(options: { seed?: boolean; graceMs?: number; refreshMs?: number } = {}) {
  const market = new FakeMarketData({ seed: options.seed ?? true });
  const pubsub = new InProcessPubSub();
  const published: { topic: string; message: ServerMessage }[] = [];
  for (const topic of [TOPIC, NOV, SPOT_BTC, "spot:ETH", "spot:XAUT"]) {
    pubsub.subscribe(topic, (message) => published.push({ topic, message }));
  }
  const lines: string[] = [];
  const log = createLogger(
    "debug",
    (line) => lines.push(line),
    () => NOW,
  );
  const feed = new MarketFeed({
    market,
    pubsub,
    coalesceMs: 250,
    graceMs: options.graceMs ?? 30_000,
    refreshMs: options.refreshMs ?? 300_000,
    retryMs: 10_000,
    now: () => NOW,
    log,
  });
  return { market, pubsub, published, feed, lines };
}

function strikesFromList(instruments: readonly Instrument[], underlying: string, code: string): string[] {
  return [
    ...new Set(
      instruments
        .filter((i) => i.underlying === underlying && i.expiryCode === code)
        .map((i) => i.strike as string),
    ),
  ].sort((a, b) => Number(a) - Number(b));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("[GATEWAY] MarketFeed lifecycle and status", () => {
  it("[GATEWAY] start loads the instrument list, seeds spot from REST tickers and opens the venue socket", async () => {
    const { feed, market } = make();
    expect(feed.status()).toMatchObject({
      ready: false,
      topics: 0,
      pending: 0,
      loadedAt: null,
      lastError: null,
    });
    expect(feed.status().expiries).toEqual({ BTC: [], ETH: [], XAUT: [] });
    await feed.start();
    const status = feed.status();
    expect(status.ready).toBe(true);
    expect(status.loadedAt).toBe(NOW);
    expect(status.market).toMatchObject({ instruments: 972, quotes: 307, socket: "open", subscribed: 0 });
    expect(status.expiries.BTC).toEqual(market.expiries("BTC").map((e) => e.date));
    expect(status.expiries.BTC[0]).toBe("2026-09-05");
    expect(status.expiries.XAUT.length).toBeGreaterThan(0);
    expect(status.spot.BTC).toMatch(/^\d+(\.\d+)?$/);
    expect(status.spot.ETH).toBeNull(); // fixture has BTC tickers only
    expect(feed.spot("BTC")?.p).toBe(status.spot.BTC);
    expect(feed.spot("ETH")).toBeNull();
    feed.stop();
    expect(market.socket).toBe("closed");
  });

  it("[GATEWAY] a failed load is retried, the list is refreshed periodically and stop cancels the timer", async () => {
    const { feed, market, lines } = make({ refreshMs: 60_000 });
    market.failLoad = true;
    await feed.start();
    expect(feed.status()).toMatchObject({ ready: false, lastError: "rest down" });
    expect(market.loads).toBe(1);
    expect(lines.some((l) => l.includes("instrument load failed"))).toBe(true);

    market.failLoad = "rest down (raw rejection)";
    await vi.advanceTimersByTimeAsync(10_000);
    expect(market.loads).toBe(2);
    expect(feed.status()).toMatchObject({ ready: false, lastError: "rest down (raw rejection)" });

    market.failLoad = false;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(market.loads).toBe(3);
    expect(feed.status()).toMatchObject({ ready: true, lastError: null });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(market.loads).toBe(4);
    feed.stop();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(market.loads).toBe(4);

    const noRefresh = make({ refreshMs: 0 });
    await noRefresh.feed.start();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(noRefresh.market.loads).toBe(1);
    noRefresh.feed.stop();
  });

  it("[GAPS-28] a refresh re-watches held chain topics so a strike listed intraday gets quotes", async () => {
    const { feed, market } = make({ refreshMs: 60_000 });
    await feed.start();
    feed.acquire(TOPIC);
    expect(market.watchCalls).toEqual(["BTC:2026-09-25"]);
    const before = market.symbols.size;

    // Delta lists a new strike between refreshes.
    const base = market.instrumentList.find((i) => i.symbol === CALL);
    if (!base) throw new Error("fixture call missing");
    const listed: Instrument = { ...base, id: 999_999, symbol: "C-BTC-80250-250926", strike: "80250" };
    expect(market.instrumentList.some((i) => i.symbol === listed.symbol)).toBe(false);
    market.instrumentList.push(listed);
    market.bySymbol.set(listed.symbol, listed);
    expect(market.symbols.has(listed.symbol)).toBe(false);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(market.loads).toBe(2);
    expect(market.watchCalls).toEqual(["BTC:2026-09-25", "BTC:2026-09-25"]);
    expect(market.symbols.has(listed.symbol)).toBe(true);
    expect(market.symbols.size).toBe(before + 1);
    // Unheld topics are not touched by the refresh.
    expect(market.watchCalls.filter((c) => c === "BTC:2026-11-27")).toHaveLength(0);
    feed.stop();
  });

  it("[GATEWAY] venue errors and socket status changes are logged, not thrown", async () => {
    const { feed, market, lines } = make();
    await feed.start();
    market.emitError(new Error("socket hiccup"));
    expect(lines.some((l) => l.includes("venue error") && l.includes("socket hiccup"))).toBe(true);
    expect(lines.some((l) => l.includes("venue socket") && l.includes('"socket":"open"'))).toBe(true);
    feed.stop();
  });
});

describe("[GAPS-1] MarketFeed snapshots come from the instrument list", () => {
  it("[GAPS-1] snapshot rows validate against ChainRow/ChainSnapshot and strikes equal the instrument list", async () => {
    const { feed, market } = make();
    await feed.start();
    const snapshot = feed.snapshot(TOPIC);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.seq).toBe(0);
    const rows = snapshot?.rows ?? [];
    expect(rows).toHaveLength(52);
    for (const row of rows) expect(ChainRow.parse(row)).toEqual(row);
    expect(rows.map((r) => r.strike)).toEqual(strikesFromList(market.instrumentList, "BTC", "250926"));
    const full = {
      venue: "delta_india",
      underlying: "BTC",
      expiry: "2026-09-25",
      ts: NOW,
      spot: feed.spot("BTC")?.p,
      rows,
    };
    expect(ChainSnapshot.parse(full)).toEqual(full);
    expect(rows.filter((r) => r.call).length).toBe(market.chain("BTC", "2026-09-25").quoted);

    // every listed expiry of every underlying snapshots cleanly, even without quotes (ETH/XAUT)
    for (const underlying of ["BTC", "ETH", "XAUT"] as const) {
      for (const date of feed.status().expiries[underlying]) {
        const snap = feed.snapshot(`chain:delta_india:${underlying}:${date}`);
        const code = market.expiries(underlying).find((e) => e.date === date)?.code ?? "";
        expect(snap?.rows.map((r) => r.strike)).toEqual(
          strikesFromList(market.instrumentList, underlying, code),
        );
      }
    }
    feed.stop();
  });

  it("[GATEWAY] a snapshot that fails ChainSnapshot validation is withheld and logged", async () => {
    const { feed, market, lines } = make();
    await feed.start();
    const call = market.quote(CALL) as Quote;
    market.quotes.set(call.instrumentId, { ...call, mark: "not-a-decimal" });
    expect(feed.snapshot(TOPIC)).toBeNull();
    expect(lines.some((l) => l.includes("snapshot failed schema validation") && l.includes(TOPIC))).toBe(
      true,
    );
    market.quotes.set(call.instrumentId, call);
    expect(feed.snapshot(TOPIC)?.rows).toHaveLength(52);
    feed.stop();
  });

  it("[GATEWAY] unknown expiries, spot and fut topics have no chain snapshot", async () => {
    const { feed } = make();
    await feed.start();
    expect(feed.snapshot("chain:delta_india:BTC:2030-01-01")).toBeNull();
    expect(feed.snapshot(SPOT_BTC)).toBeNull();
    expect(feed.snapshot("fut:delta_india:BTCUSD")).toBeNull();
    expect(feed.supports(TOPIC)).toBe(true);
    expect(feed.supports(SPOT_BTC)).toBe(true);
    expect(feed.supports("fut:delta_india:BTCUSD")).toBe(false);
    expect(feed.supports("nonsense")).toBe(false);
    feed.stop();
  });
});

describe("[GATEWAY] MarketFeed reference counting with a 30 s grace", () => {
  it("[GATEWAY] subscribes upstream on the first holder only and unsubscribes 30 s after the last one leaves", async () => {
    const { feed, market } = make();
    await feed.start();
    feed.acquire(TOPIC);
    feed.acquire(TOPIC);
    expect(market.watchCalls).toEqual(["BTC:2026-09-25"]);
    expect(feed.holders(TOPIC)).toBe(2);
    expect(feed.status().topics).toBe(1);
    expect(market.symbols.size).toBe(market.watch("BTC", "2026-09-25").length);

    feed.release(TOPIC);
    feed.release(TOPIC);
    expect(feed.holders(TOPIC)).toBe(0);
    vi.advanceTimersByTime(29_999);
    expect(market.unwatchCalls).toEqual([]);

    // a client returning during the grace keeps the upstream subscription; nothing is re-sent to the venue
    feed.acquire(TOPIC);
    vi.advanceTimersByTime(60_000);
    expect(market.unwatchCalls).toEqual([]);
    expect(market.watchCalls).toEqual(["BTC:2026-09-25", "BTC:2026-09-25"]); // the second entry is our direct market.watch above
    expect(feed.holders(TOPIC)).toBe(1);

    feed.release(TOPIC);
    vi.advanceTimersByTime(30_000);
    expect(market.unwatchCalls).toEqual(["BTC:2026-09-25"]);
    expect(feed.holders(TOPIC)).toBe(0);
    expect(feed.status().topics).toBe(0);
    expect(market.symbols.size).toBe(0);

    feed.release(TOPIC); // never held: no-op
    feed.release("chain:delta_india:ETH:2026-09-25");
    feed.stop();
  });

  it("[GATEWAY] spot topics subscribe the perpetual; fut topics touch nothing; stop drops every upstream subscription", async () => {
    const { feed, market } = make({ graceMs: 0 });
    await feed.start();
    feed.acquire(SPOT_BTC);
    feed.acquire("spot:XAUT");
    expect(market.symbolCalls).toEqual([
      { op: "sub", symbols: [SPOT_SYMBOLS.BTC] },
      { op: "sub", symbols: ["XAUTUSD"] },
    ]);
    feed.release(SPOT_BTC);
    vi.advanceTimersByTime(0);
    expect(market.symbolCalls.at(-1)).toEqual({ op: "unsub", symbols: ["BTCUSD"] });

    feed.acquire("fut:delta_india:BTCUSD");
    feed.release("fut:delta_india:BTCUSD");
    vi.advanceTimersByTime(0);
    expect(market.symbolCalls).toHaveLength(3);

    feed.acquire(TOPIC);
    feed.acquire(NOV);
    feed.release(NOV); // grace timer pending at stop time
    feed.stop();
    expect(market.unwatchCalls.sort()).toEqual(["BTC:2026-09-25", "BTC:2026-11-27"]);
    expect(market.symbolCalls.at(-1)).toEqual({ op: "unsub", symbols: ["XAUTUSD"] });
    expect(feed.status().topics).toBe(0);
  });
});

describe("[GATEWAY] MarketFeed publishes coalesced deltas with only changed fields", () => {
  it("[GATEWAY] ticks on a held chain topic become q frames with a monotonic seq; unheld topics publish nothing", async () => {
    const { feed, market, published: all } = make();
    const published = () => all.filter((p) => p.topic !== SPOT_BTC);
    await feed.start();
    feed.acquire(TOPIC);
    const base = market.quote(CALL) as Quote;

    market.tick(market.later(CALL, { mark: "1300", ask: "1330" }));
    market.tick(market.later(CALL, { mark: "1301", ask: "1330" }, 2_000));
    expect(feed.status().pending).toBeGreaterThanOrEqual(1); // one merged delta (plus a spot tick when CALL's spot differs from the latest seed)
    expect(published()).toEqual([]);
    vi.advanceTimersByTime(250);
    expect(published()).toHaveLength(1);
    const first = published()[0]?.message as Extract<ServerMessage, { t: "q" }>;
    expect(ServerMessage.parse(first)).toEqual(first);
    expect(first).toMatchObject({ t: "q", topic: TOPIC, seq: 1 });
    expect(first.d).toEqual([
      { i: `delta_india:${CALL}`, ts: base.venueTs + 2_000, mark: "1301", ask: "1330" },
    ]);
    expect(QuoteDelta.parse(first.d[0])).toEqual(first.d[0]);
    expect(feed.seq(TOPIC)).toBe(1);
    expect(feed.snapshot(TOPIC)?.seq).toBe(1);
    expect(feed.snapshot(TOPIC)?.rows.find((r) => r.strike === "80000")?.call?.mark).toBe("1301");

    // identical data with a newer venue timestamp is not a delta
    market.tick(market.later(CALL, { mark: "1301", ask: "1330" }, 3_000));
    vi.advanceTimersByTime(250);
    expect(published()).toHaveLength(1);

    market.tick(market.later(CALL, { bid: "1290" }, 4_000));
    vi.advanceTimersByTime(250);
    expect(published()).toHaveLength(2);
    expect(published()[1]?.message).toMatchObject({
      t: "q",
      seq: 2,
      d: [{ i: `delta_india:${CALL}`, bid: "1290" }],
    });

    // a put of the held expiry (no REST seed in the fixture) publishes a full first delta
    const putInstrument = market.instrument("P-BTC-80000-250926") as Instrument;
    market.tick({
      ...market.later(CALL, { mark: "2600" }, 5_000),
      symbol: putInstrument.symbol,
      instrumentId: putInstrument.id,
    });
    vi.advanceTimersByTime(250);
    expect(published()).toHaveLength(3);
    expect(published()[2]?.message).toMatchObject({
      t: "q",
      seq: 3,
      d: [{ i: "delta_india:P-BTC-80000-250926", mark: "2600", oi: expect.any(String) as string }],
    });

    // the November chain is not held: its ticks update the cache but publish nothing
    market.tick(market.later("C-BTC-99000-271126", { mark: "1" }));
    vi.advanceTimersByTime(250);
    expect(published()).toHaveLength(3);
    expect(feed.snapshot(NOV)?.rows.find((r) => r.strike === "99000")?.call?.mark).toBe("1");
    expect(feed.seq(NOV)).toBe(0);
    feed.stop();
  });

  it("[GATEWAY] spot ticks are published per underlying, deduplicated and ordered by venue time", async () => {
    const { feed, market, published } = make();
    await feed.start();
    const before = feed.spot("BTC") as { p: string; ts: number };
    const callTs = (market.quote(CALL) as Quote).venueTs;
    expect(callTs + 5_000).toBeGreaterThan(before.ts);
    market.tick(market.later(CALL, { spot: "80000" }, 5_000));
    expect(feed.spot("BTC")).toEqual({ p: "80000", ts: callTs + 5_000 });
    // same price, newer time: timestamp moves, nothing new to publish
    market.tick(market.later(CALL, { spot: "80000" }, 6_000));
    expect(feed.spot("BTC")?.ts).toBe(callTs + 6_000);
    // older frame: ignored
    market.tick({ ...market.later(CALL, { spot: "1" }), venueTs: before.ts - 1 });
    expect(feed.spot("BTC")?.p).toBe("80000");
    // frame without spot: ignored
    market.tick(market.later(CALL, { spot: null }, 7_000));
    vi.advanceTimersByTime(250);
    const spots = published.filter((p) => p.topic === SPOT_BTC).map((p) => p.message);
    expect(spots).toEqual([{ t: "spot", s: "BTC", p: "80000" }]);

    // the perpetual's ticker (not in the option list) feeds spot too; unknown symbols are ignored
    const perp: Quote = {
      ...market.later(CALL, { spot: "80100" }, 8_000),
      symbol: "BTCUSD",
      instrumentId: 27,
    };
    market.tick(perp);
    market.tick({ ...perp, symbol: "SOLUSD", spot: "1" });
    market.bySymbol.set("C-SOL-1-250926", {
      ...(market.instrument(CALL) as Instrument),
      underlying: "SOL",
      symbol: "C-SOL-1-250926",
    });
    market.tick({ ...perp, symbol: "C-SOL-1-250926", spot: "2" });
    // an option record without an expiry date (venue type allows null) cannot map to a chain topic: ignored
    market.bySymbol.set("C-BTC-X-250926", {
      ...(market.instrument(CALL) as Instrument),
      symbol: "C-BTC-X-250926",
      expiryDate: null,
    });
    feed.acquire(TOPIC);
    market.tick({ ...perp, symbol: "C-BTC-X-250926", spot: "80100", mark: "1" });
    vi.advanceTimersByTime(250);
    expect(published.filter((p) => p.message.t === "q")).toEqual([]);
    expect(published.filter((p) => p.topic === SPOT_BTC).at(-1)?.message).toEqual({
      t: "spot",
      s: "BTC",
      p: "80100",
    });
    expect(published.filter((p) => p.topic !== SPOT_BTC && p.message.t === "spot")).toEqual([]);
    feed.stop();
  });

  it("[GATEWAY] a quote that cannot be expressed in the schema (no spot anywhere) is skipped, not published", async () => {
    const { feed, market, published, lines } = make({ seed: false });
    await feed.start();
    expect(feed.spot("BTC")).toBeNull();
    feed.acquire(TOPIC);
    const seeded = fixtureQuotes().find((q) => q.symbol === CALL) as Quote;
    market.tick({ ...seeded, spot: null });
    vi.advanceTimersByTime(250);
    expect(published).toEqual([]);
    expect(lines.some((l) => l.includes("quote skipped"))).toBe(true);

    market.tick({ ...seeded, venueTs: seeded.venueTs + 1 });
    vi.advanceTimersByTime(250);
    expect(published.map((p) => p.message.t).sort()).toEqual(["q", "spot"]);
    // once a spot is known, a later frame without one falls back to it
    market.tick({ ...seeded, spot: null, mark: "7", venueTs: seeded.venueTs + 2 });
    vi.advanceTimersByTime(250);
    expect(published.at(-1)?.message).toMatchObject({ t: "q", seq: 2, d: [{ mark: "7" }] });
    feed.stop();
  });

  it("[GATEWAY] after stop, venue ticks are ignored", async () => {
    const { feed, market, published } = make();
    await feed.start();
    feed.acquire(TOPIC);
    feed.stop();
    market.tick(market.later(CALL, { mark: "1" }));
    vi.advanceTimersByTime(250);
    expect(published).toEqual([]);
  });
});
