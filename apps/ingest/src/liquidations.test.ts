import type { LiquidationEvent } from "@hapiecoin/schema";
import { describe, expect, it, vi } from "vitest";
import { ForceOrderStream, LiquidationBuffer, type SocketLike, baseOf, parseForceOrder } from "./liquidations.js";

const tracked = new Set(["BTC", "ETH"]);
const frame = (o: Record<string, unknown>) => JSON.stringify({ e: "forceOrder", E: 1, o: { s: "BTCUSDT", S: "SELL", o: "LIMIT", f: "IOC", q: "0.5", p: "80000", ap: "79990", X: "FILLED", T: 1_000_000, ...o } });
const ev = (over: Partial<LiquidationEvent>): LiquidationEvent => ({ t: 1_000_000, venue: "binance", symbol: "BTC", side: "long", price: 80000, qty: 1, usd: 80000, ...over });

describe("[INGEST] force-order parsing", () => {
  it("maps venue symbols to tracked bases and SELL/BUY to long/short, preferring the average price", () => {
    expect(baseOf("BTCUSDT", tracked)).toBe("BTC");
    expect(baseOf("ethusdc", tracked)).toBe("ETH");
    expect(baseOf("SOLUSDT", tracked)).toBeNull();
    expect(parseForceOrder(frame({}), tracked)).toEqual({ t: 1_000_000, venue: "binance", symbol: "BTC", side: "long", price: 79990, qty: 0.5, usd: 39995 });
    expect(parseForceOrder(frame({ S: "BUY", ap: "0" }), tracked)?.side).toBe("short");
    expect(parseForceOrder(frame({ S: "BUY", ap: "0" }), tracked)?.price).toBe(80000);
    expect(parseForceOrder(frame({ s: "SOLUSDT" }), tracked)).toBeNull();
    expect(parseForceOrder("{oops", tracked)).toBeNull();
    expect(parseForceOrder(JSON.stringify({ e: "trade" }), tracked)).toBeNull();
  });
});

describe("[INGEST] LiquidationBuffer", () => {
  it("dedupes, prunes outside the window and beyond capacity, and folds into buckets, venues, symbols and recent", () => {
    let now = 10 * 3_600_000;
    const b = new LiquidationBuffer({ windowMs: 4 * 3_600_000, bucketMs: 3_600_000, recentLimit: 2, capacity: 3, now: () => now });
    expect(b.add([ev({}), ev({})])).toBe(1);
    expect(b.add([ev({ t: now - 1000, symbol: "ETH", side: "short", venue: "okx", usd: 5000, price: 5000 })])).toBe(1);
    expect(b.add([ev({ t: now - 2 * 3_600_000 - 1, usd: 1000, price: 1000 })])).toBe(1);
    expect(b.size()).toBe(2); // the t=1_000_000 event is outside the 4 h window
    b.add([ev({ t: now - 10, usd: 10, price: 10 }), ev({ t: now - 20, usd: 20, price: 20 })]);
    expect(b.size()).toBe(3); // capacity 3 drops the oldest
    const s = b.snapshot();
    expect(s.windowMs).toBe(4 * 3_600_000);
    expect(s.buckets).toHaveLength(5);
    expect(s.total).toEqual({ longUsd: 30, shortUsd: 5000 });
    expect(s.byVenue).toEqual([{ venue: "okx", longUsd: 0, shortUsd: 5000 }, { venue: "binance", longUsd: 30, shortUsd: 0 }]);
    expect(s.bySymbol.map((x) => x.symbol)).toEqual(["ETH", "BTC"]);
    expect(s.recent.map((e) => e.usd)).toEqual([10, 20]); // newest first, capped at 2
    expect(s.buckets.at(-2)).toEqual({ t: 9 * 3_600_000, longUsd: 30, shortUsd: 5000 }); // all three events sit just before the 10 h boundary
    expect(s.buckets.at(-1)).toEqual({ t: 10 * 3_600_000, longUsd: 0, shortUsd: 0 });
    b.add([ev({ t: now + 3_600_001, usd: 7, price: 7 })]); // future-stamped: counted in totals, no bucket yet
    expect(b.snapshot().total.longUsd).toBe(37);
    now += 5 * 3_600_000;
    expect(b.snapshot().total).toEqual({ longUsd: 7, shortUsd: 0 }); // only the future-stamped event is still inside the window
    expect(new LiquidationBuffer().snapshot().buckets.length).toBe(25);
  });
});

class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  readonly handlers = new Map<string, ((...a: unknown[]) => void)[]>();
  closed = false;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  on(event: string, listener: (...a: unknown[]) => void): this {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), listener]);
    return this;
  }
  emit(event: string, ...args: unknown[]): void {
    for (const h of this.handlers.get(event) ?? []) h(...args);
  }
  close(): void {
    this.closed = true;
  }
}

describe("[INGEST] ForceOrderStream", () => {
  it("connects to the all-market stream, feeds parsed frames into the buffer, reconnects after close and stops cleanly", () => {
    FakeSocket.all = [];
    const buffer = new LiquidationBuffer({ now: () => 2_000_000 });
    const timers: (() => void)[] = [];
    const states: string[] = [];
    const events: LiquidationEvent[] = [];
    const stream = new ForceOrderStream({ url: "wss://x/ws/", tracked, buffer, createSocket: (u) => new FakeSocket(u), reconnectMs: 5, setTimer: (fn) => timers.push(fn), onEvent: (e) => events.push(e), onState: (s) => states.push(s) });
    stream.start();
    const s1 = FakeSocket.all[0]!;
    expect(s1.url).toBe("wss://x/ws/!forceOrder@arr");
    s1.emit("open");
    s1.emit("message", frame({}));
    s1.emit("message", Buffer.from(frame({})));
    s1.emit("message", "not json");
    expect(events).toHaveLength(1);
    expect(buffer.size()).toBe(1);
    s1.emit("error", new Error("x"));
    s1.emit("error", "not an error object");
    s1.emit("close");
    expect(states).toEqual(["open", "error", "error", "closed"]);
    expect(timers).toHaveLength(1);
    timers[0]!();
    expect(FakeSocket.all).toHaveLength(2);
    stream.stop();
    expect(FakeSocket.all[1]!.closed).toBe(true);
    FakeSocket.all[1]!.emit("close");
    expect(timers).toHaveLength(1); // no reconnect after stop
    s1.emit("close"); // a stale socket closing after replacement does not touch the current one
    // default timer path
    const real = new ForceOrderStream({ url: "wss://x", tracked, buffer, createSocket: (u) => new FakeSocket(u), reconnectMs: 1 });
    real.start();
    const spy = vi.spyOn(globalThis, "setTimeout");
    FakeSocket.all.at(-1)!.emit("close");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    real.stop();
  });
});
