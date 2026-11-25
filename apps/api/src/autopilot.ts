/**
 * Autopilot (ADR-108; HC-TR-216..218): after every market snapshot the API asks each playbook whether its plan enters
 * on the marks of that snapshot (the recorded history with the snapshot as "today", through the same `entryFor` the
 * backtest and the proposals use), and for every trader who switched the playbook on opens a PAPER strategy at those
 * marks with its exits armed. Paper only: this module writes strategy rows and never reaches a venue's order surface,
 * and Go live refuses a row it opened (routes/live.ts).
 *
 * A trader, playbook, venue and asset (the key) holds one trade at a time (AUTOPILOT_MAX_OPEN, ADR-112). The ladder of
 * ADR-110 (another trade when the entry moves to other strikes or another expiry) is still built behind `maxOpen`: the
 * same strikes and expiry are never held twice, which a partial unique index holds against two passes. Between two
 * entries of a key, and after one of its trades ends, the key waits the cool-down. While a trade is open, its own
 * structure pricing clearly better than its entry is written down as a note. Every reason a switched-on playbook did
 * not enter is logged once per change of reason, so the log reads as a history of decisions and not as a heartbeat.
 *
 * ADR-112: one trade per key at a time again (`AUTOPILOT_MAX_OPEN`; the ladder of ADR-110 lost in the backtest), and
 * playbooks entered by the clock: once in their window (every evening on the nearest expiry, ADR-112; one evening a
 * week on the Friday expiry, ADR-115; or once per month-end expiry while it is a set number of days out, ADR-117),
 * with their own exits and nothing of Autopilot's profit exit.
 *
 * Runs on the leader only (ADR-062), inside the first snapshotter's after-hook. A failure for one trader, playbook or
 * underlying is logged and the pass goes on.
 */
import { type MarginInputsSource, entryMargin } from "./margin.js";
import { AUTOPILOT_PLAYBOOKS, type EodDay, type EodRow, type Playbook, type PlaybookAsset, type PlaybookClock, type PlaybookProposal, type ProposalResult, type ProposalSkip, calendarFor, daysToExpiryOf, fillFee, proposalFor } from "@hapiecoin/pricing";
import {
  AUTOPILOT_BETTER_ENTRY_PCT,
  AUTOPILOT_COOLDOWN_MINUTES,
  AUTOPILOT_DTE_BANDS,
  AUTOPILOT_MAX_OPEN,
  AUTOPILOT_RUNS_RETENTION_DAYS,
  AUTOPILOT_TARGET_PCT,
  AUTOPILOT_TRAIL_GIVE_PCT,
  type AutopilotClosedTrade,
  type AutopilotDteBand,
  type AutopilotExitStyle,
  type AutopilotResults,
  type AutopilotRun,
  type AutopilotRunDetail,
  type AutopilotSettings,
  type AutopilotView,
  DEFAULT_AUTOPILOT_SETTINGS,
  MAX_STRATEGY_NAME,
  autopilotDteBand,
  type Underlying,
  type Venue,
  toDecimal,
} from "@hapiecoin/schema";
import { DEFAULT_VENUE, defaultLotSizes, getVenue } from "@hapiecoin/venues";
import { and, asc, desc, eq, gte, like, lt, lte, max, ne, sql } from "drizzle-orm";
import { writeAudit } from "./audit.js";
import { SAVED_WITHDRAWN, type SavedCatalogue, isSavedId, savedCardsFor, savedCatalogue, savedStillOnPaper, usableSavedIds } from "./autopilot-saved.js";
import { dayOf, eodDaysCached } from "./chain-eod.js";
import type { Db } from "./db/client.js";
import { autopilotRuns, autopilotSettings, brokers, instrumentMarks, ivSnapshots, strategies, strategyLegs, strategyRules, userSettings, users } from "./db/schema.js";
import { activeSubscription, freePlan } from "./entitlements.js";
import { PLAYBOOK_ASSETS } from "./playbooks.js";
import { newId } from "./routes/shared.js";

export interface AutopilotDeps {
  db: Db;
  logger: { info(o: object, msg: string): void; warn(o: object, msg: string): void };
  now?: (() => number) | undefined;
  /** How old the newest snapshot may be before nothing is entered on it. */
  maxMarkAgeMs?: number | undefined;
  /** The most trades a key holds at a time; AUTOPILOT_MAX_OPEN unless a test of the ladder says otherwise. */
  maxOpen?: number | undefined;
  /** HC-TR-257: the venue's public margin parameters; absent, a trade is entered without a margin figure. */
  marginInputs?: MarginInputsSource | undefined;
}

/** A snapshot older than this is not a price to enter at (two missed five-minute passes). */
export const AUTOPILOT_MAX_MARK_AGE_MS = 12 * 60_000;
const COOLDOWN_MS = AUTOPILOT_COOLDOWN_MINUTES * 60_000;
const DAY_MS = 86_400_000;
/** What a strategy Autopilot opens is named after: its playbook, then this. */
export const AUTOPILOT_NAME_SUFFIX = " · Autopilot";
/** A playbook entered by the clock enters once per window: not again within this long of its last entry. */
const CLOCK_ONCE_MS = 6 * 3_600_000;
/** Inside the playbook's entry window: from its first hour, before its second (UTC), on its day of the week when it has one. */
export const inWindow = (c: PlaybookClock, nowMs: number): boolean => {
  const d = new Date(nowMs);
  const h = d.getUTCHours();
  return h >= c.fromHourUtc && h < c.toHourUtc && (c.weekdayUtc === undefined || d.getUTCDay() === c.weekdayUtc);
};
/** The first instant after `fromMs` at which the UTC clock reads `hour`:00. */
export const nextHourUtc = (fromMs: number, hour: number): number => {
  const d = new Date(fromMs);
  const sameDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour);
  return sameDay > fromMs ? sameDay : sameDay + 86_400_000;
};
/** The index that holds "one open trade per key and structure"; a write it refuses means another pass got there first. */
const OPEN_UQ = "strategies_autopilot_open_uq";

