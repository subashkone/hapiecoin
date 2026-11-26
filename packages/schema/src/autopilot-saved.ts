/**
 * Saved Autopilot strategies (ADR-141, ADR-142; HC-TR-269..276): a strategy an admin builds in the app instead of in
 * code. It holds the settings a built-in clock playbook holds (when it enters, what it sells and buys, how it exits)
 * and is stored beside the built-in list, never instead of it. PAPER ONLY: nothing here can place an order on a venue.
 *
 * One model for both ways to enter: an entry window by the clock (which may be the whole day) and, with it or alone,
 * market conditions judged on the recorded days. A strategy either collects premium (the engine then refuses an entry
 * whose premium does not exceed the fees) or, ADR-143, pays premium for a structure with a target on the most it can
 * make (the engine then refuses an entry whose target, after the fees, is not below that most). Either way it sells at
 * least one option.
 */
import { z } from "zod";
import { Id } from "./accounts.js";
import { IsoDateTime, Underlying } from "./primitives.js";

/** How a leg's strike is chosen: listed strikes from the money, per cent of the spot away, or the option priced nearest a premium. */
export const SAVED_LEG_BY = ["strikes", "pct", "premium"] as const;
/** The most one leg may be of the strategy's lots (a butterfly sells two for each one it buys on a side). */
export const SAVED_LEG_RATIO_MAX = 5;
export const SavedLeg = z
  .strictObject({
    kind: z.enum(["call", "put"]),
    side: z.enum(["buy", "sell"]),
    by: z.enum(SAVED_LEG_BY),
    /** By strikes: how many listed strikes from the money; 0 is the listed strike at or just below the spot, as the built-in templates count (ADR-143). By per cent and by premium: above zero. */
    value: z.number().min(0).max(100_000),
    /** ADR-143: by strikes only, the strike is in the money (a call below the spot, a put above it). Absent: out of the money. */
    itm: z.boolean().optional(),
    /** ADR-143: this leg is that many times the strategy's lots. Absent: once. */
    ratio: z.number().int().min(2).max(SAVED_LEG_RATIO_MAX).optional(),
  })
  .refine((l) => l.by !== "strikes" || (Number.isInteger(l.value) && l.value <= 50), { message: "Strikes from the money is a whole number up to 50", path: ["value"] })
  .refine((l) => l.by === "strikes" || l.value > 0, { message: "Per cent away and a premium are above zero", path: ["value"] })
  .refine((l) => l.by !== "pct" || l.value <= 50, { message: "Per cent away is at most 50", path: ["value"] })
  .refine((l) => !l.itm || (l.by === "strikes" && l.value > 0), { message: "In the money is for a leg by strikes, at least one strike in", path: ["itm"] });
export type SavedLeg = z.infer<typeof SavedLeg>;

/** Market conditions, judged on the recorded days with the latest snapshot as today (the conditions the engine already has). */
export const SavedConditions = z.strictObject({
  /** The spot above (or below) its simple average of the last `days` recorded days. */
  sma: z.strictObject({ days: z.number().int().min(2).max(400), side: z.enum(["above", "below"]) }).optional(),
  /** The front expiry's at-the-money IV ranked inside [min, max] (0 to 100) against the last `lookbackDays` days. */
  ivRank: z
    .strictObject({ min: z.number().min(0).max(100).optional(), max: z.number().min(0).max(100).optional(), lookbackDays: z.number().int().min(20).max(400) })
    .refine((r) => r.min !== undefined || r.max !== undefined, { message: "Give a lowest or a highest rank" })
    .refine((r) => r.min === undefined || r.max === undefined || r.min <= r.max, { message: "The lowest rank is above the highest" })
    .optional(),
});
export type SavedConditions = z.infer<typeof SavedConditions>;

