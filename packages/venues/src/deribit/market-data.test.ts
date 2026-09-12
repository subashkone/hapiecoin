import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchLike } from "../http.js";
import { FakeWebSocket } from "../test-support/fake-ws.js";
import { loadDeribitBookSummaryFixture, loadDeribitInstrumentsFixture, loadDeribitWsFrames } from "../test-support/fixtures.js";
import type { Quote } from "../types.js";
import { DeribitMarketData, createDeribitMarketData } from "./market-data.js";

const NOW = 1_789_148_000_000;
const frames = loadDeribitWsFrames();
/** The BTC perpetual as get_instruments?kind=future lists it (fields the adapter reads; no expiry in practice). */
const PERPETUAL = { instrument_name: "BTC-PERPETUAL", instrument_id: 1, kind: "future", expiration_timestamp: 32503680000000, base_currency: "BTC", quote_currency: "USD", counter_currency: "USD", settlement_currency: "BTC", settlement_period: "perpetual", contract_size: 10, tick_size: 0.5, min_trade_amount: 1, is_active: true, state: "open", instrument_type: "reversed", price_index: "btc_usd" };

const fetchFixtures: FetchLike = (input) => {
  const url = new URL(input);
  const body =
    url.pathname === "/api/v2/public/get_instruments"
      ? url.searchParams.get("currency") !== "BTC"
        ? { jsonrpc: "2.0", result: [] }
        : url.searchParams.get("kind") === "future"
          ? { jsonrpc: "2.0", result: [PERPETUAL] }
          : loadDeribitInstrumentsFixture()
      : url.pathname === "/api/v2/public/get_book_summary_by_currency"
        ? url.searchParams.get("currency") === "BTC"
          ? loadDeribitBookSummaryFixture()
          : { jsonrpc: "2.0", result: [] }
        : { jsonrpc: "2.0", error: { code: 404, message: "no route" } };
  return Promise.resolve({ status: 200, headers: { get: () => null }, text: () => Promise.resolve(JSON.stringify(body)) });
};

