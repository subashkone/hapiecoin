/**
 * Strategy backtest over recorded end-of-day chains (ADR-077; HC-TR-184, HC-TR-185): the query the Backtest tab sends
 * and the result the API answers. Money figures are decimal strings rounded to cents at the API edge; the pricing
 * package's `runBacktest` does the arithmetic.
 */
import { z } from "zod";
import { DecimalString, IsoDate, Underlying, Venue } from "./primitives.js";

export const BACKTEST_MIN_DTE = [1, 3, 7, 14, 30] as const;
/** Moving-average lengths the Rules row offers (ADR-099). */
export const BACKTEST_SMA_DAYS = [20, 50, 100, 200] as const;
export const BacktestFees = z.enum(["venue", "none"]);
export type BacktestFees = z.infer<typeof BacktestFees>;
export const BacktestExitReason = z.enum(["settled", "target", "stop", "time", "open"]);
export type BacktestExitReason = z.infer<typeof BacktestExitReason>;

export const BacktestQuery = z.object({
  asset: Underlying,
  /** A catalogue template name. */
  template: z.string().trim().min(1).max(60),
  lots: z.coerce.number().int().min(1).max(1000).default(10),
  /** The entry picks the nearest listed expiry with at least this many days left. */
  minDte: z.coerce.number().int().min(1).max(365).default(7),
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  venue: Venue.optional(),
  /** ADR-099: charge the venue's published fee rule (default) or nothing. */
  fees: BacktestFees.default("venue"),
  /** Enter only with the spot above or below the average of the last `smaDays` recorded spots (both or neither). */
  smaDays: z.coerce.number().int().min(2).max(400).optional(),
  smaSide: z.enum(["above", "below"]).optional(),
  /** IV-rank band, 0..100, against the recorded ATM IVs of the previous year. */
  ivRankMin: z.coerce.number().min(0).max(100).optional(),
  ivRankMax: z.coerce.number().min(0).max(100).optional(),
  /** UTC weekdays allowed to enter, 0 (Sunday) to 6, comma-separated. */
  weekdays: z.string().regex(/^[0-6](,[0-6]){0,6}$/).optional(),
  /** Exit rules in percent: of the max profit (or the credit), of the max loss (or the premium), and days to settlement. */
  targetPct: z.coerce.number().min(1).max(100).optional(),
  stopPct: z.coerce.number().min(1).max(500).optional(),
  timeStopDte: z.coerce.number().int().min(0).max(365).optional(),
  /** ADR-100: split the range's entries into this many contiguous equal-count periods, each with its own stats. */
  folds: z.coerce.number().int().min(2).max(3).optional(),
});
export type BacktestQuery = z.infer<typeof BacktestQuery>;

export const SWEEP_AXES = ["smaDays", "minDte", "targetPct", "stopPct", "timeStopDte"] as const;
export const SweepAxis = z.enum(SWEEP_AXES);
export type SweepAxis = z.infer<typeof SweepAxis>;
/** Up to eight comma-separated non-negative numbers; each is then checked against the axis's own field bounds (parseSweepValues). */
const SweepValues = z.string().regex(/^\d+(\.\d+)?(,\d+(\.\d+)?){0,7}$/);
/** The sweep (ADR-100; HC-TR-204): the single run's query plus one or two axes with their values; the route caps the grid at 48 trials. */
export const SweepQuery = BacktestQuery.omit({ folds: true }).extend({
  axis1: SweepAxis,
  values1: SweepValues,
  axis2: SweepAxis.optional(),
  values2: SweepValues.optional(),
});
export type SweepQuery = z.infer<typeof SweepQuery>;

/** The values of a swept axis, each validated against the same field the single run uses (bounds and integrality); null when any value fails or the list is not strictly increasing. */
export function parseSweepValues(axis: SweepAxis, raw: string): number[] | null {
  const field = BacktestQuery.shape[axis];
  const values = raw.split(",").map(Number);
  for (const [i, v] of values.entries()) {
    if (!field.safeParse(v).success) return null;
    if (i > 0 && !(v > values[i - 1]!)) return null;
  }
  return values;
}

export const BacktestLeg = z.strictObject({
  kind: z.enum(["call", "put", "future"]),
  side: z.enum(["buy", "sell"]),
  strike: DecimalString,
  expiry: z.string(),
  price: DecimalString,
  /** Underlying units. */
  quantity: DecimalString,
  exitPrice: DecimalString,
});
export type BacktestLeg = z.infer<typeof BacktestLeg>;

