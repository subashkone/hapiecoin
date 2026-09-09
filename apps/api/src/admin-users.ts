// Admin · User Management (Phase 4 item 4a, ADR-032; docs/design/admin.md): the admin's view of a user, the list with
// search / filters / sort / paging, the detail behind the drawer, comped plan changes, invitations and the role and
// account rules that protect the acting admin and the last admin. Every route in routes/admin-users.ts and the user
// routes in routes/billing.ts go through here so the row shape is built in one place.
import { type AdminUserDetail, type AdminUserRow, type AdminUserSubscription, type AdminUsersQuery, type AuditEntry, type BillingInterval, INTERVAL_MONTHS, type PlanLimits } from "@hapiecoin/schema";
import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { uniqueReferralCode } from "./auth.js";
import { auditLog, plans, referralCommissions, sessions, subscriptions, userSettings, users } from "./db/schema.js";
import { activeSubscription, freePlan } from "./entitlements.js";
import { recordReferralCommission } from "./referrals.js";
import type { AppDeps } from "./routes/shared.js";
import { newId } from "./routes/shared.js";
import { errors } from "./security/errors.js";

export type UserRow = typeof users.$inferSelect;
type SubRow = typeof subscriptions.$inferSelect;
type PlanRow = typeof plans.$inferSelect;

export const USERS_PAGE_SIZE = 10;
const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const days = (ms: number) => Math.round(ms / 86_400_000);

/** The admin's row for one user: plan and dates from the active subscription, referrals, overrides, totals (HC-AD-087). */
export async function adminRow(deps: AppDeps, u: UserRow, at: Date): Promise<AdminUserRow> {
  const db = deps.db;
  // the active subscription, or the newest one that ran out (so Ends can say "expired N d ago", HC-AD-045)
  const sub = (await activeSubscription(deps, u.id, at)) ?? (await db.select().from(subscriptions).where(and(eq(subscriptions.userId, u.id), eq(subscriptions.status, "active"))).orderBy(desc(subscriptions.startsAt)).limit(1))[0];
  const [ref] = await db.select({ n: sql<number>`count(*)` }).from(users).where(eq(users.referredBy, u.referralCode));
  const [settings] = await db.select({ lotSizes: userSettings.lotSizes }).from(userSettings).where(eq(userSettings.userId, u.id)).limit(1);
  const [paid] = await db.select({ total: sql<string>`coalesce(sum(cast(coalesce(${subscriptions.paidInr}, '0') as numeric)), 0)` }).from(subscriptions).where(eq(subscriptions.userId, u.id));
  const [last] = await db.select({ at: sql<Date | string | null>`max(${sessions.createdAt})` }).from(sessions).where(eq(sessions.userId, u.id));
  const lastAt = last?.at ? new Date(last.at) : null;
  const validityDays = sub && sub.expiresAt ? Math.max(1, Math.round((sub.expiresAt.getTime() - sub.startsAt.getTime()) / 86_400_000)) : null;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    active: u.active,
    planName: sub?.planName ?? null,
    planId: sub?.planId ?? null,
    interval: sub?.interval ?? null,
    startsAt: sub?.startsAt.toISOString() ?? null,
    expiresAt: sub?.expiresAt?.toISOString() ?? null,
    validityDays,
    referrals: Number(ref?.n ?? 0),
    commissionPct: u.commissionPct,
    limitOverrides: u.limitOverrides,
    lotSizes: settings ? settings.lotSizes : null,
    createdAt: u.createdAt.toISOString(),
    mobile: u.mobile,
    referralCode: u.referralCode,
    paidInr: money(Number(paid?.total ?? 0)),
    lastLoginAt: lastAt && !Number.isNaN(lastAt.getTime()) ? lastAt.toISOString() : null,
  };
}

function matchesStatus(r: AdminUserRow, status: AdminUsersQuery["status"], at: Date): boolean {
  if (status === "all") return true;
  if (status === "deactivated") return !r.active;
  if (status === "free") return r.planName === null;
  if (status === "active") return r.planName !== null && (r.expiresAt === null || new Date(r.expiresAt).getTime() > at.getTime());
  return r.planName !== null && r.expiresAt !== null && new Date(r.expiresAt).getTime() <= at.getTime();
}

function compare(a: AdminUserRow, b: AdminUserRow, sort: AdminUsersQuery["sort"]): number {
  const av = a[sort];
  const bv = b[sort];
  if (av === null && bv === null) return 0;
  if (av === null) return 1; // nulls last in either direction
  if (bv === null) return -1;
  if (sort === "paidInr") return Number(av) - Number(bv);
  return String(av).localeCompare(String(bv));
}

