// Pure derivations for the terminal pages (HC-MT-040..150): per-venue totals across the per-symbol snapshots, the
// coins of one venue, Fear & Greed lookbacks, long/short hourly readings, funding averages and the rainbow band.
// No fetching, no React: the pages call these on the snapshots they already hold.
import type { FundingData, LongShortData, OpenInterestData, SeriesPoint } from "@hapiecoin/schema";
import { fearGreedLabel, rainbowBand } from "@hapiecoin/schema";

export interface VenueTotal {
  venue: string;
  oiUsd: number;
  /** Symbols the venue reported open interest for. */
  coins: number;
  /** Share of the open interest summed over every venue and symbol, 0..1. */
  share: number;
}
/** Open interest per venue summed over the per-symbol snapshots, largest first. */
export function venueTotals(snaps: readonly Pick<OpenInterestData, "venues">[]): VenueTotal[] {
  const by = new Map<string, { oiUsd: number; coins: number }>();
  for (const s of snaps)
    for (const v of s.venues) {
      const g = by.get(v.venue) ?? { oiUsd: 0, coins: 0 };
      g.oiUsd += v.oiUsd;
      g.coins += 1;
      by.set(v.venue, g);
    }
  const total = [...by.values()].reduce((s, g) => s + g.oiUsd, 0);
  return [...by.entries()].map(([venue, g]) => ({ venue, oiUsd: g.oiUsd, coins: g.coins, share: total > 0 ? g.oiUsd / total : 0 })).sort((a, b) => b.oiUsd - a.oiUsd);
}

export interface VenueCoinRow {
  symbol: string;
  oiUsd: number | null;
  change24h: number | null;
  rate: number | null;
  predicted: number | null;
  apr: number | null;
}
/** One venue's rows across the tracked symbols: its open interest and funding for each coin it reports. */
export function venueCoins(venue: string, oi: readonly Pick<OpenInterestData, "symbol" | "venues">[], funding: readonly Pick<FundingData, "symbol" | "venues">[]): VenueCoinRow[] {
  const out = new Map<string, VenueCoinRow>();
  const row = (symbol: string) => {
    const r = out.get(symbol) ?? { symbol, oiUsd: null, change24h: null, rate: null, predicted: null, apr: null };
    out.set(symbol, r);
    return r;
  };
  for (const s of oi) {
    const v = s.venues.find((x) => x.venue === venue);
    if (!v) continue;
    const r = row(s.symbol);
    r.oiUsd = v.oiUsd;
    r.change24h = v.change24h;
  }
  for (const s of funding) {
    const v = s.venues.find((x) => x.venue === venue);
    if (!v) continue;
    const r = row(s.symbol);
    r.rate = v.rate;
    r.predicted = v.predicted;
    r.apr = v.apr;
  }
  return [...out.values()].sort((a, b) => (b.oiUsd ?? -1) - (a.oiUsd ?? -1));
}

export interface FgReading {
  value: number;
  label: string;
  t: number;
}
/** The daily Fear & Greed reading `daysBack` points before the newest one (0 = today). */
export function fgAt(points: readonly SeriesPoint[], daysBack: number): FgReading | null {
  const p = points[points.length - 1 - daysBack];
  return p ? { value: p.v, label: fearGreedLabel(p.v), t: p.t } : null;
}

export interface LsReading {
  t: number;
  global: number | null;
  topAccounts: number | null;
  topPositions: number | null;
}
/** The newest `n` long/short readings with the three series merged by timestamp, newest first. */
export function hourlyReadings(d: Pick<LongShortData, "global" | "topAccounts" | "topPositions">, n = 24): LsReading[] {
  const by = new Map<number, LsReading>();
  const put = (pts: readonly SeriesPoint[], key: "global" | "topAccounts" | "topPositions") => {
    for (const p of pts) {
      const r = by.get(p.t) ?? { t: p.t, global: null, topAccounts: null, topPositions: null };
      r[key] = p.v;
      by.set(p.t, r);
    }
  };
  put(d.global, "global");
  put(d.topAccounts, "topAccounts");
  put(d.topPositions, "topPositions");
  return [...by.values()].sort((a, b) => b.t - a.t).slice(0, n);
}

/** Plain mean of the venues' current funding rates; null when none reported. */
export function avgFunding(venues: readonly { rate: number | null }[]): number | null {
  const xs = venues.map((v) => v.rate).filter((r): r is number => r !== null && Number.isFinite(r));
  return xs.length ? xs.reduce((s, r) => s + r, 0) / xs.length : null;
}
/** 8-hourly rate annualised: × 3 settlements × 365 days (the same convention as the funding dataset's apr). */
export const annualised = (rate: number | null | undefined): number | null => (rate === null || rate === undefined ? null : rate * 3 * 365);

/** The rainbow band the close sits in, named; null until the fit exists. */
export function rainbowBandName(close: number, fit: number | null | undefined, multipliers: readonly number[], names: readonly string[]): string | null {
  if (fit === null || fit === undefined || !(fit > 0) || !(close > 0)) return null;
  return names[rainbowBand(close, fit, multipliers)] ?? null;
}

/** The coin with the most liquidations in the window. */
export function largestCoin(bySymbol: readonly { symbol: string; longUsd: number; shortUsd: number }[]): { symbol: string; usd: number } | null {
  let best: { symbol: string; usd: number } | null = null;
  for (const r of bySymbol) {
    const usd = r.longUsd + r.shortUsd;
    if (!best || usd > best.usd) best = { symbol: r.symbol, usd };
  }
  return best;
}

export const oiShare = (oi: number | null | undefined, total: number | null | undefined): number | null => (oi !== null && oi !== undefined && total ? oi / total : null);