export const BacktestTrade = z.strictObject({
  entryDay: IsoDate,
  exitDay: IsoDate,
  expiry: IsoDate,
  legs: z.array(BacktestLeg),
  /** Net premium paid at entry; negative for a credit. */
  entryCost: DecimalString,
  /** Realised P&L before fees. */
  grossPnl: DecimalString,
  /** Fees and tax paid (entry fills, exit fills or the in-the-money settlement). */
  fees: DecimalString,
  /** Net of fees. */
  pnl: DecimalString,
  exitReason: BacktestExitReason,
  /** A requested target or stop had no base for this trade. */
  ruleInert: z.boolean(),
  status: z.enum(["closed", "open"]),
  /** An open trade valued with Black-76 on the last day because a recorded mark was missing. */
  modelled: z.boolean(),
  daysHeld: z.number().int().nonnegative(),
});
export type BacktestTrade = z.infer<typeof BacktestTrade>;

export const BacktestStats = z.strictObject({
  trades: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  /** 0..1; null without a closed trade. */
  winRate: z.number().min(0).max(1).nullable(),
  /** Net of fees. */
  total: DecimalString,
  grossTotal: DecimalString,
  totalFees: DecimalString,
  average: DecimalString.nullable(),
  median: DecimalString.nullable(),
  best: DecimalString.nullable(),
  worst: DecimalString.nullable(),
  maxDrawdown: DecimalString,
  profitFactor: z.number().nonnegative().nullable(),
});
export type BacktestStats = z.infer<typeof BacktestStats>;

/** One walk-forward period (ADR-100). */
export const BacktestFold = z.strictObject({
  index: z.number().int().nonnegative(),
  firstDay: IsoDate.nullable(),
  lastDay: IsoDate.nullable(),
  entries: z.number().int().nonnegative(),
  stats: BacktestStats,
});
export type BacktestFold = z.infer<typeof BacktestFold>;

export const BacktestResult = z.strictObject({
  asset: Underlying,
  venue: Venue,
  template: z.string(),
  lots: z.number().int().positive(),
  minDte: z.number().int().positive(),
  trades: z.array(BacktestTrade),
  /** Realised P&L, cumulative, one point per recorded day. */
  equity: z.array(z.strictObject({ day: IsoDate, pnl: DecimalString })),
  stats: BacktestStats,
  coverage: z.strictObject({
    firstDay: IsoDate.nullable(),
    lastDay: IsoDate.nullable(),
    days: z.number().int().nonnegative(),
    /** Days whose chain was reconstructed from the venue's candle history rather than recorded live (ADR-098). */
    reconstructedDays: z.number().int().nonnegative(),
    entries: z.number().int().nonnegative(),
    skipped: z.strictObject({ noExpiry: z.number().int().nonnegative(), noFit: z.number().int().nonnegative(), noSignal: z.number().int().nonnegative() }),
    openTrades: z.number().int().nonnegative(),
    modelledTrades: z.number().int().nonnegative(),
    /** `inert`: trades whose requested target or stop had no base (near-zero premium on an unbounded payoff) and so could never fire. */
    exits: z.strictObject({ settled: z.number().int().nonnegative(), target: z.number().int().nonnegative(), stop: z.number().int().nonnegative(), time: z.number().int().nonnegative(), inert: z.number().int().nonnegative() }),
  }),
  /** Which fee rule the figures are net of (ADR-099). */
  fees: BacktestFees,
  /** The walk-forward periods when `folds` was asked for (ADR-100). */
  folds: z.array(BacktestFold).optional(),
});
export type BacktestResult = z.infer<typeof BacktestResult>;

export const SweepTrial = z.strictObject({
  values: z.object({ smaDays: z.number().optional(), minDte: z.number().optional(), targetPct: z.number().optional(), stopPct: z.number().optional(), timeStopDte: z.number().optional() }),
  trades: z.number().int().nonnegative(),
  total: DecimalString,
  grossTotal: DecimalString,
  totalFees: DecimalString,
  winRate: z.number().min(0).max(1).nullable(),
  maxDrawdown: DecimalString,
  profitFactor: z.number().nonnegative().nullable(),
  /** Share of the grid neighbours that keep this trial's result (same sign, at least half the size); null without a result or neighbours. */
  plateau: z.number().min(0).max(1).nullable(),
});
export type SweepTrial = z.infer<typeof SweepTrial>;

export const SweepResult = z.strictObject({
  asset: Underlying,
  venue: Venue,
  template: z.string(),
  lots: z.number().int().positive(),
  fees: BacktestFees,
  axes: z.array(z.strictObject({ axis: SweepAxis, values: z.array(z.number()) })).min(1).max(2),
  /** Row-major: the first axis outer, the second inner. */
  trials: z.array(SweepTrial),
  /** Index of the best net total among the trials with a closed trade; null when none closed. */
  best: z.number().int().nonnegative().nullable(),
  /** The hard cap on trials per sweep. */
  cap: z.number().int().positive(),
});
export type SweepResult = z.infer<typeof SweepResult>;
