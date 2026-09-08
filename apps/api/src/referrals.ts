// Referral commissions (Phase 4 item 3, ADR-031): recorded when a referred user's subscription is written (billing
// activation now, Razorpay checkout in item 2 through the same function), read back for the trader's My Referrals
// page and the admin's Commissions tab, settled per referrer or in bulk with an audit trail.
import { type AdminCommissionDetail, type AdminCommissionRow, type AdminCommissionsView, type CommissionStatus, type MonthBar, type ReferralRow, type ReferralsView, commissionFor, monthKey } from "@hapiecoin/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { referralCommissions, users } from "./db/schema.js";
import type { subscriptions } from "./db/schema.js";
import type { AppDeps } from "./routes/shared.js";
import { newId } from "./routes/shared.js";

type UserRow = typeof users.$inferSelect;
type SubRow = typeof subscriptions.$inferSelect;
type CommissionRow = typeof referralCommissions.$inferSelect;

const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

/**
 * Write (or refresh) the commission row for a subscription when its owner was referred. A ₹0 payment leaves a
 * `not_paid` row with no amount so the referrer still sees the sign-up; a paid one is `pending` until settled.
 */
export async function recordReferralCommission(deps: AppDeps, sub: SubRow, now = new Date()): Promise<CommissionRow | null> {
  const [referred] = await deps.db.select().from(users).where(eq(users.id, sub.userId)).limit(1);
  if (!referred?.referredBy) return null;
  const [referrer] = await deps.db.select().from(users).where(eq(users.referralCode, referred.referredBy)).limit(1);
  if (!referrer || referrer.id === referred.id) return null;
  const paid = sub.paidInr ?? "0";
  const commissionInr = commissionFor(paid, referrer.commissionPct);
  const status: CommissionStatus = Number(commissionInr) > 0 ? "pending" : "not_paid";
  const [existing] = await deps.db.select().from(referralCommissions).where(eq(referralCommissions.subscriptionId, sub.id)).limit(1);
  if (existing) {
    if (existing.status === "paid") return existing; // never reopen a settled payout
    const [row] = await deps.db.update(referralCommissions).set({ amountInr: paid, commissionInr, commissionPct: referrer.commissionPct, planName: sub.planName, interval: sub.interval, status, updatedAt: now }).where(eq(referralCommissions.id, existing.id)).returning();
    return row ?? null;
  }
  const [row] = await deps.db
    .insert(referralCommissions)
    .values({ id: newId("cms"), referrerId: referrer.id, referredUserId: referred.id, subscriptionId: sub.id, planName: sub.planName, interval: sub.interval, amountInr: paid, commissionInr, commissionPct: referrer.commissionPct, status, createdAt: now, updatedAt: now })
    .returning();
  return row ?? null;
}

function toReferralRow(u: UserRow, c: CommissionRow | undefined): ReferralRow {
  return {
    userId: u.id,
    name: u.name,
    email: u.email,
    joinedAt: u.createdAt.toISOString(),
    planName: c?.planName ?? null,
    interval: c?.interval ?? null,
    amountInr: c?.amountInr ?? "0",
    commissionInr: c?.commissionInr ?? "0",
    status: c?.status ?? "not_paid",
    month: monthKey(c?.createdAt ?? u.createdAt),
  };
}

/** Latest commission per referred user (a user can subscribe more than once; the newest row represents them). */
async function latestByReferred(deps: AppDeps, referrerId: string): Promise<Map<string, CommissionRow>> {
  const rows = await deps.db.select().from(referralCommissions).where(eq(referralCommissions.referrerId, referrerId)).orderBy(desc(referralCommissions.createdAt));
  const m = new Map<string, CommissionRow>();
  for (const r of rows) if (!m.has(r.referredUserId)) m.set(r.referredUserId, r);
  return m;
}

function byMonth(rows: readonly CommissionRow[]): MonthBar[] {
  const m = new Map<string, { paid: number; pending: number }>();
  for (const r of rows) {
    const k = monthKey(r.createdAt);
    const b = m.get(k) ?? { paid: 0, pending: 0 };
    if (r.status === "paid") b.paid += Number(r.commissionInr);
    if (r.status === "pending") b.pending += Number(r.commissionInr);
    m.set(k, b);
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12).map(([month, b]) => ({ month, paidInr: money(b.paid), pendingInr: money(b.pending) }));
}

export async function referralsView(deps: AppDeps, userId: string): Promise<ReferralsView> {
  const [me] = await deps.db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!me) throw new Error("user not found");
  const referred = await deps.db.select().from(users).where(eq(users.referredBy, me.referralCode)).orderBy(desc(users.createdAt));
  const latest = await latestByReferred(deps, me.id);
  const all = await deps.db.select().from(referralCommissions).where(eq(referralCommissions.referrerId, me.id));
  const rows = referred.map((u) => toReferralRow(u, latest.get(u.id)));
  const sum = (s: CommissionStatus) => all.filter((r) => r.status === s).reduce((t, r) => t + Number(r.commissionInr), 0);
  const paid = sum("paid");
  const pending = sum("pending");
  return {
    code: me.referralCode,
    link: `${deps.config.webUrl.replace(/\/+$/, "")}/auth?tab=signup&ref=${me.referralCode}`,
    commissionPct: me.commissionPct,
    stats: { referrals: referred.length, earnedInr: money(paid + pending), paidInr: money(paid), pendingInr: money(pending) },
    rows,
    byMonth: byMonth(all),
  };
}

