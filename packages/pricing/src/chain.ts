/**
 * Option-chain structure helpers (HC-WS-029, HC-WS-094, HC-WS-098, HC-WS-100, HC-SH-078, HC-WS-038).
 * Rows come straight from the venue instrument list per expiry (ADR-006); nothing here assumes a strike step.
 */

import type { ChainRow } from "./types.js";

export type PutCallBasis = "oi" | "volume";

export interface PainPoint {
  strike: number;
  /** Total option value paid out at expiry if the underlying settled at `strike`, in contracts × price units. */
  pain: number;
}

export interface GexPoint {
  strike: number;
  /** Dealer gamma exposure in quote currency per 1 % move (calls positive, puts negative). */
  gex: number;
}

export interface GammaExposureResult {
  byStrike: GexPoint[];
  net: number;
  /** First strike (ascending) at which the cumulative exposure changes sign, or null when it never flips. */
  flipStrike: number | null;
}

export interface SmilePoint {
  strike: number;
  iv: number;
}

const num = (value: number | undefined): number => (value === undefined || Number.isNaN(value) ? 0 : value);

function sortedRows(rows: readonly ChainRow[]): ChainRow[] {
  return [...rows].sort((a, b) => a.strike - b.strike);
}

/** Pain per candidate settlement strike: sum of call OI × max(K − Ki, 0) + put OI × max(Ki − K, 0). */
export function painProfile(rows: readonly ChainRow[]): PainPoint[] {
  const sorted = sortedRows(rows);
  return sorted.map((candidate) => {
    let pain = 0;
    for (const row of sorted) {
      pain += num(row.callOi) * Math.max(candidate.strike - row.strike, 0);
      pain += num(row.putOi) * Math.max(row.strike - candidate.strike, 0);
    }
    return { strike: candidate.strike, pain };
  });
}

/** Strike that minimises total option value at expiry (lowest strike wins a tie); NaN for an empty chain. */
export function maxPain(rows: readonly ChainRow[]): number {
  let best = NaN;
  let bestPain = Infinity;
  for (const point of painProfile(rows)) {
    if (point.pain < bestPain) {
      bestPain = point.pain;
      best = point.strike;
    }
  }
  return best;
}

/** Put/call ratio on open interest (default) or volume. Infinity when calls are zero and puts are not; NaN when both are zero. */
export function putCallRatio(rows: readonly ChainRow[], basis: PutCallBasis = "oi"): number {
  let calls = 0;
  let puts = 0;
  for (const row of rows) {
    calls += num(basis === "oi" ? row.callOi : row.callVolume);
    puts += num(basis === "oi" ? row.putOi : row.putVolume);
  }
  if (calls === 0) return puts === 0 ? NaN : Infinity;
  return puts / calls;
}

/**
 * Gamma exposure per strike in the dealer convention (customers long calls, short puts): gamma × OI (contracts)
 * × contractSize × spot² × 1 %, calls positive and puts negative.
 */
export function gammaExposure(rows: readonly ChainRow[], spot: number, contractSize: number): GammaExposureResult {
  const scale = contractSize * spot * spot * 0.01;
  const byStrike: GexPoint[] = sortedRows(rows).map((row) => ({
    strike: row.strike,
    gex: (num(row.callGamma) * num(row.callOi) - num(row.putGamma) * num(row.putOi)) * scale,
  }));
  let net = 0;
  let flipStrike: number | null = null;
  let lastSign = 0;
  for (const point of byStrike) {
    net += point.gex;
    const sign = Math.sign(net);
    if (sign === 0) continue;
    if (flipStrike === null && lastSign !== 0 && sign !== lastSign) flipStrike = point.strike;
    lastSign = sign;
  }
  return { byStrike, net, flipStrike };
}

/**
 * Volatility smile: one IV per strike, ascending. With `spot` the out-of-the-money side is used (puts below
 * the spot, calls at or above it), falling back to the other side; without it both sides are averaged.
 * Strikes with no finite IV on either side are skipped.
 */
export function smile(rows: readonly ChainRow[], spot?: number): SmilePoint[] {
  const out: SmilePoint[] = [];
  for (const row of sortedRows(rows)) {
    const call = row.callIv !== undefined && Number.isFinite(row.callIv) ? row.callIv : undefined;
    const put = row.putIv !== undefined && Number.isFinite(row.putIv) ? row.putIv : undefined;
    let iv: number | undefined;
    if (spot === undefined) {
      iv = call !== undefined && put !== undefined ? 0.5 * (call + put) : (call ?? put);
    } else {
      iv = row.strike < spot ? (put ?? call) : (call ?? put);
    }
    if (iv !== undefined) out.push({ strike: row.strike, iv });
  }
  return out;
}

/** One-sigma expected move over `days`: spot × iv × sqrt(days / 365); 0 for a non-positive horizon. */
export function expectedMove(spot: number, iv: number, days: number): number {
  if (!(days > 0)) return 0;
  return spot * iv * Math.sqrt(days / 365);
}

/** Forward implied by put-call parity at one strike: K + C − P (HC-WS-029 "Fwd"). */
export function impliedForward(strike: number, callPrice: number, putPrice: number): number {
  return strike + callPrice - putPrice;
}
