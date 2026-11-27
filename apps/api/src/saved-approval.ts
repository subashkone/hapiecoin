/**
 * Approval of a saved Autopilot strategy for live (ADR-145; HC-TR-291..293).
 *
 * A version on paper builds a paper record. The record is read from ONE account: the one that took the most entries of
 * that version. Accounts trade their own lot sizes and can miss entries, so adding accounts together, or letting a
 * different account stand for each entry, would mix sizes and count an entry twice; one account's trades are one
 * consistent run of the strategy. The record says how many accounts traded it and that it shows one of them.
 * An approver reads that record against the checks the owner kept (design §3.4, decisions of 25 Nov 2026) and approves,
 * or withdraws the approval.
 *
 * PAPER ONLY. An approval is a record on a row that stays at stage `paper`: the engine does not read it, nothing is
 * placed, enabled or switched by it. It says the version is eligible for live once live exists (step 4, its own ADR).
 */
import { AUTOPILOT_RUNS_RETENTION_DAYS, SAVED_REFUSALS, type SavedApproval, type SavedApprovalView, type SavedPaperRecord, type SavedPaperTrade, type SavedStrategy, savedApprovalChecks } from "@hapiecoin/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import { savedById, toSaved } from "./autopilot-saved.js";
import type { Db } from "./db/client.js";
import { autopilotRuns, autopilotSavedStrategies, strategies, strategyLegs, users } from "./db/schema.js";

const DAY_MS = 86_400_000;
/** The closed trades a view lists: the approver reads them, the record counts every one. */
export const APPROVAL_TRADES_LISTED = 200;
const cents = (v: string | null | undefined): number => Math.round(Number(v ?? 0) * 100) || 0;
const usd = (c: number): string => (c / 100).toFixed(2);
const wholeDays = (from: number, to: number): number => Math.max(0, Math.floor((to - from) / DAY_MS));

export interface PaperRecord {
  record: SavedPaperRecord;
  trades: SavedPaperTrade[];
  skips: Record<string, number>;
}

/**
 * What a version did on paper, in the account that took the most entries of it (the earliest to enter, then the lowest
 * id, when two took as many). Closed means archived, or every leg squared off by hand while the row still says paper, as
 * the trader's own results count it; the net is the P&L at the closing marks less the fees estimated at entry. Money is
 * added up in whole cents. The skip lines are that account's log lines by reason (every account's when none entered):
 * the engine writes a line when the reason changes, not once per entry skipped.
 */
export async function paperRecordOf(db: Pick<Db, "select">, strategy: Pick<SavedStrategy, "id" | "publishedAt">, now: Date): Promise<PaperRecord> {
  const rows = await db
    .select({
      userId: autopilotRuns.userId,
      kind: autopilotRuns.kind,
      reason: autopilotRuns.reason,
      at: autopilotRuns.at,
      asset: autopilotRuns.asset,
      detail: autopilotRuns.detail,
      status: strategies.status,
      realizedPnl: strategies.realizedPnl,
      startedAt: strategies.startedAt,
      closedAt: strategies.closedAt,
      closeReason: strategies.closeReason,
      openLegs: sql<number>`(select count(*)::int from ${strategyLegs} where ${strategyLegs.strategyId} = ${strategies.id} and ${strategyLegs.status} = 'open')`,
      lastLegClose: sql<string | null>`(select max(${strategyLegs.closedAt}) from ${strategyLegs} where ${strategyLegs.strategyId} = ${strategies.id})`,
    })
    .from(autopilotRuns)
    .leftJoin(strategies, eq(strategies.id, autopilotRuns.strategyId))
    .where(eq(autopilotRuns.playbookId, strategy.id))
    .orderBy(asc(autopilotRuns.at), asc(autopilotRuns.id));
  // (an entry whose trade row is gone, deleted with its account, has nothing left to count)
  // (ADR-148: a trade entered live under a mandate is not paper: it is no part of the paper record)
  const entries = rows.filter((r) => r.kind === "entered" && r.status !== null && r.detail.mode !== "live");
  const taken = new Map<string, { n: number; first: number }>();
  for (const r of entries) {
    const had = taken.get(r.userId);
    if (had) had.n += 1;
    else taken.set(r.userId, { n: 1, first: r.at.getTime() });
  }
  const [account] = [...taken.entries()].sort(([a, x], [b, y]) => y.n - x.n || x.first - y.first || (a < b ? -1 : 1)).map(([id]) => id);
  const t = { open: 0, closed: 0, wins: 0, gross: 0, fees: 0, net: 0 };
  let worst: number | null = null;
  const trades: SavedPaperTrade[] = [];
  const mine = entries.filter((r) => r.userId === account);
  for (const r of mine) {
    const closedAt = r.status === "archived" ? r.closedAt : r.status === "paper" && r.openLegs === 0 && r.lastLegClose ? new Date(r.lastLegClose) : null;
    if (!closedAt) {
      t.open += 1;
      continue;
    }
    const gross = cents(r.realizedPnl);
    const fees = cents(r.detail.fees);
    const net = gross - fees;
    t.closed += 1;
    t.wins += net > 0 ? 1 : 0;
    t.gross += gross;
    t.fees += fees;
    t.net += net;
    worst = worst === null ? net : Math.min(worst, net);
    trades.push({ asset: r.asset, expiry: r.detail.expiry ?? null, strikes: (r.detail.legs ?? []).map((l) => l.strike), openedAt: (r.startedAt ?? r.at).toISOString(), closedAt: closedAt.toISOString(), netUsd: usd(net), reason: r.closeReason ?? (r.status === "paper" ? "squared_off" : "unknown") });
  }
  const skips: Record<string, number> = {};
  for (const r of rows) if (r.kind === "skipped" && (account === undefined || r.userId === account)) skips[r.reason] = (skips[r.reason] ?? 0) + 1;
  const since = strategy.publishedAt;
  const first = mine[0]?.at ?? null;
  const last = mine.at(-1)?.at ?? null;
  const days = first ? wholeDays(first.getTime(), now.getTime()) : 0;
  return {
    record: {
      since,
      publishedDays: since ? wholeDays(Date.parse(since), now.getTime()) : 0,
      firstEntryAt: first?.toISOString() ?? null,
      lastEntryAt: last?.toISOString() ?? null,
      days,
      accounts: taken.size,
      open: t.open,
      closed: t.closed,
      wins: t.wins,
      grossUsd: usd(t.gross),
      feesUsd: usd(t.fees),
      netUsd: usd(t.net),
      worstNetUsd: worst === null ? null : usd(worst),
      skipLines: Object.values(skips).reduce((a, n) => a + n, 0),
      logDays: AUTOPILOT_RUNS_RETENTION_DAYS,
    },
    // newest first by when they were entered
    trades: trades.reverse().slice(0, APPROVAL_TRADES_LISTED),
    skips,
  };
}

