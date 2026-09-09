/**
 * Liquidation stream and rolling aggregate. Binance pushes forced orders on `!forceOrder@arr` (at most one per
 * symbol per second); OKX's recent filled liquidations are polled. Both land in one ring buffer keyed by
 * (venue, ts, symbol, price, qty) so a re-poll does not double count, and `snapshot()` folds the window into the
 * hourly buckets, per-venue and per-symbol totals the Liquidations pages show (HC-MA-060..066).
 *
 * Binance frame (docs): { e: "forceOrder", o: { s: "BTCUSDT", S: "SELL"|"BUY", q, p, ap, T } } — a SELL forced order
 * closes a long, a BUY closes a short.
 */
import type { LiquidationEvent, LiquidationsData } from "@hapiecoin/schema";
import { z } from "zod";

const num = z.coerce.number();
export const ForceOrderFrame = z.looseObject({ e: z.literal("forceOrder"), o: z.looseObject({ s: z.string(), S: z.enum(["BUY", "SELL"]), q: num, p: num, ap: num.optional(), T: num }) });

/** Map "BTCUSDT" → "BTC"; null for symbols we do not track. */
export function baseOf(venueSymbol: string, tracked: ReadonlySet<string>): string | null {
  const base = venueSymbol.replace(/(USDT|USDC|BUSD|USD)$/i, "").toUpperCase();
  return tracked.has(base) ? base : null;
}

export function parseForceOrder(raw: string, tracked: ReadonlySet<string>): LiquidationEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const f = ForceOrderFrame.safeParse(json);
  if (!f.success) return null;
  const symbol = baseOf(f.data.o.s, tracked);
  if (!symbol) return null;
  const price = f.data.o.ap && f.data.o.ap > 0 ? f.data.o.ap : f.data.o.p;
  return { t: f.data.o.T, venue: "binance", symbol, side: f.data.o.S === "SELL" ? "long" : "short", price, qty: f.data.o.q, usd: price * f.data.o.q };
}

export interface LiquidationBufferOptions {
  windowMs?: number;
  bucketMs?: number;
  /** Newest events kept in `recent`. */
  recentLimit?: number;
  /** Ring capacity; older events are dropped even inside the window. */
  capacity?: number;
  now?: () => number;
}

const key = (e: LiquidationEvent): string => `${e.venue}:${e.t}:${e.symbol}:${e.price}:${e.qty}`;

export class LiquidationBuffer {
  private readonly events = new Map<string, LiquidationEvent>();
  private readonly windowMs: number;
  private readonly bucketMs: number;
  private readonly recentLimit: number;
  private readonly capacity: number;
  private readonly now: () => number;

  constructor(opts: LiquidationBufferOptions = {}) {
    this.windowMs = opts.windowMs ?? 24 * 60 * 60 * 1000;
    this.bucketMs = opts.bucketMs ?? 60 * 60 * 1000;
    this.recentLimit = opts.recentLimit ?? 100;
    this.capacity = opts.capacity ?? 20_000;
    this.now = opts.now ?? Date.now;
  }

  /** Add events; duplicates (same venue, time, symbol, price and size) are ignored. Returns how many were new. */
  add(events: readonly LiquidationEvent[]): number {
    let added = 0;
    for (const e of events) {
      const k = key(e);
      if (this.events.has(k)) continue;
      this.events.set(k, e);
      added += 1;
    }
    this.prune();
    return added;
  }

  size(): number {
    return this.events.size;
  }

  private prune(): void {
    const floor = this.now() - this.windowMs;
    for (const [k, e] of this.events) if (e.t < floor) this.events.delete(k);
    if (this.events.size > this.capacity) {
      const sorted = [...this.events.entries()].sort((a, b) => a[1].t - b[1].t);
      for (const [k] of sorted.slice(0, this.events.size - this.capacity)) this.events.delete(k);
    }
  }

