/**
 * Saved Autopilot strategies (ADR-141, ADR-142; HC-TR-269..276): what an admin builds in the app, stored beside the
 * built-in list and never instead of it. This module keeps the rows (create, edit, versions, publish, retire, delete),
 * turns a row into the `Playbook` the engine already runs, and answers who may use one.
 *
 * PAPER ONLY: nothing here reaches a venue. A row is traded only at stage `paper`; a draft cannot trade.
 *
 * A version that has traded never changes: new settings are saved as the next version under a new id, so the trades and
 * the log of the old one stay its own, and an open trade keeps the exits it was entered with (they are copied onto the
 * trade at entry, autopilot.ts).
 */
import type { Playbook } from "@hapiecoin/pricing";
import { type AutopilotStrategy, SAVED_REFUSALS, type SavedBacktest, type SavedCard, SavedDefinition, type SavedStrategy, type SavedStrategyCreate, type SavedStrategyPatch, savedEntryText, savedLossCapped, savedPlaybookOf } from "@hapiecoin/schema";
import { and, desc, eq, inArray, max, ne, notExists, sql } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { autopilotSavedStrategies, autopilotSettings, plans, strategies, subscriptions, users } from "./db/schema.js";
import { activeSubscription } from "./entitlements.js";
import { newId } from "./routes/shared.js";

type Row = typeof autopilotSavedStrategies.$inferSelect;

/** Every saved strategy's id starts with this; no built-in playbook's does. */
export const SAVED_ID_PREFIX = "sv_";
export const isSavedId = (id: string): boolean => id.startsWith(SAVED_ID_PREFIX);

/** JSON with its keys in order: Postgres stores jsonb with its own key order, so settings are compared by this. */
const stable = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

/** A saved strategy as the playbook the engine runs: always entered by the clock, with its own exits (one conversion, shared with the screens). */
export function savedPlaybook(row: Pick<Row, "id" | "name" | "summary" | "definition" | "backtest">): Playbook {
  return savedPlaybookOf(row);
}

/** No trade was ever opened from the row: part of the write itself, so an entry a moment earlier is not missed between a read and the write. */
const neverTraded = (db: Db) => notExists(db.select({ one: sql`1` }).from(strategies).where(eq(strategies.autopilotPlaybookId, autopilotSavedStrategies.id)));
/** The index that holds "one version of a family on paper". */
const PAPER_UQ = "autopilot_saved_strategies_family_paper_uq";

async function tradedIds(db: Db, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db.selectDistinct({ id: strategies.autopilotPlaybookId }).from(strategies).where(inArray(strategies.autopilotPlaybookId, [...ids]));
  return new Set(rows.map((r) => r.id!));
}

export function toSaved(r: Row, traded: boolean): SavedStrategy {
  return {
    id: r.id,
    familyId: r.familyId,
    version: r.version,
    name: r.name,
    summary: r.summary,
    definition: r.definition,
    stage: r.stage,
    audience: r.audience,
    userIds: r.userIds,
    planIds: r.planIds,
    backtest: r.backtest,
    backtestAt: r.backtestAt?.toISOString() ?? null,
    approval: r.stage === "paper" ? r.approval : null,
    traded,
    lossCapped: savedLossCapped(r.definition.legs),
    entryText: savedEntryText(r.definition),
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    publishedAt: r.publishedAt?.toISOString() ?? null,
    retiredAt: r.retiredAt?.toISOString() ?? null,
  };
}

/** Every saved strategy, newest first; the versions of one family follow each other by that order. */
export async function listSaved(db: Db): Promise<SavedStrategy[]> {
  const rows = await db.select().from(autopilotSavedStrategies).orderBy(desc(autopilotSavedStrategies.createdAt), desc(autopilotSavedStrategies.version));
  const traded = await tradedIds(db, rows.map((r) => r.id));
  return rows.map((r) => toSaved(r, traded.has(r.id)));
}

async function rowOf(db: Db, id: string): Promise<Row | undefined> {
  const [row] = await db.select().from(autopilotSavedStrategies).where(eq(autopilotSavedStrategies.id, id)).limit(1);
  return row;
}

/** One saved strategy as the admin screens read it (what an audit line keeps of it before a change). */
export async function savedById(db: Db, id: string): Promise<SavedStrategy | null> {
  const row = await rowOf(db, id);
  return row ? toSaved(row, (await tradedIds(db, [id])).has(id)) : null;
}

