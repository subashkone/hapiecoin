// Entitlements (Phase 4 item 1, ADR-030): what a user may still do this month, from the plan behind their
// subscription (or the Free plan), with the admin's per-user overrides. One place answers both the My
// Subscription page and the trading routes, so a limit is enforced exactly where the reference's
// "Upgrade Required" dialog appears (HC-SH-054).
import { type Entitlement, type LimitKey, LIMIT_KEYS, LIMIT_LABELS, type Plan, type PlanLimits } from "@hapiecoin/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { plans, strategies, subscriptions, users } from "./db/schema.js";
import type { AppDeps } from "./routes/shared.js";
import { HttpError } from "./security/errors.js";

/** Feature names for the "not included" message (HC-SH-054). */
const FEATURE_NAMES: Record<LimitKey, string> = { paper_trading: "Paper trading", live_trading: "Live trading", alerts: "Alerts", templates: "Saving strategies" };

type PlanRow = typeof plans.$inferSelect;
type SubRow = typeof subscriptions.$inferSelect;

export function toPlan(row: PlanRow): Plan {
  return { id: row.id, name: row.name, description: row.description, features: row.features, intervals: row.intervals, menuItemIds: row.menuItemIds, active: row.active, sortOrder: row.sortOrder, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

/** Start of the current UTC calendar month. */
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** The user's active subscription row (latest by start), if any and not past its expiry. */
export async function activeSubscription(deps: AppDeps, userId: string, now: Date): Promise<SubRow | undefined> {
  const [row] = await deps.db.select().from(subscriptions).where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active"))).orderBy(desc(subscriptions.startsAt)).limit(1);
  if (!row) return undefined;
  if (row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime()) return undefined;
  return row;
}

/** The Free plan: the cheapest active plan at ₹0 monthly, or null when none is configured. */
export async function freePlan(deps: AppDeps): Promise<PlanRow | undefined> {
  const rows = await deps.db.select().from(plans).where(eq(plans.active, true)).orderBy(plans.sortOrder, plans.name);
  return rows.find((p) => Number(p.intervals.monthly.priceInr) === 0);
}

export interface EffectivePlan {
  plan: PlanRow | undefined;
  subscription: SubRow | undefined;
  limits: PlanLimits;
  overrides: PlanLimits;
}

/** Plan limits for the subscription's interval (or the Free plan's monthly limits) plus the user's overrides. */
export async function effectivePlan(deps: AppDeps, userId: string, now: Date): Promise<EffectivePlan> {
  const subscription = await activeSubscription(deps, userId, now);
  let plan: PlanRow | undefined;
  if (subscription?.planId) [plan] = await deps.db.select().from(plans).where(eq(plans.id, subscription.planId)).limit(1);
  if (!plan) plan = await freePlan(deps);
  const interval = subscription?.interval ?? "monthly";
  const limits: PlanLimits = plan ? { ...plan.intervals[interval].limits } : {};
  const [u] = await deps.db.select({ overrides: users.limitOverrides }).from(users).where(eq(users.id, userId)).limit(1);
  return { plan, subscription, limits, overrides: u?.overrides ?? {} };
}

/** Strategies started this month by mode, and the user's saved strategies (drafts). */
export async function monthUsage(deps: AppDeps, userId: string, now: Date): Promise<Record<LimitKey, number>> {
  const since = monthStart(now);
  const rows = await deps.db
    .select({ mode: strategies.tradingMode, n: sql<number>`count(*)` })
    .from(strategies)
    .where(and(eq(strategies.userId, userId), gte(strategies.startedAt, since)))
    .groupBy(strategies.tradingMode);
  const count = (mode: "paper" | "live") => Number(rows.find((r) => r.mode === mode)?.n ?? 0);
  const [drafts] = await deps.db.select({ n: sql<number>`count(*)` }).from(strategies).where(and(eq(strategies.userId, userId), eq(strategies.status, "draft")));
  return { paper_trading: count("paper"), live_trading: count("live"), alerts: 0, templates: Number(drafts?.n ?? 0) };
}

export function resolveEntitlements(e: EffectivePlan, used: Record<LimitKey, number>): Entitlement[] {
  return LIMIT_KEYS.map((key) => {
    const override = e.overrides[key];
    const planLimit = e.limits[key];
    if (override !== undefined && override > 0) return { key, limit: override, included: true, used: used[key], overridden: true };
    if (planLimit === undefined) return { key, limit: 0, included: false, used: used[key], overridden: false };
    return { key, limit: planLimit === 0 ? null : planLimit, included: true, used: used[key], overridden: false };
  });
}

export async function entitlementsFor(deps: AppDeps, userId: string, now: Date): Promise<{ effective: EffectivePlan; entitlements: Entitlement[] }> {
  const effective = await effectivePlan(deps, userId, now);
  const used = await monthUsage(deps, userId, now);
  return { effective, entitlements: resolveEntitlements(effective, used) };
}

/** 403 UPGRADE_REQUIRED carries the message the Upgrade Required dialog shows (HC-SH-054). */
export function upgradeRequired(message: string): HttpError {
  return new HttpError(403, "UPGRADE_REQUIRED", message);
}

/** Throw unless the user may use `key` once more this month; also refuses a deactivated account (HC-AD-047). */
export async function assertEntitled(deps: AppDeps, userId: string, key: LimitKey, now = new Date()): Promise<void> {
  const [u] = await deps.db.select({ active: users.active }).from(users).where(eq(users.id, userId)).limit(1);
  if (u && !u.active) throw new HttpError(403, "ACCOUNT_DEACTIVATED", "Your account has been deactivated. Contact support.");
  const { effective, entitlements } = await entitlementsFor(deps, userId, now);
  const ent = entitlements.find((x) => x.key === key)!;
  const planName = effective.plan?.name ?? "current";
  const label = LIMIT_LABELS[key];
  if (!ent.included) throw upgradeRequired(`${FEATURE_NAMES[key]} is not included in your ${planName} plan. Upgrade to unlock it.`);
  if (ent.limit !== null && ent.used >= ent.limit) throw upgradeRequired(`Your ${planName} plan allows ${ent.limit} ${label.toLowerCase()}; you have used ${ent.used} this month. Upgrade for more.`);
}
