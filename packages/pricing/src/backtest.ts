/**
 * Strategy backtest over recorded end-of-day chains (ADR-077; HC-TR-184): a template is placed on each day's ladder
 * exactly as the Builder places it (materialiseTemplate around the same ATM row: the last strike at or below the spot),
 * held, and settled leg by leg at intrinsic value on the first recorded day on or after each leg's expiry date. A trade whose legs have not all settled by the last recorded day is
 * "open" and marked at that day: a recorded mark for the same instrument when the day's chain has it, otherwise
 * Black-76 at the day's ATM IV, which makes the trade "modelled". Nothing here is a forecast: every figure comes from
 * marks the venue published, and a modelled figure says so. Pure: no clock, no I/O.
 *
 * ADR-099 (HC-TR-200..202): a venue fee rule charges every fill and in-the-money settlement so P&L is net; entry
 * conditions (spot against an N-day average of the recorded spots, an IV-rank band from the recorded ATM IVs, UTC
 * weekdays) skip a day without a signal and count it; exit rules (target, stop, time stop) are judged once per
 * recorded day on recorded marks only, never on model prices, and a trade says why it ended. With none of these set
 * the output is exactly the ADR-077 engine's.
 *
 * ADR-100 (HC-TR-203): `folds` splits the shown range's entries into two or three contiguous equal-count periods,
 * each with the full stats shape, so a plan that only worked in the period it was fitted on can be seen.
 */
import { black76Price } from "./black76.js";
import { type TradingCalendar, daysToExpiryOf, yearFractionOf } from "./calendar.js";
import { type FeeRule, fillFee, settlementFee } from "./fees.js";
import { expiryExtremes } from "./strategy.js";
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
  /** Where the day's rows came from: recorded live at the settlement hour, reconstructed from the venue's candle history (no IV), or both (ADR-098). Absent means recorded. */
  source?: "snapshot" | "candles" | "mixed" | undefined;
}

/** Entry conditions: every one set must hold on the entry day; a day without enough history for one is "no signal". */
export interface BacktestConditions {
  /** Enter only when the spot is above (or below) the simple average of the last `days` recorded spots, today included. */
  sma?: { days: number; side: "above" | "below" } | undefined;
  /** Enter only when today's front-expiry ATM IV ranks inside [min, max] (0..100) against the recorded ATM IVs of the previous `lookbackDays` calendar days; needs IV_RANK_MIN_POINTS points. */
  ivRank?: { min?: number | undefined; max?: number | undefined; lookbackDays: number } | undefined;
  /** UTC weekdays allowed to enter, 0 (Sunday) to 6. */
  weekdays?: readonly number[] | undefined;
}
/** Exit rules, judged once per recorded day on recorded marks from the day after entry until the nearest leg settles. */
export interface BacktestExits {
  /** Close when the open profit reaches this share (0..1) of the structure's maximum profit, or of the net credit when the profit is unbounded. */
  targetPct?: number | undefined;
  /** Close when the open loss reaches this share (0..1) of the structure's maximum loss, or of the net premium when the loss is unbounded. */
  stopPct?: number | undefined;
  /** Close on the first recorded day with at most this many days left to the nearest leg's settlement. */
  timeStopDte?: number | undefined;
}
export type ExitReason = "settled" | "target" | "stop" | "time" | "open";
/** Recorded ATM IV points an IV-rank condition needs before it judges a day. */
export const IV_RANK_MIN_POINTS = 20;

export interface BacktestOptions {
  lots: number;
  /** Underlying units per lot (the venue's contract size for the asset). */
  unitsPerLot: number;
  /** The entry picks the nearest listed expiry with at least this many days left. */
  minDte: number;
  calendar: TradingCalendar;
  /** Entry days inside [from, to] (YYYY-MM-DD, inclusive); the whole range when absent. Days before `from` are still history for the conditions, and the coverage and equity describe the days from `from` on. */
  from?: string | undefined;
  to?: string | undefined;
  /** The venue's fee rule, charged on every fill and in-the-money settlement (ADR-099); absent or null charges nothing. */
  fees?: FeeRule | null | undefined;
  conditions?: BacktestConditions | undefined;
  exits?: BacktestExits | undefined;
  /** Walk-forward: split the entries of the shown range into this many contiguous equal-count periods (2 or 3), each with its own stats (ADR-100). */
  folds?: number | undefined;
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
  /** Realised P&L before fees. */
  grossPnl: number;
  /** Fees and tax on the entry fills, the exit fills or the in-the-money settlement; 0 when the run charges none. */
  fees: number;
  /** Why the trade ended: settled at expiry, a rule, or still open at the end of the data. */
  exitReason: ExitReason;
  /** True when a target or stop was requested but had no base for this trade, so it could not fire. */
  ruleInert: boolean;
  /** Realised P&L net of fees. */
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
  /** Net of fees. */
  total: number;
  /** Before fees. */
  grossTotal: number;
  /** Fees and tax over the closed trades. */
  totalFees: number;
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
  /** Of those, days reconstructed entirely from the venue's candle history (ADR-098). */
  reconstructedDays: number;
  /** Days on which a trade was entered. */
  entries: number;
  /** Entry days skipped: no listed expiry with `minDte` days left, the template did not fit the ladder, or an entry condition did not hold (or lacked history). */
  skipped: { noExpiry: number; noFit: number; noSignal: number };
  /** How the closed trades ended; `inert` counts trades whose requested target or stop had no base (a near-zero premium on an unbounded payoff), so the rule could never fire. */
  exits: { settled: number; target: number; stop: number; time: number; inert: number };
  openTrades: number;
  modelledTrades: number;
}

