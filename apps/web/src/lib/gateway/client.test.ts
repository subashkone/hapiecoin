import { chainTopic, spotTopic, type ChainRow } from "@hapiecoin/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildChain } from "../../../test/fixtures/chain";
import { FakeSocket, makeGateway } from "../../../test/helpers";
import { GatewayClient } from "./client";

const TOPIC = chainTopic("delta_india", "BTC", "2026-09-25");
const rows: ChainRow[] = buildChain("BTC", "2026-09-25");

beforeEach(() => FakeSocket.reset());
afterEach(() => vi.useRealTimers());

describe("HC-SH-006 GatewayClient connection lifecycle", () => {
  it("connects, subscribes on open, and refcounts topics", () => {
    const gw = makeGateway();
    const status: string[] = [];
    gw.on("status", (s) => status.push(s));
    const off1 = gw.subscribe(TOPIC);
    gw.connect();
    expect(gw.getStatus()).toBe("connecting");
    const ws = FakeSocket.last();
    expect(ws.sent).toHaveLength(0); // not open yet
    ws.open();
    expect(gw.getStatus()).toBe("open");
    expect(ws.sentFrames()).toEqual([{ op: "sub", topics: [TOPIC] }]);
    const off2 = gw.subscribe(TOPIC); // second subscriber: no extra frame
    expect(ws.sent).toHaveLength(1);
    off2();
    off2(); // idempotent
    expect(gw.topics()).toEqual([TOPIC]);
    off1();
    expect(ws.sentFrames().at(-1)).toEqual({ op: "unsub", topics: [TOPIC] });
    expect(gw.topics()).toEqual([]);
    expect(gw.getChain(TOPIC)).toBeUndefined();
    expect(status).toEqual(["connecting", "open"]);
    gw.connect(); // already connected: no second socket
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("applies snap and q frames, refreshing on a seq gap", () => {
    const gw = makeGateway();
    const chains: number[] = [];
    gw.on("chain", (_t, s) => chains.push(s.seq));
    gw.subscribe(TOPIC);
    gw.connect();
    const ws = FakeSocket.last();
    ws.open();
    ws.receive({ t: "snap", topic: TOPIC, seq: 0, rows });
    expect(gw.getChain(TOPIC)?.rows).toHaveLength(52);
    ws.receive({ t: "q", topic: TOPIC, seq: 1, d: [{ i: rows[0]!.call!.instrumentId, mark: "42" }] });
    expect(gw.getChain(TOPIC)?.rows[0]?.call?.mark).toBe("42");
    // gap → stale → unsub+sub for a fresh snapshot
    ws.receive({ t: "q", topic: TOPIC, seq: 5, d: [{ i: rows[0]!.call!.instrumentId, mark: "43" }] });
    expect(gw.getChain(TOPIC)?.stale).toBe(true);
    expect(ws.sentFrames().slice(-2)).toEqual([
      { op: "unsub", topics: [TOPIC] },
      { op: "sub", topics: [TOPIC] },
    ]);
    ws.receive({ t: "snap", topic: TOPIC, seq: 6, rows });
    expect(gw.getChain(TOPIC)?.stale).toBe(false);
    expect(chains).toEqual([0, 1, 1, 6]);
    // frames for an unknown topic are ignored
    ws.receive({ t: "snap", topic: chainTopic("delta_india", "ETH", "2026-09-25"), seq: 0, rows: [] });
    expect(gw.getChain(chainTopic("delta_india", "ETH", "2026-09-25"))).toBeUndefined();
  });

  it("handles spot, pong latency, err and malformed frames", () => {
    let now = 1000;
    const gw = makeGateway({ now: () => now, pingIntervalMs: 50, setTimer: () => 0, clearTimer: () => {} });
    const errors: string[] = [];
    const latencies: number[] = [];
    gw.on("error", (code) => errors.push(code));
    gw.on("latency", (ms) => latencies.push(ms));
    gw.subscribe(spotTopic("BTC"));
    gw.connect();
    const ws = FakeSocket.last();
    ws.open(); // ping sent at 1000
    expect(ws.sentFrames()).toContainEqual({ op: "ping" });
    now = 1084;
    ws.receive({ t: "pong" });
    expect(gw.getLatency()).toBe(84);
    expect(latencies).toEqual([84]);
    ws.receive({ t: "spot", s: "BTC", p: "79521.5", c24: -1.2 });
    expect(gw.getSpot("BTC")).toMatchObject({ price: "79521.5", c24: -1.2 });
    ws.receive({ t: "spot", s: "BTC", p: "79530" });
    expect(gw.getSpot("BTC")).toMatchObject({ prev: "79521.5", dir: "up", c24: -1.2 });
    ws.receive({ t: "err", code: "RATE_LIMIT", message: "slow down" });
    ws.receive("{not json");
    ws.receive({ t: "bogus" });
    expect(errors).toEqual(["RATE_LIMIT", "BAD_JSON", "BAD_FRAME"]);
  });

  it("reconnects with exponential backoff and resubscribes", () => {
    vi.useFakeTimers();
    const gw = makeGateway({ backoffBaseMs: 100, backoffMaxMs: 250 });
    const status: string[] = [];
    gw.on("status", (s) => status.push(s));
    gw.subscribe(TOPIC);
    gw.subscribe(spotTopic("ETH"));
    gw.connect();
    FakeSocket.last().open();
    expect(gw.nextBackoffMs()).toBe(100);
    FakeSocket.last().drop();
    expect(gw.getStatus()).toBe("reconnecting");
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(100);
    expect(FakeSocket.instances).toHaveLength(2);
    FakeSocket.last().drop(); // fails before open → longer wait
    expect(gw.nextBackoffMs()).toBe(250); // capped
    vi.advanceTimersByTime(199);
    expect(FakeSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(3);
    FakeSocket.last().open();
    expect(FakeSocket.last().sentFrames()).toEqual([{ op: "sub", topics: [TOPIC, spotTopic("ETH")] }]);
    expect(gw.nextBackoffMs()).toBe(100); // attempts reset after a successful open
    expect(status).toEqual(["connecting", "open", "reconnecting", "open"]); // status events are de-duplicated
  });

  it("close() stops reconnecting; reopen() resumes with subscriptions intact", () => {
    vi.useFakeTimers();
    const gw = makeGateway();
    gw.subscribe(TOPIC);
    gw.connect();
    const ws = FakeSocket.last();
    ws.open();
    gw.close();
    expect(ws.closed).toBe(true);
    expect(gw.getStatus()).toBe("closed");
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.instances).toHaveLength(1);
    gw.connect(); // ignored while manually closed
    expect(FakeSocket.instances).toHaveLength(1);
    gw.reopen();
    expect(FakeSocket.instances).toHaveLength(2);
    FakeSocket.last().open();
    expect(FakeSocket.last().sentFrames()).toEqual([{ op: "sub", topics: [TOPIC] }]);
    // close while a reconnect timer is pending clears it
    FakeSocket.last().drop();
    gw.close();
    vi.advanceTimersByTime(5000);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("schedules a reconnect when the socket factory throws, and refresh() ignores unknown topics", () => {
    vi.useFakeTimers();
    let fail = true;
    const gw = new GatewayClient({
      url: "ws://x",
      backoffBaseMs: 10,
      pingIntervalMs: 0,
      createSocket: (url) => {
        if (fail) throw new Error("boom");
        return new FakeSocket(url);
      },
    });
    gw.connect();
    expect(gw.getStatus()).toBe("reconnecting");
    fail = false;
    vi.advanceTimersByTime(10);
    expect(FakeSocket.instances).toHaveLength(1);
    FakeSocket.last().open();
    gw.refresh(TOPIC); // not subscribed → nothing sent
    expect(FakeSocket.last().sent).toHaveLength(0);
  });

  it("uses the real WebSocket constructor by default", () => {
    const Ctor = vi.fn(function (this: FakeSocket, url: string) {
      return new FakeSocket(url);
    });
    vi.stubGlobal("WebSocket", Ctor);
    const gw = new GatewayClient({ url: "ws://real", pingIntervalMs: 0 });
    gw.connect();
    expect(Ctor).toHaveBeenCalledWith("ws://real");
    vi.unstubAllGlobals();
  });
});