const SKIP_TEXT: Record<ProposalSkip, string> = {
  control: "This playbook is the control and never trades",
  noDays: "No recorded history to judge the entry on",
  noSignal: "Its entry conditions are not met",
  noExpiry: "No listed expiry is far enough out for this playbook",
  noFit: "The structure does not fit the listed strikes, or a leg has no price",
  noMove: "No spot price from 24 hours ago to judge the move on",
};
export const skipText = (reason: ProposalSkip): string => SKIP_TEXT[reason];
const errorText = (e: unknown): string => (e instanceof Error ? `${e.message}${e.cause instanceof Error ? `: ${e.cause.message}` : ""}` : String(e));

/** ADR-122: a stored spot counts as "the spot then" within this long of the instant asked for. */
export const SPOT_NEAR_MS = 30 * 60_000;
/** The stored spot nearest an instant (ADR-122: the spot 24 hours before an entry); null when no snapshot is within `SPOT_NEAR_MS` of it. */
export async function spotNear(db: Db, venue: Venue, asset: Underlying, atMs: number): Promise<number | null> {
  const rows = await db.select({ ts: ivSnapshots.ts, spot: ivSnapshots.spot }).from(ivSnapshots).where(and(eq(ivSnapshots.venue, venue), eq(ivSnapshots.asset, asset), gte(ivSnapshots.ts, new Date(atMs - SPOT_NEAR_MS)), lte(ivSnapshots.ts, new Date(atMs + SPOT_NEAR_MS)))).orderBy(asc(ivSnapshots.ts), asc(ivSnapshots.id));
  let best: { gap: number; spot: number } | null = null;
  for (const r of rows) {
    const gap = Math.abs(r.ts.getTime() - atMs);
    if (Number(r.spot) > 0 && (!best || gap < best.gap)) best = { gap, spot: Number(r.spot) };
  }
  return best ? best.spot : null;
}

/**
 * The newest snapshot of a venue and underlying as a recorded "day": every option mark of that pass folded into
 * ladders per expiry, with the spot the same pass stored, dated by the pass. Null when there is no pass, no spot for
 * it, or it is older than `maxAgeMs`.
 */
export async function liveDay(db: Db, venue: Venue, asset: Underlying, nowMs: number, maxAgeMs: number): Promise<EodDay | null> {
  const [last] = await db.select({ ts: instrumentMarks.ts }).from(instrumentMarks).where(and(eq(instrumentMarks.venue, venue), eq(instrumentMarks.asset, asset))).orderBy(desc(instrumentMarks.ts)).limit(1);
  if (!last || nowMs - last.ts.getTime() > maxAgeMs) return null;
  const [snap] = await db.select({ spot: ivSnapshots.spot }).from(ivSnapshots).where(and(eq(ivSnapshots.venue, venue), eq(ivSnapshots.asset, asset), eq(ivSnapshots.ts, last.ts))).limit(1);
  if (!snap || !(Number(snap.spot) > 0)) return null;
  const marks = await db.select({ symbol: instrumentMarks.symbol, mark: instrumentMarks.mark, markIv: instrumentMarks.markIv }).from(instrumentMarks).where(and(eq(instrumentMarks.venue, venue), eq(instrumentMarks.asset, asset), eq(instrumentMarks.ts, last.ts)));
  const codec = getVenue(venue).symbols;
  const byExpiry = new Map<string, Map<number, EodRow>>();
  for (const m of marks) {
    if (!codec.isOption(m.symbol)) continue;
    const p = codec.parseOption(m.symbol);
    const strike = Number(p.strike);
    let ladder = byExpiry.get(p.expiryDate);
    if (!ladder) byExpiry.set(p.expiryDate, (ladder = new Map<number, EodRow>()));
    let row = ladder.get(strike);
    if (!row) ladder.set(strike, (row = { strike }));
    const q = { mark: Number(m.mark), iv: m.markIv === null ? undefined : Number(m.markIv) };
    if (p.kind === "call") row.call = q;
    else row.put = q;
  }
  if (byExpiry.size === 0) return null;
  const expiries = [...byExpiry.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([expiry, ladder]) => ({ expiry, rows: [...ladder.values()].sort((a, b) => a.strike - b.strike) }));
  return { day: dayOf(last.ts), ts: last.ts.getTime(), spot: Number(snap.spot), expiries, source: "snapshot" };
}

/** The figures an entry is decided and logged on, in USD for the trade's size. */
export interface AutopilotPlan {
  fees: number;
  /** The profit level: Autopilot's own, or a clock playbook's take of its premium (ADR-113); null when the trade has none. */
  targetUsd: number | null;
  stopUsd: number | null;
  timeStopDte: number | null;
  /** Every sold option is closed on its own at this multiple of its entry price; null when there is no such stop. */
  legStop: number | null;
  /** ADR-114: a stopped option starts a trail on the rest with this percentage give-back; null: the rest is kept. */
  trailRestPct: number | null;
  /** ADR-120: the levels of a profit ladder (an equal part of every leg closed at each, the last part held); null without one. */
  ladder: readonly number[] | null;
  /** ADR-121: a profit lock in USD (the profit that arms it, the floor it closes at); null without one. */
  lock: { atUsd: number; floorUsd: number } | null;
  /** ADR-121: the hour (UTC) the whole trade is closed at after the entry; null: no timed exit of its own. */
  exitHourUtc: number | null;
  /** ADR-123: every sold option is bought back alone once its mark has fallen to this price; null: held. */
  legBuyBackAt: number | null;
  /** ADR-124: the same, with the level a share of the price each option was sold at; null: none. */
  legBuyBackShare: number | null;
  /** ADR-121: the profit level starts a trail with this percentage give-back instead of closing; null: it closes (or follows the trader's exit style). */
  takeTrailPct: number | null;
}

type FeeRule = Parameters<typeof fillFee>[3] | null;
/** The entry fill and an exit fill of the same size under the venue's rule. */
function roundTripFees(proposal: PlaybookProposal, unitsPerLot: number, feeRule: FeeRule): number {
  const entryFee = feeRule ? proposal.legs.reduce((sum, l) => sum + fillFee(l.kind, proposal.spot * l.lots * unitsPerLot, Number(l.price) * l.lots * unitsPerLot, feeRule), 0) : 0;
  return entryFee * 2;
}

/**
 * The plan of a playbook entered by the clock (pure, ADR-112): no strategy stop and none of Autopilot's profit level,
 * only the stop on each sold option when the playbook has one, and its own profit take when it has one (a share of
 * the premium collected, ADR-113). Null when the premium collected does not exceed the fees: a sold structure that
 * cannot pay for its own fills is not entered.
 */