/** One walk-forward period: the trades entered in it and their stats (ADR-100). */
export interface BacktestFold {
  index: number;
  /** Entry days of the period's first and last trade; null for a period without entries. */
  firstDay: string | null;
  lastDay: string | null;
  entries: number;
  stats: BacktestStats;
}

export interface BacktestResult {
  trades: BacktestTrade[];
  /** Realised P&L, cumulative over closed trades, one point per recorded day. */
  equity: { day: string; pnl: number }[];
  stats: BacktestStats;
  coverage: BacktestCoverage;
  /** The walk-forward periods when `folds` was asked for. */
  folds?: BacktestFold[] | undefined;
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
  const skipped = { noExpiry: 0, noFit: 0, noSignal: 0 };
  const rule = opts.fees ?? null;
  const last = days.at(-1);
  for (let i = 0; i < days.length; i++) {
    const d = days[i]!;
    if ((opts.from && d.day < opts.from) || (opts.to && d.day > opts.to)) continue;
    if (opts.conditions && !entrySignal(days, i, opts.conditions)) {
      skipped.noSignal += 1;
      continue;
    }
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
    let fees = rule ? legs.reduce((sum, l) => sum + fillFee(l.kind, d.spot * l.quantity, l.price * l.quantity, rule), 0) : 0;
    let exitIdx = i;
    let closed = true;
    let exitReason: ExitReason = "settled";
    const settled = new Set<BacktestLeg>();
    // rule exits first (ADR-099): judged once per recorded day on recorded marks only, from the day after entry until
    // the nearest leg settles; a day where any leg has no recorded mark is not judged
    const ruled = opts.exits ? ruleExit(days, i, legs, opts.exits, opts.calendar) : null;
    const ruleInert = opts.exits ? ruleBases(legs, opts.exits).inert : false;
    if (ruled) {
      exitIdx = ruled.index;
      exitReason = ruled.reason;
      const x = days[exitIdx]!;
      for (const leg of legs) {
        leg.exitPrice = ruled.marks.get(leg)!;
        if (rule) fees += fillFee(leg.kind, x.spot * leg.quantity, leg.exitPrice * leg.quantity, rule);
      }
    } else {
      // settle each option leg on the first recorded day on or after its expiry date (a backfilled day may be stamped
      // before the settlement hour, so the date decides, not the instant); a future rides to the exit day
      for (const leg of legs) {
        if (leg.kind === "future") continue;
        const j = days.findIndex((x, k) => k > i && x.day >= leg.expiry);
        if (j < 0) {
          closed = false;
          continue;
        }
        leg.exitPrice = intrinsic(leg, days[j]!.spot);
        if (rule) fees += settlementFee(leg.kind, days[j]!.spot * leg.quantity, leg.exitPrice * leg.quantity, rule);
        settled.add(leg);
        if (j > exitIdx) exitIdx = j;
      }
    }
    let modelled = false;
    if (ruled) {
      // every leg left at the rule day's recorded marks
    } else if (closed) {
      for (const leg of legs) {
        if (leg.kind !== "future") continue;
        leg.exitPrice = days[exitIdx]!.spot;
        if (rule) fees += fillFee("future", leg.exitPrice * leg.quantity, 0, rule);
      }
    } else {
      // open: mark every leg at the last recorded day; no exit fee has been paid yet
      exitReason = "open";
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
    const grossPnl = legs.reduce((sum, l) => sum + sign(l.side) * l.quantity * (l.exitPrice - l.price), 0);
    const pnl = grossPnl - fees;
    const entryCost = legs.reduce((sum, l) => sum + (l.kind === "future" ? 0 : sign(l.side) * l.quantity * l.price), 0);
    trades.push({
      entryDay: d.day,
      exitDay: exit.day,
      expiry: target.expiry,
      legs,
      entryCost,
      grossPnl,
      fees,
      pnl,
      status: closed ? "closed" : "open",
      modelled,
      exitReason,
      ruleInert,
      daysHeld: Math.max(0, Math.round((exit.ts - d.ts) / 86_400_000)),
    });
  }
  const closedTrades = trades.filter((t) => t.status === "closed");
  const byExit = new Map<string, number>();
  for (const t of closedTrades) byExit.set(t.exitDay, (byExit.get(t.exitDay) ?? 0) + t.pnl);
  // the days the run describes: from `from` on (earlier days are history for the conditions only)
  const shown = opts.from ? days.filter((d) => d.day >= opts.from!) : days;
  let cum = 0;
  const equity = shown.map((d) => {
    cum += byExit.get(d.day) ?? 0;
    return { day: d.day, pnl: cum };
  });
  const stats = statsOf(closedTrades, equity.map((e) => e.pnl));
  const folds = opts.folds !== undefined && opts.folds >= 2 ? foldsOf(trades, opts.folds) : undefined;
  return {
    trades,
    equity,
    stats,
    ...(folds ? { folds } : {}),
    coverage: {
      firstDay: shown[0]?.day ?? null,
      lastDay: last?.day ?? null,
      days: shown.length,
      reconstructedDays: shown.filter((d) => d.source === "candles").length,
      entries: trades.length,
      skipped,
      openTrades: trades.length - closedTrades.length,
      modelledTrades: trades.filter((t) => t.modelled).length,
      exits: {
        settled: closedTrades.filter((t) => t.exitReason === "settled").length,
        target: closedTrades.filter((t) => t.exitReason === "target").length,
        stop: closedTrades.filter((t) => t.exitReason === "stop").length,
        time: closedTrades.filter((t) => t.exitReason === "time").length,
        inert: trades.filter((t) => t.ruleInert).length,
      },
    },
  };
}

/** The ATM IV of the nearest expiry still ahead on the day (else the first listed); null without an IV. */
export function frontAtmIv(d: EodDay): number | null {
  const listed = [...d.expiries].sort((a, b) => a.expiry.localeCompare(b.expiry));
  const front = listed.find((e) => e.expiry > d.day) ?? listed[0];
  return front ? atmIvOf(front.rows, d.spot) : null;
}

/** Whether every entry condition holds on day `i`; a condition without enough recorded history is false (no signal). */
export function entrySignal(days: readonly EodDay[], i: number, c: BacktestConditions): boolean {
  const d = days[i]!;
  if (c.weekdays && c.weekdays.length > 0 && !c.weekdays.includes(new Date(d.ts).getUTCDay())) return false;
  if (c.sma) {
    if (c.sma.days < 1 || i + 1 < c.sma.days) return false;
    let sum = 0;
    for (let k = i - c.sma.days + 1; k <= i; k++) sum += days[k]!.spot;
    const sma = sum / c.sma.days;
    if (c.sma.side === "above" ? !(d.spot > sma) : !(d.spot < sma)) return false;
  }
  if (c.ivRank) {
    const current = frontAtmIv(d);
    if (current === null) return false;
    const series: number[] = [];
    const cutoff = new Date(d.ts - c.ivRank.lookbackDays * 86_400_000).toISOString().slice(0, 10);
    for (let k = i - 1; k >= 0 && days[k]!.day >= cutoff; k--) {
      const v = frontAtmIv(days[k]!);
      if (v !== null) series.push(v);
    }
    if (series.length < IV_RANK_MIN_POINTS) return false;
    const low = Math.min(...series);
    const high = Math.max(...series);
    const rank = high > low ? ((current - low) / (high - low)) * 100 : 50;
    if (c.ivRank.min !== undefined && rank < c.ivRank.min) return false;
    if (c.ivRank.max !== undefined && rank > c.ivRank.max) return false;
  }
  return true;
}

/**
 * The first recorded day after entry on which an exit rule fires, with every leg's recorded mark that day; null when
 * none fires before the nearest leg settles. Target and stop are shares of the structure's expiry extremes (of the net
 * premium when the extreme is unbounded); the time stop counts days to the nearest leg's settlement. A day on which
 * any leg has no recorded mark is not judged.
 */
/**
 * The amounts a target and a stop fire at for a structure: shares of its expiry extremes, or of the net premium when
 * the extreme is unbounded. `inert` is true when a requested rule has no base (a near-zero premium on an unbounded
 * payoff), so it can never fire and the trade should say so.
 */
export function ruleBases(legs: readonly BacktestLeg[], exits: BacktestExits): { target: number | null; stop: number | null; inert: boolean } {
  const entryCost = legs.reduce((sum, l) => sum + (l.kind === "future" ? 0 : sign(l.side) * l.quantity * l.price), 0);
  const { maxProfit, maxLoss } = expiryExtremes(legs);
  const target = exits.targetPct === undefined ? null : exits.targetPct * (Number.isFinite(maxProfit) && maxProfit > 0 ? maxProfit : Math.abs(entryCost));
  const stop = exits.stopPct === undefined ? null : exits.stopPct * (Number.isFinite(maxLoss) && maxLoss < 0 ? -maxLoss : Math.abs(entryCost));
  const inert = (target !== null && !(target > 0)) || (stop !== null && !(stop > 0));
  return { target, stop, inert };
}

export function ruleExit(days: readonly EodDay[], i: number, legs: readonly BacktestLeg[], exits: BacktestExits, calendar: TradingCalendar): { index: number; reason: ExitReason; marks: Map<BacktestLeg, number> } | null {
  const nearest = legs.filter((l) => l.kind !== "future").map((l) => l.expiry).sort()[0];
  if (nearest === undefined) return null;
  const { target, stop } = ruleBases(legs, exits);
  for (let j = i + 1; j < days.length; j++) {
    const x = days[j]!;
    if (x.day >= nearest) break; // the nearest leg settles today: settlement decides
    const marks = new Map<BacktestLeg, number>();
    for (const leg of legs) {
      const m = recordedMark(x, leg);
      if (m === null) break;
      marks.set(leg, m);
    }
    if (marks.size !== legs.length) continue;
    const pnl = legs.reduce((sum, l) => sum + sign(l.side) * l.quantity * (marks.get(l)! - l.price), 0);
    if (target !== null && target > 0 && pnl >= target) return { index: j, reason: "target", marks };
    if (stop !== null && stop > 0 && pnl <= -stop) return { index: j, reason: "stop", marks };
    if (exits.timeStopDte !== undefined && daysToExpiryOf(calendar, x.ts, nearest) <= exits.timeStopDte) return { index: j, reason: "time", marks };
  }
  return null;
}

/** The statistics of a set of closed trades; `equityPnls` is the cumulative realised series the drawdown is read from. */
export function statsOf(closedTrades: readonly BacktestTrade[], equityPnls: readonly number[]): BacktestStats {
  const pnls = closedTrades.map((t) => t.pnl);
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const grossWin = wins.reduce((s, p) => s + p, 0);
  const grossLoss = -losses.reduce((s, p) => s + p, 0);
  return {
    trades: closedTrades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: pnls.length ? wins.length / pnls.length : null,
    total: pnls.reduce((s, p) => s + p, 0),
    grossTotal: closedTrades.reduce((s, t) => s + t.grossPnl, 0),
    totalFees: closedTrades.reduce((s, t) => s + t.fees, 0),
    average: pnls.length ? pnls.reduce((s, p) => s + p, 0) / pnls.length : null,
    median: median(pnls),
    best: pnls.length ? Math.max(...pnls) : null,
    worst: pnls.length ? Math.min(...pnls) : null,
    maxDrawdown: maxDrawdownOf(equityPnls),
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
  };
}

/**
 * Walk-forward periods (ADR-100): the trades, in entry order, cut into `count` contiguous segments of equal count
 * (the later segments take the extra trade when the count does not divide), each with the stats of its closed
 * trades and a drawdown read from its own cumulative P&L netted per exit day, as the headline figure is. A segment
 * with no trade has null days.
 */
export function foldsOf(trades: readonly BacktestTrade[], count: number): BacktestFold[] {
  const k = Math.max(2, Math.floor(count));
  const n = trades.length;
  const out: BacktestFold[] = [];
  for (let f = 0; f < k; f++) {
    const start = Math.floor((n * f) / k);
    const end = Math.floor((n * (f + 1)) / k);
    const slice = trades.slice(start, end);
    const closed = slice.filter((t) => t.status === "closed");
    const byDay = new Map<string, number>();
    for (const t of closed) byDay.set(t.exitDay, (byDay.get(t.exitDay) ?? 0) + t.pnl);
    let cum = 0;
    const equity = [...byDay.keys()].sort().map((day) => (cum += byDay.get(day)!));
    out.push({ index: f, firstDay: slice[0]?.entryDay ?? null, lastDay: slice.at(-1)?.entryDay ?? null, entries: slice.length, stats: statsOf(closed, equity) });
  }
  return out;
}
