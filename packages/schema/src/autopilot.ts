/**
 * Autopilot (ADR-108; HC-TR-216..218): the server enters a PAPER strategy by itself when a playbook the trader
 * switched on has an entry on the latest marks, arms its exits, and keeps a log of what it did and what it left alone.
 * Paper only: nothing here can place an order on a venue. A playbook holds one trade per structure (the same strikes
 * and expiry are never held twice) and up to AUTOPILOT_MAX_OPEN structures on a venue and asset (ADR-110); between two
 * entries, and after a trade ends, the same playbook waits a cool-down.
 */
import { z } from "zod";
import { Id } from "./accounts.js";
import { DecimalString, IsoDateTime, Underlying, Venue } from "./primitives.js";

/**
 * How a winning Autopilot trade is taken off. Both start from the same level: a profit of AUTOPILOT_TARGET_PCT of the
 * most the structure can make, after the entry fee and the expected exit fee. `target` closes there; `trail` keeps
 * the trade from there and closes when it gives back AUTOPILOT_TRAIL_GIVE_PCT of its best (ADR-103).
 */
/** `own` (ADR-112): the playbook's own exits and nothing from Autopilot; the only style of a playbook entered by the clock. */
export const AUTOPILOT_EXIT_STYLES = ["trail", "target", "own"] as const;
export const AutopilotExitStyle = z.enum(AUTOPILOT_EXIT_STYLES);
export type AutopilotExitStyle = z.infer<typeof AutopilotExitStyle>;
/** The styles a trader chooses between on a playbook that takes Autopilot's profit exit. */
export const AUTOPILOT_CHOSEN_EXIT_STYLES = ["trail", "target"] as const satisfies readonly AutopilotExitStyle[];
export const AUTOPILOT_EXIT_LABELS: Record<AutopilotExitStyle, string> = { trail: "Trail, give back 10 %", target: "Close at 10 % of the most it can make", own: "Its own exits" };

/** The profit level both exit styles start from, as a share of the structure's maximum profit, net of both fees. */
export const AUTOPILOT_TARGET_PCT = 10;
/** The give-back of the trailing style, as a share of the best profit seen. */
export const AUTOPILOT_TRAIL_GIVE_PCT = "10";
/** After an Autopilot trade of a playbook is entered or ends, how long the same playbook, venue and asset waits before entering again. */
export const AUTOPILOT_COOLDOWN_MINUTES = 15;
/**
 * The most trades one playbook holds at a time on a venue and asset. ADR-110 allowed five, each on its own strikes;
 * ADR-112 set it back to one after the backtest of that ladder: the added trades lost on average on every structure.
 */
export const AUTOPILOT_MAX_OPEN = 1;
/** A fresh structure is noted as a better entry than the open trade's when its net premium is better by at least this share. */
export const AUTOPILOT_BETTER_ENTRY_PCT = 10;

/** What Go live answers for a trade Autopilot opened: its exits were priced for the paper entry and must never send a real order. */
export const AUTOPILOT_PAPER_ONLY_MESSAGE = "An Autopilot trade stays on paper. Build the same strategy yourself to trade it live.";
/** What deleting a trade Autopilot opened answers: its results count every trade, the losing ones too (ADR-111). */
export const AUTOPILOT_KEEP_MESSAGE = "An Autopilot trade is part of its results and cannot be deleted. Close it instead.";
/** Autopilot's log lines are kept this long. */
export const AUTOPILOT_RUNS_RETENTION_DAYS = 90;

/** One playbook the trader switched on, and how its winners are taken off. */
export const AutopilotStrategy = z.strictObject({ playbookId: z.string().trim().min(1).max(64), exit: AutopilotExitStyle });
export type AutopilotStrategy = z.infer<typeof AutopilotStrategy>;

/** PUT /v1/autopilot: the master switch and the playbooks switched on (each at most once). */
export const AutopilotSettings = z
  .strictObject({ enabled: z.boolean(), strategies: z.array(AutopilotStrategy).max(32) })
  .refine((s) => new Set(s.strategies.map((x) => x.playbookId)).size === s.strategies.length, { message: "A playbook can be switched on once", path: ["strategies"] });
export type AutopilotSettings = z.infer<typeof AutopilotSettings>;
export const DEFAULT_AUTOPILOT_SETTINGS: AutopilotSettings = { enabled: false, strategies: [] };

/**
 * What a log line records. entered: a paper trade was opened. skipped: a playbook that is switched on did not enter
 * (the reason says why; the same reason is written once, not on every pass). noted: while a trade was open, the
 * structure priced better than that trade's entry.
 */
export const AUTOPILOT_RUN_KINDS = ["entered", "skipped", "noted"] as const;
export const AutopilotRunKind = z.enum(AUTOPILOT_RUN_KINDS);
export type AutopilotRunKind = z.infer<typeof AutopilotRunKind>;