/** Search, filters, sort and a 10-row page over every user (HC-AD-086, 089, 094, 099). */
export async function listUsers(deps: AppDeps, q: AdminUsersQuery, at: Date): Promise<{ items: AdminUserRow[]; total: number; page: number; pageSize: number }> {
  const needle = q.q ? `%${q.q.toLowerCase()}%` : null;
  const where = needle ? or(like(sql`lower(${users.email})`, needle), like(sql`lower(${users.name})`, needle)) : undefined;
  const all = await deps.db.select().from(users).where(where);
  const rows: AdminUserRow[] = [];
  for (const u of all) rows.push(await adminRow(deps, u, at));
  const filtered = rows
    .filter((r) => matchesStatus(r, q.status, at))
    .filter((r) => q.plan === "all" || (q.plan === "free" ? r.planId === null : r.planId === q.plan))
    .sort((a, b) => {
      const c = compare(a, b, q.sort);
      const sign = q.dir === "asc" ? 1 : -1;
      if (c !== 0) {
        // nulls stay last whichever direction was asked for
        if (a[q.sort] === null || b[q.sort] === null) return c;
        return c * sign;
      }
      return a.id.localeCompare(b.id);
    });
  const start = (q.page - 1) * USERS_PAGE_SIZE;
  return { items: filtered.slice(start, start + USERS_PAGE_SIZE), total: filtered.length, page: q.page, pageSize: USERS_PAGE_SIZE };
}

function toSub(s: SubRow, at: Date): AdminUserSubscription {
  const active = s.status === "active" && (s.expiresAt === null || s.expiresAt.getTime() > at.getTime());
  return {
    id: s.id,
    planId: s.planId,
    planName: s.planName,
    interval: s.interval,
    status: s.status === "active" && !active ? "expired" : s.status,
    startsAt: s.startsAt.toISOString(),
    expiresAt: s.expiresAt?.toISOString() ?? null,
    validityDays: s.expiresAt ? Math.max(1, Math.round((s.expiresAt.getTime() - s.startsAt.getTime()) / 86_400_000)) : null,
    daysLeft: active && s.expiresAt ? Math.max(0, days(s.expiresAt.getTime() - at.getTime())) : null,
    priceInr: s.priceInr,
    paidInr: s.paidInr,
  };
}

/** Everything the drawer shows (HC-AD-101..107): row, subscriptions, plan defaults, referral summary, audit history. */
export async function userDetail(deps: AppDeps, id: string, at: Date): Promise<AdminUserDetail | null> {
  const db = deps.db;
  const [u] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!u) return null;
  const user = await adminRow(deps, u, at);
  const subs = await db.select().from(subscriptions).where(eq(subscriptions.userId, id)).orderBy(desc(subscriptions.startsAt));
  const active = await activeSubscription(deps, id, at);
  const planRow: PlanRow | undefined = active?.planId ? (await db.select().from(plans).where(eq(plans.id, active.planId)).limit(1))[0] : await freePlan(deps);
  const interval: BillingInterval = active?.interval ?? "monthly";
  const limits: PlanLimits = planRow ? planRow.intervals[interval].limits : {};
  const referred = await db.select().from(users).where(eq(users.referredBy, u.referralCode)).orderBy(desc(users.createdAt));
  const commissions = await db.select().from(referralCommissions).where(eq(referralCommissions.referrerId, u.id)).orderBy(desc(referralCommissions.createdAt));
  const latest = new Map<string, (typeof commissions)[number]>();
  for (const c of commissions) if (!latest.has(c.referredUserId)) latest.set(c.referredUserId, c);
  const sum = (status: "paid" | "pending") => commissions.filter((c) => c.status === status).reduce((t, c) => t + Number(c.commissionInr), 0);
  const audit = await db.select({ id: auditLog.id, action: auditLog.action, target: auditLog.target, actorId: auditLog.actorId, at: auditLog.at, after: auditLog.after }).from(auditLog).where(eq(auditLog.target, `user:${id}`)).orderBy(desc(auditLog.at), desc(auditLog.id)).limit(20);
  const actorIds = [...new Set(audit.map((a) => a.actorId).filter((x): x is string => x !== null))];
  const actors = actorIds.length ? await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, actorIds)) : [];
  const actorEmail = new Map(actors.map((a) => [a.id, a.email]));
  const history: AuditEntry[] = audit.map((a) => ({ id: a.id, action: a.action, target: a.target, actorId: a.actorId, actorEmail: a.actorId ? (actorEmail.get(a.actorId) ?? null) : null, at: a.at.toISOString(), after: a.after ?? null }));
  return {
    user,
    subscription: active ? toSub(active, at) : null,
    subscriptions: subs.map((s) => toSub(s, at)),
    planDefaults: { planName: planRow?.name ?? "Free", limits },
    referrals: {
      code: u.referralCode,
      commissionPct: u.commissionPct,
      count: referred.length,
      earnedInr: money(sum("paid") + sum("pending")),
      paidInr: money(sum("paid")),
      pendingInr: money(sum("pending")),
      rows: referred.map((r) => {
        const c = latest.get(r.id);
        return { userId: r.id, name: r.name, email: r.email, joinedAt: r.createdAt.toISOString(), planName: c?.planName ?? null, interval: c?.interval ?? null, amountInr: c?.amountInr ?? "0", commissionInr: c?.commissionInr ?? "0", status: c?.status ?? "not_paid", month: (c?.createdAt ?? r.createdAt).toISOString().slice(0, 7) };
      }),
    },
    history,
  };
}