export function clockPlanFor(p: Playbook, proposal: PlaybookProposal, unitsPerLot: number, feeRule: FeeRule): AutopilotPlan | null {
  const fees = roundTripFees(proposal, unitsPerLot, feeRule);
  const credit = -proposal.entryCost;
  if (!(credit > fees)) return null;
  const take = p.clock?.takeProfitOfCredit;
  // a profit level that rounds to nothing would close the trade on the first tick (as planFor refuses for its own)
  if (take !== undefined && credit * take < 0.01) return null;
  const lock = p.clock?.lock;
  // a floor that rounds to nothing is no floor: the trade would close at once when armed
  if (lock !== undefined && credit * lock.floor < 0.01) return null;
  return { fees, targetUsd: take === undefined ? null : credit * take, stopUsd: null, timeStopDte: null, legStop: p.clock?.legStop ?? null, trailRestPct: p.clock?.trailRestPct ?? null, ladder: p.clock?.ladder ?? null, lock: lock === undefined ? null : { atUsd: credit * lock.at, floorUsd: credit * lock.floor }, exitHourUtc: p.clock?.exitHourUtc ?? null, takeTrailPct: p.clock?.takeTrailPct ?? null, legBuyBackAt: p.clock?.legBuyBackAt ?? null, legBuyBackShare: p.clock?.legBuyBackShare ?? null };
}

/**
 * The exits of an entry (pure). Fees are the entry fill and an exit fill of the same size under the venue's rule. The
 * target is AUTOPILOT_TARGET_PCT of the most the structure can make, plus those fees, so reaching it is that profit
 * after both fees. Null when the structure has no defined maximum, when the target is not below the maximum (the fees
 * eat the trade: common close to expiry, where premiums are small), or when a level would round to nothing and fire
 * on the first tick.
 */
export function planFor(p: Playbook, proposal: PlaybookProposal, unitsPerLot: number, feeRule: FeeRule): AutopilotPlan | null {
  const { maxProfit } = proposal;
  const maxLoss = Math.abs(proposal.maxLoss); // the expiry extremes give the loss as a negative P&L
  if (!Number.isFinite(maxProfit) || !Number.isFinite(maxLoss) || maxProfit <= 0 || maxLoss <= 0) return null;
  const fees = roundTripFees(proposal, unitsPerLot, feeRule);
  const targetUsd = (maxProfit * AUTOPILOT_TARGET_PCT) / 100 + fees;
  if (targetUsd >= maxProfit || targetUsd < 0.01) return null;
  const stopPct = p.exits?.stopPct;
  const stopUsd = stopPct === undefined ? null : maxLoss * stopPct;
  if (stopUsd !== null && stopUsd < 0.01) return null;
  return { fees, targetUsd, stopUsd, timeStopDte: p.exits?.timeStopDte ?? null, legStop: null, trailRestPct: null, ladder: null, lock: null, exitHourUtc: null, takeTrailPct: null, legBuyBackAt: null, legBuyBackShare: null };
}

/** Whether `fresh` (a net premium: paid positive, received negative) is better than `open` by the noted margin; judged in cents. */
export function betterEntry(fresh: number, open: number): boolean {
  const openCents = Math.round(open * 100);
  if (openCents === 0) return false;
  // lower is better on both sides: less paid for a debit, more received for a credit
  return Math.round(fresh * 100) <= openCents - Math.max(1, Math.round((Math.abs(openCents) * AUTOPILOT_BETTER_ENTRY_PCT) / 100));
}

/**
 * What a trade holds, as one string: every leg's side, kind, strike and expiry, in order. Two trades with the same
 * one are the same position; a strike reads the same whether it comes from a proposal or from the legs table.
 */
export const structureKey = (legs: readonly { side: string; kind: string; strike: string; expiry: string }[]): string => legs.map((l) => `${l.side}:${l.kind}:${Number(l.strike)}:${l.expiry}`).join(",");

function detailOf(proposal: PlaybookProposal, plan: AutopilotPlan | null, nowMs: number, exit?: AutopilotExitStyle): AutopilotRunDetail {
  const dte = Math.round((Date.parse(`${proposal.expiry}T00:00:00Z`) - Date.parse(`${dayOf(new Date(nowMs))}T00:00:00Z`)) / DAY_MS);
  const money = (n: number) => (Number.isFinite(n) ? toDecimal(n, 2) : null);
  return {
    spot: toDecimal(proposal.spot, 2),
    expiry: proposal.expiry,
    dte,
    entryCost: toDecimal(proposal.entryCost, 2),
    maxProfit: money(proposal.maxProfit),
    maxLoss: money(proposal.maxLoss),
    capital: money(Math.abs(proposal.maxLoss)),
    legs: proposal.legs.map((l) => ({ side: l.side, kind: l.kind, strike: l.strike, price: l.price })),
    ...(proposal.move ? { move: { pct: toDecimal(proposal.move.movePct, 2), side: proposal.move.side } } : {}),
    ...(plan ? { fees: toDecimal(plan.fees, 2), ...(plan.targetUsd === null ? {} : { targetUsd: toDecimal(plan.targetUsd, 2) }), stopUsd: plan.stopUsd === null ? null : toDecimal(plan.stopUsd, 2), ...(plan.legStop === null ? {} : { legStop: plan.legStop }), ...(plan.trailRestPct === null ? {} : { trailRestPct: plan.trailRestPct }), ...(plan.ladder === null ? {} : { ladder: [...plan.ladder] }), ...(plan.lock === null ? {} : { lock: { at: toDecimal(plan.lock.atUsd, 2), floor: toDecimal(plan.lock.floorUsd, 2) } }), ...(plan.takeTrailPct === null ? {} : { takeTrailPct: plan.takeTrailPct }), ...(plan.legBuyBackAt === null ? {} : { legBuyBackAt: toDecimal(plan.legBuyBackAt, 2) }), ...(plan.legBuyBackShare === null ? {} : { legBuyBackShare: plan.legBuyBackShare }), ...(plan.exitHourUtc === null ? {} : { exitAt: new Date(nextHourUtc(nowMs, plan.exitHourUtc)).toISOString() }) } : {}),
    ...(exit ? { exit } : {}),
  };
}