/** A new draft, the first version of its family. */
export async function createSaved(db: Db, input: SavedStrategyCreate, userId: string, at: Date): Promise<SavedStrategy> {
  const id = newId("sv");
  const [row] = await db.insert(autopilotSavedStrategies).values({ id, familyId: id, version: 1, name: input.name, summary: input.summary, definition: input.definition, createdBy: userId, createdAt: at, updatedAt: at }).returning();
  return toSaved(row!, false);
}

/** A copy as a new draft of a family of its own: no backtest, no audience, no record. */
export async function duplicateSaved(db: Db, id: string, userId: string, at: Date): Promise<SavedStrategy | null> {
  const row = await rowOf(db, id);
  if (!row) return null;
  return createSaved(db, { name: `${row.name.slice(0, 53)} (copy)`, summary: row.summary, definition: row.definition }, userId, at);
}

/** `bad`: what was sent is wrong (an unknown user or plan); otherwise the strategy's state refuses the step. */
export type SavedResult = { ok: true; strategy: SavedStrategy; newVersion: boolean } | { ok: false; why: string; bad?: true };

/** The first id of the audience that names nobody: a mistyped id must not pass for "somebody can use it". */
async function unknownAudience(db: Db, userIds: readonly string[] | undefined, planIds: readonly string[] | undefined): Promise<string | null> {
  if (userIds?.length) {
    const known = new Set((await db.select({ id: users.id }).from(users).where(inArray(users.id, [...userIds]))).map((r) => r.id));
    const missing = userIds.find((u) => !known.has(u));
    if (missing !== undefined) return `${SAVED_REFUSALS.unknownUser}: ${missing}`;
  }
  if (planIds?.length) {
    const known = new Set((await db.select({ id: plans.id }).from(plans).where(inArray(plans.id, [...planIds]))).map((r) => r.id));
    const missing = planIds.find((x) => !known.has(x));
    if (missing !== undefined) return `${SAVED_REFUSALS.unknownPlan}: ${missing}`;
  }
  return null;
}

const audienceOk = (audience: Row["audience"], userIds: readonly string[], planIds: readonly string[]): boolean => audience === "admins" || (audience === "users" ? userIds.length > 0 : planIds.length > 0);

/**
 * The figures of a run of the app's own backtest (ADR-144), put on the strategy it tested: refused when the strategy
 * no longer has the settings the run tested. A draft becomes backtested; a strategy on paper stays on paper.
 */
export async function putSavedBacktest(db: Db, id: string, tested: SavedDefinition, backtest: SavedBacktest, at: Date): Promise<SavedResult | null> {
  // read and written under one lock: settings changed by another admin in between are seen, never given these figures
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(autopilotSavedStrategies).where(eq(autopilotSavedStrategies.id, id)).for("update").limit(1);
    if (!row) return null;
    if (row.stage === "retired") return { ok: false as const, why: SAVED_REFUSALS.retired };
    if (stable(tested) !== stable(row.definition)) return { ok: false as const, why: SAVED_REFUSALS.backtestStale };
    const [saved] = await tx
      .update(autopilotSavedStrategies)
      .set({ backtest, backtestAt: at, approval: stable(backtest) === stable(row.backtest) ? row.approval : null, stage: row.stage === "paper" ? "paper" : "backtested", updatedAt: at })
      .where(eq(autopilotSavedStrategies.id, id))
      .returning();
    return { ok: true as const, strategy: toSaved(saved!, (await tradedIds(tx, [id])).has(id)), newVersion: false };
  });
}

/**
 * Change a saved strategy. The name, the summary and the audience change in place. New settings on a version that has
 * traded are saved as the next version (a draft with no backtest); on one that has not, they change in place, clear
 * its backtest and take it back to a draft, since the figures and the publication were for other settings.
 */