function make(underlyings?: readonly string[]) {
  const md = createDeribitMarketData({ restUrl: "https://www.deribit.com/api/v2", wsUrl: "wss://ws.example.test", fetch: fetchFixtures, WebSocket: FakeWebSocket, now: () => NOW, ...(underlyings ? { underlyings } : {}) });
  const tickers: Quote[] = [];
  const statuses: unknown[] = [];
  const errors: unknown[] = [];
  md.on("ticker", (q) => tickers.push(q));
  md.on("status", (s) => statuses.push(s));
  md.on("error", (e) => errors.push(e));
  return { md, tickers, statuses, errors };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.reset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("HC-SH-122 [VENUES] Deribit market data session", () => {
  it("loads instruments per currency and seeds quotes from the book summary; chains and expiries come from the list", async () => {
    const { md, tickers } = make();
    expect(md).toBeInstanceOf(DeribitMarketData);
    expect(await md.load()).toEqual({ instruments: 950, quotes: 950 });
    expect(tickers).toHaveLength(950);
    expect(md.instruments()).toHaveLength(950);
    expect(md.instrument("BTC-12SEP26-69000-C")?.id).toBe(691120);
    expect(md.instrument("nope")).toBeUndefined();
    expect(md.instrument("BTC-PERPETUAL")?.kind).toBe("perpetual"); // HC-SH-126: known by symbol for the spot, not part of the option list
    expect(md.quote("BTC-12SEP26-69000-C")?.greeks).toBeNull(); // the seed has no greeks
    expect(md.quote("nope")).toBeUndefined();
    const expiries = md.expiries("BTC");
    expect(expiries).toHaveLength(12);
    expect(expiries[0]).toMatchObject({ code: "120926", label: "12SEP26", date: "2026-09-12", settlementTime: "2026-09-12T08:00:00.000Z" });
    const chain = md.chain("BTC", "2026-09-12");
    expect(chain.venue).toBe("deribit");
    expect(chain.rows).toHaveLength(27);
    expect(chain.total).toBe(54);
    expect(chain.quoted).toBe(54);
    expect(Number(chain.spot)).toBeGreaterThan(70_000);
    expect(md.expiries("ETH")).toEqual([]);
    expect(md.status()).toEqual({ instruments: 950, quotes: 950, socket: "idle", subscribed: 0 });
  });

  it("HC-SH-126 a failed futures listing is reported and the option chain still loads (ADR-071)", async () => {
    const flaky: FetchLike = (input, init) => {
      const url = new URL(input);
      if (url.pathname === "/api/v2/public/get_instruments" && url.searchParams.get("kind") === "future") return Promise.resolve({ status: 503, headers: { get: () => null }, text: () => Promise.resolve("down") });
      return fetchFixtures(input, init);
    };
    const md = createDeribitMarketData({ restUrl: "https://www.deribit.com/api/v2", wsUrl: "wss://ws.example.test", fetch: flaky, WebSocket: FakeWebSocket, now: () => NOW, sleep: () => Promise.resolve(), underlyings: ["BTC"] });
    const errors: unknown[] = [];
    md.on("error", (e) => errors.push(e));
    expect(await md.load()).toEqual({ instruments: 950, quotes: 950 });
    expect(errors).toHaveLength(1);
    expect(md.instrument("BTC-PERPETUAL")).toBeUndefined();
    // a refresh that fails the futures listing keeps the perpetual a previous load knew
    const { md: steady } = make(undefined);
    await steady.load();
    expect(steady.instrument("BTC-PERPETUAL")?.kind).toBe("perpetual");
    (steady as unknown as { rest: { getInstruments: (c: string, k?: string) => Promise<unknown[]> } }).rest.getInstruments = (c: string, k?: string) => (k === "future" ? Promise.reject(new Error("503")) : Promise.resolve([]));
    await steady.load().catch(() => undefined);
    expect(steady.instrument("BTC-PERPETUAL")?.kind).toBe("perpetual");
  });

  it("HC-SH-126 watches an expiry's options over the socket, applies ticker frames by instrument name (the perpetual too), ignores unknown names, and stops", async () => {
    const { md, tickers, statuses } = make(["BTC"]);
    await md.load();
    tickers.length = 0;
    const symbols = md.watch("BTC", "2026-09-12");
    expect(symbols).toHaveLength(54);
    md.subscribeSymbols(["BTC-PERPETUAL"]);
    md.start();
    const ws = FakeWebSocket.last;
    ws.simulateOpen();
    const frames0 = ws.sentJson() as { method: string; params: { channels?: string[] } }[];
    expect(frames0[0]!.method).toBe("public/set_heartbeat");
    expect(frames0[1]!.params.channels).toHaveLength(55);
    expect(md.status().subscribed).toBe(55);
    expect(statuses.length).toBeGreaterThan(0);
    ws.simulateMessage(frames["tickerBtc"]);
    expect(tickers).toHaveLength(1);
    const q = md.quote("BTC-12SEP26-69000-C")!;
    expect(q.greeks).not.toBeNull();
    const data = (frames["tickerBtc"] as { params: { data: { timestamp: number; mark_price: number; index_price: number } } }).params.data;
    expect(q.venueTs).toBe(data.timestamp);
    expect(Number(q.mark)).toBeCloseTo(data.mark_price * data.index_price, 4);
    // an older frame does not replace a newer quote; an unknown instrument is ignored
    ws.simulateMessage({ ...(frames["tickerBtc"] as object), params: { channel: "ticker.BTC-12SEP26-69000-C.100ms", data: { ...(frames["tickerBtc"] as { params: { data: object } }).params.data, timestamp: 1, mark_price: 0.5 } } });
    expect(md.quote("BTC-12SEP26-69000-C")!.venueTs).toBe(data.timestamp);
    ws.simulateMessage({ jsonrpc: "2.0", method: "subscription", params: { channel: "ticker.X.100ms", data: { ...(frames["tickerBtc"] as { params: { data: object } }).params.data, instrument_name: "X" } } });
    ws.simulateMessage({ jsonrpc: "2.0", method: "subscription", params: { channel: "ticker.BTC-12SEP26-69000-C.100ms", data: { ...(frames["tickerBtc"] as { params: { data: object } }).params.data, timestamp: data.timestamp + 5, index_price: 0 } } }); // no index: dropped
    expect(tickers).toHaveLength(1);
    expect(md.unwatch("BTC", "2026-09-12")).toHaveLength(54);
    // HC-SH-126 (ADR-071): the perpetual's ticker becomes a quote whose spot is the index, so the gateway serves a Deribit spot
    md.subscribeSymbols(["BTC-PERPETUAL"]);
    ws.simulateMessage({ jsonrpc: "2.0", method: "subscription", params: { channel: "ticker.BTC-PERPETUAL.100ms", data: { ...(frames["tickerBtc"] as { params: { data: object } }).params.data, instrument_name: "BTC-PERPETUAL", timestamp: data.timestamp + 9 } } });
    expect(md.quote("BTC-PERPETUAL")?.spot).toBe(String(data.index_price));
    expect(md.quote("BTC-PERPETUAL")?.mark).toBe(String(data.mark_price)); // USD-priced: not multiplied by the index
    expect(tickers).toHaveLength(2);
    md.unsubscribeSymbols(["BTC-PERPETUAL"]);
    expect(md.status().subscribed).toBe(0);
    md.stop();
    expect(md.status().socket).toBe("closed");
  });

  it("forwards socket errors and chooses the aggregation from the channel option", async () => {
    const { md, errors } = make(["BTC"]);
    md.start();
    FakeWebSocket.last.simulateOpen();
    FakeWebSocket.last.simulateMessage("not json");
    expect(errors).toHaveLength(1);
    const agg = createDeribitMarketData({ restUrl: "https://www.deribit.com/api/v2", wsUrl: "wss://ws.example.test", fetch: fetchFixtures, WebSocket: FakeWebSocket, channel: "agg2", heartbeatMs: 0 });
    expect(agg.ws.interval).toBe("agg2");
    await expect(make(["ETH", "BTC"]).md.load()).resolves.toEqual({ instruments: 950, quotes: 950 });
  });
});
