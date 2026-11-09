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
});
export type BacktestQuery = z.infer<typeof BacktestQuery>;

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
});
export type BacktestResult = z.infer<typeof BacktestResult>;