export async function adminCommissions(deps: AppDeps, q: string, month: string | null): Promise<AdminCommissionsView> {
  const all = await deps.db.select().from(referralCommissions);
  const months = [...new Set(all.map((r) => monthKey(r.createdAt)))].sort().reverse();
  const inMonth = month ? all.filter((r) => monthKey(r.createdAt) === month) : all;
  const referrerIds = [...new Set(inMonth.map((r) => r.referrerId))];
  const referrers = referrerIds.length ? await deps.db.select().from(users).where(inArray(users.id, referrerIds)) : [];
  const rows: AdminCommissionRow[] = referrers
    .map((u): AdminCommissionRow => {
      const mine = inMonth.filter((r) => r.referrerId === u.id);
      const paid = mine.filter((r) => r.status === "paid").reduce((t, r) => t + Number(r.commissionInr), 0);
      const pending = mine.filter((r) => r.status === "pending").reduce((t, r) => t + Number(r.commissionInr), 0);
      const lastNote = mine.filter((r) => r.note).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]?.note ?? null;
      return { referrerId: u.id, name: u.name, email: u.email, referrals: new Set(mine.map((r) => r.referredUserId)).size, commissionPct: u.commissionPct, totalInr: money(paid + pending), paidInr: money(paid), pendingInr: money(pending), status: pending > 0 ? "pending" : paid > 0 ? "paid" : "not_paid", lastNote };
    })
    .filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()) || r.email.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(b.pendingInr) - Number(a.pendingInr) || a.name.localeCompare(b.name));
  const tiles = rows.reduce((t, r) => ({ total: t.total + Number(r.totalInr), paid: t.paid + Number(r.paidInr), pending: t.pending + Number(r.pendingInr) }), { total: 0, paid: 0, pending: 0 });
  return { tiles: { totalInr: money(tiles.total), paidInr: money(tiles.paid), pendingInr: money(tiles.pending) }, rows, byMonth: byMonth(inMonth), months };
}

export async function adminCommissionDetail(deps: AppDeps, referrerId: string): Promise<AdminCommissionDetail | null> {
  const [u] = await deps.db.select().from(users).where(eq(users.id, referrerId)).limit(1);
  if (!u) return null;
  const referred = await deps.db.select().from(users).where(eq(users.referredBy, u.referralCode)).orderBy(desc(users.createdAt));
  const latest = await latestByReferred(deps, u.id);
  return { referrer: { id: u.id, name: u.name, email: u.email, commissionPct: u.commissionPct }, rows: referred.map((r) => toReferralRow(r, latest.get(r.id))) };
}

/** Settle (or refuse) every pending row of a referrer; returns the rows touched and the amount. */
export async function markPayment(deps: AppDeps, referrerId: string, status: "paid" | "not_paid", note: string | undefined, proofUrl: string | undefined, now = new Date()): Promise<{ rows: number; amountInr: string }> {
  const pending = await deps.db.select().from(referralCommissions).where(and(eq(referralCommissions.referrerId, referrerId), eq(referralCommissions.status, "pending")));
  if (pending.length === 0) return { rows: 0, amountInr: "0.00" };
  await deps.db
    .update(referralCommissions)
    .set({ status, paidAt: status === "paid" ? now : null, ...(note !== undefined ? { note } : {}), ...(proofUrl !== undefined ? { proofUrl } : {}), updatedAt: now }) // a Paid mark without a note keeps the earlier reason on record
    .where(inArray(referralCommissions.id, pending.map((r) => r.id)));
  return { rows: pending.length, amountInr: money(pending.reduce((t, r) => t + Number(r.commissionInr), 0)) };
}

export async function bulkPay(deps: AppDeps, referrerIds: readonly string[] | undefined, now = new Date()): Promise<{ settledRows: number; referrers: number; amountInr: string }> {
  const where = referrerIds ? and(eq(referralCommissions.status, "pending"), inArray(referralCommissions.referrerId, referrerIds)) : eq(referralCommissions.status, "pending");
  const pending = await deps.db.select().from(referralCommissions).where(where);
  if (pending.length === 0) return { settledRows: 0, referrers: 0, amountInr: "0.00" };
  await deps.db.update(referralCommissions).set({ status: "paid", paidAt: now, note: "bulk pay", updatedAt: now }).where(inArray(referralCommissions.id, pending.map((r) => r.id)));
  return { settledRows: pending.length, referrers: new Set(pending.map((r) => r.referrerId)).size, amountInr: money(pending.reduce((t, r) => t + Number(r.commissionInr), 0)) };
}
