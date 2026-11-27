/**
 * The mandate a trader signs before Autopilot may trade a saved strategy live for them (ADR-147; HC-TR-296..298;
 * docs/design/autopilot-strategy-builder.md 3.5). Per trader, per version of a strategy and per exchange account: the
 * lots per trade, the most capital it may use, a loss limit for the day and for the week, the number of trades open
 * at once, four statements ticked, the typed LIVE word and the authenticator code. It replaces the per-trade LIVE
 * word, which an unattended trade cannot have.
 *
 * A RECORD ONLY in this step: nothing reads a mandate yet, and Autopilot still trades on paper only. The engine's live
 * entry (its own step) reads it, and the limits here are then hard stops on NEW entries; open trades keep their exits.
 */
import { z } from "zod";
import { Id } from "./accounts.js";
import { IsoDateTime } from "./primitives.js";

/** The four statements, in the words the trader ticks. The words signed are stored with the mandate. */
export const MANDATE_STATEMENTS = {
  realOrders: "Autopilot will place real orders on my exchange account for this strategy, without asking me before each one.",
  ownAccount: "The exchange account and its API key are mine. The exchange's terms say an account is for its holder only, and using it this way is my decision.",
  canLose: "I can lose money, up to the limits I set here and beyond them if the market moves faster than an exit can fill. A paper record or a backtest is not a promise.",
  estimate: "Any margin figure HapieCoin shows is an estimate, and a stop or a target is sent as a market order that may fill at a worse price than its level.",
} as const;
export const MANDATE_STATEMENT_KEYS = ["realOrders", "ownAccount", "canLose", "estimate"] as const;
export type MandateStatementKey = (typeof MANDATE_STATEMENT_KEYS)[number];

export const MANDATE_STATES = ["active", "paused", "ended"] as const;
export const MandateState = z.enum(MANDATE_STATES);
export type MandateState = z.infer<typeof MandateState>;

/** Whole US dollars: a limit a trader types, never a computed amount. */
const WholeUsd = z.number().int().min(1).max(10_000_000);
/** One trade per coin at a time, and a strategy names at most three coins. */
export const MANDATE_MAX_OPEN = 3;
export const MANDATE_CONFIRM_MESSAGE = "Type LIVE to sign the mandate";

/** What the trader sends to sign. `confirm` is the typed LIVE word; the authenticator code travels in its header. */
export const MandateSign = z
  .strictObject({
    strategyId: Id,
    accountId: Id,
    lots: z.number().int().min(1).max(100_000),
    maxCapitalUsd: WholeUsd,
    dayLossLimitUsd: WholeUsd,
    weekLossLimitUsd: WholeUsd,
    maxOpen: z.number().int().min(1).max(MANDATE_MAX_OPEN),
    statements: z.strictObject({ realOrders: z.literal(true), ownAccount: z.literal(true), canLose: z.literal(true), estimate: z.literal(true) }),
    confirm: z.string().max(16),
  })
  .refine((m) => m.weekLossLimitUsd >= m.dayLossLimitUsd, { message: "The loss limit for the week is at least the limit for the day", path: ["weekLossLimitUsd"] })
  .refine((m) => m.dayLossLimitUsd <= m.maxCapitalUsd, { message: "The loss limit for the day is within the capital it may use", path: ["dayLossLimitUsd"] })
  .refine((m) => m.weekLossLimitUsd <= m.maxCapitalUsd, { message: "The loss limit for the week is within the capital it may use", path: ["weekLossLimitUsd"] });
export type MandateSign = z.infer<typeof MandateSign>;

/** A mandate as its trader reads it back. */
export const Mandate = z.strictObject({
  id: z.string(),
  strategyId: z.string(),
  strategyName: z.string(),
  version: z.number().int().positive(),
  /** Null once the exchange account was removed: the mandate is then ended. */
  accountId: z.string().nullable(),
  accountLabel: z.string().nullable(),
  lots: z.number().int().positive(),
  maxCapitalUsd: z.number().int().positive(),
  dayLossLimitUsd: z.number().int().positive(),
  weekLossLimitUsd: z.number().int().positive(),
  maxOpen: z.number().int().positive(),
  state: MandateState,
  /** Whether, right now, the strategy may trade live (on paper, approved, its settings sound) and is still the trader's to use: without it no new live entry would be taken. */
  standing: z.boolean(),
  signedAt: IsoDateTime,
  pausedAt: IsoDateTime.nullable(),
  pauseReason: z.string().nullable(),
  endedAt: IsoDateTime.nullable(),
  endReason: z.string().nullable(),
});
export type Mandate = z.infer<typeof Mandate>;
export const MandateList = z.strictObject({ items: z.array(Mandate) });
export type MandateList = z.infer<typeof MandateList>;

/** What the mandate routes answer when a step is refused. */
export const MANDATE_REFUSALS = {
  notApproved: "This strategy is not approved for live",
  notUsable: "This strategy is not available to you",
  notCapped: "Its loss is not limited by bought options: it cannot trade live",
  unreadable: "Its settings cannot be read: it cannot trade live",
  tooManyOpen: "More trades open at once than the strategy has coins: it holds one trade per coin",
  heldExit: "It takes profit in steps or buys back a cheap option, and those exits run on paper only for now: it cannot trade live yet",
  noAccount: "Choose one of your connected exchange accounts",
  wrongVenue: "That account is on another exchange than the strategy trades on",
  tooManyLots: "More lots per trade than the strategy was approved with",
  signedAlready: "You already hold a mandate for this strategy: end it before signing another",
  needsAuthenticator: "Switch the authenticator on for your account before signing a mandate",
  notActive: "Only an active mandate can be paused",
  accountEnded: "Its exchange account was removed",
  incompleteEntry: "A trade entered under this mandate did not complete: square that trade off before resuming",
  notPaused: "Only a paused mandate can be resumed",
  ended: "This mandate has ended",
  accountGone: "Its exchange account was removed: sign a new mandate",
} as const;

/** Why a mandate was paused by the trader, as stored. */
export const MANDATE_PAUSED_BY_TRADER = "Paused by you";
export const MANDATE_ENDED_BY_TRADER = "Ended by you";
