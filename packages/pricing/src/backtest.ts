/**
 * Strategy backtest over recorded end-of-day chains (ADR-077; HC-TR-184): a template is placed on each day's ladder
 * exactly as the Builder places it (materialiseTemplate around the same ATM row: the last strike at or below the spot),
 * held, and settled leg by leg at intrinsic value on the first recorded day on or after each leg's expiry date. A trade whose legs have not all settled by the last recorded day is
 * "open" and marked at that day: a recorded mark for the same instrument when the day's chain has it, otherwise
 * Black-76 at the day's ATM IV, which makes the trade "modelled". Nothing here is a forecast: every figure comes from
 * marks the venue published, and a modelled figure says so. Pure: no clock, no I/O.
 */
import { black76Price } from "./black76.js";
import { type TradingCalendar, daysToExpiryOf, yearFractionOf } from "./calendar.js";
import { type ChainStrike, type StrategyTemplate, materialiseTemplate } from "./templates.js";
import type { LegKind, Side } from "./types.js";

export interface EodQuote {
  mark: number;
  /** Mark IV as a fraction; absent when the venue quoted none. */
  iv?: number | undefined;
}
export interface EodRow {
  strike: number;
  call?: EodQuote | undefined;
  put?: EodQuote | undefined;
}
export interface EodExpiry {
  expiry: string;
  /** Ascending strikes. */
  rows: EodRow[];
}
/** One recorded end of day: the spot and every listed expiry's ladder at the venue's settlement hour. */
export interface EodDay {
  /** YYYY-MM-DD, UTC. */
  day: string;
  /** When the chain was recorded. */
  ts: number;
  spot: number;
  expiries: EodExpiry[];
}

export interface BacktestOptions {
  lots: number;
  /** Underlying units per lot (the venue's contract size for the asset). */
  unitsPerLot: number;
  /** The entry picks the nearest listed expiry with at least this many days left. */
  minDte: number;
  calendar: TradingCalendar;
  /** Entry days inside [from, to] (YYYY-MM-DD, inclusive); the whole range when absent. */
  from?: string | undefined;
  to?: string | undefined;
}

export interface BacktestLeg {
  kind: LegKind;
  side: Side;
  strike: number;
  expiry: string;
  /** Entry mark per underlying unit. */
  price: number;
  /** Underlying units. */
  quantity: number;
  /** What the leg settled at (intrinsic on its settlement day) or, for an open trade, was marked at on the last recorded day. */
  exitPrice: number;
}

export interface BacktestTrade {
  entryDay: string;
  /** The last leg's settlement day, or the last recorded day for an open trade. */
  exitDay: string;
  /** The expiry the template was placed on. */
  expiry: string;
  legs: BacktestLeg[];
  /** Net premium paid at entry (negative when the structure was sold for a credit), quote currency. */
  entryCost: number;
  pnl: number;
  status: "closed" | "open";
  /** Some leg of an open trade had no recorded mark on the last day and was valued with Black-76. */
  modelled: boolean;
  daysHeld: number;
}

export interface BacktestStats {
  trades: number;
  wins: number;
  losses: number;
  /** 0..1; null without a closed trade. */
  winRate: number | null;
  total: number;
  average: number | null;
  median: number | null;
  best: number | null;
  worst: number | null;
  /** Largest peak-to-trough fall of the realised equity curve (a non-negative amount). */
  maxDrawdown: number;
  /** Gross wins over gross losses; null without a losing trade. */
  profitFactor: number | null;
}

export interface BacktestCoverage {
  firstDay: string | null;
  lastDay: string | null;
  /** Recorded days in the whole set. */
  days: number;
  /** Days on which a trade was entered. */
  entries: number;
  /** Entry days skipped: no listed expiry with `minDte` days left, or the template did not fit the ladder. */
  skipped: { noExpiry: number; noFit: number };
  openTrades: number;
  modelledTrades: number;
}

export interface BacktestResult {
  trades: BacktestTrade[];
  /** Realised P&L, cumulative over closed trades, one point per recorded day. */
  equity: { day: string; pnl: number }[];
  stats: BacktestStats;
  coverage: BacktestCoverage;
}

const sign = (side: Side) => (side === "buy" ? 1 : -1);