  snapshot(): LiquidationsData {
    this.prune();
    const now = this.now();
    const start = Math.floor((now - this.windowMs) / this.bucketMs) * this.bucketMs;
    const buckets = new Map<number, { longUsd: number; shortUsd: number }>();
    for (let t = start; t <= now; t += this.bucketMs) buckets.set(t, { longUsd: 0, shortUsd: 0 });
    const byVenue = new Map<LiquidationEvent["venue"], { longUsd: number; shortUsd: number }>();
    const bySymbol = new Map<string, { longUsd: number; shortUsd: number }>();
    const total = { longUsd: 0, shortUsd: 0 };
    const bump = (acc: { longUsd: number; shortUsd: number }, e: LiquidationEvent) => {
      if (e.side === "long") acc.longUsd += e.usd;
      else acc.shortUsd += e.usd;
    };
    const all = [...this.events.values()];
    for (const e of all) {
      const b = buckets.get(Math.floor(e.t / this.bucketMs) * this.bucketMs);
      if (b) bump(b, e);
      bump(byVenue.get(e.venue) ?? byVenue.set(e.venue, { longUsd: 0, shortUsd: 0 }).get(e.venue)!, e);
      bump(bySymbol.get(e.symbol) ?? bySymbol.set(e.symbol, { longUsd: 0, shortUsd: 0 }).get(e.symbol)!, e);
      bump(total, e);
    }
    const recent = all.sort((a, b) => b.t - a.t).slice(0, this.recentLimit);
    return {
      windowMs: this.windowMs,
      bucketMs: this.bucketMs,
      buckets: [...buckets.entries()].map(([t, v]) => ({ t, ...v })),
      byVenue: [...byVenue.entries()].map(([venue, v]) => ({ venue, ...v })).sort((a, b) => b.longUsd + b.shortUsd - (a.longUsd + a.shortUsd)),
      bySymbol: [...bySymbol.entries()].map(([symbol, v]) => ({ symbol, ...v })).sort((a, b) => b.longUsd + b.shortUsd - (a.longUsd + a.shortUsd)),
      total,
      recent,
    };
  }
}

/** The slice of a WebSocket the stream uses; tests pass a fake. */
export interface SocketLike {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  close(): void;
}

export interface ForceOrderStreamOptions {
  url: string;
  tracked: ReadonlySet<string>;
  buffer: LiquidationBuffer;
  createSocket: (url: string) => SocketLike;
  reconnectMs?: number;
  onEvent?: (event: LiquidationEvent) => void;
  onState?: (state: "open" | "closed" | "error", error?: Error) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
}

/** Keeps one socket open to `!forceOrder@arr` and reconnects after `reconnectMs` when it closes. */
export class ForceOrderStream {
  private socket: SocketLike | null = null;
  private stopped = false;
  private readonly reconnectMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;

  constructor(private readonly opts: ForceOrderStreamOptions) {
    this.reconnectMs = opts.reconnectMs ?? 5_000;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.socket?.close();
    this.socket = null;
  }

  private connect(): void {
    if (this.stopped) return;
    const url = `${this.opts.url.replace(/\/+$/, "")}/!forceOrder@arr`;
    const socket = this.opts.createSocket(url);
    this.socket = socket;
    socket.on("open", () => this.opts.onState?.("open"));
    socket.on("message", (data) => {
      const text = typeof data === "string" ? data : String(data);
      const event = parseForceOrder(text, this.opts.tracked);
      if (!event) return;
      if (this.opts.buffer.add([event]) > 0) this.opts.onEvent?.(event);
    });
    socket.on("error", (error) => this.opts.onState?.("error", error instanceof Error ? error : new Error(String(error))));
    socket.on("close", () => {
      this.opts.onState?.("closed");
      if (this.socket === socket) this.socket = null;
      if (!this.stopped) this.setTimer(() => this.connect(), this.reconnectMs);
    });
  }
}
