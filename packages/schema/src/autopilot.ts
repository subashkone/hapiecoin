/**
 * Autopilot (ADR-108; HC-TR-216..218): the server enters a PAPER strategy by itself when a playbook the trader
 * switched on has an entry on the latest marks, arms its exits, and keeps a log of what it did and what it left alone.
 * Paper only: nothing here can place an order on a venue. One open Autopilot trade per playbook, venue and asset; after
 * a trade ends the same playbook waits a cool-down before it may enter again.
 */
import { z } from "zod";
import { Id } from "./accounts.js";
import { DecimalString, IsoDateTime, Underlying, Venue } from "./primitives.js";

/**
 * How a winning Autopilot trade is taken off. Both start from the same level: a profit of AUTOPILOT_TARGET_PCT of the
 * most the structure can make, after the entry fee and the expected exit fee. `target` closes there; `trail` keeps
 * the trade from there and closes when it gives back AUTOPILOT_TRAIL_GIVE_PCT of its best (ADR-103).
 */
export const AUTOPILOT_EXIT_STYLES = ["trail", "target"] as const;
export const AutopilotExitStyle = z.enum(AUTOPILOT_EXIT_STYLES);
export type AutopilotExitStyle = z.infer<typeof AutopilotExitStyle>;
export const AUTOPILOT_EXIT_LABELS: Record<AutopilotExitStyle, string> = { trail: "Trail, give back 10 %", target: "Close at 10 % of the most it can make" };

/** The profit level both exit styles start from, as a share of the structure's maximum profit, net of both fees. */
export const AUTOPILOT_TARGET_PCT = 10;
/** The give-back of the trailing style, as a share of the best profit seen. */
export const AUTOPILOT_TRAIL_GIVE_PCT = "10";
/** After an Autopilot trade of a playbook ends, how long the same playbook, venue and asset waits before entering again. */
export const AUTOPILOT_COOLDOWN_MINUTES = 15;
/** A fresh structure is noted as a better entry than the open trade's when its net premium is better by at least this share. */
export const AUTOPILOT_BETTER_ENTRY_PCT = 10;

/** What Go live answers for a trade Autopilot opened: its exits were priced for the paper entry and must never send a real order. */
export const AUTOPILOT_PAPER_ONLY_MESSAGE = "An Autopilot trade stays on paper. Build the same strategy yourself to trade it live.";
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
