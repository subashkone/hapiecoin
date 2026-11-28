/**
 * The mandate a trader signs before Autopilot may trade a saved strategy live for them (ADR-147; HC-TR-296..298).
 * This module keeps the rows: sign, pause, resume, end, and read back.
 *
 * A RECORD ONLY: nothing in the engine reads a mandate yet, nothing here reaches a venue or opens a stored exchange
 * key, and Autopilot still trades on paper only. Signing is refused unless the strategy would be allowed to trade
 * live: on paper with a standing approval, its loss limited by bought options and by no stop on one sold option alone
 * (ADR-157), no exit that runs on paper only, the
 * trader in its audience, and an exchange account of the trader's own on the strategy's venue.
 *
 * Every step runs in one transaction on the locked strategy row (sign, resume) or the locked mandate row, and writes
 * its audit line in the same transaction: the step and its line stand or fall together.
 */
import { MANDATE_ENDED_BY_TRADER, MANDATE_PAUSED_BY_TRADER, MANDATE_REFUSALS, MANDATE_STATEMENTS, type Mandate, type MandateSign, SavedDefinition, savedLossLimit } from "@hapiecoin/schema";
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { mayUseSaved } from "./autopilot-saved.js";
import type { Db } from "./db/client.js";
import { autopilotMandates, autopilotSavedStrategies, brokerCredentials, brokers, strategies, users } from "./db/schema.js";
import { activeSubscription } from "./entitlements.js";
import { newId } from "./routes/shared.js";

type Row = typeof autopilotMandates.$inferSelect;
type StrategyRow = typeof autopilotSavedStrategies.$inferSelect;

export type MandateResult = { ok: true; mandate: Mandate } | { ok: false; why: string };
/** Writes the audit line of a step inside the step's own transaction. */
export type MandateAudit = (tx: Db, row: Row) => Promise<unknown>;

/** The exits the rules engine holds on a live trade (rules-engine.ts: `step` and `leg_take` wait on live): a strategy that uses one cannot trade live yet. */
export function hasHeldExit(definition: Pick<SavedDefinition, "exits">): boolean {
  const e = definition.exits;
  return e.ladder !== undefined || e.legBuyBackAt !== undefined || e.legBuyBackShare !== undefined;
}

/** Whether a strategy row may take a NEW live entry at all: on paper, approved, and that approval not ended. */
export const standingFor = (s: Pick<StrategyRow, "stage" | "approval"> | undefined): boolean => s !== undefined && s.stage === "paper" && s.approval !== null;

/**
 * Why this strategy cannot trade live for anyone, or null. Checked at signing, when a mandate is resumed and when one
 * is read back. The settings are parsed first: a row written past the schema (GAPS #153) is a refusal, never a crash,
 * and never reads as standing while the engine would not trade it.
 */
export function liveRefusalOf(s: StrategyRow | undefined): string | null {
  if (!standingFor(s)) return MANDATE_REFUSALS.notApproved;
  const parsed = SavedDefinition.safeParse(s!.definition);
  if (!parsed.success) return MANDATE_REFUSALS.unreadable;
  // ADR-157: covered legs are not enough; a stop that closes one sold option alone leaves a trade whose loss is not limited
  const limit = savedLossLimit(parsed.data);
  if (limit === "uncovered") return MANDATE_REFUSALS.notCapped;
  if (limit === "legStop") return MANDATE_REFUSALS.legStop;
  if (hasHeldExit(parsed.data)) return MANDATE_REFUSALS.heldExit;
  return null;
}

/**
 * ADR-149 (HC-TR-310): of these saved strategies, the ones that may trade live at all (on paper, approved, loss
 * limited, no exit held on live, settings readable). What a trader's card is told: that one fact, and nothing of who
 * approved it or on which record.
 */
export async function liveOpenIds(db: Pick<Db, "select">, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db.select().from(autopilotSavedStrategies).where(inArray(autopilotSavedStrategies.id, [...ids]));
  return new Set(rows.filter((r) => liveRefusalOf(r) === null).map((r) => r.id));
}

