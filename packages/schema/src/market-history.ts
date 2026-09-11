// Market history (ADR-056; GAPS #62, #31, #32): the ATM implied-volatility and spot series the API snapshotter records
// from the venue, and the derived IV rank / realised-vol figures the Vol tab, the header and the alerts read.
// Figures here are chart data (fractions and prices as numbers), never money.
import { z } from "zod";
import { IsoDate, IsoDateTime, Underlying, Venue } from "./primitives.js";

/** One day of the front-expiry ATM IV series: the last snapshot of that UTC day. */
export const IvPoint = z.strictObject({
  day: IsoDate,
  /** ATM implied volatility as a fraction (0.42 = 42 %). */
  atmIv: z.number().finite().nonnegative(),
  /** Underlying spot at that snapshot (USD). */
  spot: z.number().finite().positive(),
  /** The expiry the ATM IV was read from (the nearest listed with two or more days left). */
  expiry: IsoDate,
});
export type IvPoint = z.infer<typeof IvPoint>;

export const IvRank = z.strictObject({
  /** Where today's ATM IV sits between the 1-year low and high, 0..100. */
  rank: z.number().min(0).max(100),
  /** Share of the recorded days with an ATM IV at or below today's, 0..100. */
  percentile: z.number().min(0).max(100),
  low: z.number().finite().nonnegative(),
  high: z.number().finite().nonnegative(),
  /** Days of history behind the figures (365 once the series is a year old). */
  days: z.number().int().nonnegative(),
});
export type IvRank = z.infer<typeof IvRank>;

export const RealisedVol = z.strictObject({
  /** Annualised 30-day realised volatility of the spot closes, as a fraction. */
  rv30: z.number().finite().nonnegative(),
  /** Daily closes the figure is built on (30 once a month of history exists). */
  days: z.number().int().nonnegative(),
  /** ATM IV − realised vol, as a fraction (positive = options price more movement than realised). */
  spread: z.number().finite(),
});
export type RealisedVol = z.infer<typeof RealisedVol>;

export const IvHistory = z.strictObject({
  asset: Underlying,
  /** The venue the snapshots were taken on (ADR-065). */
  venue: Venue,
  /** Time of the newest snapshot; null when nothing has been recorded yet. */
  asOf: IsoDateTime.nullable(),
  current: z.strictObject({ atmIv: z.number().finite().nonnegative(), spot: z.number().finite().positive(), expiry: IsoDate, ts: IsoDateTime }).nullable(),
  /** Null until at least two days of history exist. */
  rank: IvRank.nullable(),
  /** Null until at least two daily closes exist. */
  realised: RealisedVol.nullable(),
  /** Spot high and low over the last 24 hours of snapshots (GAPS #31, partial). */
  spot24h: z.strictObject({ high: z.number().finite().positive(), low: z.number().finite().positive() }).nullable(),
  /** Daily points, oldest first, at most 365. */
  series: z.array(IvPoint).max(366),
});
export type IvHistory = z.infer<typeof IvHistory>;

export const MarkPoint = z.strictObject({
  ts: IsoDateTime,
  mark: z.number().finite().nonnegative(),
  /** Mark IV as a fraction; null when the venue quoted none. */
  markIv: z.number().finite().nonnegative().nullable(),
});
export type MarkPoint = z.infer<typeof MarkPoint>;
export const MarkHistory = z.strictObject({ symbol: z.string().min(1), venue: Venue, hours: z.number().int().positive(), points: z.array(MarkPoint) });
export type MarkHistory = z.infer<typeof MarkHistory>;

/** IV rank and percentile of `current` against `values` (the daily series); null with fewer than two points. */
export function ivRankOf(values: readonly number[], current: number): IvRank | null {
  if (values.length < 2) return null;
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  let atOrBelow = 0;
  for (const v of values) {
    if (v < low) low = v;
    if (v > high) high = v;
    if (v <= current) atOrBelow += 1;
  }
  const rank = high > low ? Math.min(100, Math.max(0, ((current - low) / (high - low)) * 100)) : 50;
  return { rank, percentile: (atOrBelow / values.length) * 100, low, high, days: values.length };
}

/** Annualised realised volatility from daily closes (sample stdev of log returns × √365); null with fewer than two closes. */
export function realisedVolOf(closes: readonly number[]): { rv: number; days: number } | null {
  if (closes.length < 2) return null;
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1];
    const b = closes[i];
    if (a !== undefined && b !== undefined && a > 0 && b > 0) returns.push(Math.log(b / a));
  }
  if (returns.length === 0) return null;
  if (returns.length === 1) return { rv: 0, days: closes.length };
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  return { rv: Math.sqrt(variance) * Math.sqrt(365), days: closes.length };
}

/** A one-line reading of the rank for the Vol tab (HC-WS-096 "interpretation line"). */
export function ivRankLabel(rank: number): string {
  if (rank < 20) return "Low · options are cheap against the year; buying premium is favoured";
  if (rank < 50) return "Below mid-range · premium is on the cheaper side";
  if (rank < 80) return "Above mid-range · premium is on the richer side";
  return "High · options are expensive against the year; selling premium is favoured";
}
