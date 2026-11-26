// The exchange's public mark candles, downloaded once and kept (ADR-144; HC-TR-287). A backtest in the app reads the
// prices of an option (or of the perpetual, for the spot) through `marksOf`: from the table when the range asked for
// is already there, from the venue otherwise, in windows the venue's cap on a response allows. Public data: no key,
// read-only toward the venue, spaced under four requests a second. Nothing past "now" is kept: a series asked for
// beyond the present comes back padded with its last price (GAPS #179), and a bar still forming is not a price.
import type { SavedBacktestResolution, Venue } from "@hapiecoin/schema";
import type { Candle } from "@hapiecoin/venues";
import { and, eq } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { markCandles } from "./db/schema.js";

export const RESOLUTION_MS: Record<SavedBacktestResolution, number> = { "5m": 5 * 60_000, "1h": 3_600_000 };
/** Bars asked for in one request (the venue caps a response at 2,000). */
export const CANDLES_PER_REQUEST = 1_900;
/** Minimum gap between two candle requests (under four a second), as the nightly chain history keeps. */
export const CANDLE_MIN_GAP_MS = 270;

export interface MarkSource {
  candles: (params: { symbol: string; resolution: SavedBacktestResolution; start: number; end: number }) => Promise<Candle[]>;
}

/** A source that spaces requests `minGapMs` apart and makes up to three attempts per request; counts every attempt. */
export function spacedSource(source: MarkSource, opts: { minGapMs?: number | undefined; now?: (() => number) | undefined; sleep?: ((ms: number) => Promise<void>) | undefined } = {}): MarkSource & { requests: () => number } {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const gap = opts.minGapMs ?? CANDLE_MIN_GAP_MS;
  let last = -Infinity;
  let requests = 0;
  // one request at a time, whoever asks: two runs at once share the gap instead of each keeping its own
  let queue: Promise<unknown> = Promise.resolve();
  const ask = async (params: Parameters<MarkSource["candles"]>[0]): Promise<Candle[]> => {
    for (let attempt = 1; ; attempt++) {
      const wait = gap - (now() - last);
      if (wait > 0) await sleep(wait);
      last = now();
      requests += 1;
      try {
        return await source.candles(params);
      } catch (e) {
        if (attempt >= 3) throw e;
        await sleep(2_000 * attempt);
      }
    }
  };
  return {
    requests: () => requests,
    candles: (params) => {
      const mine = queue.then(() => ask(params));
      queue = mine.catch(() => undefined);
      return mine;
    },
  };
}

/** The usable bars of a response, oldest first: a close that is a number above zero, of a bar that had closed by `nowMs`. */
export function barsOf(candles: readonly Candle[], resolution: SavedBacktestResolution, nowMs: number): [number, number][] {
  const byTime = new Map<number, number>();
  for (const c of candles) {
    const close = Number(c.close);
    if (Number.isFinite(close) && close > 0 && c.time * 1000 + RESOLUTION_MS[resolution] <= nowMs) byTime.set(c.time, close);
  }
  return [...byTime.entries()].sort((a, b) => a[0] - b[0]);
}

/**
 * The marks of one series over [fromMs, toMs] as a map from an instant (epoch ms) to the price that held then: the
 * close of the bar that ends at that instant. Read from the table when it holds the range; otherwise the part of the
 * range the row does not hold is downloaded and joined to it (the row stays one unbroken range, and a bar once held is
 * never dropped).
 */
export async function marksOf(db: Db, source: MarkSource, key: { venue: Venue; symbol: string; resolution: SavedBacktestResolution }, fromMs: number, toMs: number, nowMs: number): Promise<Map<number, number>> {
  const step = RESOLUTION_MS[key.resolution];
  const from = Math.floor(fromMs / step) * step;
  // nothing is asked for beyond the last bar that has closed
  const to = Math.min(Math.ceil(toMs / step) * step, Math.floor(nowMs / step) * step);
  const where = and(eq(markCandles.venue, key.venue), eq(markCandles.symbol, key.symbol), eq(markCandles.resolution, key.resolution));
  const [held] = await db.select().from(markCandles).where(where).limit(1);
  let bars = held?.bars ?? [];
  if (to > from && !(held && held.fromMs <= from && held.toMs >= to)) {
    const start = Math.min(from, held?.fromMs ?? from);
    const end = Math.max(to, held?.toMs ?? to);
    // only what the row does not hold yet is asked for: before its range and after it
    const missing: [number, number][] = held ? [[start, held.fromMs] as [number, number], [held.toMs, end] as [number, number]].filter(([a, b]) => b > a) : [[start, end]];
    const got: Candle[] = [];
    for (const [a, b] of missing) for (let at = a; at < b; at += CANDLES_PER_REQUEST * step) got.push(...(await source.candles({ symbol: key.symbol, resolution: key.resolution, start: Math.floor(at / 1000), end: Math.floor(Math.min(b, at + CANDLES_PER_REQUEST * step) / 1000) })));
    // joined with the bars already held, which a short answer from the venue can never take away
    const joined = new Map<number, number>(bars);
    for (const [time, close] of barsOf(got, key.resolution, nowMs)) if (time * 1000 >= start - step && time * 1000 < end) joined.set(time, close);
    bars = [...joined.entries()].sort((x, y) => x[0] - y[0]);
    const fetchedAt = new Date(nowMs);
    await db.insert(markCandles).values({ ...key, fromMs: start, toMs: end, bars, fetchedAt }).onConflictDoUpdate({ target: [markCandles.venue, markCandles.symbol, markCandles.resolution], set: { fromMs: start, toMs: end, bars, fetchedAt } });
  }
  const out = new Map<number, number>();
  for (const [time, close] of bars) out.set(time * 1000 + step, close);
  return out;
}
