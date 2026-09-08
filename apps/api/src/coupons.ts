// Coupons (Phase 4 item 2, ADR-034): admin CRUD and the one evaluation function every quote, checkout and
// activation goes through. A coupon redeems on a paid payment only; per-user counts come from paid payment rows.
import { type AvailableCoupon, type Coupon, type CouponBulkBody, type CouponInput, type CouponReason, type PriceBreakdown, breakdownFor } from "@hapiecoin/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { coupons, payments, plans } from "./db/schema.js";
import type { AppDeps } from "./routes/shared.js";
import { newId } from "./routes/shared.js";
import { errors } from "./security/errors.js";

export type CouponRow = typeof coupons.$inferSelect;
type PlanRow = typeof plans.$inferSelect;
const asIntervals = (xs: string[]): Coupon["intervals"] => xs.filter((x): x is Coupon["intervals"][number] => x === "monthly" || x === "quarterly" || x === "yearly");

export function toCoupon(c: CouponRow): Coupon {
  return {
    id: c.id,
    code: c.code,
    description: c.description,
    discountType: c.discountType,
    discountValue: c.discountValue,
    minOrderInr: c.minOrderInr,
    maxUses: c.maxUses,
    usedCount: c.usedCount,
    perUserLimit: c.perUserLimit,
    startsAt: c.startsAt?.toISOString() ?? null,
    endsAt: c.endsAt?.toISOString() ?? null,
    scope: c.scope,
    planIds: c.planIds,
    intervals: asIntervals(c.intervals),
    assignedUserIds: c.assignedUserIds,
    active: c.active,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export async function listCoupons(deps: AppDeps): Promise<Coupon[]> {
  return (await deps.db.select().from(coupons).orderBy(desc(coupons.createdAt))).map(toCoupon);
}

async function assertPlansExist(deps: AppDeps, planIds: string[]): Promise<void> {
  const rows = await deps.db.select({ id: plans.id }).from(plans).where(inArray(plans.id, planIds));
  if (rows.length !== new Set(planIds).size) throw errors.badRequest("Unknown plan in the coupon's scope");
}

export async function createCoupon(deps: AppDeps, input: CouponInput, now: Date): Promise<Coupon> {
  await assertPlansExist(deps, input.planIds);
  const [dup] = await deps.db.select({ id: coupons.id }).from(coupons).where(eq(coupons.code, input.code)).limit(1);
  if (dup) throw errors.conflict(`Coupon ${input.code} already exists`);
  const [row] = await deps.db
    .insert(coupons)
    .values({ id: newId("cpn"), ...input, startsAt: input.startsAt ? new Date(input.startsAt) : null, endsAt: input.endsAt ? new Date(input.endsAt) : null, createdAt: now, updatedAt: now })
    .returning();
  if (!row) throw new Error("coupon insert returned no row");
  return toCoupon(row);
}

export async function updateCoupon(deps: AppDeps, id: string, input: CouponInput, now: Date): Promise<Coupon | null> {
  const [current] = await deps.db.select().from(coupons).where(eq(coupons.id, id)).limit(1);
  if (!current) return null;
  await assertPlansExist(deps, input.planIds);
  const [dup] = await deps.db.select({ id: coupons.id }).from(coupons).where(and(eq(coupons.code, input.code), sql`${coupons.id} <> ${id}`)).limit(1);
  if (dup) throw errors.conflict(`Coupon ${input.code} already exists`);
  const [row] = await deps.db
    .update(coupons)
    .set({ ...input, startsAt: input.startsAt ? new Date(input.startsAt) : null, endsAt: input.endsAt ? new Date(input.endsAt) : null, updatedAt: now })
    .where(eq(coupons.id, id))
    .returning();
  return row ? toCoupon(row) : null;
}

export async function setCouponActive(deps: AppDeps, id: string, active: boolean, now: Date): Promise<Coupon | null> {
  const [row] = await deps.db.update(coupons).set({ active, updatedAt: now }).where(eq(coupons.id, id)).returning();
  return row ? toCoupon(row) : null;
}

export async function deleteCoupon(deps: AppDeps, id: string): Promise<boolean> {
  return (await deps.db.delete(coupons).where(eq(coupons.id, id)).returning({ id: coupons.id })).length > 0;
}

export async function bulkCoupons(deps: AppDeps, body: CouponBulkBody, now: Date): Promise<number> {
  if (body.action === "delete") return (await deps.db.delete(coupons).where(inArray(coupons.id, body.ids)).returning({ id: coupons.id })).length;
  return (await deps.db.update(coupons).set({ active: body.action === "activate", updatedAt: now }).where(inArray(coupons.id, body.ids)).returning({ id: coupons.id })).length;
}

/** Paid redemptions of one coupon by one user (HC-AC-018 per-user limit). */
async function userUses(deps: AppDeps, couponId: string, userId: string): Promise<number> {
  const [r] = await deps.db.select({ n: sql<number>`count(*)` }).from(payments).where(and(eq(payments.couponId, couponId), eq(payments.userId, userId), eq(payments.status, "paid")));
  return Number(r?.n ?? 0);
}

/** The reason a coupon does not apply to this purchase, or null (HC-AC-018). `discountedInr` is the plan price after its own discount. */
export async function couponReason(deps: AppDeps, c: CouponRow, userId: string, planId: string, interval: string, discountedInr: number, now: Date): Promise<CouponReason | null> {
  if (!c.active) return "inactive";
  if (c.startsAt && c.startsAt.getTime() > now.getTime()) return "not_started";
  if (c.endsAt && c.endsAt.getTime() < now.getTime()) return "expired";
  if (c.maxUses !== null && c.usedCount >= c.maxUses) return "exhausted";
  if (c.scope === "community" && !c.assignedUserIds.includes(userId)) return "not_assigned";
  if (!c.planIds.includes(planId)) return "wrong_plan";
  if (!c.intervals.includes(interval)) return "wrong_interval";
  if (discountedInr < Number(c.minOrderInr)) return "below_minimum";
  if ((await userUses(deps, c.id, userId)) >= c.perUserLimit) return "per_user_limit";
  return null;
}

export function toAvailable(c: CouponRow, reason: CouponReason | null): AvailableCoupon {
  return { code: c.code, description: c.description, discountType: c.discountType, discountValue: c.discountValue, minOrderInr: c.minOrderInr, endsAt: c.endsAt?.toISOString() ?? null, scope: c.scope, reason };
}

const discountedPrice = (plan: PlanRow, interval: Coupon["intervals"][number]): number => {
  const p = plan.intervals[interval];
  return p.discountPriceInr === null ? Number(p.priceInr) : Number(p.discountPriceInr);
};

/** Public coupons plus community coupons assigned to the user, each with its reason (HC-AC-020). */
export async function availableCoupons(deps: AppDeps, userId: string, plan: PlanRow, interval: Coupon["intervals"][number], now: Date): Promise<{ items: AvailableCoupon[]; breakdown: PriceBreakdown }> {
  const all = await deps.db.select().from(coupons).where(eq(coupons.active, true)).orderBy(desc(coupons.createdAt));
  const visible = all.filter((c) => c.scope === "public" || c.assignedUserIds.includes(userId));
  const discounted = discountedPrice(plan, interval);
  const items: AvailableCoupon[] = [];
  for (const c of visible) items.push(toAvailable(c, await couponReason(deps, c, userId, plan.id, interval, discounted, now)));
  return { items, breakdown: breakdownFor(plan.intervals[interval]) };
}

/** Resolve a code for a purchase: the row when it applies, otherwise the reason (HC-AC-017). */
export async function resolveCoupon(deps: AppDeps, code: string, userId: string, plan: PlanRow, interval: Coupon["intervals"][number], now: Date): Promise<{ row: CouponRow; reason: null } | { row: CouponRow | null; reason: CouponReason }> {
  const [row] = await deps.db.select().from(coupons).where(eq(coupons.code, code.toUpperCase())).limit(1);
  if (!row) return { row: null, reason: "unknown" };
  const reason = await couponReason(deps, row, userId, plan.id, interval, discountedPrice(plan, interval), now);
  return reason ? { row, reason } : { row, reason: null };
}

/** Count a paid redemption (called once per paid payment, inside settlement). */
export async function redeemCoupon(deps: AppDeps, couponId: string, now: Date): Promise<void> {
  await deps.db.update(coupons).set({ usedCount: sql`${coupons.usedCount} + 1`, updatedAt: now }).where(eq(coupons.id, couponId));
}