/** The checks of design 3.4 as the owner kept them: one writing of them, in the schema package, shared with the screens. */
export const approvalChecks = savedApprovalChecks;

/** The record, the checks and the approval of one strategy, for the admin who asks. */
export async function approvalView(db: Db, strategy: SavedStrategy, userId: string, now: Date): Promise<SavedApprovalView> {
  const { record, trades, skips } = await paperRecordOf(db, strategy, now);
  const checks = approvalChecks(strategy, record);
  return { strategyId: strategy.id, record, checks, approvable: strategy.stage === "paper" && checks.every((c) => c.pass || !c.blocking), mayApprove: await mayApprove(db, userId), approval: strategy.approval, trades, skips };
}

/** Whether a user holds the approver permission: given by name, never implied by the admin role (HC-TR-293). */
export async function mayApprove(db: Pick<Db, "select">, userId: string): Promise<boolean> {
  const [u] = await db.select({ yes: users.canApproveLive, role: users.role, active: users.active }).from(users).where(eq(users.id, userId)).limit(1);
  return u !== undefined && u.yes && u.role === "admin" && u.active;
}

export type ApprovalResult = { ok: true; strategy: SavedStrategy } | { ok: false; why: string; forbidden?: true };
/** Writes the audit line of a step inside the step's own transaction: the step and its line stand or fall together. */
export type ApprovalAudit = (tx: Db, approval: SavedApproval) => Promise<unknown>;

/**
 * Approve. Inside one transaction, on the locked row: the permission is read again, the checks are made again on the
 * record as it is now, and the approval is stored with the record and the backtest figures it was given on.
 */
export async function approveSaved(db: Db, id: string, approver: { id: string; name: string }, now: Date, audit: ApprovalAudit): Promise<ApprovalResult | null> {
  const done = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(autopilotSavedStrategies).where(eq(autopilotSavedStrategies.id, id)).for("update");
    if (!(await mayApprove(tx, approver.id))) return { ok: false as const, why: SAVED_REFUSALS.notApprover, forbidden: true as const };
    if (!row) return null;
    // (whether it has traded does not bear on the checks: the record counts its trades itself)
    const strategy = toSaved(row, true);
    if (row.stage !== "paper") return { ok: false as const, why: SAVED_REFUSALS.approveNotPaper };
    if (row.approval) return { ok: false as const, why: SAVED_REFUSALS.approveTwice };
    const { record } = await paperRecordOf(tx, strategy, now);
    const failed = approvalChecks(strategy, record).filter((c) => c.blocking && !c.pass);
    if (failed.length > 0 || !row.backtest) return { ok: false as const, why: `${SAVED_REFUSALS.approveChecks}: ${failed.map((c) => c.label.toLowerCase()).join("; ")}` };
    const approval: SavedApproval = { by: approver.id, byName: approver.name, at: now.toISOString(), record, backtest: row.backtest };
    await tx.update(autopilotSavedStrategies).set({ approval, updatedAt: now }).where(and(eq(autopilotSavedStrategies.id, id), eq(autopilotSavedStrategies.stage, "paper")));
    await audit(tx, approval);
    return { ok: true as const };
  });
  if (!done?.ok) return done;
  const strategy = await savedById(db, id);
  return strategy ? { ok: true, strategy } : null;
}

/** Withdraw an approval at once. The strategy stays on paper and its open paper trades keep their exits. */
export async function withdrawApproval(db: Db, id: string, approverId: string, now: Date, audit: ApprovalAudit): Promise<ApprovalResult | null> {
  const done = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(autopilotSavedStrategies).where(eq(autopilotSavedStrategies.id, id)).for("update");
    if (!(await mayApprove(tx, approverId))) return { ok: false as const, why: SAVED_REFUSALS.notApprover, forbidden: true as const };
    if (!row) return null;
    if (row.stage !== "paper" || !row.approval) return { ok: false as const, why: SAVED_REFUSALS.notApproved };
    await tx.update(autopilotSavedStrategies).set({ approval: null, updatedAt: now }).where(eq(autopilotSavedStrategies.id, id));
    await audit(tx, row.approval);
    return { ok: true as const };
  });
  if (!done?.ok) return done;
  const strategy = await savedById(db, id);
  return strategy ? { ok: true, strategy } : null;
}