export async function updateSaved(db: Db, id: string, patch: SavedStrategyPatch, userId: string, at: Date): Promise<SavedResult | null> {
  const row = await rowOf(db, id);
  if (!row) return null;
  if (row.stage === "retired") return { ok: false, why: SAVED_REFUSALS.retired };
  const unknown = await unknownAudience(db, patch.userIds, patch.planIds);
  if (unknown) return { ok: false, why: unknown, bad: true };
  const resettled = patch.definition !== undefined && stable(patch.definition) !== stable(row.definition);
  const name = patch.name ?? row.name;
  const summary = patch.summary ?? row.summary;
  const audience = patch.audience ?? row.audience;
  const userIds = patch.userIds ?? row.userIds;
  const planIds = patch.planIds ?? row.planIds;
  // figures sent with new settings are the new settings'; otherwise new settings leave none
  // (figures typed again exactly as a run of the app's backtest left them are still that run's: its mark stays)
  const typed = patch.backtest && !resettled && row.backtest?.run && stable(patch.backtest) === stable({ ...row.backtest, run: undefined }) ? row.backtest : patch.backtest;
  const backtest: SavedBacktest | null = typed !== undefined ? typed : resettled ? null : row.backtest;
  // (a run's figures that a form sends back unchanged are not new figures: their date stays; typed ones are dated when they are sent)
  const backtestAt = patch.backtest && backtest !== row.backtest ? at : backtest ? row.backtestAt : null;

  if (resettled) {
    // in place only while no trade was ever opened from it, which the write itself checks: a draft again, unpublished
    const [saved] = (await tradedIds(db, [id])).has(id)
      ? []
      : await db
          .update(autopilotSavedStrategies)
          .set({ name, summary, definition: patch.definition!, audience, userIds, planIds, backtest, backtestAt, stage: backtest ? "backtested" : "draft", publishedAt: null, approval: null, updatedAt: at })
          .where(and(eq(autopilotSavedStrategies.id, id), neverTraded(db)))
          .returning();
    if (saved) return { ok: true, strategy: toSaved(saved, false), newVersion: false };
    const [last] = await db.select({ version: max(autopilotSavedStrategies.version) }).from(autopilotSavedStrategies).where(eq(autopilotSavedStrategies.familyId, row.familyId));
    const [next] = await db
      .insert(autopilotSavedStrategies)
      .values({ id: newId("sv"), familyId: row.familyId, version: last!.version! + 1, name, summary, definition: patch.definition!, stage: backtest ? "backtested" : "draft", audience, userIds, planIds, backtest, backtestAt, createdBy: userId, createdAt: at, updatedAt: at })
      .returning();
    return { ok: true, strategy: toSaved(next!, false), newVersion: true };
  }

  // a strategy on paper stays publishable: its figures and its audience cannot be emptied under it
  const paper = row.stage === "paper";
  if (paper && !backtest) return { ok: false, why: SAVED_REFUSALS.needsBacktest };
  if (paper && !audienceOk(audience, userIds, planIds)) return { ok: false, why: SAVED_REFUSALS.needsAudience };
  const [saved] = await db
    .update(autopilotSavedStrategies)
    // (an approval was given on the figures it saw: other figures end it, ADR-145)
    .set({ name, summary, audience, userIds, planIds, backtest, backtestAt, approval: stable(backtest) === stable(row.backtest) ? row.approval : null, stage: paper ? "paper" : backtest ? "backtested" : "draft", updatedAt: at })
    .where(eq(autopilotSavedStrategies.id, id))
    .returning();
  return { ok: true, strategy: toSaved(saved!, (await tradedIds(db, [id])).has(id)), newVersion: false };
}

/**
 * In a trader's settings, the id of a version that was just retired becomes the id of the version published in its
 * place, for the traders who may use the new one. A trader it is not for keeps the retired id, which their next save
 * lets go of: the new version is never written into the settings of somebody it was not published for.
 */
async function carrySwitches(tx: Pick<Db, "select" | "update">, from: readonly string[], to: Pick<Row, "id" | "audience" | "userIds" | "planIds">, at: Date): Promise<void> {
  for (const old of from) {
    const holders = await tx.select({ userId: autopilotSettings.userId, strategies: autopilotSettings.strategies, role: users.role }).from(autopilotSettings).innerJoin(users, eq(users.id, autopilotSettings.userId)).where(sql`${autopilotSettings.strategies} @> ${JSON.stringify([{ playbookId: old }])}::jsonb`);
    for (const h of holders) {
      let planId: string | null = null;
      if (h.role !== "admin" && to.audience === "plans") {
        // the subscription that is running now, as entitlements.activeSubscription reads it
        const [sub] = await tx.select({ planId: subscriptions.planId, expiresAt: subscriptions.expiresAt }).from(subscriptions).where(and(eq(subscriptions.userId, h.userId), eq(subscriptions.status, "active"))).orderBy(desc(subscriptions.startsAt)).limit(1);
        planId = sub && (sub.expiresAt === null || sub.expiresAt.getTime() > at.getTime()) ? sub.planId : null;
      }
      if (!mayUseSaved(to, { userId: h.userId, role: h.role }, planId)) continue;
      const kept: AutopilotStrategy[] = h.strategies.filter((x) => x.playbookId !== old && x.playbookId !== to.id);
      await tx.update(autopilotSettings).set({ strategies: [...kept, { playbookId: to.id, exit: "own" }], updatedAt: at }).where(eq(autopilotSettings.userId, h.userId));
    }
  }
}