type Key = { userId: string; playbookId: string; venue: Venue; asset: Underlying };
const runKey = (k: Key) => and(eq(autopilotRuns.userId, k.userId), eq(autopilotRuns.playbookId, k.playbookId), eq(autopilotRuns.venue, k.venue), eq(autopilotRuns.asset, k.asset));
const tradeKey = (k: Key) => and(eq(strategies.userId, k.userId), eq(strategies.autopilotPlaybookId, k.playbookId), eq(strategies.venue, k.venue), eq(strategies.asset, k.asset));

/** Write a skip unless the key's newest line already says the same; a note in between is not a change of reason. */
async function skip(db: Db, k: Key, reason: string, detail: AutopilotRunDetail, at: Date): Promise<boolean> {
  const [last] = await db.select({ kind: autopilotRuns.kind, reason: autopilotRuns.reason }).from(autopilotRuns).where(and(runKey(k), ne(autopilotRuns.kind, "noted"))).orderBy(desc(autopilotRuns.at), desc(autopilotRuns.id)).limit(1);
  if (last?.kind === "skipped" && last.reason === reason) return false;
  await db.insert(autopilotRuns).values({ ...k, kind: "skipped", reason, detail, at });
  return true;
}

/**
 * The key's trades that still hold a position, oldest first, each with the structure it was entered on. A paper row
 * whose legs were all closed by hand stays `paper` in the strategies table (only a rule or the settler archives it);
 * Autopilot closes such a row out here, dated by its last leg, so it neither counts as held nor skips the cool-down.
 */
async function openTrades(db: Db, k: Key, at: Date): Promise<{ id: string; structure: string }[]> {
  const rows = await db.select({ id: strategies.id, structure: strategies.autopilotStructure }).from(strategies).where(and(tradeKey(k), eq(strategies.status, "paper"))).orderBy(asc(strategies.createdAt), asc(strategies.id));
  const held: { id: string; structure: string }[] = [];
  for (const row of rows) {
    const legs = await db.select({ side: strategyLegs.side, kind: strategyLegs.kind, strike: strategyLegs.strike, expiry: strategyLegs.expiry, status: strategyLegs.status }).from(strategyLegs).where(eq(strategyLegs.strategyId, row.id)).orderBy(asc(strategyLegs.position));
    if (legs.some((l) => l.status === "open")) {
      // the structure it was ENTERED on, which is what the index holds: a leg the trader rolled or added since does
      // not make it another trade. A row from before the column gets it from its legs once, and keeps it.
      let structure = row.structure;
      if (structure === null) {
        structure = structureKey(legs);
        await db.update(strategies).set({ autopilotStructure: structure }).where(eq(strategies.id, row.id));
      }
      held.push({ id: row.id, structure });
      continue;
    }
    const [last] = await db.select({ at: max(strategyLegs.closedAt) }).from(strategyLegs).where(eq(strategyLegs.strategyId, row.id));
    await db.update(strategies).set({ status: "archived", closedAt: last?.at ?? at, closeReason: "squared_off", updatedAt: at }).where(and(eq(strategies.id, row.id), eq(strategies.status, "paper")));
    await db.update(strategyRules).set({ state: "disarmed", updatedAt: at }).where(and(eq(strategyRules.strategyId, row.id), eq(strategyRules.state, "armed")));
  }
  return held;
}

export interface AutopilotReport {
  entered: number;
  skipped: number;
  noted: number;
  failed: number;
}

interface Trader {
  userId: string;
  role: "user" | "admin";
  strategies: AutopilotSettings["strategies"];
}

/** ADR-119: the coins Autopilot looks at: the recorded playbooks' and XAUT, which only clock playbooks trade. */
export const AUTOPILOT_ASSETS: readonly PlaybookAsset[] = [...PLAYBOOK_ASSETS, "XAUT"];

