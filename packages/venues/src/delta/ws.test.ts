import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StaleConnectionError } from "../errors.js";
import type { DeltaSchemaError, VenueWsError } from "../errors.js";
import { FakeWebSocket } from "../test-support/fake-ws.js";
import { LIVE_COMPACT_TICKER_FRAME, LIVE_V2_TICKER_FRAME } from "../test-support/fixtures.js";
import type { Quote } from "../types.js";
import { DELTA_HEARTBEAT_TIMEOUT_MS, DeltaWsClient } from "./ws.js";
import type { DeltaWsClientOptions } from "./ws.js";

const URL = "wss://socket.example.test";
const SYMBOLS = ["C-BTC-80000-250926", "P-BTC-80000-250926"];

interface Recorded {
  open: unknown[];
  close: unknown[];
  error: unknown[];
  reconnect: unknown[];
  ticker: unknown[];
  heartbeat: unknown[];
  subscriptions: unknown[];
}

function make(extra: Partial<DeltaWsClientOptions> = {}) {
  const client = new DeltaWsClient({ url: URL, WebSocket: FakeWebSocket, now: () => 1_800_000_000_000, ...extra });
  const events: Recorded = { open: [], close: [], error: [], reconnect: [], ticker: [], heartbeat: [], subscriptions: [] };
  for (const name of Object.keys(events) as (keyof Recorded)[]) {
    client.on(name as "open", (payload) => events[name].push(payload));
  }
  return { client, events };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.reset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("[VENUES] DeltaWsClient lifecycle", () => {
  it("[VENUES] connects, enables heartbeat and sends queued subscriptions on open", () => {
    const { client, events } = make();
    expect(client.state).toBe("idle");
    expect(client.subscribe(SYMBOLS)).toEqual(SYMBOLS);
    expect(client.subscribe(["P-BTC-80000-250926"])).toEqual([]);
    client.connect();
    expect(client.state).toBe("connecting");
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.last.url).toBe(URL);
    client.connect(); // no-op while connecting
    expect(FakeWebSocket.instances).toHaveLength(1);

    FakeWebSocket.last.simulateOpen();
    expect(client.state).toBe("open");
    expect(client.isOpen).toBe(true);
    expect(events.open).toHaveLength(1);
    expect(FakeWebSocket.last.sentJson()).toEqual([
      { type: "enable_heartbeat" },
      { type: "subscribe", payload: { channels: [{ name: "v2/ticker", symbols: SYMBOLS }] } },
    ]);
    client.connect(); // no-op while open
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("[VENUES] subscribes only new symbols after open, dedupes, and unsubscribes only known ones", () => {
    const { client } = make();
    client.connect();
    FakeWebSocket.last.simulateOpen();
    expect(FakeWebSocket.last.sentJson()).toEqual([{ type: "enable_heartbeat" }]);

    expect(client.subscribe(["A", "B"])).toEqual(["A", "B"]);
    expect(client.subscribe(["B", "C"])).toEqual(["C"]);
    expect(client.subscribe(["A"])).toEqual([]);
    expect(client.symbols).toEqual(["A", "B", "C"]);
    expect(client.unsubscribe(["B", "Z"])).toEqual(["B"]);
    expect(client.unsubscribe(["Z"])).toEqual([]);
    expect(client.symbols).toEqual(["A", "C"]);
    expect(FakeWebSocket.last.sentJson().slice(1)).toEqual([
      { type: "subscribe", payload: { channels: [{ name: "v2/ticker", symbols: ["A", "B"] }] } },
      { type: "subscribe", payload: { channels: [{ name: "v2/ticker", symbols: ["C"] }] } },
      { type: "unsubscribe", payload: { channels: [{ name: "v2/ticker", symbols: ["B"] }] } },
    ]);
  });

  it("[VENUES] uses the compact `ticker` channel name when configured", () => {
    const { client } = make({ channel: "ticker" });
    client.subscribe(["BTCUSD"]);
    client.connect();
    FakeWebSocket.last.simulateOpen();
    expect(client.channel).toBe("ticker");
    expect(FakeWebSocket.last.sentJson()[1]).toEqual({
      type: "subscribe",
      payload: { channels: [{ name: "ticker", symbols: ["BTCUSD"] }] },
    });
  });

  it("[VENUES] close() stops reconnecting and can be reopened", () => {
    const { client, events } = make();
    client.subscribe(SYMBOLS);
    client.close(); // closing an idle client emits nothing
    expect(client.state).toBe("closed");
    expect(events.close).toHaveLength(0);

    client.connect();
    const first = FakeWebSocket.last;
    first.simulateOpen();
    client.close();
    expect(client.state).toBe("closed");
    expect(first.closeCalls).toEqual([{ code: 1000, reason: "client closed" }]);
    expect(events.close).toEqual([{ code: 1000, reason: "client closed", willReconnect: false }]);

    first.simulateClose(1006, "late"); // late event from the old socket is ignored
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(events.reconnect).toHaveLength(0);

    client.connect();
    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.last.simulateOpen();
    expect(FakeWebSocket.last.sentJson()[1]).toEqual({
      type: "subscribe",
      payload: { channels: [{ name: "v2/ticker", symbols: SYMBOLS }] },
    });
  });

  it("[VENUES] ignores a socket that opens after close() and honours close() called from a close listener", () => {
    const { client, events } = make();
    client.connect();
    const abandoned = FakeWebSocket.last;
    client.close();
    abandoned.simulateOpen(); // handshake completed after we gave up on it
    expect(client.state).toBe("closed");
    expect(events.open).toHaveLength(0);
    expect(abandoned.sent).toEqual([]);

    const reentrant = make();
    reentrant.client.on("close", () => reentrant.client.close());
    reentrant.client.connect();
    FakeWebSocket.last.simulateOpen();
    FakeWebSocket.last.simulateClose(1006, "dropped");
    expect(reentrant.client.state).toBe("closed");
    expect(reentrant.events.reconnect).toHaveLength(1);
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(2); // no reconnect socket was created
  });

  it("[VENUES] close() cancels a pending reconnect and survives a throwing native close", () => {
    const { client, events } = make();
    client.connect();
    FakeWebSocket.last.simulateOpen();
    FakeWebSocket.last.simulateClose();
    expect(client.state).toBe("reconnecting");
    client.close();
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(events.reconnect).toHaveLength(1);

    client.connect();
    FakeWebSocket.last.simulateOpen();
    FakeWebSocket.failClose = true;
    expect(() => client.close()).not.toThrow();
    expect(client.state).toBe("closed");
  });
});

describe("[VENUES] DeltaWsClient frames", () => {
  it("[VENUES] normalises a live v2/ticker frame into a Quote", () => {
    const { client, events } = make();
    client.connect();
    FakeWebSocket.last.simulateOpen();
    FakeWebSocket.last.simulateMessage(LIVE_V2_TICKER_FRAME);
    expect(events.ticker).toHaveLength(1);
    expect(events.ticker[0]).toEqual({
      venue: "delta",
      symbol: "P-BTC-80000-250926",
      instrumentId: 147880,
      mark: "2616.58595291",
      bid: "2590",
      ask: "2643",
      bidSize: "6044",
      askSize: "5794",
      markIv: 0.34751966,
      bidIv: 0.34382519,
      askIv: 0.35119024,
      greeks: { delta: -0.49848053, gamma: 0.00006364, theta: -67.00638062, vega: 71.96112211, rho: -21.66828721 },
      oi: "18.947",
      oiContracts: "18947",
      volume: "5.229",
      spot: "79777.3",
      venueTs: 1788725363377,
      receivedAt: 1_800_000_000_000,
    } satisfies Quote);
  });

  it("[VENUES] normalises compact `ticker` frames (one event per entry)", () => {
    const { client, events } = make({ channel: "ticker" });
    client.connect();
    FakeWebSocket.last.simulateOpen();
    const entry = LIVE_COMPACT_TICKER_FRAME.d[0];
    FakeWebSocket.last.simulateMessage({ ...LIVE_COMPACT_TICKER_FRAME, d: [entry, { ...entry, s: "ETHUSD", i: 3136 }] });
    expect(events.ticker.map((q) => (q as Quote).symbol)).toEqual(["BTCUSD", "ETHUSD"]);
    expect((events.ticker[0] as Quote).spot).toBe("79777.9");
    FakeWebSocket.last.simulateMessage({ ...LIVE_COMPACT_TICKER_FRAME, sp: undefined });
    expect((events.ticker[2] as Quote).spot).toBeNull();
  });

  it("[VENUES] emits heartbeat and subscriptions events", () => {
    const { client, events } = make();
    client.connect();
    FakeWebSocket.last.simulateOpen();
    FakeWebSocket.last.simulateMessage({ ts_origin: 1788725364628418, ts_publish: 1788725364628418, type: "heartbeat" });
    FakeWebSocket.last.simulateMessage({ type: "heartbeat" });
    expect(events.heartbeat).toEqual([
      { tsOrigin: 1788725364628418, tsPublish: 1788725364628418, receivedAt: 1_800_000_000_000 },
      { tsOrigin: null, tsPublish: null, receivedAt: 1_800_000_000_000 },
    ]);
    FakeWebSocket.last.simulateMessage({ channels: [{ name: "v2/ticker", symbols: SYMBOLS }], type: "subscriptions" });
    expect(events.subscriptions).toEqual([[{ name: "v2/ticker", symbols: SYMBOLS }]]);
    expect(events.error).toHaveLength(0);
  });

  it("[VENUES] reports refused subscriptions, error frames, bad JSON and bad shapes as error events", () => {
    const { client, events } = make();
    client.connect();
    FakeWebSocket.last.simulateOpen();
    const ws = FakeWebSocket.last;
    ws.simulateMessage({ type: "subscriptions", channels: [{ name: "trading_notifications", error: "Unauthorized user" }] });
    ws.simulateMessage({ type: "subscriptions", channels: "nope" });
    ws.simulateMessage({ type: "error", message: "bad request" });
    ws.simulateMessage({ type: "error", message: 42 });
    ws.simulateMessage({ type: "error" });
    ws.simulateMessage("{not json");
    ws.simulateMessage({ type: "v2/ticker", symbol: "X" });
    ws.simulateMessage({ type: "ticker", d: "nope" });
    ws.simulateMessage({ type: "candlestick_1m", symbol: "BTCUSD" }); // ignored channel
    ws.simulateMessage({ hello: "world" }); // no type: ignored
    ws.simulateMessage([1, 2, 3]); // not an object: ignored
    ws.simulateRawMessage(Buffer.from("{\"type\":\"heartbeat\"}")); // binary frames are stringified

    const errors = events.error as Error[];
    expect(errors.map((e) => e.constructor.name)).toEqual([
      "VenueWsError",
      "DeltaSchemaError",
      "VenueWsError",
      "VenueWsError",
      "VenueWsError",
      "DeltaSchemaError",
      "DeltaSchemaError",
      "DeltaSchemaError",
    ]);
    expect(errors[0]?.message).toBe("subscription refused: Unauthorized user");
    expect((errors[0] as VenueWsError).payload).toEqual({ name: "trading_notifications", error: "Unauthorized user" });
    expect((errors[1] as DeltaSchemaError).source).toBe("subscriptions");
    expect(errors[2]?.message).toBe("bad request");
    expect(errors[3]?.message).toBe("venue error");
    expect(errors[4]?.message).toBe("venue error");
    expect((errors[5] as DeltaSchemaError).issues[0]).toContain("not JSON");
    expect((errors[6] as DeltaSchemaError).source).toBe("v2/ticker");
    expect((errors[7] as DeltaSchemaError).source).toBe("ticker");
    expect(events.ticker).toHaveLength(0);
    expect(events.heartbeat).toHaveLength(1);
    expect(events.subscriptions).toHaveLength(1);
  });
});

describe("[VENUES] DeltaWsClient reconnect, backoff and heartbeat watchdog", () => {
  it("[VENUES] reconnects after a drop with exponential backoff and resubscribes the current set", () => {
    const { client, events } = make({ backoff: { initialMs: 1000, factor: 2, maxMs: 5000 } });
    client.subscribe(SYMBOLS);
    client.connect();
    FakeWebSocket.last.simulateOpen();
    client.subscribe(["C-BTC-81000-250926"]);
    client.unsubscribe(["P-BTC-80000-250926"]);

    FakeWebSocket.last.simulateClose(1006, "network");
    expect(client.state).toBe("reconnecting");
    expect(events.close).toEqual([{ code: 1006, reason: "network", willReconnect: true }]);
    expect(events.reconnect).toEqual([{ attempt: 1, delayMs: 1000 }]);
    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(client.state).toBe("connecting");

    // second failure before open: delay doubles; third: doubles again; fourth: capped
    FakeWebSocket.last.simulateBareClose();
    expect(events.reconnect[1]).toEqual({ attempt: 2, delayMs: 2000 });
    expect(events.close[1]).toEqual({ code: 1006, reason: "", willReconnect: true });
    vi.advanceTimersByTime(2000);
    FakeWebSocket.last.simulateClose();
    expect(events.reconnect[2]).toEqual({ attempt: 3, delayMs: 4000 });
    vi.advanceTimersByTime(4000);
    FakeWebSocket.last.simulateClose();
    expect(events.reconnect[3]).toEqual({ attempt: 4, delayMs: 5000 });
    expect(client.attempt).toBe(4);
    vi.advanceTimersByTime(5000);

    FakeWebSocket.last.simulateOpen();
    expect(client.attempt).toBe(0);
    expect(client.state).toBe("open");
    expect(FakeWebSocket.last.sentJson()).toEqual([
      { type: "enable_heartbeat" },
      { type: "subscribe", payload: { channels: [{ name: "v2/ticker", symbols: ["C-BTC-80000-250926", "C-BTC-81000-250926"] }] } },
    ]);
    expect(events.open).toHaveLength(2);
  });

  it("[VENUES] applies jitter on top of the base delay", () => {
    const { client, events } = make({ backoff: { initialMs: 1000, jitter: () => 1, jitterRatio: 0.25 } });
    client.connect();
    FakeWebSocket.last.simulateClose();
    expect(events.reconnect).toEqual([{ attempt: 1, delayMs: 1250 }]);
    const clamped = make({ backoff: { initialMs: 1000, jitter: () => 5, jitterRatio: 0.5 } });
    clamped.client.connect();
    FakeWebSocket.last.simulateClose();
    expect(clamped.events.reconnect).toEqual([{ attempt: 1, delayMs: 1500 }]);
  });

  it("[VENUES] drops a silent socket after 35 s, resets the watchdog on every frame, and ignores the dead socket afterwards", () => {
    const { client, events } = make();
    expect(DELTA_HEARTBEAT_TIMEOUT_MS).toBe(35_000);
    client.connect();
    const first = FakeWebSocket.last;
    first.simulateOpen();

    vi.advanceTimersByTime(30_000);
    first.simulateMessage({ type: "heartbeat" });
    vi.advanceTimersByTime(30_000);
    first.simulateMessage(LIVE_V2_TICKER_FRAME);
    vi.advanceTimersByTime(34_999);
    expect(events.error).toHaveLength(0);
    expect(client.state).toBe("open");

    vi.advanceTimersByTime(1);
    expect(events.error).toHaveLength(1);
    expect(events.error[0]).toBeInstanceOf(StaleConnectionError);
    expect((events.error[0] as StaleConnectionError).silentMs).toBe(35_000);
    expect(first.closeCalls).toEqual([{ code: 4000, reason: "stale" }]);
    expect(client.state).toBe("reconnecting");
    expect(events.close.at(-1)).toEqual({ code: 4000, reason: "stale", willReconnect: true });

    first.simulateMessage(LIVE_V2_TICKER_FRAME); // dead socket: ignored
    first.simulateClose(); // dead socket: ignored
    first.simulateError(new Error("late"));
    expect(events.ticker).toHaveLength(1);
    expect(events.error).toHaveLength(1);
    expect(events.reconnect).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("[VENUES] tolerates a native close that throws when dropping a stale socket", () => {
    const { client, events } = make({ heartbeatMs: 100 });
    client.connect();
    FakeWebSocket.last.simulateOpen();
    FakeWebSocket.failClose = true;
    vi.advanceTimersByTime(100);
    expect(events.error[0]).toBeInstanceOf(StaleConnectionError);
    expect(client.state).toBe("reconnecting");
  });

  it("[VENUES] disables the watchdog with heartbeatMs 0", () => {
    const { client, events } = make({ heartbeatMs: 0 });
    client.connect();
    FakeWebSocket.last.simulateOpen();
    vi.advanceTimersByTime(600_000);
    expect(events.error).toHaveLength(0);
    expect(client.state).toBe("open");
  });

  it("[VENUES] surfaces socket errors and constructor failures", () => {
    const { client, events } = make();
    client.connect();
    const ws = FakeWebSocket.last;
    ws.simulateError(new Error("ECONNREFUSED"));
    ws.simulateError({ message: "handshake failed" });
    ws.simulateError(null);
    ws.simulateError({});
    expect((events.error as Error[]).map((e) => e.message)).toEqual([
      "ECONNREFUSED",
      "handshake failed",
      "socket error",
      "socket error",
    ]);

    FakeWebSocket.failConstruct = true;
    const failing = make();
    failing.client.connect();
    expect((failing.events.error[0] as Error).message).toBe("fake constructor failure");
    expect(failing.events.reconnect).toEqual([{ attempt: 1, delayMs: 1000 }]);
    expect(failing.client.state).toBe("reconnecting");
    FakeWebSocket.failConstruct = false;
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("[VENUES] wraps non-Error constructor throws", () => {
    class Throwing {
      constructor() {
        throw "string failure"; // eslint-disable-line @typescript-eslint/only-throw-error
      }
    }
    const client = new DeltaWsClient({ url: URL, WebSocket: Throwing as unknown as typeof FakeWebSocket });
    const errors: Error[] = [];
    client.on("error", (e) => errors.push(e));
    client.connect();
    expect(errors[0]?.message).toBe("string failure");
    client.close();
  });

  it("[VENUES] falls back to globalThis.WebSocket and fails clearly when none exists", () => {
    vi.stubGlobal("WebSocket", undefined);
    expect(() => new DeltaWsClient({ url: URL })).toThrow(/No WebSocket implementation/);
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const client = new DeltaWsClient({ url: URL });
    client.connect();
    expect(FakeWebSocket.instances).toHaveLength(1);
    client.close();
  });

  it("[VENUES] listeners can be removed individually or all at once", () => {
    const { client } = make();
    const seen: unknown[] = [];
    const off = client.on("open", () => seen.push("a"));
    const second = () => seen.push("b");
    client.on("open", second);
    client.connect();
    FakeWebSocket.last.simulateOpen();
    off();
    client.off("open", second);
    client.off("close", second); // unknown listener: no-op
    client.close();
    client.connect();
    FakeWebSocket.last.simulateOpen();
    expect(seen).toEqual(["a", "b"]);
    client.removeAllListeners();
    client.close();
  });
});
