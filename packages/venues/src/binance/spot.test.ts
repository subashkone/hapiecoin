import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeltaSchemaError, StaleConnectionError } from "../errors.js";
import { FakeWebSocket } from "../test-support/fake-ws.js";
import { LIVE_BINANCE_FRAME } from "../test-support/fixtures.js";
import type { SpotTick } from "../types.js";
import {
  BINANCE_STALE_MS,
  BINANCE_STREAM_URL,
  BinanceSpotClient,
  binanceStreamName,
  buildBinanceStreamUrl,
  parseMiniTicker,
} from "./spot.js";

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("[VENUES] Binance stream naming", () => {
  it("[VENUES] maps BTC/ETH to usdt miniTicker streams and has no stream for XAUT", () => {
    expect(binanceStreamName("BTC")).toBe("btcusdt@miniTicker");
    expect(binanceStreamName("eth")).toBe("ethusdt@miniTicker");
    expect(binanceStreamName("XAUT")).toBeNull();
    expect(binanceStreamName("xaut")).toBeNull();
    expect(binanceStreamName("")).toBeNull();
  });

  it("[VENUES] builds the combined-stream URL, deduped, or null when nothing is supported", () => {
    expect(buildBinanceStreamUrl(["BTC", "ETH", "XAUT", "btc"])).toBe(
      `${BINANCE_STREAM_URL}?streams=btcusdt@miniTicker/ethusdt@miniTicker`,
    );
    expect(buildBinanceStreamUrl(["XAUT"])).toBeNull();
    expect(buildBinanceStreamUrl([])).toBeNull();
    expect(buildBinanceStreamUrl(["BTC"], "wss://alt.example.test/stream")).toBe(
      "wss://alt.example.test/stream?streams=btcusdt@miniTicker",
    );
  });
});

describe("[VENUES] parseMiniTicker", () => {
  it("[VENUES] parses the live frame into a SpotTick with a decimal price and 24 h change", () => {
    expect(parseMiniTicker(LIVE_BINANCE_FRAME)).toEqual({
      source: "binance",
      underlying: "BTC",
      symbol: "BTCUSDT",
      price: "79789.86",
      change24hPct: -0.0628,
      ts: 1788725597015,
    } satisfies SpotTick);
  });

  it("[VENUES] returns null for non-ticker frames and guards a zero open", () => {
    expect(parseMiniTicker({ result: null, id: 1 })).toBeNull();
    expect(parseMiniTicker({ stream: "btcusdt@trade", data: { e: "trade" } })).toBeNull();
    expect(parseMiniTicker(null)).toBeNull();
    const zeroOpen = { ...LIVE_BINANCE_FRAME, data: { ...LIVE_BINANCE_FRAME.data, o: "0.00000000" } };
    expect(parseMiniTicker(zeroOpen)?.change24hPct).toBe(0);
    const minimal = { stream: "ethusdt@miniTicker", data: { e: "24hrMiniTicker", E: 1, s: "ETHUSDT", c: "2500", o: "2000" } };
    expect(parseMiniTicker(minimal)).toMatchObject({ underlying: "ETH", price: "2500", change24hPct: 25 });
  });
});

describe("[VENUES] BinanceSpotClient", () => {
  it("[VENUES] streams supported underlyings, skips XAUT, and emits spot ticks", () => {
    const client = new BinanceSpotClient({ underlyings: ["BTC", "ETH", "XAUT"], WebSocket: FakeWebSocket });
    expect(client.streamed).toEqual(["BTC", "ETH"]);
    expect(client.skipped).toEqual(["XAUT"]);
    expect(client.url).toBe(`${BINANCE_STREAM_URL}?streams=btcusdt@miniTicker/ethusdt@miniTicker`);

    const ticks: SpotTick[] = [];
    const errors: Error[] = [];
    client.on("spot", (t) => ticks.push(t));
    client.on("error", (e) => errors.push(e));
    client.connect();
    FakeWebSocket.last.simulateOpen();
    expect(FakeWebSocket.last.sent).toEqual([]); // combined streams need no subscribe frame
    FakeWebSocket.last.simulateMessage(LIVE_BINANCE_FRAME);
    FakeWebSocket.last.simulateMessage({ result: null, id: 1 }); // ignored
    FakeWebSocket.last.simulateMessage("not json");
    expect(ticks).toHaveLength(1);
    expect(ticks[0]).toMatchObject({ underlying: "BTC", price: "79789.86" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(DeltaSchemaError);
    expect((errors[0] as DeltaSchemaError).source).toBe("binance");
    client.close();
  });

  it("[VENUES] never opens a socket when only XAUT is requested", () => {
    const client = new BinanceSpotClient({ underlyings: ["XAUT"], WebSocket: FakeWebSocket });
    expect(client.streamed).toEqual([]);
    expect(client.skipped).toEqual(["XAUT"]);
    client.connect();
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(client.state).toBe("idle");
    client.close();
  });

  it("[VENUES] reconnects when the stream goes silent for 30 s", () => {
    expect(BINANCE_STALE_MS).toBe(30_000);
    const client = new BinanceSpotClient({ underlyings: ["BTC"], WebSocket: FakeWebSocket, baseUrl: "wss://alt.example.test/stream" });
    const errors: Error[] = [];
    client.on("error", (e) => errors.push(e));
    client.connect();
    FakeWebSocket.last.simulateOpen();
    vi.advanceTimersByTime(29_999);
    FakeWebSocket.last.simulateMessage(LIVE_BINANCE_FRAME);
    vi.advanceTimersByTime(29_999);
    expect(errors).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(errors[0]).toBeInstanceOf(StaleConnectionError);
    expect(client.state).toBe("reconnecting");
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    client.close();
  });
});