/** One pass over every venue, underlying, playbook and trader with Autopilot on. */
export async function runAutopilot(deps: AutopilotDeps, venues: readonly Venue[]): Promise<AutopilotReport> {
  const report: AutopilotReport = { entered: 0, skipped: 0, noted: 0, failed: 0 };
  const nowMs = (deps.now ?? Date.now)();
  const at = new Date(nowMs);
  const maxOpen = deps.maxOpen ?? AUTOPILOT_MAX_OPEN;
  const traders: Trader[] = await deps.db
    .select({ userId: autopilotSettings.userId, role: users.role, strategies: autopilotSettings.strategies })
    .from(autopilotSettings)
    .innerJoin(users, eq(users.id, autopilotSettings.userId))
    .where(and(eq(autopilotSettings.enabled, true), eq(users.active, true)));
  if (traders.length === 0) return report;
  await deps.db.delete(autopilotRuns).where(lt(autopilotRuns.at, new Date(nowMs - AUTOPILOT_RUNS_RETENTION_DAYS * DAY_MS)));

  // ADR-107: the product needs a plan; a trader without one gets no trades until they have it again
  const freeOnOffer = (await freePlan(deps)) !== undefined;
  const planned = new Map<string, boolean>();
  // ADR-141: the strategies an admin saved and published, beside the built-in list; read once a pass, when the first
  // underlying is reached. A failure to read them leaves the built-in playbooks trading as they always have.
  let savedRead: Promise<SavedCatalogue> | undefined;
  const savedOf = (): Promise<SavedCatalogue> =>
    (savedRead ??= savedCatalogue(deps.db, at).catch((e: unknown) => {
      report.failed += 1;
      deps.logger.warn({ reason: errorText(e) }, "autopilot could not read the saved strategies");
      return { playbooks: [], unreadable: [], mayUse: () => Promise.resolve(true) };
    }));
  const hasPlan = async (t: Trader): Promise<boolean> => {
    let ok = planned.get(t.userId);
    if (ok === undefined) planned.set(t.userId, (ok = t.role === "admin" || freeOnOffer || (await activeSubscription(deps, t.userId, at)) !== undefined));
    return ok;
  };

  for (const venue of venues) {
    const adapter = getVenue(venue);
    const venueLots = defaultLotSizes(adapter) as Record<string, string>;
    for (const asset of AUTOPILOT_ASSETS) {
      try {
        // paper needs no key, but a strategy names the exchange it would trade on (ADR-065)
        const [broker] = await deps.db.select({ id: brokers.id }).from(brokers).where(and(eq(brokers.scope, "GLOBAL"), eq(brokers.venue, venue))).orderBy(asc(brokers.id)).limit(1);
        const live = broker ? await liveDay(deps.db, venue, asset, nowMs, deps.maxMarkAgeMs ?? AUTOPILOT_MAX_MARK_AGE_MS) : null;
        const days = live ? [...(await eodDaysCached(deps.db, venue, asset)).filter((d) => d.day < live.day), live] : [];
        const calendar = calendarFor(adapter.calendar.settlementHourUtc(asset));
        const saved = await savedOf();
        if (saved.unreadable.length > 0 && asset === AUTOPILOT_ASSETS[0] && venue === venues[0]) deps.logger.warn({ ids: saved.unreadable }, "autopilot left out saved strategies whose settings cannot be read");
        const playbooks: readonly Playbook[] = saved.playbooks.length === 0 ? AUTOPILOT_PLAYBOOKS : [...AUTOPILOT_PLAYBOOKS, ...saved.playbooks];
        for (const p of playbooks) {
          if (!p.assets.includes(asset) || (p.clock && !p.clock.venues.includes(venue))) continue;
          // ADR-122: the spot of the look-back before this snapshot, read only while the entry window is open
          const spotBefore = live && p.clock?.moveSide && inWindow(p.clock, nowMs) ? await spotNear(deps.db, venue, asset, live.ts - p.clock.moveSide.hours * 3_600_000) : null;
          // the structure for one lot size is the same for every trader on it
          const priced = new Map<number, { result: ProposalResult; plan: AutopilotPlan | null }>();
          const pricedFor = (unitsPerLot: number) => {
            let hit = priced.get(unitsPerLot);
            if (!hit) {
              const result = proposalFor(p, days, { unitsPerLot, calendar, spotBefore });
              priced.set(unitsPerLot, (hit = { result, plan: result.ok ? (p.clock ? clockPlanFor : planFor)(p, result.proposal, unitsPerLot, adapter.feeRule) : null }));
            }
            return hit;
          };
          for (const t of traders) {
            const wanted = t.strategies.find((x) => x.playbookId === p.id);
            if (!wanted) continue;
            const k: Key = { userId: t.userId, playbookId: p.id, venue, asset };
            try {
              // the engine values a trade with the trader's own lot size on the default venue (ADR-070): so do the levels
              const [own] = venue === DEFAULT_VENUE ? await deps.db.select({ lotSizes: userSettings.lotSizes }).from(userSettings).where(eq(userSettings.userId, t.userId)).limit(1) : [];
              const unitsPerLot = Number(own?.lotSizes[asset] ?? venueLots[asset]);
              const { result, plan } = live ? pricedFor(unitsPerLot) : { result: null, plan: null };
              const open = await openTrades(deps.db, k, at);
              if (open.length > 0) {
                if (!result?.ok) continue; // holding, and the playbook has no entry to weigh on this pass
                // the very structure a trade holds is never entered twice: a clearly better price for it is written down
                const fresh = structureKey(result.proposal.legs);
                const same = open.find((o) => o.structure === fresh);
                if (same) {
                  // (a playbook entered by the clock takes the evening's price as it is: nothing to note)
                  if (!p.clock && (await noteBetterEntry(deps.db, k, same.id, result.proposal, plan, nowMs))) report.noted += 1;
                  continue;
                }
                // other strikes or another expiry: through the same checks, which hold it to `maxOpen` (ADR-110, ADR-112)
              }
              const no = async (reason: string, detail: AutopilotRunDetail = {}) => {
                if (await skip(deps.db, k, reason, detail, at)) report.skipped += 1;
              };
              if (!(await hasPlan(t))) await no("No active plan: choose a plan to let Autopilot trade");
              else if (!(await saved.mayUse(p.id, t))) await no("This strategy is not available to you");
              else if (!broker) await no("No paper exchange is set up for this venue");
              else if (p.clock && !inWindow(p.clock, nowMs)) await no(`Outside its entry hours (${p.clock.window})`);
              else if (!live || !result) await no("No fresh prices: the newest market snapshot is missing or too old");
              else if (!result.ok) await no(skipText(result.reason));
              // by the clock: the next settlement or nothing; a later expiry is another trade than the one the card describes
              else if (p.clock && daysToExpiryOf(calendar, nowMs, result.proposal.expiry) > p.clock.maxDte) await no(p.clock.cadence === "monthly" ? "No month-end expiry in its range yet" : p.clock.weekdayUtc === undefined ? "The next expiry has no prices yet" : "Its Friday expiry has no prices yet", detailOf(result.proposal, null, nowMs));
              else if (result.proposal.legs.some((l) => l.kind === "future")) await no("A futures leg needs a margin figure Autopilot does not have yet", detailOf(result.proposal, null, nowMs));
              else if (result.proposal.legs.some((l) => !(Number(l.price) > 0))) await no("A leg of the structure has no price", detailOf(result.proposal, null, nowMs));
              else if (!plan) await no(p.clock ? "The premium collected is smaller than the fees" : "The fees are larger than the profit target, or the structure has no defined maximum", detailOf(result.proposal, null, nowMs));
              else if (open.length >= maxOpen) await no(maxOpen === 1 ? "Holds a trade already: one at a time for a strategy and coin" : `Holds ${maxOpen} trades already, the most for one strategy and coin`, detailOf(result.proposal, plan, nowMs));
              else {
                // the newest entry or close of the key, whichever trade it was: one entry per cool-down, and none right after a close.
                // By the clock: once per window, counted from the last entry (yesterday's trade settled only hours ago).
                const [prev] = await deps.db.select({ startedAt: max(strategies.startedAt), closedAt: max(strategies.closedAt) }).from(strategies).where(tradeKey(k));
                const lastMs = p.clock ? (prev?.startedAt?.getTime() ?? 0) : Math.max(prev?.startedAt?.getTime() ?? 0, prev?.closedAt?.getTime() ?? 0);
                // ADR-117: a monthly window is open on many evenings; a trade of this expiry that has ended is not taken again
                const [had] = p.clock?.oncePerExpiry ? await deps.db.select({ id: strategies.id }).from(strategies).where(and(tradeKey(k), like(strategies.autopilotStructure, `%:${result.proposal.expiry}%`))).limit(1) : [];
                if (had) await no("Already traded this expiry");
                else if (lastMs > 0 && nowMs - lastMs < (p.clock ? CLOCK_ONCE_MS : COOLDOWN_MS)) await no(p.clock ? "Already entered in this window" : `Waiting ${AUTOPILOT_COOLDOWN_MINUTES} minutes after its last trade`);
                else {
                  // a playbook entered by the clock runs on its own exits whatever the card says (ADR-112)
                  const style: AutopilotExitStyle = p.clock ? "own" : wanted.exit === "own" ? "trail" : wanted.exit;
                  // HC-TR-257: the margin of the sold options at the snapshot's spot and marks, under today's percent of each contract
                  const marginEstimate = await entryMargin(
                    deps.marginInputs,
                    asset,
                    venue,
                    result.proposal.legs.map((l) => ({ kind: l.kind, side: l.side, symbol: adapter.symbols.formatOption(l.kind as "call" | "put", asset, l.strike, l.expiry), lots: l.lots, price: l.price })), // a futures leg never reaches here, as in enter()
                    String(own?.lotSizes[asset] ?? venueLots[asset]),
                    result.proposal.spot,
                  );
                  const id = await enter(deps.db, k, p, result.proposal, plan, style, broker.id, at, marginEstimate);
                  deps.logger.info({ userId: t.userId, playbookId: p.id, venue, asset, strategyId: id }, "autopilot entered a paper trade");
                  report.entered += 1;
                }
              }
            } catch (e) {
              const reason = errorText(e);
              if (reason.includes(OPEN_UQ) || reason.includes(SAVED_WITHDRAWN)) continue; // another pass opened this key's trade a moment ago, or the saved strategy was withdrawn
              report.failed += 1;
              deps.logger.warn({ userId: t.userId, playbookId: p.id, venue, asset, reason }, "autopilot pass failed for a trader");
            }
          }
        }
      } catch (e) {
        report.failed += 1;
        deps.logger.warn({ venue, asset, reason: errorText(e) }, "autopilot pass failed for an underlying");
      }
    }
  }
  return report;
}