/** The exits a clock playbook may carry (ADR-112..124). Absent: that exit is not used; none at all: held to settlement. */
export const SavedExits = z
  .strictObject({
    /** Every sold option is closed alone at this multiple of the price it was sold at. */
    legStop: z.number().gt(1).max(20).optional(),
    /** The whole trade is closed at this share of the premium collected. */
    takeProfitOfCredit: z.number().gt(0).lt(1).optional(),
    /** With `takeProfitOfCredit` or `targetOfMax`: do not close there, trail from there with this percentage give-back. */
    takeTrailPct: z.number().gt(0).max(100).optional(),
    /** ADR-143: the whole trade is closed at this share of the most it can make at expiry. For a structure whose most is known. */
    targetOfMax: z.number().gt(0).lt(1).optional(),
    /** ADR-143: the whole trade is closed at a loss of this share of the most it can lose at expiry. */
    stopOfMax: z.number().gt(0).max(1).optional(),
    /** ADR-143: the whole trade is closed once the expiry is this many days away or fewer. At least a day: at the settlement itself the trade is settled anyway. */
    timeStopDte: z.number().int().min(1).max(400).optional(),
    /** After a sold option is stopped, the rest is trailed with this percentage give-back. */
    trailRestPct: z.number().gt(0).max(100).optional(),
    /** Take profit in steps: rising levels in per cent of the premium of the lots still open. */
    ladder: z.array(z.number().gt(0).max(100)).min(1).max(4).optional(),
    /** A profit lock: armed at `at` of the premium, closes at `floor` of it (shares between 0 and 1). */
    lock: z.strictObject({ at: z.number().gt(0).max(1), floor: z.number().gt(0).max(1) }).optional(),
    /** The whole trade is closed at the first time the clock reads this hour (UTC) after the entry. */
    exitHourUtc: z.number().int().min(0).max(23).optional(),
    /** Every sold option is bought back alone once its mark has fallen to this price. */
    legBuyBackAt: z.number().gt(0).max(100_000).optional(),
    /** The same, with the level a share of the price each option was sold at. */
    legBuyBackShare: z.number().gt(0).lt(1).optional(),
  })
  .refine((e) => e.legBuyBackAt === undefined || e.legBuyBackShare === undefined, { message: "A buy-back is by price or by share, not both", path: ["legBuyBackShare"] })
  .refine((e) => e.takeTrailPct === undefined || e.takeProfitOfCredit !== undefined || e.targetOfMax !== undefined, { message: "A trailing profit take needs the profit level it starts from", path: ["takeTrailPct"] })
  .refine((e) => e.takeProfitOfCredit === undefined || e.targetOfMax === undefined, { message: "A profit level is a share of the premium or of the most the trade can make, not both", path: ["targetOfMax"] })
  .refine((e) => e.trailRestPct === undefined || e.legStop !== undefined, { message: "Trailing the rest starts when a sold option is stopped: it needs that stop", path: ["trailRestPct"] })
  .refine((e) => !e.lock || e.lock.floor < e.lock.at, { message: "The floor of a profit lock is below the level that arms it", path: ["lock"] })
  .refine((e) => !e.ladder || e.ladder.every((v, i, a) => i === 0 || v > a[i - 1]!), { message: "The steps rise", path: ["ladder"] });
export type SavedExits = z.infer<typeof SavedExits>;

/** The nearest an expiry may be, in days (about an hour): the newest snapshot may be minutes old, and an expiry that has just settled is not one to enter. */
export const SAVED_MIN_DTE = 0.04;
/** A window longer than this many hours enters once per expiry: the engine's "once per window" is this long. */
export const SAVED_LONG_WINDOW_HOURS = 6;

export const SAVED_CADENCES = ["daily", "weekly", "monthly"] as const;
export const SavedCadence = z.enum(SAVED_CADENCES);
export type SavedCadence = z.infer<typeof SavedCadence>;