/** The ATM index of a ladder, the Builder's rule (gateway reducer `atmIndex`): the last strike at or below the spot; 0 when the spot is below every strike; -1 for an empty ladder. */
export function atmIndexOf(rows: readonly { strike: number }[], spot: number): number {
  if (rows.length === 0) return -1;
  let idx = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.strike <= spot) idx = i;
    else break;
  }
  return idx;
}

/** ATM IV of a ladder: the mean of the quoted sides at the ATM strike; null when neither side has an IV. */
export function atmIvOf(rows: readonly EodRow[], spot: number): number | null {
  const row = rows[atmIndexOf(rows, spot)];
  if (!row) return null;
  const ivs = [row.call?.iv, row.put?.iv].filter((v): v is number => typeof v === "number" && v > 0);
  return ivs.length ? ivs.reduce((s, v) => s + v, 0) / ivs.length : null;
}

const toChainStrikes = (rows: readonly EodRow[]): ChainStrike[] =>
  rows.map((r) => ({
    strike: String(r.strike),
    call: r.call ? { mark: String(r.call.mark), markIv: r.call.iv } : undefined,
    put: r.put ? { mark: String(r.put.mark), markIv: r.put.iv } : undefined,
  }));

function recordedMark(day: EodDay, leg: BacktestLeg): number | null {
  if (leg.kind === "future") return day.spot;
  const exp = day.expiries.find((e) => e.expiry === leg.expiry);
  const row = exp?.rows.find((r) => r.strike === leg.strike);
  const q = leg.kind === "call" ? row?.call : row?.put;
  return q ? q.mark : null;
}

/** Settlement value of an option leg at the spot. */
function intrinsic(leg: BacktestLeg, spot: number): number {
  return leg.kind === "call" ? Math.max(spot - leg.strike, 0) : Math.max(leg.strike - spot, 0);
}

function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Largest fall from a running peak of a cumulative series that starts at 0. */
export function maxDrawdownOf(cumulative: readonly number[]): number {
  let peak = 0;
  let worst = 0;
  for (const v of cumulative) {
    if (v > peak) peak = v;
    if (peak - v > worst) worst = peak - v;
  }
  return worst;
}

