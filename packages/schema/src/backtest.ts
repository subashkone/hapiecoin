/**
 * Strategy backtest over recorded end-of-day chains (ADR-077; HC-TR-184, HC-TR-185): the query the Backtest tab sends
 * and the result the API answers. Money figures are decimal strings rounded to cents at the API edge; the pricing
 * package's `runBacktest` does the arithmetic.
 */
import { z } from "zod";
import { DecimalString, IsoDate, Underlying, Venue } from "./primitives.js";

export const BACKTEST_MIN_DTE = [1, 3, 7, 14, 30] as const;

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
  pnl: DecimalString,
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
  total: DecimalString,
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
    entries: z.number().int().nonnegative(),
    skipped: z.strictObject({ noExpiry: z.number().int().nonnegative(), noFit: z.number().int().nonnegative() }),
    openTrades: z.number().int().nonnegative(),
    modelledTrades: z.number().int().nonnegative(),
  }),
});
export type BacktestResult = z.infer<typeof BacktestResult>;