/**
 * Put a user on a plan without payment (HC-AD-100, 104): the active subscription is cancelled and a new one starts
 * now at the plan's list price with paidInr 0. The referrer's commission row follows (₹0 → No Purchase).
 */
export async function setPlan(deps: AppDeps, userId: string, planId: string, interval: BillingInterval, at: Date): Promise<{ planName: string; subscriptionId: string }> {
  const db = deps.db;
  const [plan] = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
  if (!plan || !plan.active) throw errors.notFound("Plan");
  const pricing = plan.intervals[interval];
  const current = await activeSubscription(deps, userId, at);
  if (current) await db.update(subscriptions).set({ status: "cancelled", updatedAt: at }).where(eq(subscriptions.id, current.id));
  const expiresAt = Number(pricing.priceInr) === 0 ? null : new Date(at.getTime() + INTERVAL_MONTHS[interval] * 30 * 86_400_000);
  const [created] = await db.insert(subscriptions).values({ id: newId("sub"), userId, planName: plan.name, planId: plan.id, interval, priceInr: pricing.priceInr, paidInr: "0", currency: "INR", status: "active", startsAt: at, expiresAt, featureLimits: pricing.limits, createdAt: at, updatedAt: at }).returning();
  if (created) await recordReferralCommission(deps, created, at);
  return { planName: plan.name, subscriptionId: created?.id ?? "" };
}

/** Role and account rules (ADR-032): never the acting admin's own role or account, never the last admin. */
export async function assertRoleChangeAllowed(deps: AppDeps, actorId: string, target: UserRow, role: "user" | "admin"): Promise<void> {
  if (target.id === actorId) throw errors.conflict("You cannot change your own role");
  if (target.role === role) return;
  if (role === "admin" && !target.active) throw errors.conflict("Activate the account before making it an admin");
  if (role === "user") {
    const [n] = await deps.db.select({ n: sql<number>`count(*)` }).from(users).where(and(eq(users.role, "admin"), eq(users.active, true)));
    if (Number(n?.n ?? 0) <= 1) throw errors.conflict("HapieCoin needs at least one active admin");
  }
}

/** Create the user row and send the invitation (HC-AD-108); the invitee signs in by OTP, no password is set. */
export async function inviteUser(deps: AppDeps, input: { name: string; email: string; mobile?: string | undefined; planId?: string | undefined; interval?: BillingInterval | undefined }, invitedBy: string, at: Date): Promise<UserRow> {
  const db = deps.db;
  const email = input.email.toLowerCase();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) throw errors.conflict(`${email} already has an account`);
  const [row] = await db
    .insert(users)
    .values({ id: newId("usr"), name: input.name, email, emailVerified: false, role: "user", avatar: "rocket", referralCode: await uniqueReferralCode(db), referredBy: null, mobile: input.mobile ?? null, createdAt: at, updatedAt: at })
    .returning();
  if (!row) throw new Error("invite insert returned no row");
  if (input.planId && input.interval) await setPlan(deps, row.id, input.planId, input.interval, at);
  const link = `${deps.config.webUrl.replace(/\/+$/, "")}/auth?tab=login&email=${encodeURIComponent(email)}`;
  await deps.mailer.sendInvite({ email, name: input.name, invitedBy, link });
  return row;
}