/**
 * Publish to paper: Autopilot may trade it from the next pass. Any other version of its family on paper is retired, and
 * the traders who had that version switched on have this one instead (the engine still checks that each may use it).
 */
export async function publishSaved(db: Db, id: string, at: Date): Promise<SavedResult | null> {
  const row = await rowOf(db, id);
  if (!row) return null;
  if (row.stage === "paper" || row.stage === "retired") return { ok: false, why: SAVED_REFUSALS.notDraft };
  if (!row.backtest) return { ok: false, why: SAVED_REFUSALS.needsBacktest };
  if (!audienceOk(row.audience, row.userIds, row.planIds)) return { ok: false, why: SAVED_REFUSALS.needsAudience };
  try {
    const saved = await db.transaction(async (tx) => {
      const retired = await tx.update(autopilotSavedStrategies).set({ stage: "retired", retiredAt: at, approval: null, updatedAt: at }).where(and(eq(autopilotSavedStrategies.familyId, row.familyId), eq(autopilotSavedStrategies.stage, "paper"), ne(autopilotSavedStrategies.id, id))).returning({ id: autopilotSavedStrategies.id });
      // the stage is part of the write: a publish or a delete that got there first leaves nothing to publish
      const [next] = await tx.update(autopilotSavedStrategies).set({ stage: "paper", publishedAt: at, approval: null, updatedAt: at }).where(and(eq(autopilotSavedStrategies.id, id), inArray(autopilotSavedStrategies.stage, ["draft", "backtested"]))).returning();
      if (!next) throw new Error(PAPER_UQ);
      await carrySwitches(tx, retired.map((r) => r.id), next, at);
      return next;
    });
    return { ok: true, strategy: toSaved(saved, false), newVersion: false };
  } catch (e) {
    // another publish of this family got there first (the index holds one version on paper)
    if (e instanceof Error && `${e.message} ${e.cause instanceof Error ? e.cause.message : ""}`.includes(PAPER_UQ)) return { ok: false, why: SAVED_REFUSALS.notDraft };
    throw e;
  }
}

/** Retire: no new entries. Open trades keep their exits and the record stays. */
export async function retireSaved(db: Db, id: string, at: Date): Promise<SavedResult | null> {
  const row = await rowOf(db, id);
  if (!row) return null;
  if (row.stage !== "paper") return { ok: false, why: SAVED_REFUSALS.notPaper };
  const [saved] = await db.update(autopilotSavedStrategies).set({ stage: "retired", retiredAt: at, approval: null, updatedAt: at }).where(eq(autopilotSavedStrategies.id, id)).returning();
  return { ok: true, strategy: toSaved(saved!, (await tradedIds(db, [id])).has(id)), newVersion: false };
}

/** Delete a version that never traded and is not on paper; one that has traded is part of its record and is retired instead. */
export async function deleteSaved(db: Db, id: string): Promise<{ ok: true } | { ok: false; why: string } | null> {
  const row = await rowOf(db, id);
  if (!row) return null;
  // on paper, traders may have it switched on: it is retired first, which they can see
  if (row.stage === "paper") return { ok: false, why: SAVED_REFUSALS.onPaper };
  const gone = await db.delete(autopilotSavedStrategies).where(and(eq(autopilotSavedStrategies.id, id), neverTraded(db))).returning({ id: autopilotSavedStrategies.id });
  return gone.length > 0 ? { ok: true } : { ok: false, why: SAVED_REFUSALS.traded };
}

/** Inside the transaction that opens a trade: the strategy is still published. The row is held until the trade is written, so it is not changed or deleted under the entry. */
export async function savedStillOnPaper(tx: Pick<Db, "select">, id: string): Promise<boolean> {
  const rows = await tx.select({ id: autopilotSavedStrategies.id }).from(autopilotSavedStrategies).where(and(eq(autopilotSavedStrategies.id, id), eq(autopilotSavedStrategies.stage, "paper"))).for("share");
  return rows.length > 0;
}
/** What `enter` throws when it is not: the pass moves on, as it does when another pass took the key. */
/** ADR-148: whether the strategy is on paper AND approved for live, read with the live trade's own write (the row is held while it is). */
export async function savedStillApproved(tx: Pick<Db, "select">, id: string): Promise<boolean> {
  const [row] = await tx.select({ stage: autopilotSavedStrategies.stage, approval: autopilotSavedStrategies.approval }).from(autopilotSavedStrategies).where(eq(autopilotSavedStrategies.id, id)).for("share");
  return row !== undefined && row.stage === "paper" && row.approval !== null;
}