/** The settings of a saved strategy: everything the engine reads. Hours and weekdays are UTC, as the engine keeps them. */
export const SavedDefinition = z
  .strictObject({
    assets: z.array(Underlying).min(1).max(3),
    /** Delta Exchange India only: the studies behind the exits cover no other exchange, and its prices are in USD. */
    venues: z.array(z.literal("delta_india")).length(1),
    lots: z.number().int().min(1).max(100_000),
    /** daily: the next expiry; weekly: one weekday for a weekly expiry; monthly: the month-end expiry. */
    cadence: SavedCadence,
    /** The entry window: from the first hour, before the second. 0 and 24 is the whole day. */
    fromHourUtc: z.number().int().min(0).max(23),
    toHourUtc: z.number().int().min(1).max(24),
    /** weekly: the one weekday (0 = Sunday) the window opens on. */
    weekdayUtc: z.number().int().min(0).max(6).optional(),
    /** daily: the weekdays allowed; absent, every day. */
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
    /** One entry per expiry: a trade of this expiry that has ended is not taken again. */
    oncePerExpiry: z.boolean(),
    /** The expiry is at least and at most this many days out. */
    minDte: z.number().min(SAVED_MIN_DTE).max(400),
    maxDte: z.number().gt(0).max(400),
    legs: z.array(SavedLeg).min(1).max(6),
    conditions: SavedConditions.optional(),
    /** One side after a move: the spot against the spot `hours` earlier; beyond `pct` per cent only the side behind the move is sold. */
    moveSide: z.strictObject({ hours: z.number().int().min(1).max(168), pct: z.number().gt(0).max(50) }).optional(),
    exits: SavedExits,
  })
  .refine((d) => d.fromHourUtc < d.toHourUtc, { message: "The entry window ends after it starts", path: ["toHourUtc"] })
  .refine((d) => d.minDte < d.maxDte, { message: "The furthest expiry is beyond the nearest", path: ["maxDte"] })
  .refine((d) => (d.cadence === "weekly") === (d.weekdayUtc !== undefined), { message: "A weekly strategy enters on one weekday, and only a weekly one", path: ["weekdayUtc"] })
  .refine((d) => d.weekdays === undefined || d.cadence === "daily", { message: "Only a daily strategy chooses its weekdays", path: ["weekdays"] })
  .refine((d) => d.weekdays === undefined || new Set(d.weekdays).size === d.weekdays.length, { message: "A weekday is listed once", path: ["weekdays"] })
  .refine((d) => new Set(d.assets).size === d.assets.length, { message: "A coin is listed once", path: ["assets"] })
  .refine((d) => d.toHourUtc - d.fromHourUtc <= SAVED_LONG_WINDOW_HOURS || d.oncePerExpiry, { message: "A window longer than six hours enters once per expiry", path: ["oncePerExpiry"] })
  .refine((d) => d.assets.length === 1 || (d.legs.every((l) => l.by !== "premium") && d.exits.legBuyBackAt === undefined), { message: "A premium and a buy-back price are for one coin: with several coins use per cent and a share", path: ["assets"] })
  .refine((d) => d.legs.some((l) => l.side === "sell"), { message: "A saved strategy sells at least one option", path: ["legs"] })
  // a target on the most a trade can make needs that most to be a number: no more bought than sold, of each kind
  .refine((d) => d.exits.targetOfMax === undefined || savedProfitCapped(d.legs), { message: "A target on the most the trade can make needs that most to be limited: do not buy more calls than you sell, or more puts", path: ["exits"] })
  // a stop on the most it can lose needs that most to be a number: every sold option covered by a bought one
  .refine((d) => d.exits.stopOfMax === undefined || savedLossCapped(d.legs), { message: "A stop on the most the trade can lose needs a limited loss: cover every sold option with a bought one of its kind", path: ["exits"] })
  // the exit before expiry leaves the trade at least a day to live
  .refine((d) => d.exits.timeStopDte === undefined || d.minDte >= d.exits.timeStopDte + 1, { message: "The exit before expiry is at least a day nearer than the nearest expiry it enters", path: ["exits"] });
export type SavedDefinition = z.infer<typeof SavedDefinition>;