async function noteBetterEntry(db: Db, k: Key, openId: string, fresh: PlaybookProposal, plan: AutopilotPlan | null, nowMs: number): Promise<boolean> {
  const [entry] = await db.select({ detail: autopilotRuns.detail }).from(autopilotRuns).where(and(runKey(k), eq(autopilotRuns.kind, "entered"), eq(autopilotRuns.strategyId, openId))).limit(1);
  const openCost = Number(entry?.detail.entryCost);
  const now = detailOf(fresh, plan, nowMs);
  // the caller found `openId` holding the very structure of `fresh`: only that can be "a better entry" for it
  if (!entry || !Number.isFinite(openCost) || !betterEntry(fresh.entryCost, openCost)) return false;
  const [lastNote] = await db.select({ at: autopilotRuns.at }).from(autopilotRuns).where(and(runKey(k), eq(autopilotRuns.kind, "noted"), eq(autopilotRuns.strategyId, openId))).orderBy(desc(autopilotRuns.at)).limit(1);
  if (lastNote && nowMs - lastNote.at.getTime() < COOLDOWN_MS) return false;
  await db.insert(autopilotRuns).values({ ...k, kind: "noted", reason: "A better entry than the open trade's: not taken, these strikes are held already", strategyId: openId, detail: { ...now, openEntryCost: toDecimal(openCost, 2) }, at: new Date(nowMs) });
  return true;
}

