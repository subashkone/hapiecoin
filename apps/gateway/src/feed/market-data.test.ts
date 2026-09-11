import type { FetchLike, Quote } from "@hapiecoin/venues";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeribitMarketData } from "@hapiecoin/venues";
import { FakeWebSocket } from "../test-support/fake-ws.js";
import { NOW, loadJson } from "../test-support/fixtures.js";
import { createMarketData, marketDataUrls } from "./market-data.js";

const products = loadJson("delta-products.json");
const tickers = loadJson("delta-tickers.json") as { result: Record<string, unknown>[] };

const fetchFixtures: FetchLike = (input) => {
  const url = new URL(input);
  const body =
    url.pathname === "/v2/products"
      ? products
      : url.pathname === "/v2/tickers"
        ? tickers
        : { success: false };
  return Promise.resolve({
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve(JSON.stringify(body)),
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("[VENUES] createMarketData wraps the real Delta market-data session", () => {
  it("[VENUES] loads fixtures over the injected fetch, serves chains, and forwards socket subscriptions", async () => {
    const md = createMarketData(
      {
        DELTA_REST_URL: "https://api.example.test",
        DELTA_WS_URL: "wss://socket.example.test",
        DELTA_WS_CHANNEL: "v2/ticker", DERIBIT_REST_URL: "https://www.deribit.com/api/v2", DERIBIT_WS_URL: "wss://www.deribit.com/ws/api/v2", DERIBIT_WS_INTERVAL: "100ms",
      },
      "delta_india",
      { fetch: fetchFixtures, WebSocket: FakeWebSocket, now: () => NOW },
    );
    expect(md.status()).toEqual({ instruments: 0, quotes: 0, socket: "idle", subscribed: 0 });
    expect(await md.load()).toEqual({ instruments: 972, quotes: 307 });
    expect(md.instrument("C-BTC-99000-271126")?.id).toBe(151077);
    expect(md.quote("C-BTC-99000-271126")?.mark).toBe("1290.81008713");
    expect(md.expiries("BTC")).toHaveLength(8);
    expect(md.chain("BTC", "2026-09-25").strikes).toHaveLength(52);

    const ticks: Quote[] = [];
    const off = md.on("ticker", (quote) => ticks.push(quote));
    md.start();
    FakeWebSocket.last.simulateOpen();
    expect(md.status().socket).toBe("open");

    const watched = md.watch("BTC", "2026-09-25");
    expect(watched).toContain("P-BTC-80000-250926");
    md.subscribeSymbols(["BTCUSD"]);
    const sent = FakeWebSocket.last.sentJson() as {
      type: string;
      payload?: { channels: { symbols: string[] }[] };
    }[];
    expect(sent[0]).toEqual({ type: "enable_heartbeat" });
    expect(sent[1]?.payload?.channels[0]?.symbols).toEqual(watched);
    expect(sent[2]?.payload?.channels[0]?.symbols).toEqual(["BTCUSD"]);
    expect(md.status().subscribed).toBe(watched.length + 1);

    const first = tickers.result[0] as Record<string, unknown>;
    // venue timestamps are microseconds; a tick 1 s newer than the REST seed replaces it
    FakeWebSocket.last.simulateMessage({
      ...first,
      type: "v2/ticker",
      mark_price: "1500",
      timestamp: Number(first.timestamp) + 1_000_000,
    });
    expect(ticks).toHaveLength(1);
    expect(md.quote(String(first.symbol))?.mark).toBe("1500");
    off();

    expect(md.unwatch("BTC", "2026-09-25")).toEqual(watched);
    md.unsubscribeSymbols(["BTCUSD"]);
    expect(md.status().subscribed).toBe(0);
    md.stop();
    expect(md.status().socket).toBe("closed");
  });
});

describe("HC-SH-122 [GATEWAY] createMarketData per venue (ADR-067)", () => {
  it("dials the Deribit endpoints and aggregation from the config and returns that venue's session", () => {
    const config = { DELTA_REST_URL: "https://delta.example", DELTA_WS_URL: "wss://delta.example", DELTA_WS_CHANNEL: "ticker" as const, DERIBIT_REST_URL: "https://deribit.example/api/v2", DERIBIT_WS_URL: "wss://deribit.example/ws", DERIBIT_WS_INTERVAL: "agg2" as const };
    expect(marketDataUrls(config, "deribit")).toEqual({ restUrl: "https://deribit.example/api/v2", wsUrl: "wss://deribit.example/ws", channel: "agg2" });
    expect(marketDataUrls(config, "delta_india")).toEqual({ restUrl: "https://delta.example", wsUrl: "wss://delta.example", channel: "ticker" });
    const md = createMarketData(config, "deribit", { WebSocket: FakeWebSocket, fetch: () => Promise.reject(new Error("offline")) });
    expect(md).toBeInstanceOf(DeribitMarketData);
    expect((md as DeribitMarketData).ws.interval).toBe("agg2");
  });
});
