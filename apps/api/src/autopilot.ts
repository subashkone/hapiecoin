/**
 * Autopilot (ADR-108; HC-TR-216..218): after every market snapshot the API asks each playbook whether its plan enters
 * on the marks of that snapshot (the recorded history with the snapshot as "today", through the same `entryFor` the
 * backtest and the proposals use), and for every trader who switched the playbook on opens a PAPER strategy at those
 * marks with its exits armed. Paper only: this module writes strategy rows and never reaches a venue's order surface,
 * and Go live refuses a row it opened (routes/live.ts).
 *
 * One open Autopilot trade per trader, playbook, venue and asset (a partial unique index holds this against two
 * passes). After a trade ends the same key waits the cool-down. While a trade is open, the same structure pricing
 * clearly better than that trade's entry is written down as a note. Every reason a switched-on playbook did not enter
 * is logged once per change of reason, so the log reads as a history of decisions and not as a heartbeat.
 *
 * Runs on the leader only (ADR-062), inside the first snapshotter's after-hook. A failure for one trader, playbook or
 * underlying is logged and the pass goes on.
 */
import { type EodDay, type EodRow, PLAYBOOKS, type Playbook, type PlaybookProposal, type ProposalResult, type ProposalSkip, calendarFor, fillFee, proposalFor } from "@hapiecoin/pricing";
import {
  AUTOPILOT_BETTER_ENTRY_PCT,
  AUTOPILOT_COOLDOWN_MINUTES,
  AUTOPILOT_RUNS_RETENTION_DAYS,
  AUTOPILOT_TARGET_PCT,
  AUTOPILOT_TRAIL_GIVE_PCT,
  type AutopilotExitStyle,
  type AutopilotRun,
  type AutopilotRunDetail,
  type AutopilotSettings,
  type AutopilotView,
  DEFAULT_AUTOPILOT_SETTINGS,
  type Underlying,
  type Venue,
  toDecimal,
} from "@hapiecoin/schema";
import { DEFAULT_VENUE, defaultLotSizes, getVenue } from "@hapiecoin/venues";
import { and, asc, desc, eq, lt, max } from "drizzle-orm";
import { writeAudit } from "./audit.js";
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
}

/** A snapshot older than this is not a price to enter at (two missed five-minute passes). */
export const AUTOPILOT_MAX_MARK_AGE_MS = 12 * 60_000;
const COOLDOWN_MS = AUTOPILOT_COOLDOWN_MINUTES * 60_000;
const DAY_MS = 86_400_000;
/** The index that holds "one open trade per key"; a write it refuses means another pass got there first. */
const OPEN_UQ = "strategies_autopilot_open_uq";

const SKIP_TEXT: Record<ProposalSkip, string> = {
  control: "This playbook is the control and never trades",
  noDays: "No recorded history to judge the entry on",
  noSignal: "Its entry conditions are not met",
  noExpiry: "No listed expiry is far enough out for this playbook",
  noFit: "The structure does not fit the listed strikes, or a leg has no price",
};
export const skipText = (reason: ProposalSkip): string => SKIP_TEXT[reason];
const errorText = (e: unknown): string => (e instanceof Error ? `${e.message}${e.cause instanceof Error ? `: ${e.cause.message}` : ""}` : String(e));

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
  targetUsd: number;
  stopUsd: number | null;
  timeStopDte: number | null;
}

/**
 * The exits of an entry (pure). Fees are the entry fill and an exit fill of the same size under the venue's rule. The
 * target is AUTOPILOT_TARGET_PCT of the most the structure can make, plus those fees, so reaching it is that profit
 * after both fees. Null when the structure has no defined maximum, when the target is not below the maximum (the fees
 * eat the trade: common close to expiry, where premiums are small), or when a level would round to nothing and fire
 * on the first tick.
 */
