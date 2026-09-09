/**
 * Liquidation streams and rolling aggregate. Binance pushes forced orders on `!forceOrder@arr` (at most one per
 * symbol per second); Bybit pushes `allLiquidation.{symbol}` frames on its public linear stream (every 500 ms,
 * ADR-041); OKX's recent filled liquidations are polled. All land in one ring buffer keyed by
 * (venue, ts, symbol, price, qty) so a re-poll does not double count, and `snapshot()` folds the window into the
 * hourly buckets, per-venue and per-symbol totals the Liquidations pages show (HC-MA-060..066).
 *
 * Binance frame (docs): { e: "forceOrder", o: { s: "BTCUSDT", S: "SELL"|"BUY", q, p, ap, T } } — a SELL forced order
 * closes a long, a BUY closes a short.
 * Bybit frame (docs, verified 09 Sep 2026): { topic: "allLiquidation.BTCUSDT", type: "snapshot", ts, data: [{ T, s, S:
 * "Buy"|"Sell", v, p }] } — S is the liquidated position side ("Buy" = a long was liquidated), v the size, p the
 * bankruptcy price (not the fill), so `usd` is an approximation on Bybit.
 */
import type { LiquidationEvent, LiquidationsData } from "@hapiecoin/schema";
import { z } from "zod";

const num = z.coerce.number();
export const ForceOrderFrame = z.looseObject({ e: z.literal("forceOrder"), o: z.looseObject({ s: z.string(), S: z.enum(["BUY", "SELL"]), q: num, p: num, ap: num.optional(), T: num }) });
export const BybitLiquidationFrame = z.looseObject({ topic: z.string().startsWith("allLiquidation."), data: z.array(z.looseObject({ T: num, s: z.string(), S: z.enum(["Buy", "Sell"]), v: num, p: num })) });

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

/** One Bybit frame carries several fills; subscribe acks and pongs parse to an empty list. */
export function parseBybitLiquidation(raw: string, tracked: ReadonlySet<string>): LiquidationEvent[] {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  const f = BybitLiquidationFrame.safeParse(json);
  if (!f.success) return [];
  const out: LiquidationEvent[] = [];
  for (const d of f.data.data) {
    const symbol = baseOf(d.s, tracked);
    if (!symbol) continue;
    out.push({ t: d.T, venue: "bybit", symbol, side: d.S === "Buy" ? "long" : "short", price: d.p, qty: d.v, usd: d.p * d.v });
  }
  return out;
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

/** The slice of a WebSocket the stream uses; tests pass a fake. `send` is only needed by venues that subscribe. */
export interface SocketLike {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  close(): void;
  send?(data: string): void;
}

export interface LiquidationStreamOptions {
  url: string;
  tracked: ReadonlySet<string>;
  buffer: LiquidationBuffer;
  createSocket: (url: string) => SocketLike;
  /** First reconnect delay; it doubles per failed attempt up to `maxReconnectMs` and resets once a socket opens. */
  reconnectMs?: number;
  maxReconnectMs?: number;
  onEvent?: (event: LiquidationEvent) => void;
  onState?: (state: "open" | "closed" | "error", error?: Error) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
}
export type ForceOrderStreamOptions = LiquidationStreamOptions;

/** What differs per venue: the path under the base URL, the frames to send on open, the parser, and the heartbeat. */
export interface VenueStreamSpec {
  venue: "binance" | "bybit";
  path: string;
  parse: (text: string, tracked: ReadonlySet<string>) => LiquidationEvent[];
  subscribe?: (tracked: ReadonlySet<string>) => string[];
  ping?: { message: string; everyMs: number };
}

export const BINANCE_STREAM: VenueStreamSpec = {
  venue: "binance",
  path: "/!forceOrder@arr",
  parse: (text, tracked) => {
    const e = parseForceOrder(text, tracked);
    return e ? [e] : [];
  },
};
/**
 * Bybit wants an explicit subscribe and a ping every 20 s or it drops the socket. One frame per symbol: Bybit rejects
 * a whole request when any topic is unknown (seen 09 Sep 2026 with PEPE, which trades there as 1000PEPEUSDT).
 */
export const BYBIT_STREAM: VenueStreamSpec = {
  venue: "bybit",
  path: "",
  parse: parseBybitLiquidation,
  subscribe: (tracked) => [...tracked].map((s) => JSON.stringify({ op: "subscribe", args: [`allLiquidation.${s}USDT`] })),
  ping: { message: JSON.stringify({ op: "ping" }), everyMs: 20_000 },
};

/** Keeps one socket open to a venue's liquidation feed and reconnects after `reconnectMs` when it closes. */
export class LiquidationStream {
  private socket: SocketLike | null = null;
  private stopped = false;
  private readonly reconnectMs: number;
  private readonly maxReconnectMs: number;
  private attempt = 0;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;

  constructor(
    private readonly spec: VenueStreamSpec,
    private readonly opts: LiquidationStreamOptions,
  ) {
    this.reconnectMs = opts.reconnectMs ?? 5_000;
    this.maxReconnectMs = opts.maxReconnectMs ?? 60_000;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  }

  /** Delay before the next attempt: reconnectMs × 2^attempt, capped, so a blocked venue does not spam the log. */
  nextDelay(): number {
    return Math.min(this.maxReconnectMs, this.reconnectMs * 2 ** this.attempt);
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
    const url = `${this.opts.url.replace(/\/+$/, "")}${this.spec.path}`;
    const socket = this.opts.createSocket(url);
    this.socket = socket;
    socket.on("open", () => {
      this.attempt = 0;
      for (const frame of this.spec.subscribe?.(this.opts.tracked) ?? []) socket.send?.(frame);
      if (this.spec.ping) this.schedulePing(socket, this.spec.ping);
      this.opts.onState?.("open");
    });
    socket.on("message", (data) => {
      const text = typeof data === "string" ? data : String(data);
      for (const event of this.spec.parse(text, this.opts.tracked)) if (this.opts.buffer.add([event]) > 0) this.opts.onEvent?.(event);
    });
    socket.on("error", (error) => this.opts.onState?.("error", error instanceof Error ? error : new Error(String(error))));
    socket.on("close", () => {
      this.opts.onState?.("closed");
      if (this.socket === socket) this.socket = null;
      if (!this.stopped) {
        const delay = this.nextDelay();
        this.attempt += 1;
        this.setTimer(() => this.connect(), delay);
      }
    });
  }

  /** Heartbeat loop bound to one socket: it ends by itself once that socket is replaced or the stream stops. */
  private schedulePing(socket: SocketLike, ping: { message: string; everyMs: number }): void {
    this.setTimer(() => {
      if (this.stopped || this.socket !== socket) return;
      socket.send?.(ping.message);
      this.schedulePing(socket, ping);
    }, ping.everyMs);
  }
}

/** Binance preset kept under its original name. */
export class ForceOrderStream extends LiquidationStream {
  constructor(opts: LiquidationStreamOptions) {
    super(BINANCE_STREAM, opts);
  }
}
export class BybitLiquidationStream extends LiquidationStream {
  constructor(opts: LiquidationStreamOptions) {
    super(BYBIT_STREAM, opts);
  }
}
