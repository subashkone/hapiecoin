// Derived series and tables for the derivatives, liquidations, screener and coin pages (HC-MA-041..048, 060..066,
// 084..087). Pure functions over the ingest snapshots (ADR-038) so the pages only render what these return.
import { ANALYTICS_VENUE_LABELS, type AnalyticsVenue, type FundingData, type LiquidationEvent, type LiquidationsData, type SeriesPoint, fundingApr } from "@hapiecoin/schema";

export const venueLabel = (v: string): string => (ANALYTICS_VENUE_LABELS as Record<string, string>)[v] ?? v;

/** CoinGecko's 7-day sparkline is hourly and ends at the snapshot time: give each value a timestamp. */
export function sparklineSeries(values: readonly number[], endAt: number, stepMs = 3600e3): SeriesPoint[] {
  return values.map((v, i) => ({ t: endAt - (values.length - 1 - i) * stepMs, v }));
}

/** The value of `other` nearest each `base` timestamp (within `tolMs`), else null, so two feeds share one x grid. */
export function alignTo(base: readonly SeriesPoint[], other: readonly SeriesPoint[], tolMs = 90 * 60e3): (number | null)[] {
  let j = 0;
  return base.map((b) => {
    while (j + 1 < other.length && Math.abs(other[j + 1]!.t - b.t) <= Math.abs(other[j]!.t - b.t)) j += 1;
    const o = other[j];
    return o && Math.abs(o.t - b.t) <= tolMs ? o.v : null;
  });
}

export interface LiqPoint {
  t: number;
  longUsd: number;
  shortUsd: number;
}
/** Long/short USD per bin over [from, now], filled from events (newest-first or any order). */
export function binEvents(events: readonly LiquidationEvent[], from: number, now: number, binMs: number, symbol?: string): LiqPoint[] {
  const start = Math.floor(from / binMs) * binMs;
  const bins = new Map<number, LiqPoint>();
  for (let t = start; t <= now; t += binMs) bins.set(t, { t, longUsd: 0, shortUsd: 0 });
  for (const e of events) {
    if (e.t < from || e.t > now || (symbol && e.symbol !== symbol)) continue;
    const b = bins.get(Math.floor(e.t / binMs) * binMs);
    if (!b) continue;
    if (e.side === "long") b.longUsd += e.usd;
    else b.shortUsd += e.usd;
  }
  return [...bins.values()];
}

export type LiqWindow = 1 | 4 | 12 | 24;
export const LIQ_WINDOWS: readonly LiqWindow[] = [1, 4, 12, 24];
/**
 * Bars for the liquidations chart (HC-MA-061, 062): the ingest's hourly buckets for 12 h and 24 h; for 1 h and 4 h
 * the recent events are re-binned at 5 / 15 minutes. `capped` says the event ring buffer did not reach the window start.
 */
export function liqWindow(data: Pick<LiquidationsData, "buckets" | "recent" | "bucketMs">, hours: LiqWindow, now = Date.now()): { points: LiqPoint[]; binMs: number; fromEvents: boolean; capped: boolean } {
  const from = now - hours * 3600e3;
  if (hours * 3600e3 >= data.bucketMs * 12) {
    const points = data.buckets.filter((b) => b.t + data.bucketMs > from).map((b) => ({ t: b.t, longUsd: b.longUsd, shortUsd: b.shortUsd }));
    return { points, binMs: data.bucketMs, fromEvents: false, capped: false };
  }
  const binMs = hours === 1 ? 5 * 60e3 : 15 * 60e3;
  const oldest = data.recent.reduce((m, e) => Math.min(m, e.t), Number.POSITIVE_INFINITY);
  return { points: binEvents(data.recent, from, now, binMs), binMs, fromEvents: true, capped: data.recent.length > 0 && oldest > from };
}

export interface HeatRow {
  /** Band offset from the current price in percent (+1 = 0..+1 % above, −1 = 0..−1 % below). */
  band: number;
  level: number;
  cells: number[];
}
/**
 * Captured liquidations by price band (±`bands` %) × hour (HC-MA-085). Shorts liquidate above price, longs below;
 * the grid keeps the side the venue reported and only places the band from the fill price.
 */
export function liqHeatmap(events: readonly LiquidationEvent[], symbol: string, price: number, now = Date.now(), hours = 12, bands = 5): { rows: HeatRow[]; hours: number[]; max: number; count: number } {
  const hourStarts: number[] = [];
  for (let h = hours - 1; h >= 0; h--) hourStarts.push(Math.floor((now - h * 3600e3) / 3600e3) * 3600e3);
  const rows: HeatRow[] = [];
  for (let k = bands; k >= -bands; k--) if (k !== 0) rows.push({ band: k, level: price * (1 + k / 100), cells: new Array<number>(hours).fill(0) });
  let max = 0;
  let count = 0;
  const from = hourStarts[0] ?? now;
  for (const e of events) {
    if (e.symbol !== symbol || e.t < from || e.t > now || price <= 0) continue;
    const d = (e.price / price - 1) * 100;
    const k = d >= 0 ? Math.min(bands, Math.max(1, Math.ceil(d))) : Math.max(-bands, Math.min(-1, Math.floor(d)));
    const row = rows.find((r) => r.band === k)!;
    const col = Math.min(hours - 1, Math.floor((e.t - from) / 3600e3));
    const v = (row.cells[col] ?? 0) + e.usd;
    row.cells[col] = v;
    max = Math.max(max, v);
    count += 1;
  }
  return { rows, hours: hourStarts, max, count };
}

export interface ArbRow {
  symbol: string;
  longLeg: AnalyticsVenue;
  shortLeg: AnalyticsVenue;
  longRate: number;
  shortRate: number;
  /** Per-8 h spread as a decimal fraction (short leg minus long leg). */
  spread: number;
  estApr: number;
  minOi: number | null;
}
/** Cross-venue funding spreads (HC-MA-048): long the venue paying the least, short the one paying the most. */
export function arbRows(fundings: readonly FundingData[]): ArbRow[] {
  const out: ArbRow[] = [];
  for (const f of fundings) {
    if (f.venues.length < 2) continue;
    const sorted = [...f.venues].sort((a, b) => a.rate - b.rate);
    const lo = sorted[0]!;
    const hi = sorted[sorted.length - 1]!;
    const spread = hi.rate - lo.rate;
    const ois = [lo.oiUsd, hi.oiUsd].filter((x): x is number => x !== null);
    out.push({ symbol: f.symbol, longLeg: lo.venue, shortLeg: hi.venue, longRate: lo.rate, shortRate: hi.rate, spread, estApr: fundingApr(spread), minOi: ois.length ? Math.min(...ois) : null });
  }
  return out.sort((a, b) => b.estApr - a.estApr);
}

/** "1h 05m" until the next funding settlement, "due" once passed, "—" when the venue did not say. */
export function nextFundingIn(at: number | null, now = Date.now()): string {
  if (at === null) return "—";
  const mins = Math.round((at - now) / 60e3);
  if (mins <= 0) return "due";
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}

/** Long share of a long/short ratio as a percent. */
export const longShare = (ratio: number): number => (ratio / (1 + ratio)) * 100;

/** Sum of the last `n` points' buy + sell, or null when there are none. */
export function takerVolume24h(points: readonly { buy: number; sell: number }[], n = 24): number | null {
  const tail = points.slice(-n);
  return tail.length ? tail.reduce((s, p) => s + p.buy + p.sell, 0) : null;
}