export function planFor(p: Playbook, proposal: PlaybookProposal, unitsPerLot: number, feeRule: Parameters<typeof fillFee>[3] | null): AutopilotPlan | null {
  const { maxProfit } = proposal;
  const maxLoss = Math.abs(proposal.maxLoss); // the expiry extremes give the loss as a negative P&L
  if (!Number.isFinite(maxProfit) || !Number.isFinite(maxLoss) || maxProfit <= 0 || maxLoss <= 0) return null;
  const entryFee = feeRule ? proposal.legs.reduce((sum, l) => sum + fillFee(l.kind, proposal.spot * l.lots * unitsPerLot, Number(l.price) * l.lots * unitsPerLot, feeRule), 0) : 0;
  const fees = entryFee * 2;
  const targetUsd = (maxProfit * AUTOPILOT_TARGET_PCT) / 100 + fees;
  if (targetUsd >= maxProfit || targetUsd < 0.01) return null;
  const stopPct = p.exits?.stopPct;
  const stopUsd = stopPct === undefined ? null : maxLoss * stopPct;
  if (stopUsd !== null && stopUsd < 0.01) return null;
  return { fees, targetUsd, stopUsd, timeStopDte: p.exits?.timeStopDte ?? null };
}

/** Whether `fresh` (a net premium: paid positive, received negative) is better than `open` by the noted margin; judged in cents. */
export function betterEntry(fresh: number, open: number): boolean {
  const openCents = Math.round(open * 100);
  if (openCents === 0) return false;
  // lower is better on both sides: less paid for a debit, more received for a credit
  return Math.round(fresh * 100) <= openCents - Math.max(1, Math.round((Math.abs(openCents) * AUTOPILOT_BETTER_ENTRY_PCT) / 100));
}

type DetailLegs = NonNullable<AutopilotRunDetail["legs"]>;
const structureOf = (expiry: string | undefined, legs: DetailLegs | undefined): string => `${expiry ?? ""}|${(legs ?? []).map((l) => `${l.side}:${l.kind}:${l.strike}`).join(",")}`;

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
    ...(plan ? { fees: toDecimal(plan.fees, 2), targetUsd: toDecimal(plan.targetUsd, 2), stopUsd: plan.stopUsd === null ? null : toDecimal(plan.stopUsd, 2) } : {}),
    ...(exit ? { exit } : {}),
  };
}

type Key = { userId: string; playbookId: string; venue: Venue; asset: Underlying };
const runKey = (k: Key) => and(eq(autopilotRuns.userId, k.userId), eq(autopilotRuns.playbookId, k.playbookId), eq(autopilotRuns.venue, k.venue), eq(autopilotRuns.asset, k.asset));
const tradeKey = (k: Key) => and(eq(strategies.userId, k.userId), eq(strategies.autopilotPlaybookId, k.playbookId), eq(strategies.venue, k.venue), eq(strategies.asset, k.asset));

/** Write a skip unless the key's newest line already says the same. */
async function skip(db: Db, k: Key, reason: string, detail: AutopilotRunDetail, at: Date): Promise<boolean> {
  const [last] = await db.select({ kind: autopilotRuns.kind, reason: autopilotRuns.reason }).from(autopilotRuns).where(runKey(k)).orderBy(desc(autopilotRuns.at), desc(autopilotRuns.id)).limit(1);
  if (last?.kind === "skipped" && last.reason === reason) return false;
  await db.insert(autopilotRuns).values({ ...k, kind: "skipped", reason, detail, at });
  return true;
}

/**
 * The key's trade that still holds a position, if any. A paper row whose legs were all closed by hand stays `paper`
 * in the strategies table (only a rule or the settler archives it); Autopilot closes such a row out here, dated by its
 * last leg, so it neither blocks the key for good nor skips the cool-down.
 */