/** Open the paper strategy, its legs at the snapshot's marks, its exits, and the log line: all or nothing. */
async function enter(db: Db, k: Key, p: Playbook, proposal: PlaybookProposal, plan: AutopilotPlan, exit: AutopilotExitStyle, brokerId: string, at: Date, marginEstimate: string | null = null): Promise<string> {
  const codec = getVenue(k.venue).symbols;
  const id = newId("strat");
  const detail = detailOf(proposal, plan, at.getTime(), exit);
  await db.transaction(async (tx) => {
    // ADR-142: a saved strategy is entered only while it is still published, checked with the trade's own write
    if (isSavedId(p.id) && !(await savedStillOnPaper(tx, p.id))) throw new Error(SAVED_WITHDRAWN);
    await tx.insert(strategies).values({
      id,
      userId: k.userId,
      // never longer than a strategy name may be: a longer one is refused by the schema every screen reads the list with (GAPS #153)
      name: `${p.name.slice(0, MAX_STRATEGY_NAME - AUTOPILOT_NAME_SUFFIX.length)}${AUTOPILOT_NAME_SUFFIX}`,
      asset: k.asset,
      venue: k.venue,
      status: "paper",
      tradingMode: "paper",
      templateName: typeof p.template === "string" ? p.template : p.name,
      brokerId,
      tags: ["autopilot"],
      startedAt: at,
      autopilotPlaybookId: p.id,
      autopilotStructure: structureKey(proposal.legs),
      marginEstimate,
    });
    const legIds = proposal.legs.map(() => newId("leg"));
    await tx.insert(strategyLegs).values(
      proposal.legs.map((l, position) => ({
        id: legIds[position]!,
        strategyId: id,
        kind: l.kind,
        side: l.side,
        strike: l.strike,
        expiry: l.expiry,
        symbol: codec.formatOption(l.kind as "call" | "put", k.asset, l.strike, l.expiry), // a futures leg never reaches here
        lots: l.lots,
        price: l.price,
        entryPrice: l.price,
        iv: l.iv === undefined ? null : String(l.iv),
        status: "open" as const,
        position,
        openedAt: at,
      })),
    );
    const rule = (values: Pick<typeof strategyRules.$inferInsert, "kind" | "trigger" | "value" | "thresholdUsd"> & Partial<typeof strategyRules.$inferInsert>) => ({ id: newId("rule"), strategyId: id, scope: "strategy" as const, channels: ["push", "telegram"], state: "armed" as const, createdAt: at, updatedAt: at, ...values });
    const rules: ReturnType<typeof rule>[] = [];
    if (plan.targetUsd !== null) {
      const target = toDecimal(plan.targetUsd, 2);
      rules.push(rule({ kind: "target", trigger: "money", value: target, thresholdUsd: target, ...(plan.takeTrailPct !== null ? { trailTrigger: "pct" as const, trailValue: String(plan.takeTrailPct) } : exit === "trail" ? { trailTrigger: "pct" as const, trailValue: AUTOPILOT_TRAIL_GIVE_PCT } : {}) }));
    }
    // ADR-112: each sold option has its own stop at a multiple of the price it was sold at; the other legs stay
    if (plan.legStop !== null)
      proposal.legs.forEach((l, i) => {
        if (l.side === "sell" && l.kind !== "future") rules.push(rule({ kind: "leg_stop", trigger: "multiple", value: String(plan.legStop), thresholdUsd: toDecimal(plan.legStop! * Number(l.price), 2), legId: legIds[i]!, scope: "leg" as const, ...(plan.trailRestPct === null ? {} : { trailTrigger: "pct" as const, trailValue: String(plan.trailRestPct) }) }));
      });
    // ADR-123: each sold option is bought back alone once it is nearly worthless; one sold at or under the level
    // already has no such rule (it would fire at once)
    if (plan.legBuyBackAt !== null) {
      const at = plan.legBuyBackAt;
      proposal.legs.forEach((l, i) => {
        if (l.side === "sell" && l.kind !== "future" && Number(l.price) > at) rules.push(rule({ kind: "leg_take", trigger: "price", value: String(at), thresholdUsd: toDecimal(at, 2), legId: legIds[i]!, scope: "leg" as const }));
      });
    }
    // ADR-124: the same buy-back at a share of the price each option was sold at; a level that rounds to nothing is no
    // level. One buy-back a leg: a plan with a price has it at the price
    else if (plan.legBuyBackShare !== null) {
      const share = plan.legBuyBackShare;
      proposal.legs.forEach((l, i) => {
        const level = toDecimal(share * Number(l.price), 2);
        if (l.side === "sell" && l.kind !== "future" && Number(level) > 0) rules.push(rule({ kind: "leg_take", trigger: "multiple", value: String(share), thresholdUsd: level, legId: legIds[i]!, scope: "leg" as const }));
      });
    }
    // ADR-120: one step a level; each closes an equal part of what the legs hold when it fires (a quarter, then a
    // third of the rest, then half), and the last part has no rule
    if (plan.ladder !== null) {
      const levels = plan.ladder;
      levels.forEach((pct, i) => rules.push(rule({ kind: "step", trigger: "pct", value: String(pct), thresholdUsd: String(pct), closeShare: toDecimal(1 / (levels.length + 1 - i), 6) })));
    }
    // ADR-121: a profit lock waits for its level, then holds a fixed floor; a timed exit closes everything at its hour
    if (plan.lock !== null) rules.push(rule({ kind: "lock", trigger: "money", value: toDecimal(plan.lock.atUsd, 2), thresholdUsd: toDecimal(plan.lock.floorUsd, 2) }));
    if (plan.exitHourUtc !== null) {
      const exitMs = nextHourUtc(at.getTime(), plan.exitHourUtc);
      rules.push(rule({ kind: "time", trigger: "at", value: new Date(exitMs).toISOString(), thresholdUsd: String(exitMs) }));
    }
    if (plan.stopUsd !== null) rules.push(rule({ kind: "stop", trigger: "money", value: toDecimal(plan.stopUsd, 2), thresholdUsd: toDecimal(-plan.stopUsd, 2) }));
    if (plan.timeStopDte !== null) rules.push(rule({ kind: "time", trigger: "dte", value: String(plan.timeStopDte), thresholdUsd: String(plan.timeStopDte) }));
    if (rules.length) await tx.insert(strategyRules).values(rules); // a winged strangle is held to settlement: no rule at all
    await tx.insert(autopilotRuns).values({ ...k, kind: "entered", reason: "Its entry conditions were met on the latest prices", strategyId: id, detail, at });
  });
  await writeAudit(db, { actorId: null, action: "autopilot.enter", target: `strategy:${id}`, before: null, after: { userId: k.userId, playbookId: p.id, venue: k.venue, asset: k.asset, exit, ...detail } });
  return id;
}

// ---- the trader's side: settings and the log ----------------------------------------------------------------------

export async function autopilotSettingsOf(db: Db, userId: string): Promise<AutopilotSettings> {
  const [row] = await db.select().from(autopilotSettings).where(eq(autopilotSettings.userId, userId)).limit(1);
  return row ? { enabled: row.enabled, strategies: row.strategies } : DEFAULT_AUTOPILOT_SETTINGS;
}

/**
 * Save the settings; a playbook that does not exist or is the control is refused by name. A saved strategy (ADR-141)
 * counts while it is published and this trader may use it; one that has been retired or withdrawn since is dropped,
 * not refused, so the settings a trader already holds can still be saved.
 */
export async function saveAutopilotSettings(db: Db, userId: string, next: AutopilotSettings, at: Date): Promise<{ ok: true } | { ok: false; why: string }> {
  const usable = next.strategies.some((s) => isSavedId(s.playbookId)) ? await usableSavedIds(db, userId, at) : new Set<string>();
  const chosen: AutopilotSettings["strategies"] = [];
  for (const s of next.strategies) {
    if (isSavedId(s.playbookId)) {
      // a saved strategy is entered by the clock: its own exits
      if (usable.has(s.playbookId)) chosen.push({ ...s, exit: "own" });
      continue;
    }
    const p = AUTOPILOT_PLAYBOOKS.find((x) => x.id === s.playbookId);
    if (!p) return { ok: false, why: `${s.playbookId} is not a playbook Autopilot can trade` };
    if (s.exit === "own" && !p.clock) return { ok: false, why: `${p.name} takes Autopilot's profit exit: choose trail or target` };
    chosen.push(p.clock ? { ...s, exit: "own" } : s);
  }
  await db.insert(autopilotSettings).values({ userId, enabled: next.enabled, strategies: chosen, updatedAt: at }).onConflictDoUpdate({ target: autopilotSettings.userId, set: { enabled: next.enabled, strategies: chosen, updatedAt: at } });
  return { ok: true };
}

export const AUTOPILOT_RUNS_SHOWN = 200;
export async function autopilotView(db: Db, userId: string, at: Date = new Date()): Promise<AutopilotView> {
  const rows = await db.select().from(autopilotRuns).where(eq(autopilotRuns.userId, userId)).orderBy(desc(autopilotRuns.at), desc(autopilotRuns.id)).limit(AUTOPILOT_RUNS_SHOWN);
  const runs: AutopilotRun[] = rows.map((r) => ({ id: String(r.id), at: r.at.toISOString(), playbookId: r.playbookId, venue: r.venue, asset: r.asset, kind: r.kind, reason: r.reason, strategyId: r.strategyId, detail: r.detail }));
  const settings = await autopilotSettingsOf(db, userId);
  // ADR-142: the saved strategies this trader may use, and the ones they have traded
  const saved = await savedCardsFor(db, userId, at);
  return { settings, runs, ...(saved.length > 0 ? { saved } : {}) };
}