export function runBacktest(tpl: StrategyTemplate, daysIn: readonly EodDay[], opts: BacktestOptions): BacktestResult {
  const days = [...daysIn].sort((a, b) => a.day.localeCompare(b.day));
  const trades: BacktestTrade[] = [];
  const skipped = { noExpiry: 0, noFit: 0 };
  const last = days.at(-1);
  for (let i = 0; i < days.length; i++) {
    const d = days[i]!;
    if ((opts.from && d.day < opts.from) || (opts.to && d.day > opts.to)) continue;
    const listed = [...d.expiries].sort((a, b) => a.expiry.localeCompare(b.expiry));
    const target = listed.find((e) => daysToExpiryOf(opts.calendar, d.ts, e.expiry) >= opts.minDte);
    if (!target) {
      skipped.noExpiry += 1;
      continue;
    }
    if (!tpl.legs.some((l) => l.kind !== "future")) {
      skipped.noFit += 1; // a perpetual alone has no expiry to hold to: nothing to backtest
      continue;
    }
    const rowsByExpiry: Record<string, { rows: ChainStrike[]; atm: number }> = {};
    for (const e of listed) rowsByExpiry[e.expiry] = { rows: toChainStrikes(e.rows), atm: atmIndexOf(e.rows, d.spot) };
    const mat = materialiseTemplate(tpl, {
      asset: "backtest",
      expiry: target.expiry,
      expiries: listed.map((e) => e.expiry),
      rows: rowsByExpiry[target.expiry]!.rows,
      atm: rowsByExpiry[target.expiry]!.atm,
      rowsByExpiry,
      lots: opts.lots,
      spot: String(d.spot),
    });
    if (!mat.ok) {
      skipped.noFit += 1;
      continue;
    }
    const legs: BacktestLeg[] = mat.legs.map((l) => ({
      kind: l.kind,
      side: l.side,
      strike: l.kind === "future" ? 0 : Number(l.strike),
      expiry: l.kind === "future" ? "" : l.expiry,
      price: Number(l.price),
      quantity: l.lots * opts.unitsPerLot,
      exitPrice: Number(l.price), // overwritten below: settled, or marked on the last day
    }));
    // settle each option leg on the first recorded day on or after its expiry date (a backfilled day may be stamped
    // before the settlement hour, so the date decides, not the instant); a future rides to the exit day
    let exitIdx = i;
    let closed = true;
    const settled = new Set<BacktestLeg>();
    for (const leg of legs) {
      if (leg.kind === "future") continue;
      const j = days.findIndex((x, k) => k > i && x.day >= leg.expiry);
      if (j < 0) {
        closed = false;
        continue;
      }
      leg.exitPrice = intrinsic(leg, days[j]!.spot);
      settled.add(leg);
      if (j > exitIdx) exitIdx = j;
    }
    let modelled = false;
    if (closed) {
      for (const leg of legs) if (leg.kind === "future") leg.exitPrice = days[exitIdx]!.spot;
    } else {
      // open: mark every leg at the last recorded day
      exitIdx = days.length - 1;
      const lastDay = days[exitIdx]!;
      const iv = new Map<string, number | null>();
      for (const leg of legs) {
        if (settled.has(leg)) continue; // settled before the data ended
        const rec = recordedMark(lastDay, leg);
        if (rec !== null) {
          leg.exitPrice = rec;
          continue;
        }
        modelled = true;
        const exp = lastDay.expiries.find((e) => e.expiry === leg.expiry);
        if (!iv.has(leg.expiry)) iv.set(leg.expiry, exp ? atmIvOf(exp.rows, lastDay.spot) : null);
        // the day's ATM IV, else the IV the leg was entered at; without either the leg is worth its intrinsic value
        const sigma = iv.get(leg.expiry) ?? mat.legs.find((l) => l.kind === leg.kind && Number(l.strike) === leg.strike && l.expiry === leg.expiry)?.iv ?? 0;
        leg.exitPrice = sigma > 0 ? black76Price(lastDay.spot, leg.strike, yearFractionOf(opts.calendar, lastDay.ts, leg.expiry), sigma, leg.kind === "call") : intrinsic(leg, lastDay.spot);
      }
    }
    const exit = days[exitIdx]!;
    const pnl = legs.reduce((s, l) => s + sign(l.side) * l.quantity * (l.exitPrice - l.price), 0);
    const entryCost = legs.reduce((s, l) => s + (l.kind === "future" ? 0 : sign(l.side) * l.quantity * l.price), 0);
    trades.push({
      entryDay: d.day,
      exitDay: exit.day,
      expiry: target.expiry,
      legs,
      entryCost,
      pnl,
      status: closed ? "closed" : "open",
      modelled,
      daysHeld: Math.max(0, Math.round((exit.ts - d.ts) / 86_400_000)),
    });
  }
  const closedTrades = trades.filter((t) => t.status === "closed");
  const byExit = new Map<string, number>();
  for (const t of closedTrades) byExit.set(t.exitDay, (byExit.get(t.exitDay) ?? 0) + t.pnl);
  let cum = 0;
  const equity = days.map((d) => {
    cum += byExit.get(d.day) ?? 0;
    return { day: d.day, pnl: cum };
  });
  const pnls = closedTrades.map((t) => t.pnl);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const grossWin = wins.reduce((s, p) => s + p, 0);
  const grossLoss = -losses.reduce((s, p) => s + p, 0);
  const stats: BacktestStats = {
    trades: closedTrades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: pnls.length ? wins.length / pnls.length : null,
    total: pnls.reduce((s, p) => s + p, 0),
    average: pnls.length ? pnls.reduce((s, p) => s + p, 0) / pnls.length : null,
    median: median(pnls),
    best: pnls.length ? Math.max(...pnls) : null,
    worst: pnls.length ? Math.min(...pnls) : null,
    maxDrawdown: maxDrawdownOf(equity.map((e) => e.pnl)),
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
  };
  return {
    trades,
    equity,
    stats,
    coverage: {
      firstDay: days[0]?.day ?? null,
      lastDay: last?.day ?? null,
      days: days.length,
      entries: trades.length,
      skipped,
      openTrades: trades.length - closedTrades.length,
      modelledTrades: trades.filter((t) => t.modelled).length,
    },
  };
}