async function openTrade(db: Db, k: Key, at: Date): Promise<string | null> {
  const [row] = await db.select({ id: strategies.id }).from(strategies).where(and(tradeKey(k), eq(strategies.status, "paper"))).limit(1);
  if (!row) return null;
  const [held] = await db.select({ id: strategyLegs.id }).from(strategyLegs).where(and(eq(strategyLegs.strategyId, row.id), eq(strategyLegs.status, "open"))).limit(1);
  if (held) return row.id;
  const [last] = await db.select({ at: max(strategyLegs.closedAt) }).from(strategyLegs).where(eq(strategyLegs.strategyId, row.id));
  await db.update(strategies).set({ status: "archived", closedAt: last?.at ?? at, closeReason: "squared_off", updatedAt: at }).where(and(eq(strategies.id, row.id), eq(strategies.status, "paper")));
  await db.update(strategyRules).set({ state: "disarmed", updatedAt: at }).where(and(eq(strategyRules.strategyId, row.id), eq(strategyRules.state, "armed")));
  return null;
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

/** One pass over every venue, underlying, playbook and trader with Autopilot on. */
export async function runAutopilot(deps: AutopilotDeps, venues: readonly Venue[]): Promise<AutopilotReport> {
  const report: AutopilotReport = { entered: 0, skipped: 0, noted: 0, failed: 0 };
  const nowMs = (deps.now ?? Date.now)();
  const at = new Date(nowMs);
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
  const hasPlan = async (t: Trader): Promise<boolean> => {
    let ok = planned.get(t.userId);
    if (ok === undefined) planned.set(t.userId, (ok = t.role === "admin" || freeOnOffer || (await activeSubscription(deps, t.userId, at)) !== undefined));
    return ok;
  };

  for (const venue of venues) {
    const adapter = getVenue(venue);
    const venueLots = defaultLotSizes(adapter) as Record<string, string>;
    for (const asset of PLAYBOOK_ASSETS) {
      try {
        // paper needs no key, but a strategy names the exchange it would trade on (ADR-065)
        const [broker] = await deps.db.select({ id: brokers.id }).from(brokers).where(and(eq(brokers.scope, "GLOBAL"), eq(brokers.venue, venue))).orderBy(asc(brokers.id)).limit(1);
        const live = broker ? await liveDay(deps.db, venue, asset, nowMs, deps.maxMarkAgeMs ?? AUTOPILOT_MAX_MARK_AGE_MS) : null;
        const days = live ? [...(await eodDaysCached(deps.db, venue, asset)).filter((d) => d.day < live.day), live] : [];
        const calendar = calendarFor(adapter.calendar.settlementHourUtc(asset));
        for (const p of PLAYBOOKS) {
          if (p.control || !p.assets.includes(asset)) continue;
          // the structure for one lot size is the same for every trader on it
          const priced = new Map<number, { result: ProposalResult; plan: AutopilotPlan | null }>();
          const pricedFor = (unitsPerLot: number) => {
            let hit = priced.get(unitsPerLot);
            if (!hit) {
              const result = proposalFor(p, days, { unitsPerLot, calendar });
              priced.set(unitsPerLot, (hit = { result, plan: result.ok ? planFor(p, result.proposal, unitsPerLot, adapter.feeRule) : null }));
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
              const open = await openTrade(deps.db, k, at);
              if (open) {
                // one open trade per key: a clearly better price for the same structure is written down, at most once per cool-down
                if (result?.ok && (await noteBetterEntry(deps.db, k, open, result.proposal, plan, nowMs))) report.noted += 1;
                continue;
              }
              const no = async (reason: string, detail: AutopilotRunDetail = {}) => {
                if (await skip(deps.db, k, reason, detail, at)) report.skipped += 1;
              };
              if (!(await hasPlan(t))) await no("No active plan: choose a plan to let Autopilot trade");
              else if (!broker) await no("No paper exchange is set up for this venue");
              else if (!live || !result) await no("No fresh prices: the newest market snapshot is missing or too old");
              else if (!result.ok) await no(skipText(result.reason));
              else if (result.proposal.legs.some((l) => l.kind === "future")) await no("A futures leg needs a margin figure Autopilot does not have yet", detailOf(result.proposal, null, nowMs));
              else if (result.proposal.legs.some((l) => !(Number(l.price) > 0))) await no("A leg of the structure has no price", detailOf(result.proposal, null, nowMs));
              else if (!plan) await no("The fees are larger than the profit target, or the structure has no defined maximum", detailOf(result.proposal, null, nowMs));
              else {
                const [prev] = await deps.db.select({ startedAt: strategies.startedAt, closedAt: strategies.closedAt }).from(strategies).where(tradeKey(k)).orderBy(desc(strategies.createdAt)).limit(1);
                const lastMs = (prev?.closedAt ?? prev?.startedAt)?.getTime();
                if (lastMs !== undefined && nowMs - lastMs < COOLDOWN_MS) await no(`Waiting ${AUTOPILOT_COOLDOWN_MINUTES} minutes after its last trade`);
                else {
                  const id = await enter(deps.db, k, p, result.proposal, plan, wanted.exit, broker.id, at);
                  deps.logger.info({ userId: t.userId, playbookId: p.id, venue, asset, strategyId: id }, "autopilot entered a paper trade");
                  report.entered += 1;
                }
              }
            } catch (e) {
              const reason = errorText(e);
              if (reason.includes(OPEN_UQ)) continue; // another pass opened this key's trade a moment ago
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
  // only the very structure the trade holds (same expiry, same strikes and sides) can be "a better entry" for it
  if (!entry || !Number.isFinite(openCost) || structureOf(entry.detail.expiry, entry.detail.legs) !== structureOf(now.expiry, now.legs) || !betterEntry(fresh.entryCost, openCost)) return false;
  const [lastNote] = await db.select({ at: autopilotRuns.at }).from(autopilotRuns).where(and(runKey(k), eq(autopilotRuns.kind, "noted"))).orderBy(desc(autopilotRuns.at)).limit(1);
  if (lastNote && nowMs - lastNote.at.getTime() < COOLDOWN_MS) return false;
  await db.insert(autopilotRuns).values({ ...k, kind: "noted", reason: "A better entry than the open trade's: not taken, one trade at a time", strategyId: openId, detail: { ...now, openEntryCost: toDecimal(openCost, 2) }, at: new Date(nowMs) });
  return true;
}

/** Open the paper strategy, its legs at the snapshot's marks, its exits, and the log line: all or nothing. */
async function enter(db: Db, k: Key, p: Playbook, proposal: PlaybookProposal, plan: AutopilotPlan, exit: AutopilotExitStyle, brokerId: string, at: Date): Promise<string> {
  const codec = getVenue(k.venue).symbols;
  const id = newId("strat");
  const detail = detailOf(proposal, plan, at.getTime(), exit);
  await db.transaction(async (tx) => {
    await tx.insert(strategies).values({
      id,
      userId: k.userId,
      name: `${p.name} · Autopilot`,
      asset: k.asset,
      venue: k.venue,
      status: "paper",
      tradingMode: "paper",
      templateName: typeof p.template === "string" ? p.template : p.name,
      brokerId,
      tags: ["autopilot"],
      startedAt: at,
      autopilotPlaybookId: p.id,
    });
    await tx.insert(strategyLegs).values(
      proposal.legs.map((l, position) => ({
        id: newId("leg"),
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
    const target = toDecimal(plan.targetUsd, 2);
    const rules = [rule({ kind: "target", trigger: "money", value: target, thresholdUsd: target, ...(exit === "trail" ? { trailTrigger: "pct" as const, trailValue: AUTOPILOT_TRAIL_GIVE_PCT } : {}) })];
    if (plan.stopUsd !== null) rules.push(rule({ kind: "stop", trigger: "money", value: toDecimal(plan.stopUsd, 2), thresholdUsd: toDecimal(-plan.stopUsd, 2) }));
    if (plan.timeStopDte !== null) rules.push(rule({ kind: "time", trigger: "dte", value: String(plan.timeStopDte), thresholdUsd: String(plan.timeStopDte) }));
    await tx.insert(strategyRules).values(rules);
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

/** Save the settings; a playbook that does not exist or is the control is refused by name. */
export async function saveAutopilotSettings(db: Db, userId: string, next: AutopilotSettings, at: Date): Promise<{ ok: true } | { ok: false; unknown: string }> {
  const bad = next.strategies.find((s) => !PLAYBOOKS.some((p) => p.id === s.playbookId && !p.control));
  if (bad) return { ok: false, unknown: bad.playbookId };
  await db.insert(autopilotSettings).values({ userId, enabled: next.enabled, strategies: next.strategies, updatedAt: at }).onConflictDoUpdate({ target: autopilotSettings.userId, set: { enabled: next.enabled, strategies: next.strategies, updatedAt: at } });
  return { ok: true };
}

export const AUTOPILOT_RUNS_SHOWN = 200;
export async function autopilotView(db: Db, userId: string): Promise<AutopilotView> {
  const rows = await db.select().from(autopilotRuns).where(eq(autopilotRuns.userId, userId)).orderBy(desc(autopilotRuns.at), desc(autopilotRuns.id)).limit(AUTOPILOT_RUNS_SHOWN);
  const runs: AutopilotRun[] = rows.map((r) => ({ id: String(r.id), at: r.at.toISOString(), playbookId: r.playbookId, venue: r.venue, asset: r.asset, kind: r.kind, reason: r.reason, strategyId: r.strategyId, detail: r.detail }));
  return { settings: await autopilotSettingsOf(db, userId), runs };
}