type Trader = { role: "user" | "admin"; active: boolean; planId: string | null };
/** The trader as the audience check needs them; the plan is read only for a trader who is not an admin. */
async function traderOf(tx: Pick<Db, "select">, userId: string, now: Date): Promise<Trader | null> {
  const [user] = await tx.select({ role: users.role, active: users.active }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;
  const planId = user.role === "admin" ? null : ((await activeSubscription({ db: tx as Db }, userId, now))?.planId ?? null);
  return { ...user, planId };
}
/** Whether the strategy is this trader's to use: an active account in its audience (ADR-142). */
const usableBy = (s: StrategyRow, userId: string, trader: Trader | null): boolean => trader !== null && trader.active && mayUseSaved(s, { userId, role: trader.role }, trader.planId);

function toMandate(r: Row, s: StrategyRow | undefined, label: string | null, userId: string, trader: Trader | null): Mandate {
  return {
    id: r.id,
    strategyId: r.strategyId,
    strategyName: s?.name ?? "",
    version: s?.version ?? 1,
    accountId: r.accountId,
    accountLabel: label,
    lots: r.lots,
    maxCapitalUsd: r.maxCapitalUsd,
    dayLossLimitUsd: r.dayLossLimitUsd,
    weekLossLimitUsd: r.weekLossLimitUsd,
    maxOpen: r.maxOpen,
    // an account that was removed ends the mandate whatever its row still says
    state: r.accountId === null ? "ended" : r.state,
    standing: r.accountId !== null && r.state !== "ended" && liveRefusalOf(s) === null && usableBy(s!, userId, trader),
    signedAt: r.signedAt.toISOString(),
    pausedAt: r.pausedAt?.toISOString() ?? null,
    pauseReason: r.pauseReason,
    endedAt: r.endedAt?.toISOString() ?? null,
    endReason: r.accountId === null && r.state !== "ended" ? MANDATE_REFUSALS.accountGone : r.endReason,
  };
}

async function readBack(db: Pick<Db, "select">, userId: string, now: Date, id?: string): Promise<Mandate[]> {
  const trader = await traderOf(db, userId, now);
  const rows = await db
    .select({ m: autopilotMandates, s: autopilotSavedStrategies, label: brokerCredentials.label })
    .from(autopilotMandates)
    .leftJoin(autopilotSavedStrategies, eq(autopilotSavedStrategies.id, autopilotMandates.strategyId))
    .leftJoin(brokerCredentials, eq(brokerCredentials.id, autopilotMandates.accountId))
    .where(id === undefined ? eq(autopilotMandates.userId, userId) : and(eq(autopilotMandates.userId, userId), eq(autopilotMandates.id, id)))
    .orderBy(desc(autopilotMandates.signedAt), autopilotMandates.id);
  return rows.map((r) => toMandate(r.m, r.s ?? undefined, r.label, userId, trader));
}

/** A trader's mandates, newest first, ended ones included: they are the record of what was signed. */
export const mandatesOf = (db: Pick<Db, "select">, userId: string, now: Date): Promise<Mandate[]> => readBack(db, userId, now);

/**
 * End every mandate that trades through an exchange account, in the caller's transaction, before the account is
 * removed (the column would be set null, and a mandate without its account can do nothing). Returns the rows ended.
 */
export async function endMandatesOfAccount(tx: Pick<Db, "update">, accountId: string, now: Date): Promise<Row[]> {
  return tx
    .update(autopilotMandates)
    .set({ state: "ended", endedAt: now, endReason: MANDATE_REFUSALS.accountGone, updatedAt: now })
    .where(and(eq(autopilotMandates.accountId, accountId), ne(autopilotMandates.state, "ended")))
    .returning();
}

/**
 * Sign. On the locked strategy row: it must be allowed to trade live, the trader must be in its audience, the account
 * must be the trader's own on the strategy's venue, the lots within what the strategy was approved with, and the
 * trader must hold no other mandate for it that has not ended. The statements are stored in the words signed.
 */
export async function signMandate(db: Db, userId: string, input: MandateSign, now: Date, audit: MandateAudit): Promise<MandateResult> {
  const done = await db.transaction(async (tx) => {
    const [s] = await tx.select().from(autopilotSavedStrategies).where(eq(autopilotSavedStrategies.id, input.strategyId)).for("update");
    // a strategy the trader may not use, and one never published, read the same as one that does not exist
    if (!s || s.stage === "draft" || s.stage === "backtested" || !usableBy(s, userId, await traderOf(tx, userId, now))) return { ok: false as const, why: MANDATE_REFUSALS.notUsable };
    const refusal = liveRefusalOf(s);
    if (refusal !== null) return { ok: false as const, why: refusal };
    // the account row is held for the length of the signing: it cannot be removed between this read and the insert
    const [account] = await tx
      .select({ id: brokerCredentials.id, brokerId: brokerCredentials.brokerId })
      .from(brokerCredentials)
      .where(and(eq(brokerCredentials.id, input.accountId), eq(brokerCredentials.userId, userId)))
      .for("share");
    if (!account) return { ok: false as const, why: MANDATE_REFUSALS.noAccount };
    const [broker] = await tx.select({ venue: brokers.venue }).from(brokers).where(eq(brokers.id, account.brokerId)).limit(1);
    if (!broker || !(s.definition.venues as readonly string[]).includes(broker.venue)) return { ok: false as const, why: MANDATE_REFUSALS.wrongVenue };
    if (input.lots > s.definition.lots) return { ok: false as const, why: `${MANDATE_REFUSALS.tooManyLots} (${s.definition.lots})` };
    if (input.maxOpen > s.definition.assets.length) return { ok: false as const, why: `${MANDATE_REFUSALS.tooManyOpen} (${s.definition.assets.length})` };
    // a mandate whose account was removed past the route (the column went null) has ended in all but its row: end it here,
    // so it neither blocks this signing nor trips the one-per-strategy index
    await tx
      .update(autopilotMandates)
      .set({ state: "ended", endedAt: now, endReason: MANDATE_REFUSALS.accountGone, updatedAt: now })
      .where(and(eq(autopilotMandates.userId, userId), eq(autopilotMandates.strategyId, s.id), ne(autopilotMandates.state, "ended"), isNull(autopilotMandates.accountId)));
    const [held] = await tx
      .select({ id: autopilotMandates.id })
      .from(autopilotMandates)
      .where(and(eq(autopilotMandates.userId, userId), eq(autopilotMandates.strategyId, s.id), ne(autopilotMandates.state, "ended")))
      .limit(1);
    if (held) return { ok: false as const, why: MANDATE_REFUSALS.signedAlready };
    const [row] = await tx
      .insert(autopilotMandates)
      .values({ id: newId("mnd"), userId, strategyId: s.id, accountId: account.id, lots: input.lots, maxCapitalUsd: input.maxCapitalUsd, dayLossLimitUsd: input.dayLossLimitUsd, weekLossLimitUsd: input.weekLossLimitUsd, maxOpen: input.maxOpen, statements: { ...MANDATE_STATEMENTS }, state: "active", signedAt: now, createdAt: now, updatedAt: now })
      .returning();
    await audit(tx, row!);
    return { ok: true as const, id: row!.id };
  });
  if (!done.ok) return done;
  const [mandate] = await readBack(db, userId, now, done.id);
  return { ok: true, mandate: mandate! };
}

type Step = "pause" | "resume" | "end";

/**
 * Pause, resume or end a trader's own mandate. Pausing and ending are always allowed while the mandate has not ended
 * (stopping must never be refused); resuming checks again that the strategy may trade live and is still the trader's
 * to use. An ended mandate is final.
 */
export async function stepMandate(db: Db, userId: string, id: string, step: Step, now: Date, audit: MandateAudit): Promise<MandateResult | null> {
  const done = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(autopilotMandates).where(and(eq(autopilotMandates.id, id), eq(autopilotMandates.userId, userId))).for("update");
    if (!row) return null;
    if (row.state === "ended") return { ok: false as const, why: MANDATE_REFUSALS.ended };
    let set: Partial<Row>;
    if (step === "end") set = { state: "ended", endedAt: now, endReason: row.accountId === null ? MANDATE_REFUSALS.accountGone : MANDATE_ENDED_BY_TRADER };
    // its account is gone: it reads ended already, and the only step left is to end it
    else if (row.accountId === null) return { ok: false as const, why: MANDATE_REFUSALS.accountGone };
    else if (step === "pause") {
      if (row.state !== "active") return { ok: false as const, why: MANDATE_REFUSALS.notActive };
      set = { state: "paused", pausedAt: now, pauseReason: MANDATE_PAUSED_BY_TRADER };
    } else {
      if (row.state !== "paused") return { ok: false as const, why: MANDATE_REFUSALS.notPaused };
      const [s] = await tx.select().from(autopilotSavedStrategies).where(eq(autopilotSavedStrategies.id, row.strategyId)).for("update");
      const refusal = liveRefusalOf(s);
      if (refusal !== null) return { ok: false as const, why: refusal };
      // ADR-148: a live entry that never completed is squared off before anything new may be entered
      const [stuck] = await tx.select({ id: strategies.id }).from(strategies).where(and(eq(strategies.autopilotMandateId, row.id), eq(strategies.status, "live"), isNull(strategies.autopilotEntryCompleteAt))).limit(1);
      if (stuck) return { ok: false as const, why: MANDATE_REFUSALS.incompleteEntry };
      // the audience is checked again: a trader taken out of it, or whose plan lapsed, does not resume
      if (!usableBy(s!, userId, await traderOf(tx, userId, now))) return { ok: false as const, why: MANDATE_REFUSALS.notUsable };
      set = { state: "active", pausedAt: null, pauseReason: null };
    }
    const [after] = await tx
      .update(autopilotMandates)
      .set({ ...set, updatedAt: now })
      .where(eq(autopilotMandates.id, id))
      .returning();
    await audit(tx, after!);
    return { ok: true as const };
  });
  if (!done?.ok) return done;
  const [mandate] = await readBack(db, userId, now, id);
  return { ok: true, mandate: mandate! };
}