/** The figures of the structure at the moment of the line, in USD for the playbook's size; absent on a skip with no structure. */
export const AutopilotRunDetail = z.strictObject({
  spot: DecimalString.optional(),
  expiry: z.string().optional(),
  /** Whole days from the pass to the structure's expiry. */
  dte: z.number().int().optional(),
  /** Net premium paid (positive) or received (negative). */
  entryCost: DecimalString.optional(),
  maxProfit: DecimalString.nullable().optional(),
  maxLoss: DecimalString.nullable().optional(),
  /** Entry fee plus the expected exit fee. */
  fees: DecimalString.optional(),
  /** The capital the trade ties up: its maximum loss. */
  capital: DecimalString.nullable().optional(),
  exit: AutopilotExitStyle.optional(),
  /** The profit level the exit style starts from, fees included. */
  targetUsd: DecimalString.optional(),
  stopUsd: DecimalString.nullable().optional(),
  /** ADR-112: every sold option is closed on its own when its price reaches this multiple of the price it was sold at. */
  legStop: z.number().positive().optional(),
  legs: z.array(z.strictObject({ side: z.enum(["buy", "sell"]), kind: z.enum(["call", "put", "future"]), strike: z.string(), price: z.string() })).optional(),
  /** noted: the open trade's net premium the fresh one is compared with. */
  openEntryCost: DecimalString.optional(),
});
export type AutopilotRunDetail = z.infer<typeof AutopilotRunDetail>;

export const AutopilotRun = z.strictObject({
  id: z.string(),
  at: IsoDateTime,
  playbookId: z.string(),
  venue: Venue,
  asset: Underlying,
  kind: AutopilotRunKind,
  reason: z.string(),
  strategyId: Id.nullable(),
  detail: AutopilotRunDetail,
});
export type AutopilotRun = z.infer<typeof AutopilotRun>;

/** GET /v1/autopilot: the trader's settings and the newest log lines. */
export const AutopilotView = z.strictObject({ settings: AutopilotSettings, runs: z.array(AutopilotRun) });
export type AutopilotView = z.infer<typeof AutopilotView>;

// ---- results (ADR-111): what the trades Autopilot opened came to ----------------------------------------------------

/** Days from entry to expiry, in the bands the results are read by: the day of expiry and the day before, the week, the month, further out. */
export const AUTOPILOT_DTE_BANDS = ["0-1", "2-7", "8-30", "31+"] as const;
export const AutopilotDteBand = z.enum(AUTOPILOT_DTE_BANDS);
export type AutopilotDteBand = z.infer<typeof AutopilotDteBand>;
export const AUTOPILOT_DTE_BAND_LABELS: Record<AutopilotDteBand, string> = { "0-1": "Expiry day or the day before", "2-7": "2 to 7 days", "8-30": "8 to 30 days", "31+": "More than 30 days" };
export function autopilotDteBand(dte: number): AutopilotDteBand {
  return dte <= 1 ? "0-1" : dte <= 7 ? "2-7" : dte <= 30 ? "8-30" : "31+";
}

/**
 * A count of trades and what they came to. `grossUsd` is the P&L at the marks the trades were closed on; `feesUsd` is
 * the entry fee plus the exit fee expected at entry (an estimate: the paper book charges none); `netUsd` is the first
 * less the second. A win is a closed trade whose net is above zero. Only closed trades carry money.
 */
const tally = { open: z.number().int().nonnegative(), closed: z.number().int().nonnegative(), wins: z.number().int().nonnegative(), grossUsd: DecimalString, feesUsd: DecimalString, netUsd: DecimalString };

/** One playbook on one asset with one exit style. */
export const AutopilotResultRow = z.strictObject({
  playbookId: z.string(),
  asset: Underlying,
  exit: AutopilotExitStyle,
  ...tally,
  /** The best and the worst closed trade, net; null with none closed. */
  bestNetUsd: DecimalString.nullable(),
  worstNetUsd: DecimalString.nullable(),
  /** The mean time a closed trade was held, in minutes; null with none closed. */
  avgHoldMinutes: z.number().int().nonnegative().nullable(),
  /** How the closed trades ended, by close reason. */
  reasons: z.record(z.string(), z.number().int().positive()),
});
export type AutopilotResultRow = z.infer<typeof AutopilotResultRow>;

export const AutopilotDteRow = z.strictObject({ band: AutopilotDteBand, ...tally });
export type AutopilotDteRow = z.infer<typeof AutopilotDteRow>;

/** One closed trade, newest first in the list. */
export const AutopilotClosedTrade = z.strictObject({
  strategyId: Id,
  playbookId: z.string(),
  asset: Underlying,
  exit: AutopilotExitStyle,
  /** The strikes it sat on, in leg order, and its expiry. */
  strikes: z.array(z.string()),
  expiry: z.string().nullable(),
  dte: z.number().int().nullable(),
  openedAt: IsoDateTime,
  closedAt: IsoDateTime,
  closeReason: z.string().nullable(),
  grossUsd: DecimalString,
  feesUsd: DecimalString,
  netUsd: DecimalString,
});
export type AutopilotClosedTrade = z.infer<typeof AutopilotClosedTrade>;

/** GET /v1/autopilot/results: every trade Autopilot entered that the log still holds (AUTOPILOT_RUNS_RETENTION_DAYS). */
export const AutopilotResults = z.strictObject({
  /** The oldest entry counted, or null with none. */
  since: IsoDateTime.nullable(),
  total: z.strictObject(tally),
  rows: z.array(AutopilotResultRow),
  byDte: z.array(AutopilotDteRow),
  /** The newest closed trades. */
  trades: z.array(AutopilotClosedTrade),
});
export type AutopilotResults = z.infer<typeof AutopilotResults>;
