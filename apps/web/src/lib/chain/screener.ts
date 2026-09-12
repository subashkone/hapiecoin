// Options screener (roadmap item 11, ADR-076; HC-WS-110..112): the pure fold from the listed expiries' chains to one
// row per (expiry, strike, side) with the figures a trader screens on (premium per day, yield per day, IV against the
// expiry's own ATM, |delta|, break-even against spot, open interest), the per-expiry rows (ATM IV, 25Δ skew, expected
// move, OI, put/call ratio) and the filters. Display only: no money math for a ticket happens here (ADR-003 units).
import { type ChainRow, type Quote, type Underlying } from "@hapiecoin/schema";
import { type TradingCalendar, daysToExpiryOf, expectedMove } from "@hapiecoin/pricing";
import { atmIvOf, skew25, termShape } from "./structure";
import { chainTotals } from "./range";

export type ScreenSide = "call" | "put";
export type SideFilter = "both" | "call" | "put";
/** |Δ| bands as the chips read them. */
export const DELTA_BANDS = ["any", "≤0.10", "0.10–0.30", "0.30–0.50", ">0.50"] as const;
export type DeltaBand = (typeof DELTA_BANDS)[number];

/** Per-day figures are read over at least one hour, so an option settling within the hour stays finite. */
export const MIN_DAYS = 1 / 24;
/** Rows shown at once; the count says how many the filters left. */
export const SHOWN_ROWS = 100;

export interface StrikeRow {
  id: string;
  expiry: string;
  strike: string;
  side: ScreenSide;
  /** Days to settlement (fractional); rows at or past settlement are never built. */
  days: number;
  mark: number;
  iv: number | null;
  /** markIv minus the expiry's ATM IV, in vol points; null without either. */
  ivVsAtm: number | null;
  delta: number | null;
  /** mark ÷ max(days, MIN_DAYS): USD per underlying unit per day. */
  premiumPerDay: number;
  /** premiumPerDay ÷ spot × 100: percent of spot per day; null without spot. */
  yieldPerDay: number | null;
  /** (strike ± mark) ÷ spot − 1 in percent: + above spot for a call, − below for a put; null without spot. */
  breakEvenPct: number | null;
  /** Open interest in contracts; null when the venue sent none (GAPS #15): shown as "—", sorted last, never treated as 0. */
  oi: number | null;
}

export interface ExpiryRow {
  expiry: string;
  days: number;
  atmIv: number | null;
  skewPts: number | null;
  /** ± USD the ATM IV implies over the days left; null without spot or ATM IV. */
  expectedMove: number | null;
  expectedMovePct: number | null;
  callOi: number;
  putOi: number;
  pcr: number | null;
  strikes: number;
}

export interface ScreenInput {
  asset: Underlying;
  /** Listed expiries (ascending) and the rows of each chain that has arrived. */
  chains: ReadonlyMap<string, readonly ChainRow[]>;
  spot: number | null;
  nowMs: number;
  calendar: TradingCalendar;
}

export interface Screen {
  strikes: StrikeRow[];
  expiries: ExpiryRow[];
  /** Expiries whose chain has arrived, in listing order. */
  priced: string[];
  termShape: ReturnType<typeof termShape>;
}

function num(v: string | undefined): number | null {
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function strikeRow(expiry: string, strike: string, side: ScreenSide, q: Quote, days: number, atmIv: number | null, spot: number | null): StrikeRow | null {
  const mark = num(q.mark);
  if (mark === null) return null;
  const k = Number(strike);
  const iv = q.markIv !== undefined && Number.isFinite(q.markIv) ? q.markIv : null;
  const delta = q.greeks && Number.isFinite(q.greeks.delta) ? Math.abs(q.greeks.delta) : null;
  const premiumPerDay = mark / Math.max(days, MIN_DAYS);
  const be = side === "call" ? k + mark : k - mark;
  return {
    id: `${expiry}:${strike}:${side}`,
    expiry,
    strike,
    side,
    days,
    mark,
    iv,
    ivVsAtm: iv !== null && atmIv !== null ? (iv - atmIv) * 100 : null,
    delta,
    premiumPerDay,
    yieldPerDay: spot ? (premiumPerDay / spot) * 100 : null,
    breakEvenPct: spot ? (be / spot - 1) * 100 : null,
    oi: num(q.oi) ?? null,
  };
}

/** The whole board folded once: strike rows for every quoted option not yet settled, and one row per expiry. */
export function screen(input: ScreenInput): Screen {
  const strikes: StrikeRow[] = [];
  const expiries: ExpiryRow[] = [];
  const priced: string[] = [];
  const ivs: (number | null)[] = [];
  for (const [expiry, rows] of input.chains) {
    const days = daysToExpiryOf(input.calendar, input.nowMs, expiry);
    if (!(days > 0) || rows.length === 0) continue;
    priced.push(expiry);
    const atmIv = atmIvOf(rows, input.spot);
    ivs.push(atmIv);
    for (const r of rows) {
      if (r.call) {
        const row = strikeRow(expiry, r.strike, "call", r.call, days, atmIv, input.spot);
        if (row) strikes.push(row);
      }
      if (r.put) {
        const row = strikeRow(expiry, r.strike, "put", r.put, days, atmIv, input.spot);
        if (row) strikes.push(row);
      }
    }
    const totals = chainTotals(rows);
    const move = input.spot !== null && atmIv !== null ? expectedMove(input.spot, atmIv, days) : null;
    expiries.push({
      expiry,
      days,
      atmIv,
      skewPts: skew25(rows)?.skewPts ?? null,
      expectedMove: move,
      expectedMovePct: move !== null && input.spot ? (move / input.spot) * 100 : null,
      callOi: totals.callOi,
      putOi: totals.putOi,
      pcr: totals.pcr,
      strikes: rows.length,
    });
  }
  return { strikes, expiries, priced, termShape: termShape(ivs) };
}

export interface StrikeFilters {
  side: SideFilter;
  delta: DeltaBand;
  /** Expiries kept; an empty set keeps every expiry. */
  expiries: ReadonlySet<string>;
  minOi: number;
}

export const DEFAULT_FILTERS: StrikeFilters = { side: "both", delta: "any", expiries: new Set(), minOi: 0 };

/** Whether |Δ| falls in the band; a row without a delta fits only "any". */
export function inDeltaBand(delta: number | null, band: DeltaBand): boolean {
  if (band === "any") return true;
  if (delta === null) return false;
  switch (band) {
    case "≤0.10":
      return delta <= 0.1;
    case "0.10–0.30":
      return delta > 0.1 && delta <= 0.3;
    case "0.30–0.50":
      return delta > 0.3 && delta <= 0.5;
    case ">0.50":
      return delta > 0.5;
  }
}

export function filterStrikes(rows: readonly StrikeRow[], f: StrikeFilters): StrikeRow[] {
  return rows.filter((r) => (f.side === "both" || r.side === f.side) && inDeltaBand(r.delta, f.delta) && (f.expiries.size === 0 || f.expiries.has(r.expiry)) && (f.minOi <= 0 || (r.oi !== null && r.oi >= f.minOi)));
}