const lotsOf = (legs: readonly SavedLeg[], kind: SavedLeg["kind"], side: SavedLeg["side"]): number => legs.filter((l) => l.kind === kind && l.side === side).reduce((n, l) => n + (l.ratio ?? 1), 0);
/** Whether no more is bought than sold, of each kind, lot for lot: the most the trade can make at expiry is then a number (ADR-143). */
export function savedProfitCapped(legs: readonly SavedLeg[]): boolean {
  return lotsOf(legs, "call", "buy") <= lotsOf(legs, "call", "sell") && lotsOf(legs, "put", "buy") <= lotsOf(legs, "put", "sell");
}
/** Whether every sold option is covered by a bought one of its kind, lot for lot: the loss at expiry is then limited. */
export function savedLossCapped(legs: readonly SavedLeg[]): boolean {
  return lotsOf(legs, "call", "buy") >= lotsOf(legs, "call", "sell") && lotsOf(legs, "put", "buy") >= lotsOf(legs, "put", "sell");
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
/** A UTC hour as the clock reads in India (UTC + 5:30), as the built-in strategies write it: "9:30 PM". 24 is 5:30 the next morning. */
export function savedIstClock(hourUtc: number): { time: string; half: "AM" | "PM" } {
  const h = (hourUtc + 5) % 24;
  return { time: `${h % 12 === 0 ? 12 : h % 12}:30`, half: h < 12 ? "AM" : "PM" };
}
/** The whole UTC day, as it falls in India. */
const WHOLE_DAY = "any time from 5:30 AM IST to 5:30 the next morning";
const wholeDay = (d: Pick<SavedDefinition, "fromHourUtc" | "toHourUtc">): boolean => d.fromHourUtc === 0 && d.toHourUtc === 24;
/** The entry window as a trader in India reads it: "9:30 to 10:30 PM IST", "11:30 PM to 12:30 AM IST", or the whole day. */
export function savedWindowText(d: Pick<SavedDefinition, "fromHourUtc" | "toHourUtc">): string {
  if (wholeDay(d)) return WHOLE_DAY;
  const from = savedIstClock(d.fromHourUtc);
  const to = savedIstClock(d.toHourUtc);
  return from.half === to.half ? `${from.time} to ${to.time} ${to.half} IST` : `${from.time} ${from.half} to ${to.time} ${to.half} IST`;
}
/**
 * The India weekday a window opens on, for the UTC weekday the engine keeps: India is a day ahead of UTC from
 * 18:30 UTC, so a window that starts at 19:00 UTC or later opens on the next India day. The times in the sentence are
 * India's, so its days are too.
 */
export function savedIstWeekday(utcDay: number, fromHourUtc: number): number {
  return (utcDay + (fromHourUtc >= 19 ? 1 : 0)) % 7;
}
/** When and on which expiry a saved strategy enters, in words (what a card shows after "Entered "), in India time and India days. A daily strategy whose nearest expiry is a day out or more (ADR-143: one like the built-in trend strategies) does not enter "the next expiry": the next settlement is less than a day away, so it says which it takes. */
export function savedEntryText(d: SavedDefinition): string {
  const day = (w: number) => WEEKDAYS[savedIstWeekday(w, d.fromHourUtc)]!;
  const days = d.cadence === "weekly" ? `each ${day(d.weekdayUtc!)}` : d.cadence === "monthly" ? "once per month-end expiry" : d.weekdays ? `on ${[...d.weekdays].map((w) => savedIstWeekday(w, d.fromHourUtc)).sort((a, b) => a - b).map((w) => WEEKDAYS[w]).join(", ")}` : "every day";
  const expiry = d.cadence === "monthly" ? "on the month-end expiry" : d.cadence === "weekly" ? "on the weekly expiry" : d.minDte >= 1 ? `on the first expiry at least ${d.minDte} ${d.minDte === 1 ? "day" : "days"} out` : "on the next expiry";
  const when = [d.conditions?.sma ? `the price is ${d.conditions.sma.side} its ${d.conditions.sma.days}-day average` : null, d.conditions?.ivRank ? "volatility is in its set range" : null].filter((x) => x !== null);
  return `${days}, ${savedWindowText(d)}, ${expiry}${when.length ? `, when ${when.join(" and ")}` : ""}`;
}

/**
 * A saved strategy as the playbook the engine runs and the screens draw: always entered by the clock, with its own
 * exits, and market conditions when it has them. The shape is the pricing package's `Playbook`, written out here
 * because this package does not depend on that one; the API and the web both hand it to code typed as `Playbook`, so
 * the compiler holds the two together.
 */
export interface SavedPlaybook {
  id: string;
  name: string;
  summary: string;
  rationale: string;
  evidence: { claim: string; source: string };
  template: { name: string; category: "Neutral"; description: string; legs: { kind: "call" | "put"; side: "buy" | "sell"; k: number; pct?: number; premium?: number; lots?: number }[]; risk: "defined" | "undefined" };
  /** ADR-143: the whole-trade exits, where the built-in playbooks keep theirs. Absent when the strategy has none. */
  exits: { targetPct: number | undefined; stopPct: number | undefined; timeStopDte: number | undefined } | undefined;
  conditions: { sma: { days: number; side: "above" | "below" } | undefined; ivRank: { min?: number | undefined; max?: number | undefined; lookbackDays: number } | undefined; weekdays: number[] | undefined } | undefined;
  minDte: number;
  lots: number;
  assets: SavedDefinition["assets"];
  thresholds: { minTrades: number; netPositive: boolean; outOfSamplePositive: boolean };
  trials: { count: number; note: string };
  control: false;
  clock: Omit<SavedExits, "targetOfMax" | "stopOfMax" | "timeStopDte"> & { fromHourUtc: number; toHourUtc: number; weekdayUtc: number | undefined; cadence: "monthly" | undefined; oncePerExpiry: true | undefined; window: string; describe: string; maxDte: number; venues: string[]; moveSide: { hours: number; pct: number } | undefined };
}
/** A USD amount in a sentence: "$12.4", "-$180". */
const usd = (n: number): string => `${n < 0 ? "-" : ""}$${Math.abs(n)}`;
export function savedPlaybookOf(row: { id: string; name: string; summary: string; definition: SavedDefinition; backtest: SavedBacktest | null }): SavedPlaybook {
  const d = row.definition;
  const b = row.backtest;
  const { targetOfMax, stopOfMax, timeStopDte, ...clockExits } = d.exits;
  return {
    id: row.id,
    name: row.name,
    summary: row.summary,
    rationale: row.summary,
    evidence: b ? { claim: `${usd(b.mean)} a ${b.per} on ${b.samples} trades, ${b.positivePct} % of them positive, worst ${usd(b.worst)} (USD, figures entered by hand).`, source: b.basis } : { claim: "No backtest entered.", source: "none" },
    template: {
      name: row.name,
      category: "Neutral",
      description: row.summary,
      legs: d.legs.map((l) => {
        // out of the money: a call above the spot, a put below it; in the money, the other way; 0 strikes is at the money
        const away = (l.kind === "call" ? l.value : -l.value) * (l.itm ? -1 : 1) + 0;
        return { kind: l.kind, side: l.side, ...(l.by === "strikes" ? { k: away } : l.by === "pct" ? { k: 0, pct: away } : { k: 0, premium: l.value }), ...(l.ratio ? { lots: l.ratio } : {}) };
      }),
      risk: savedLossCapped(d.legs) ? "defined" : "undefined",
    },
    conditions: d.conditions?.sma || d.conditions?.ivRank || d.weekdays ? { sma: d.conditions?.sma, ivRank: d.conditions?.ivRank, weekdays: d.weekdays } : undefined,
    exits: targetOfMax !== undefined || stopOfMax !== undefined || timeStopDte !== undefined ? { targetPct: targetOfMax, stopPct: stopOfMax, timeStopDte } : undefined,
    minDte: d.minDte,
    lots: d.lots,
    assets: d.assets,
    // never judged by the daily record: Autopilot's own results are its record
    thresholds: { minTrades: Number.MAX_SAFE_INTEGER, netPositive: true, outOfSamplePositive: true },
    trials: { count: 1, note: "Saved in the strategy builder; its backtest figures are entered by hand" },
    control: false,
    clock: { fromHourUtc: d.fromHourUtc, toHourUtc: d.toHourUtc, weekdayUtc: d.weekdayUtc, cadence: d.cadence === "monthly" ? "monthly" : undefined, oncePerExpiry: d.oncePerExpiry || undefined, window: d.cadence === "weekly" ? `${WEEKDAYS[savedIstWeekday(d.weekdayUtc!, d.fromHourUtc)]}s, ${savedWindowText(d)}` : savedWindowText(d), describe: savedEntryText(d), maxDte: d.maxDte, venues: d.venues, moveSide: d.moveSide, ...clockExits },
  };
}

/** Draft: saved, cannot trade. Backtested: its backtest figures are entered. Paper: published, Autopilot trades it. Retired: no new entries. */
export const SAVED_STAGES = ["draft", "backtested", "paper", "retired"] as const;
export const SavedStage = z.enum(SAVED_STAGES);
export type SavedStage = z.infer<typeof SavedStage>;
export const SAVED_STAGE_LABELS: Record<SavedStage, string> = { draft: "Draft", backtested: "Backtested", paper: "On paper", retired: "Retired" };

/** Who may switch a published strategy on: admins only, named users, or everyone holding one of its plans. Admins always may. */
export const SAVED_AUDIENCES = ["admins", "users", "plans"] as const;
export const SavedAudience = z.enum(SAVED_AUDIENCES);
export type SavedAudience = z.infer<typeof SavedAudience>;

/** The backtest of these settings, entered by hand from the research scripts (ADR-141 point 7): USD per trade at the strategy's size. */
export const SavedBacktest = z.strictObject({
  mean: z.number().min(-1_000_000).max(1_000_000),
  per: z.enum(["day", "week", "trade"]),
  positivePct: z.number().min(0).max(100),
  worst: z.number().min(-10_000_000).max(10_000_000),
  samples: z.number().int().min(1).max(100_000),
  /** Where the figures come from: the script, the period, the costs counted. */
  basis: z.string().trim().min(1).max(300),
});
export type SavedBacktest = z.infer<typeof SavedBacktest>;

const Name = z.string().trim().min(1).max(60);
const Summary = z.string().trim().min(1).max(300);
const Ids = z.array(Id).max(200);

/** POST /v1/admin/autopilot-strategies: a new draft. */
export const SavedStrategyCreate = z.strictObject({ name: Name, summary: Summary, definition: SavedDefinition });
export type SavedStrategyCreate = z.infer<typeof SavedStrategyCreate>;

/**
 * PATCH: any of the name, the summary, the settings, the backtest (null clears it) and the audience. New settings on a
 * strategy that has traded are saved as a new version; on one that has not, they clear its backtest.
 */
export const SavedStrategyPatch = z
  .strictObject({ name: Name.optional(), summary: Summary.optional(), definition: SavedDefinition.optional(), backtest: SavedBacktest.nullable().optional(), audience: SavedAudience.optional(), userIds: Ids.optional(), planIds: Ids.optional() })
  .refine((p) => Object.keys(p).length > 0, { message: "Nothing to change" });
export type SavedStrategyPatch = z.infer<typeof SavedStrategyPatch>;

export const SavedStrategy = z.strictObject({
  /** The id Autopilot trades it under. Each version has its own, so a version's record is its own (ADR-142). */
  id: z.string(),
  /** The id of the first version: what the versions of one strategy share. */
  familyId: z.string(),
  version: z.number().int().positive(),
  name: z.string(),
  summary: z.string(),
  definition: SavedDefinition,
  stage: SavedStage,
  audience: SavedAudience,
  userIds: z.array(z.string()),
  planIds: z.array(z.string()),
  backtest: SavedBacktest.nullable(),
  backtestAt: IsoDateTime.nullable(),
  /** Whether Autopilot ever opened a trade from this version: such a version is retired, never deleted, and its settings never change. */
  traded: z.boolean(),
  lossCapped: z.boolean(),
  entryText: z.string(),
  createdBy: z.string().nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  publishedAt: IsoDateTime.nullable(),
  retiredAt: IsoDateTime.nullable(),
});
export type SavedStrategy = z.infer<typeof SavedStrategy>;
export const SavedStrategyList = z.strictObject({ items: z.array(SavedStrategy) });
export type SavedStrategyList = z.infer<typeof SavedStrategyList>;

/**
 * A saved strategy as a trader's Autopilot screen gets it (HC-TR-279): the ones they may switch on (`usable`), and
 * the ones they can no longer switch on but have traded or still hold in their settings, so that a trade, a log line
 * and a result keep their name.
 */
export const SavedCard = z.strictObject({ id: z.string(), version: z.number().int().positive(), name: z.string(), summary: z.string(), definition: SavedDefinition, backtest: SavedBacktest.nullable(), usable: z.boolean() });
export type SavedCard = z.infer<typeof SavedCard>;

/** What the admin routes answer when a step is refused. */
export const SAVED_REFUSALS = {
  needsBacktest: "Enter its backtest figures before publishing",
  needsAudience: "Choose who may use it: name at least one user or one plan",
  notDraft: "Only a draft or a backtested strategy can be published",
  notPaper: "Only a strategy on paper can be retired",
  retired: "A retired strategy cannot be changed: duplicate it",
  onPaper: "It is on paper: retire it before deleting it",
  unknownUser: "No such user",
  unknownPlan: "No such plan",
  traded: "It has traded: retire it instead, its trades are part of its record",
} as const;
