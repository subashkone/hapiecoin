// Derived series and tables for the derivatives, liquidations, screener and coin pages (HC-MA-041..048, 060..066,
// 084..087). Pure functions over the ingest snapshots (ADR-038) so the pages only render what these return.
import { ANALYTICS_VENUE_LABELS, type AnalyticsVenue, type CycleData, type FundingData, type LiquidationEvent, type LiquidationsData, type SeriesPoint, fundingApr, rainbowBand } from "@hapiecoin/schema";

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

/** Rainbow band edges from the cycle fit: one region per adjacent multiplier pair, lowest first. */
export const RAINBOW_COLORS = ["hsl(240 60% 55%)", "hsl(200 70% 50%)", "hsl(170 60% 45%)", "hsl(140 60% 45%)", "hsl(80 60% 45%)", "hsl(35 90% 52%)", "hsl(20 85% 52%)", "hsl(5 75% 52%)", "hsl(0 72% 45%)"];
export function rainbowRegions(fit: readonly number[], multipliers: readonly number[], names: readonly string[]): { label: string; lower: number[]; upper: number[]; color: string }[] {
  const out: { label: string; lower: number[]; upper: number[]; color: string }[] = [];
  for (let k = 0; k + 1 < multipliers.length; k++) out.push({ label: names[k] ?? `Band ${k + 1}`, lower: fit.map((f) => f * multipliers[k]!), upper: fit.map((f) => f * multipliers[k + 1]!), color: RAINBOW_COLORS[k % RAINBOW_COLORS.length]! });
  return out;
}

/** Fear & Greed zones as chart bands (extreme fear · fear · greed · extreme greed). */
export const FG_BANDS = [
  { from: 0, to: 25, color: "hsl(var(--loss) / 0.12)", label: "Extreme fear" },
  { from: 25, to: 45, color: "hsl(var(--warning) / 0.08)", label: "Fear" },
  { from: 55, to: 75, color: "hsl(var(--profit) / 0.07)", label: "Greed" },
  { from: 75, to: 100, color: "hsl(var(--profit) / 0.14)", label: "Extreme greed" },
];

export interface CycleInputs {
  cycle: CycleData | undefined;
  fearGreed: number | null;
  /** BTC weekly RSI. */
  rsiWeekly: number | null;
  /** Max Coinbase premium (USD) over the last 24 hourly points. */
  premiumMax24h: number | null;
}
/**
 * Cycle-top checklist (HC-MA-074): the six signals we can compute plus AHR999 and Puell as "n/a" until their sources
 * land (GAPS #59). `hit` is null whenever the input is missing so the page never fakes a verdict.
 */
export function cycleChecklist(inp: CycleInputs, fmtPrice: (v: number) => string): { name: string; sub: string; value: string; hit: boolean | null }[] {
  const last = inp.cycle?.points.at(-1);
  const pi = last && last.ma111 !== null && last.ma350x2 !== null ? { ratio: last.ma111 / last.ma350x2, hit: last.ma111 >= last.ma350x2 } : null;
  const ma5 = last && last.ma2yX5 !== null ? { ratio: last.close / last.ma2yX5, hit: last.close > last.ma2yX5 } : null;
  const band = last && inp.cycle ? rainbowBand(last.close, last.fit, inp.cycle.rainbowMultipliers) : null;
  const topBand = inp.cycle ? inp.cycle.rainbowMultipliers.length - 2 : null;
  return [
    { name: "Pi Cycle Top", sub: last && last.ma111 !== null && last.ma350x2 !== null ? `111DMA ${fmtPrice(last.ma111)} vs 2×350DMA ${fmtPrice(last.ma350x2)}` : "needs 350 daily closes", value: pi ? `${(pi.ratio * 100).toFixed(0)}% of cross` : "—", hit: pi ? pi.hit : null },
    { name: "AHR999 > 4", sub: "Accumulation index · source pending (GAPS #59)", value: "n/a", hit: null },
    { name: "Puell > 4", sub: "Miner revenue multiple · needs on-chain data (GAPS #59)", value: "n/a", hit: null },
    { name: "2Y MA ×5", sub: last && last.ma2yX5 !== null ? `Price vs ${fmtPrice(last.ma2yX5)}` : "needs 730 daily closes", value: ma5 ? `${(ma5.ratio * 100).toFixed(0)}%` : "—", hit: ma5 ? ma5.hit : null },
    { name: "Rainbow top band", sub: band !== null && inp.cycle ? `Current band: ${inp.cycle.rainbowNames[band] ?? band}` : "needs the cycle dataset", value: band !== null && inp.cycle ? (inp.cycle.rainbowNames[band] ?? String(band)) : "—", hit: band !== null && topBand !== null ? band >= topBand : null },
    { name: "RSI 1w > 90", sub: "BTC weekly RSI", value: inp.rsiWeekly === null ? "—" : inp.rsiWeekly.toFixed(0), hit: inp.rsiWeekly === null ? null : inp.rsiWeekly > 90 },
    { name: "F&G > 90", sub: "Fear & Greed today", value: inp.fearGreed === null ? "—" : String(inp.fearGreed), hit: inp.fearGreed === null ? null : inp.fearGreed > 90 },
    { name: "Coinbase premium spike", sub: "24h max premium", value: inp.premiumMax24h === null ? "—" : `${inp.premiumMax24h >= 0 ? "+" : "-"}$${Math.abs(inp.premiumMax24h).toFixed(1)}`, hit: inp.premiumMax24h === null ? null : inp.premiumMax24h > 40 },
  ];
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
