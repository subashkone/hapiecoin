// Pure helpers for the chain layout (HC-WS-016, HC-WS-019, HC-WS-020). They only slice or classify the
// rows the gateway sent; nothing here creates a strike (ADR-006).

/** Strike-range setting: strikes each side of the ATM row, or 0 for every listed strike. */
export type ChainRange = 6 | 12 | 0;
export const CHAIN_RANGES: readonly ChainRange[] = [6, 12, 0];

export function isChainRange(value: unknown): value is ChainRange {
  return value === 6 || value === 12 || value === 0;
}

export interface RangeSlice<T> {
  rows: T[];
  /** Index in the full list of the first row kept. */
  offset: number;
  /** ATM index inside `rows`, or -1 when the chain has no ATM row. */
  atm: number;
}

/**
 * Keep `range` strikes on each side of the ATM row (all rows when `range` is 0 or there is no ATM).
 * The slice is clamped to the list, so a chain with 5 rows and ±12 returns all 5.
 */
export function sliceAroundAtm<T>(rows: readonly T[], atm: number, range: ChainRange): RangeSlice<T> {
  if (range === 0 || atm < 0 || atm >= rows.length) return { rows: [...rows], offset: 0, atm };
  const start = Math.max(0, atm - range);
  const end = Math.min(rows.length, atm + range + 1);
  return { rows: rows.slice(start, end), offset: start, atm: atm - start };
}

/**
 * In-the-money side for a strike given spot: calls are ITM below spot, puts above it. A strike equal to
 * spot is at the money on both sides (null).
 */
export function itmSide(strike: string, spot: string | undefined): "call" | "put" | null {
  if (spot === undefined) return null;
  const k = Number(strike);
  const s = Number(spot);
  if (!Number.isFinite(k) || !Number.isFinite(s) || k === s) return null;
  return k < s ? "call" : "put";
}

/** A side's open interest as read from a quote: `oi` is absent when the venue sent none (GAPS #15). */
type OiSide = { oi?: string | undefined } | undefined;

/** Largest open interest across both sides of the given rows (for the OI bars); 0 when nothing is quoted. */
export function maxOpenInterest(rows: readonly { call?: OiSide; put?: OiSide }[]): number {
  let max = 0;
  for (const r of rows) {
    for (const q of [r.call, r.put]) {
      const n = q?.oi !== undefined ? Number(q.oi) : 0;
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return max;
}

/** Width of an OI bar in percent of its cell (0–100) relative to the chain's largest OI. */
export function oiBarPercent(oi: string | undefined, max: number): number {
  if (oi === undefined || max <= 0) return 0;
  const n = Number(oi);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(100, Math.round((n / max) * 100));
}

export interface ChainTotals {
  callOi: number;
  putOi: number;
  /** Put/call ratio by open interest, or null when there is no call OI. */
  pcr: number | null;
}

/** Σ call OI, Σ put OI and their ratio over the given rows (display only, no money math); a side without a figure adds nothing. */
export function chainTotals(rows: readonly { call?: OiSide; put?: OiSide }[]): ChainTotals {
  let callOi = 0;
  let putOi = 0;
  for (const r of rows) {
    const c = r.call?.oi !== undefined ? Number(r.call.oi) : 0;
    const p = r.put?.oi !== undefined ? Number(r.put.oi) : 0;
    if (Number.isFinite(c)) callOi += c;
    if (Number.isFinite(p)) putOi += p;
  }
  return { callOi, putOi, pcr: callOi > 0 ? putOi / callOi : null };
}

/** Mirrored horizontal offset: when calls are scrolled to `x`, puts sit at `max − x` so the same column faces the strike. */
export function mirrorOffset(x: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(max, Math.max(0, max - x));
}

/** Clamp a horizontal offset into [0, max]. */
export function clampOffset(x: number, max: number): number {
  if (max <= 0 || !Number.isFinite(x)) return 0;
  return Math.min(max, Math.max(0, x));
}
