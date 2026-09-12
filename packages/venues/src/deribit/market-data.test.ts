import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchLike } from "../http.js";
import { FakeWebSocket } from "../test-support/fake-ws.js";
import { loadDeribitBookSummaryFixture, loadDeribitInstrumentsFixture, loadDeribitWsFrames } from "../test-support/fixtures.js";
import type { Quote } from "../types.js";
import { DeribitMarketData, createDeribitMarketData } from "./market-data.js";

const NOW = 1_789_148_000_000;
const frames = loadDeribitWsFrames();

const fetchFixtures: FetchLike = (input) => {
  const url = new URL(input);
  const body =
    url.pathname === "/api/v2/public/get_instruments"
      ? url.searchParams.get("currency") === "BTC"
        ? loadDeribitInstrumentsFixture()
        : { jsonrpc: "2.0", result: [] }
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

  it("watches an expiry's options over the socket, applies ticker frames by instrument name, ignores unknown names, and stops", async () => {
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
