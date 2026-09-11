import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VenueSchemaError, VenueWsError } from "../errors.js";
import { FakeWebSocket } from "../test-support/fake-ws.js";
import { loadDeribitWsFrames } from "../test-support/fixtures.js";
import { DERIBIT_HEARTBEAT_INTERVAL_S, DERIBIT_HEARTBEAT_TIMEOUT_MS, DeribitWsClient } from "./ws.js";

const URL = "wss://ws.example.test";
const NAMES = ["BTC-12SEP26-69000-C", "BTC-12SEP26-70000-C"];
const frames = loadDeribitWsFrames();

interface Recorded {
  open: unknown[];
  close: unknown[];
  error: unknown[];
  reconnect: unknown[];
  ticker: unknown[];
  index: unknown[];
  heartbeat: unknown[];
  subscriptions: unknown[];
}

function make(interval?: "100ms" | "agg2") {
  const client = new DeribitWsClient({ url: URL, WebSocket: FakeWebSocket, ...(interval ? { interval } : {}) });
  const events: Recorded = { open: [], close: [], error: [], reconnect: [], ticker: [], index: [], heartbeat: [], subscriptions: [] };
  for (const name of Object.keys(events) as (keyof Recorded)[]) client.on(name as "open", (payload) => events[name].push(payload));
  return { client, events };
}

const sent = () => FakeWebSocket.last.sentJson() as { id: number; method: string; params: Record<string, unknown> }[];

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.reset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("HC-SH-122 [VENUES] Deribit WebSocket", () => {
  it("queues subscriptions until open, then sends the heartbeat request and one subscribe with ticker channels", () => {
    const { client, events } = make();
    expect(client.subscribe(NAMES)).toEqual(NAMES);
    expect(client.subscribe([NAMES[0]!])).toEqual([]); // dedupe
    client.connect();
    FakeWebSocket.last.simulateOpen();
    expect(sent().map((f) => f.method)).toEqual(["public/set_heartbeat", "public/subscribe"]);
    expect(sent()[0]!.params).toEqual({ interval: DERIBIT_HEARTBEAT_INTERVAL_S });
    expect(sent()[1]!.params).toEqual({ channels: NAMES.map((n) => `ticker.${n}.100ms`) });
    expect(sent().map((f) => f.id)).toEqual([1, 2]);
    expect(client.symbols).toEqual(NAMES);
    expect(events.open).toHaveLength(1);
    // a later subscribe / unsubscribe go straight out; the interval option names the channel
    expect(client.subscribe(["BTC-12SEP26-71000-P"])).toEqual(["BTC-12SEP26-71000-P"]);
    expect(client.unsubscribe([NAMES[1]!, "unknown"])).toEqual([NAMES[1]!]);
    expect(sent().at(-1)).toMatchObject({ method: "public/unsubscribe", params: { channels: [`ticker.${NAMES[1]}.100ms`] } });
    client.subscribeIndex("btc_usd");
    expect(sent().at(-1)).toMatchObject({ method: "public/subscribe", params: { channels: ["deribit_price_index.btc_usd"] } });
    const agg = make("agg2");
    agg.client.subscribe(["X"]);
    agg.client.connect();
    FakeWebSocket.last.simulateOpen();
    expect(sent()[1]!.params).toEqual({ channels: ["ticker.X.agg2"] });
  });

  it("answers a test request with public/test, reports subscriptions, tickers, the index and refusals", () => {
    const { client, events } = make();
    client.subscribe(NAMES);
    client.connect();
    const ws = FakeWebSocket.last;
    ws.simulateOpen();
    ws.simulateMessage(frames["heartbeatReply"]);
    ws.simulateMessage(frames["subscribeReply"]);
    expect(events.subscriptions).toEqual([["ticker.BTC-12SEP26-69000-C.100ms", "deribit_price_index.btc_usd"]]);
    ws.simulateMessage(frames["heartbeat"]);
    expect(events.heartbeat).toEqual([{ type: "test_request" }]);
    expect(sent().at(-1)).toMatchObject({ method: "public/test", params: {} });
    ws.simulateMessage({ jsonrpc: "2.0", method: "heartbeat", params: { type: "heartbeat" } });
    expect(events.heartbeat).toHaveLength(2);
    ws.simulateMessage(frames["testReply"]); // carries nothing the session needs
    ws.simulateMessage(frames["tickerBtc"]);
    expect(events.ticker).toHaveLength(1);
    expect(events.ticker[0]).toMatchObject({ instrument_name: "BTC-12SEP26-69000-C", mark_price: (frames["tickerBtc"] as { params: { data: { mark_price: number } } }).params.data.mark_price });
    ws.simulateMessage(frames["index"]);
    expect(events.index).toEqual([{ name: "btc_usd", price: 77561.22, ts: 1789148378799 }]);
    ws.simulateMessage({ jsonrpc: "2.0", id: 7, error: { code: 11050, message: "bad_request" } });
    expect(events.error).toHaveLength(1);
    expect(events.error[0]).toBeInstanceOf(VenueWsError);
    expect((events.error[0] as Error).message).toContain("11050");
    ws.simulateMessage({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }); // an unparsable request is refused without an id
    expect((events.error[1] as Error).message).toContain("(no id)");
    // malformed and unknown frames
    ws.simulateMessage("not json");
    expect(events.error[2]).toBeInstanceOf(VenueSchemaError);
    ws.simulateMessage({ jsonrpc: "2.0", method: "subscription", params: { channel: "ticker.X.100ms", data: { instrument_name: "X" } } });
    expect(events.error[3]).toBeInstanceOf(VenueSchemaError);
    expect((events.error[3] as VenueSchemaError).venue).toBe("deribit");
    ws.simulateMessage({ jsonrpc: "2.0", method: "subscription", params: { channel: "deribit_price_index.eth_usd", data: { bogus: true } } });
    ws.simulateMessage({ jsonrpc: "2.0", method: "subscription", params: { channel: "book.X.raw", data: {} } });
    ws.simulateMessage({ jsonrpc: "2.0", method: "subscription", params: { nope: 1 } });
    ws.simulateMessage({ jsonrpc: "2.0", method: "heartbeat", params: { type: "other" } });
    ws.simulateMessage({ jsonrpc: "2.0", method: "other", params: {} });
    ws.simulateMessage({ hello: "world" });
    expect(events.error).toHaveLength(4);
    expect(events.ticker).toHaveLength(1);
    expect(events.index).toHaveLength(1);
    expect(events.subscriptions).toHaveLength(1);
  });

  it("reconnects and resubscribes (instruments and the index) when the server goes silent past the heartbeat window", () => {
    const { client, events } = make();
    client.subscribe(NAMES);
    client.subscribeIndex("btc_usd");
    client.subscribeIndex("btc_usd"); // dedupe
    client.connect();
    FakeWebSocket.last.simulateOpen();
    expect(sent()[1]!.params).toEqual({ channels: [...NAMES.map((n) => `ticker.${n}.100ms`), "deribit_price_index.btc_usd"] });
    vi.advanceTimersByTime(DERIBIT_HEARTBEAT_TIMEOUT_MS + 1);
    expect(events.close.length + events.reconnect.length).toBeGreaterThan(0);
    vi.advanceTimersByTime(10_000);
    FakeWebSocket.last.simulateOpen();
    expect(sent().map((f) => f.method)).toEqual(["public/set_heartbeat", "public/subscribe"]);
    expect(sent()[1]!.params).toEqual({ channels: [...NAMES.map((n) => `ticker.${n}.100ms`), "deribit_price_index.btc_usd"] });
    client.close();
    expect(client.state).toBe("closed");
  });
});