export const SAVED_WITHDRAWN = "saved strategy withdrawn before its entry";

// ---- the engine's side ----------------------------------------------------------------------------------------------

/** Whether a trader may use a published strategy: an admin always; otherwise by name, or by the plan they hold. */
export function mayUseSaved(row: Pick<Row, "audience" | "userIds" | "planIds">, trader: { userId: string; role: "user" | "admin" }, planId: string | null): boolean {
  if (trader.role === "admin") return true;
  if (row.audience === "users") return row.userIds.includes(trader.userId);
  return row.audience === "plans" && planId !== null && row.planIds.includes(planId);
}

export interface SavedCatalogue {
  /** The published strategies as playbooks, oldest first: what the engine adds to the built-in list. */
  playbooks: Playbook[];
  /** Published rows whose settings no longer pass the schema (written past it): left out, and said so. */
  unreadable: string[];
  /** True for a built-in playbook; for a saved one, whether this trader may use it. */
  mayUse(playbookId: string, trader: { userId: string; role: "user" | "admin" }): Promise<boolean>;
}

/** The saved strategies on paper, for one pass of the engine. With none, the engine runs the built-in list alone. */
export async function savedCatalogue(db: Db, at: Date): Promise<SavedCatalogue> {
  const rows = await db.select().from(autopilotSavedStrategies).where(eq(autopilotSavedStrategies.stage, "paper")).orderBy(autopilotSavedStrategies.createdAt, autopilotSavedStrategies.id);
  // one row written past the schema must not take the others with it
  const sound = rows.filter((r) => SavedDefinition.safeParse(r.definition).success);
  const byId = new Map(sound.map((r) => [r.id, r]));
  const planOf = new Map<string, string | null>();
  return {
    playbooks: sound.map(savedPlaybook),
    unreadable: rows.filter((r) => !byId.has(r.id)).map((r) => r.id),
    async mayUse(playbookId, trader) {
      const row = byId.get(playbookId);
      if (!row) return true;
      // the plan is read only when the answer depends on it, once per trader
      if (trader.role !== "admin" && row.audience === "plans" && !planOf.has(trader.userId)) planOf.set(trader.userId, (await activeSubscription({ db }, trader.userId, at))?.planId ?? null);
      return mayUseSaved(row, trader, planOf.get(trader.userId) ?? null);
    },
  };
}

/** The ids of the published strategies one user may switch on. */
export async function usableSavedIds(db: Db, userId: string, at: Date): Promise<Set<string>> {
  const catalogue = await savedCatalogue(db, at);
  if (catalogue.playbooks.length === 0) return new Set();
  const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  const usable = new Set<string>();
  for (const p of catalogue.playbooks) if (await catalogue.mayUse(p.id, { userId, role: user?.role ?? "user" })) usable.add(p.id);
  return usable;
}

/**
 * The saved strategies a trader's Autopilot screen is given (HC-TR-279): the published ones they may switch on, and
 * the ones they can no longer switch on but have traded, so that those trades keep their name and their exits read
 * as they were. Nothing else: a draft, a strategy for somebody else, and a version that only sits in their settings
 * are not theirs to see. A trader with no saved strategy anywhere costs one read.
 */
export async function savedCardsFor(db: Db, userId: string, at: Date): Promise<SavedCard[]> {
  const rows = await db.select().from(autopilotSavedStrategies).where(inArray(autopilotSavedStrategies.stage, ["paper", "retired"])).orderBy(autopilotSavedStrategies.createdAt, autopilotSavedStrategies.id);
  if (rows.length === 0) return [];
  const usable = await usableSavedIds(db, userId, at);
  const others = rows.filter((r) => !usable.has(r.id)).map((r) => r.id);
  const traded = others.length === 0 ? [] : await db.selectDistinct({ id: strategies.autopilotPlaybookId }).from(strategies).where(and(eq(strategies.userId, userId), inArray(strategies.autopilotPlaybookId, others)));
  const mine = new Set([...usable, ...traded.map((r) => r.id!)]);
  return rows.filter((r) => mine.has(r.id) && SavedDefinition.safeParse(r.definition).success).map((r) => ({ id: r.id, version: r.version, name: r.name, summary: r.summary, definition: r.definition, backtest: r.backtest, usable: usable.has(r.id) }));
}
