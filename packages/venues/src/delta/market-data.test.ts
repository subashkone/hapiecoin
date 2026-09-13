import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnknownExpiryError } from "../errors.js";
import { FakeWebSocket } from "../test-support/fake-ws.js";
import { LIVE_COMPACT_TICKER_FRAME, LIVE_V2_TICKER_FRAME, loadProductsFixture, loadTickersFixture } from "../test-support/fixtures.js";
import type { Quote } from "../types.js";
import { DeltaMarketData, createDeltaMarketData } from "./market-data.js";
import type { MarketDataStatus } from "./market-data.js";
import type { FetchLike } from "./rest.js";

const REST = "https://api.example.test";
const WS = "wss://socket.example.test";
const NOW = Date.parse("2026-09-04T12:00:00Z");
const products = loadProductsFixture();
const tickers = loadTickersFixture();

const fetchFixtures: FetchLike = (input) => {
  const url = new URL(input);
  const body = url.pathname === "/v2/products" ? products : url.pathname === "/v2/tickers" ? tickers : { success: false };
  return Promise.resolve({ status: 200, headers: { get: () => null }, text: () => Promise.resolve(JSON.stringify(body)) });
};

function make() {
  const md = createDeltaMarketData({ restUrl: REST, wsUrl: WS, fetch: fetchFixtures, WebSocket: FakeWebSocket, now: () => NOW });
  const statuses: MarketDataStatus[] = [];
  const tickerEvents: Quote[] = [];
  const errors: Error[] = [];
  md.on("status", (s) => statuses.push(s));
  md.on("ticker", (q) => tickerEvents.push(q));
  md.on("error", (e) => errors.push(e));
  return { md, statuses, tickerEvents, errors };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.reset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("[VENUES] createDeltaMarketData", () => {
  it("[VENUES] loads instruments and seeds quotes from REST, then serves chains and expiries", async () => {
    const { md, tickerEvents } = make();
    expect(md).toBeInstanceOf(DeltaMarketData);
    expect(md.status()).toEqual({ instruments: 0, quotes: 0, socket: "idle", subscribed: 0 });
    expect(await md.load()).toEqual({ instruments: 972, quotes: 307 });
    expect(tickerEvents).toHaveLength(307);
    expect(md.instruments()).toHaveLength(972);
    expect(md.expiries("BTC").map((e) => e.label)).toEqual([
      "05SEP26",
      "06SEP26",
      "07SEP26",
      "11SEP26",
      "18SEP26",
      "25SEP26",
      "30OCT26",
      "27NOV26",
    ]);

    const chain = md.chain("BTC", "25SEP26");
    expect(chain.strikes).toHaveLength(52);
    expect(chain.quoted).toBe(chain.rows.filter((r) => r.call?.quote).length);
    expect(chain.asOf).toBe(NOW);
    expect(md.quote("C-BTC-99000-271126")?.mark).toBe("1290.81008713");
    expect(md.quote("P-BTC-99000-271126")).toBeUndefined(); // no put tickers in the fixture
    expect(md.quote("NOPE")).toBeUndefined();
    expect(md.instrument("C-BTC-99000-271126")?.id).toBe(151077);
    expect(() => md.chain("BTC", "010130")).toThrow(UnknownExpiryError);
  });

  it("[VENUES] watch() subscribes the expiry's options, the socket keeps quotes fresh and carries open interest over a tick without one (HC-WS-116), stop() closes", async () => {
    const { md, statuses, tickerEvents, errors } = make();
    await md.load();
    tickerEvents.length = 0;

    const symbols = md.watch("BTC", "250926");
    expect(symbols).toHaveLength(md.instruments().filter((i) => i.underlying === "BTC" && i.expiryCode === "250926").length);
    expect(symbols).toContain("P-BTC-80000-250926");
    expect(md.watch("BTC", "2026-09-25")).toEqual(symbols); // idempotent
    expect(md.status().subscribed).toBe(symbols.length);

    md.start();
    FakeWebSocket.last.simulateOpen();
    expect(statuses.at(-1)?.socket).toBe("open");
    const sent = FakeWebSocket.last.sentJson()[1] as { type: string; payload: { channels: { name: string; symbols: string[] }[] } };
    expect(sent.type).toBe("subscribe");
    expect(sent.payload.channels[0]?.name).toBe("v2/ticker");
    expect([...(sent.payload.channels[0]?.symbols ?? [])].sort()).toEqual([...symbols].sort());

    FakeWebSocket.last.simulateMessage(LIVE_V2_TICKER_FRAME);
    expect(tickerEvents).toHaveLength(1);
    expect(md.quote("P-BTC-80000-250926")?.mark).toBe("2616.58595291");
    const row = md.chain("BTC", "25SEP26").rows.find((r) => r.strike === "80000");
    expect(row?.put?.quote?.mark).toBe("2616.58595291");
    expect(md.chain("BTC", "25SEP26").spot).toBe("79777.3");

    // an older frame (1 s earlier; venue timestamps are microseconds) for the same instrument is ignored
    FakeWebSocket.last.simulateMessage({ ...LIVE_V2_TICKER_FRAME, mark_price: "1", timestamp: LIVE_V2_TICKER_FRAME.timestamp - 1_000_000 });
    expect(md.quote("P-BTC-80000-250926")?.mark).toBe("2616.58595291");
    expect(tickerEvents).toHaveLength(1);
    // a newer one replaces it
    FakeWebSocket.last.simulateMessage({ ...LIVE_V2_TICKER_FRAME, mark_price: "2", timestamp: LIVE_V2_TICKER_FRAME.timestamp + 1_000_000 });
    expect(md.quote("P-BTC-80000-250926")?.mark).toBe("2");
    // GAPS #15: a newer frame without open interest keeps the last figure the venue sent (and the tick carries it)
    expect(md.quote("P-BTC-80000-250926")?.oiContracts).toBe("18947");
    FakeWebSocket.last.simulateMessage({ ...LIVE_V2_TICKER_FRAME, mark_price: "3", oi: null, oi_contracts: null, timestamp: LIVE_V2_TICKER_FRAME.timestamp + 2_000_000 });
    expect(md.quote("P-BTC-80000-250926")).toMatchObject({ mark: "3", oi: "18.947", oiContracts: "18947" });
    expect(tickerEvents.at(-1)).toMatchObject({ mark: "3", oiContracts: "18947" });
    // the production trigger: a compact tick whose oi cell is missing keeps the pair as well
    const compact = { ...LIVE_COMPACT_TICKER_FRAME, sy: "P-BTC-80000-250926", ts: LIVE_V2_TICKER_FRAME.timestamp + 3_000_000, d: [{ ...LIVE_COMPACT_TICKER_FRAME.d[0], i: LIVE_V2_TICKER_FRAME.product_id, s: "P-BTC-80000-250926", m: "4", oi: undefined }] };
    FakeWebSocket.last.simulateMessage(compact);
    expect(md.quote("P-BTC-80000-250926")).toMatchObject({ mark: "4", oi: "18.947", oiContracts: "18947" });

    FakeWebSocket.last.simulateMessage("{bad");
    expect(errors).toHaveLength(1);

    expect(md.unwatch("BTC", "250926")).toEqual(symbols);
    expect(md.status().subscribed).toBe(0);

    FakeWebSocket.last.simulateClose();
    expect(statuses.at(-1)?.socket).toBe("reconnecting");
    md.stop();
    expect(statuses.at(-1)).toMatchObject({ socket: "closed", instruments: 972 });
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("[VENUES] passes optional socket and REST settings through and uses globals when omitted", () => {
    const sleeps: number[] = [];
    const md = createDeltaMarketData({
      restUrl: REST,
      wsUrl: WS,
      fetch: fetchFixtures,
      WebSocket: FakeWebSocket,
      channel: "ticker",
      backoff: { initialMs: 5 },
      heartbeatMs: 0,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      contractTypes: ["call_options"],
    });
    expect(md.ws.channel).toBe("ticker");
    md.start();
    FakeWebSocket.last.simulateClose();
    vi.advanceTimersByTime(5);
    expect(FakeWebSocket.instances).toHaveLength(2);
    md.stop();

    vi.stubGlobal("fetch", fetchFixtures);
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const defaults = createDeltaMarketData({ restUrl: REST, wsUrl: WS });
    expect(defaults.ws.channel).toBe("v2/ticker");
    defaults.start();
    expect(FakeWebSocket.instances).toHaveLength(3);
    defaults.stop();
  });
});

describe("HC-SH-122 [VENUES] the Delta session on the venue-neutral interface (ADR-067)", () => {
  it("subscribes and unsubscribes raw venue symbols (the perpetual for spot) beside the watched options", () => {
    const { md } = make();
    md.subscribeSymbols(["BTCUSD", "ETHUSD"]);
    expect(md.status().subscribed).toBe(2);
    expect(md.ws.symbols).toEqual(["BTCUSD", "ETHUSD"]);
    md.unsubscribeSymbols(["ETHUSD"]);
    expect(md.ws.symbols).toEqual(["BTCUSD"]);
    md.unsubscribeSymbols(["BTCUSD", "unknown"]);
    expect(md.status().subscribed).toBe(0);
  });
});
