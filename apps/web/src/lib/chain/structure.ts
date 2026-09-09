// Pure helpers for the Scenarios, Vol and Structure tabs (HC-WS-088..100): the bridge from the gateway's
// chain rows to the pricing package's structure helpers, the scenario axes (price × date), the 25Δ skew and
// the heat shading rule. Every figure comes from @hapiecoin/pricing or the venue rows; nothing here prices.
import { type ChainRow as PricingRow, maxPain } from "@hapiecoin/pricing";
import type { ChainRow as SchemaRow } from "@hapiecoin/schema";

const MS_PER_DAY = 86_400_000;
const num = (v: string | number | undefined | null): number | undefined => {
  if (v === undefined || v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** Gateway rows (decimal strings, quotes per side) → the pricing package's structure rows (numbers). */
export function toPricingRows(rows: readonly SchemaRow[]): PricingRow[] {
  return rows.map((r) => ({
    strike: Number(r.strike),
    callOi: num(r.call?.oi),
    putOi: num(r.put?.oi),
    callVolume: num(r.call?.volume24h),
    putVolume: num(r.put?.volume24h),
    callIv: r.call?.markIv,
    putIv: r.put?.markIv,
    callGamma: r.call?.greeks?.gamma,
    putGamma: r.put?.greeks?.gamma,
  }));
}

/** The `n` strikes each side of the ATM index (the mock shows ±12); the whole list when ATM is unknown. */
export function aroundAtm<T>(rows: readonly T[], atm: number, n = 12): T[] {
  if (atm < 0) return [...rows];
  return rows.slice(Math.max(0, atm - n), Math.min(rows.length, atm + n + 1));
}

/** ATM implied volatility: the mean of the call and put mark IV on the strike nearest the spot; null without quotes. */
export function atmIvOf(rows: readonly SchemaRow[], spot: number | null): number | null {
  if (spot === null || rows.length === 0) return null;
  let best: SchemaRow | undefined;
  for (const r of rows) if (best === undefined || Math.abs(Number(r.strike) - spot) < Math.abs(Number(best.strike) - spot)) best = r;
  const ivs = [best?.call?.markIv, best?.put?.markIv].filter((v): v is number => v !== undefined && Number.isFinite(v));
  return ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;
}

export interface Skew25 {
  /** Strike and IV of the put nearest −0.25 delta and the call nearest +0.25 delta. */
  put: { strike: string; iv: number };
  call: { strike: string; iv: number };
  /** Put IV minus call IV, in vol points (positive = puts richer, the usual crypto skew). */
  skewPts: number;
}

/** 25-delta skew from the quotes' own deltas; null when either side lacks a delta and an IV. */
export function skew25(rows: readonly SchemaRow[]): Skew25 | null {
  let put: { strike: string; iv: number; d: number } | undefined;
  let call: { strike: string; iv: number; d: number } | undefined;
  for (const r of rows) {
    const pd = r.put?.greeks?.delta;
    const piv = r.put?.markIv;
    if (pd !== undefined && piv !== undefined && Number.isFinite(pd) && Number.isFinite(piv)) {
      const d = Math.abs(pd + 0.25);
      if (put === undefined || d < put.d) put = { strike: r.strike, iv: piv, d };
    }
    const cd = r.call?.greeks?.delta;
    const civ = r.call?.markIv;
    if (cd !== undefined && civ !== undefined && Number.isFinite(cd) && Number.isFinite(civ)) {
      const d = Math.abs(cd - 0.25);
      if (call === undefined || d < call.d) call = { strike: r.strike, iv: civ, d };
    }
  }
  if (!put || !call) return null;
  return { put: { strike: put.strike, iv: put.iv }, call: { strike: call.strike, iv: call.iv }, skewPts: (put.iv - call.iv) * 100 };
}

export type ScenarioRange = 10 | 20;
export const SCENARIO_RANGES: readonly ScenarioRange[] = [10, 20];

export interface ScenarioAxes {
  /** Percent moves from +range down to −range in range / 5 steps (11 rows). */
  pcts: number[];
  prices: number[];
  /** Calendar days ahead per column: today, ¼, ½, ¾ of the way, the day before expiry, expiry (de-duplicated). */
  days: number[];
  /** Valuation instants per column; the expiry column is the settlement instant when given. */
  dates: number[];
}

/** The price × date axes of the matrix (HC-WS-088). */
export function scenarioAxes(spot: number, range: ScenarioRange, maxDte: number, nowMs: number, expiryAtMs?: number): ScenarioAxes {
  const step = range / 5;
  const pcts: number[] = [];
  for (let p = range; p >= -range - 1e-9; p -= step) pcts.push(Number(p.toFixed(2)));
  const dte = Math.max(0, Math.ceil(maxDte));
  const raw = [0, Math.round(dte * 0.25), Math.round(dte * 0.5), Math.round(dte * 0.75), Math.max(0, dte - 1), dte];
  const days = [...new Set(raw)].sort((a, b) => a - b);
  const dates = days.map((d) => (d === dte && expiryAtMs !== undefined ? expiryAtMs : nowMs + d * MS_PER_DAY));
  return { pcts, prices: pcts.map((p) => spot * (1 + p / 100)), days, dates };
}

/** Index of the value nearest `target` (first on ties); −1 for an empty list. */
export function nearestIndex(values: readonly number[], target: number): number {
  let best = -1;
  let dist = Infinity;
  values.forEach((v, i) => {
    const d = Math.abs(v - target);
    if (d < dist) {
      dist = d;
      best = i;
    }
  });
  return best;
}

/** Cell shade: 0.1 at zero, 0.6 at the largest magnitude in the grid (the mock's rule). */
export function heatAlpha(v: number, vmax: number): number {
  if (!Number.isFinite(v) || vmax <= 0) return 0.1;
  return 0.1 + 0.5 * Math.min(1, Math.abs(v) / vmax);
}

export function gridMax(cells: readonly (readonly number[])[]): number {
  let m = 0;
  for (const row of cells) for (const v of row) if (Number.isFinite(v)) m = Math.max(m, Math.abs(v));
  return m || 1;
}

/** Positioning read of a put/call ratio (the mock's thresholds). */
export function pcrLabel(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return v > 1.2 ? "put-heavy" : v < 0.8 ? "call-heavy" : "balanced";
}

/** Contango (rising ATM IV with expiry) vs backwardation, from the front and back of the term structure. */
export function termShape(ivs: readonly (number | null)[]): "contango" | "backwardation" | "flat" | null {
  const xs = ivs.filter((v): v is number => v !== null && Number.isFinite(v));
  if (xs.length < 2) return null;
  const front = xs[0]!;
  const back = xs[xs.length - 1]!;
  if (Math.abs(back - front) < 0.005) return "flat";
  return back > front ? "contango" : "backwardation";
}

/** Chain footer figures (HC-WS-029, 080): max pain over the listed strikes, the 25Δ skew and the ATM forward. */
export interface ChainStats {
  maxPain: number | null;
  /** IV(25Δ put) − IV(25Δ call) in vol points. */
  skewPts: number | null;
  /** Forward from ATM put-call parity: K + C − P at the strike nearest spot with both marks. */
  fwd: number | null;
}
export function chainStats(rows: readonly SchemaRow[], spot: number | null): ChainStats {
  const priced = toPricingRows(rows);
  const mp = priced.length ? maxPain(priced) : Number.NaN;
  const sk = skew25(rows);
  let fwd: number | null = null;
  if (spot !== null && Number.isFinite(spot)) {
    let best: SchemaRow | null = null;
    for (const r of rows) {
      if (!r.call || !r.put) continue;
      const c = Number(r.call.mark);
      const p = Number(r.put.mark);
      if (!Number.isFinite(c) || !Number.isFinite(p) || c <= 0 || p <= 0) continue;
      if (!best || Math.abs(Number(r.strike) - spot) < Math.abs(Number(best.strike) - spot)) best = r;
    }
    if (best) fwd = Number(best.strike) + Number(best.call!.mark) - Number(best.put!.mark);
  }
  return { maxPain: Number.isFinite(mp) ? mp : null, skewPts: sk ? sk.skewPts : null, fwd };
}

/** The Δ chips of the chain toolbar (HC-WS-074), in percent of a unit delta. */
export const DELTA_CHIPS = [10, 16, 25, 50] as const;
export interface DeltaHit {
  strike: string;
  delta: number;
}
/** The call whose Δ is nearest +target and the put whose Δ is nearest −target over the whole chain (target 0..1). */
export function nearestDelta(rows: readonly SchemaRow[], target: number): { call: DeltaHit | null; put: DeltaHit | null } {
  let call: DeltaHit | null = null;
  let put: DeltaHit | null = null;
  for (const r of rows) {
    const cd = r.call?.greeks?.delta;
    if (cd !== undefined && Number.isFinite(cd) && (!call || Math.abs(cd - target) < Math.abs(call.delta - target))) call = { strike: r.strike, delta: cd };
    const pd = r.put?.greeks?.delta;
    if (pd !== undefined && Number.isFinite(pd) && (!put || Math.abs(pd + target) < Math.abs(put.delta + target))) put = { strike: r.strike, delta: pd };
  }
  return { call, put };
}