// ---- results (ADR-111; HC-TR-223): what the trades Autopilot opened came to -----------------------------------------

// ADR-139: the screen lists the closed trades by day (it was 100). The oldest day sent may still be a part of that day; the screen says so.
export const AUTOPILOT_TRADES_SHOWN = 500;
const cents = (v: string | null | undefined): number => Math.round(Number(v ?? 0) * 100) || 0;
/** Whole cents as dollars with both decimals kept ("0.00", "-2.40"): a column of results reads better aligned. */
const usd = (c: number): string => (c / 100).toFixed(2);

interface Tally {
  open: number;
  closed: number;
  wins: number;
  gross: number;
  fees: number;
  net: number;
}
const emptyTally = (): Tally => ({ open: 0, closed: 0, wins: 0, gross: 0, fees: 0, net: 0 });
const tallyOut = (t: Tally) => ({ open: t.open, closed: t.closed, wins: t.wins, grossUsd: usd(t.gross), feesUsd: usd(t.fees), netUsd: usd(t.net) });

/**
 * Every entry the log still holds, joined to its strategy: an open trade is counted, a closed one adds its P&L at the
 * closing marks, less the fees estimated at entry (the paper book charges none, so the net is what a venue would have
 * left). Grouped by playbook, asset and exit style, and by the days to expiry at entry. Money is summed in cents.
 */
export async function autopilotResults(db: Db, userId: string): Promise<AutopilotResults> {
  const entries = await db
    .select({
      at: autopilotRuns.at,
      playbookId: autopilotRuns.playbookId,
      asset: autopilotRuns.asset,
      detail: autopilotRuns.detail,
      strategyId: strategies.id,
      status: strategies.status,
      realizedPnl: strategies.realizedPnl,
      startedAt: strategies.startedAt,
      closedAt: strategies.closedAt,
      closeReason: strategies.closeReason,
      openLegs: sql<number>`(select count(*)::int from ${strategyLegs} where ${strategyLegs.strategyId} = ${strategies.id} and ${strategyLegs.status} = 'open')`,
      lastLegClose: sql<string | null>`(select max(${strategyLegs.closedAt}) from ${strategyLegs} where ${strategyLegs.strategyId} = ${strategies.id})`,
    })
    .from(autopilotRuns)
    .innerJoin(strategies, and(eq(strategies.id, autopilotRuns.strategyId), eq(strategies.userId, userId)))
    .where(and(eq(autopilotRuns.userId, userId), eq(autopilotRuns.kind, "entered")))
    .orderBy(asc(autopilotRuns.at), asc(autopilotRuns.id));
  const total = emptyTally();
  const rows = new Map<string, { playbookId: string; asset: Underlying; exit: AutopilotExitStyle; t: Tally; best: number | null; worst: number | null; heldMs: number; reasons: Record<string, number> }>();
  const bands = new Map<AutopilotDteBand, Tally>(AUTOPILOT_DTE_BANDS.map((b) => [b, emptyTally()]));
  const trades: AutopilotClosedTrade[] = [];
  for (const e of entries) {
    const exit = e.detail.exit ?? "trail";
    const key = `${e.playbookId}|${e.asset}|${exit}`;
    let row = rows.get(key);
    if (!row) rows.set(key, (row = { playbookId: e.playbookId, asset: e.asset, exit, t: emptyTally(), best: null, worst: null, heldMs: 0, reasons: {} }));
    const band = e.detail.dte === undefined ? null : bands.get(autopilotDteBand(e.detail.dte))!;
    const into = [total, row.t, ...(band ? [band] : [])];
    // closed: archived, or every leg squared off by hand while the row still says paper (only a rule, the settler or
    // the engine's next pass archives it, and that pass may never come once the playbook is switched off)
    const closedAt = e.status === "archived" ? e.closedAt : e.status === "paper" && e.openLegs === 0 && e.lastLegClose ? new Date(e.lastLegClose) : null;
    if (!closedAt) {
      // still held (or parked by hand before ADR-109 refused it): counted, no money yet
      for (const t of into) t.open += 1;
      continue;
    }
    const gross = cents(e.realizedPnl);
    const fees = cents(e.detail.fees);
    const net = gross - fees;
    for (const t of into) {
      t.closed += 1;
      t.wins += net > 0 ? 1 : 0;
      t.gross += gross;
      t.fees += fees;
      t.net += net;
    }
    row.best = row.best === null ? net : Math.max(row.best, net);
    row.worst = row.worst === null ? net : Math.min(row.worst, net);
    const openedAt = e.startedAt ?? e.at;
    row.heldMs += Math.max(0, closedAt.getTime() - openedAt.getTime());
    const reason = e.closeReason ?? (e.status === "paper" ? "squared_off" : "unknown");
    row.reasons[reason] = (row.reasons[reason] ?? 0) + 1;
    trades.push({ strategyId: e.strategyId, playbookId: e.playbookId, asset: e.asset, exit, strikes: (e.detail.legs ?? []).map((l) => l.strike), expiry: e.detail.expiry ?? null, dte: e.detail.dte ?? null, openedAt: openedAt.toISOString(), closedAt: closedAt.toISOString(), closeReason: reason === "unknown" ? null : reason, grossUsd: usd(gross), feesUsd: usd(fees), netUsd: usd(net) });
  }
  return {
    since: entries[0]?.at.toISOString() ?? null,
    total: tallyOut(total),
    rows: [...rows.values()].map((r) => ({ playbookId: r.playbookId, asset: r.asset, exit: r.exit, ...tallyOut(r.t), bestNetUsd: r.best === null ? null : usd(r.best), worstNetUsd: r.worst === null ? null : usd(r.worst), avgHoldMinutes: r.t.closed ? Math.round(r.heldMs / r.t.closed / 60_000) : null, reasons: r.reasons })),
    byDte: AUTOPILOT_DTE_BANDS.map((band) => ({ band, ...tallyOut(bands.get(band)!) })),
    trades: trades.sort((a, b) => b.closedAt.localeCompare(a.closedAt)).slice(0, AUTOPILOT_TRADES_SHOWN),
  };
}
