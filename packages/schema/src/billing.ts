// Plans, entitlements and subscriptions (Phase 4 item 1, ADR-030). Prices are INR decimal strings (typescript rule 3);
// a limit is per calendar month (UTC): absent key = the plan does not include the feature, 0 = unlimited, n = n per
// month (the reference site's convention, HC-AD-014 / HC-AC-006). Per-user overrides (HC-AD-048) replace the plan
// number when greater than 0.
import { z } from "zod";
import { Id } from "./accounts.js";
import { DecimalString, IsoDateTime, isNonNegativeDecimal } from "./primitives.js";

/** Plan banner state (HC-SH-014, HC-SH-050..053): free / active / expiring soon (≤ 7 days) / expired. */
export const PlanState = z.object({
  state: z.enum(["free", "active", "expiring_soon", "expired"]),
  planName: z.string().optional(),
  /** null = never expires. */
  expiresAt: IsoDateTime.nullable().optional(),
  daysLeft: z.number().int().optional(),
});
export type PlanState = z.infer<typeof PlanState>;

export const BillingInterval = z.enum(["monthly", "quarterly", "yearly"]);
export type BillingInterval = z.infer<typeof BillingInterval>;
export const BILLING_INTERVALS: readonly BillingInterval[] = ["monthly", "quarterly", "yearly"];
/** Months per interval, for the "≈ per month" line and validity. */
export const INTERVAL_MONTHS: Record<BillingInterval, number> = { monthly: 1, quarterly: 3, yearly: 12 };

export const LimitKey = z.enum(["paper_trading", "live_trading", "alerts", "templates"]);
export type LimitKey = z.infer<typeof LimitKey>;
export const LIMIT_KEYS: readonly LimitKey[] = ["paper_trading", "live_trading", "alerts", "templates"];
export const LIMIT_LABELS: Record<LimitKey, string> = { paper_trading: "Paper trades / month", live_trading: "Live trades / month", alerts: "Alerts", templates: "Saved strategies" };

const NonNegativeInr = DecimalString.refine(isNonNegativeDecimal, { message: "must not be negative" });
const LimitCount = z.number().int().min(0).max(1_000_000);
export const PlanLimits = z.partialRecord(LimitKey, LimitCount);
export type PlanLimits = z.infer<typeof PlanLimits>;

export const IntervalPricing = z.strictObject({
  priceInr: NonNegativeInr,
  /** Null = no discount; must not exceed the list price. */
  discountPriceInr: NonNegativeInr.nullable(),
  limits: PlanLimits,
});
export type IntervalPricing = z.infer<typeof IntervalPricing>;

export const PlanIntervals = z.strictObject({ monthly: IntervalPricing, quarterly: IntervalPricing, yearly: IntervalPricing });
export type PlanIntervals = z.infer<typeof PlanIntervals>;

export const PlanInput = z
  .strictObject({
    name: z.string().trim().min(1).max(40),
    description: z.string().trim().max(300).default(""),
    features: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
    intervals: PlanIntervals,
    menuItemIds: z.array(Id).max(50).default([]),
    active: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(1000).default(100),
  })
  .superRefine((p, ctx) => {
    for (const k of BILLING_INTERVALS) {
      const i = p.intervals[k];
      if (i.discountPriceInr !== null && Number(i.discountPriceInr) > Number(i.priceInr)) ctx.addIssue({ code: "custom", message: `${k}: discount price exceeds the list price`, path: ["intervals", k, "discountPriceInr"] });
    }
  });
export type PlanInput = z.infer<typeof PlanInput>;

export const Plan = z.strictObject({
  id: Id,
  name: z.string(),
  description: z.string(),
  features: z.array(z.string()),
  intervals: PlanIntervals,
  menuItemIds: z.array(Id),
  active: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Plan = z.infer<typeof Plan>;
export const PlanList = z.strictObject({ items: z.array(Plan) });

export const MenuItemInput = z.strictObject({
  displayName: z.string().trim().min(1).max(60),
  category: z.string().trim().min(1).max(40),
  priceInr: NonNegativeInr,
  active: z.boolean().default(true),
});
export type MenuItemInput = z.infer<typeof MenuItemInput>;
export const MenuItem = z.strictObject({
  id: Id,
  displayName: z.string(),
  category: z.string(),
  priceInr: DecimalString,
  active: z.boolean(),
  /** Plans referencing this item (HC-AD-022). */
  linkedPlans: z.number().int(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type MenuItem = z.infer<typeof MenuItem>;
export const MenuItemList = z.strictObject({ items: z.array(MenuItem) });

export const BulkActiveBody = z.strictObject({ ids: z.array(Id).min(1).max(200), active: z.boolean() });
export type BulkActiveBody = z.infer<typeof BulkActiveBody>;

/** One feature's entitlement as the app applies it right now (plan limit with the user's override). */
export const Entitlement = z.strictObject({
  key: LimitKey,
  /** Null = unlimited; absent feature is `included: false` with limit 0. */
  limit: z.number().int().nullable(),
  included: z.boolean(),
  used: z.number().int(),
  /** True when the user's admin override, not the plan, set the limit (HC-AD-048). */
  overridden: z.boolean(),
});
export type Entitlement = z.infer<typeof Entitlement>;

export const CurrentSubscription = z.strictObject({
  id: Id,
  planId: Id.nullable(),
  planName: z.string(),
  interval: BillingInterval.nullable(),
  status: z.enum(["active", "expired", "cancelled"]),
  startsAt: IsoDateTime,
  expiresAt: IsoDateTime.nullable(),
  priceInr: DecimalString.nullable(),
  paidInr: DecimalString.nullable(),
  currency: z.string(),
});
export type CurrentSubscription = z.infer<typeof CurrentSubscription>;

/** Everything the My Subscription page needs in one call (HC-AC-003..015). */
export const SubscriptionView = z.strictObject({
  plan: PlanState,
  current: CurrentSubscription.nullable(),
  /** The plan the entitlements come from (the Free plan when there is no subscription), null when none is configured. */
  effectivePlan: Plan.nullable(),
  entitlements: z.array(Entitlement),
  /** Active plans for the comparison grid, in sort order. */
  plans: z.array(Plan),
  /** Menu items linked to the effective plan, by display name. */
  menuItems: z.array(z.string()),
  /** Account switched off by an admin (HC-AD-047): trading and activation refuse. */
  accountActive: z.boolean(),
});
export type SubscriptionView = z.infer<typeof SubscriptionView>;

export const ActivateBody = z.strictObject({ planId: Id, interval: BillingInterval });
export type ActivateBody = z.infer<typeof ActivateBody>;

/** Price breakdown of a plan at an interval (HC-AC-021); tax is GST 18 % on the discounted subtotal. */
export const GST_PCT = 18;
export function priceBreakdown(p: IntervalPricing, couponPct = 0): { list: number; planDiscount: number; couponDiscount: number; subtotal: number; tax: number; total: number } {
  const list = Number(p.priceInr);
  const discounted = p.discountPriceInr === null ? list : Number(p.discountPriceInr);
  const planDiscount = Math.max(0, list - discounted);
  const couponDiscount = Math.round(discounted * (couponPct / 100) * 100) / 100;
  const subtotal = Math.max(0, discounted - couponDiscount);
  const tax = Math.round(subtotal * (GST_PCT / 100) * 100) / 100;
  return { list, planDiscount, couponDiscount, subtotal, tax, total: Math.round((subtotal + tax) * 100) / 100 };
}

/** Admin · User Subscriptions row (HC-AD-044..048). */
export const AdminUserRow = z.strictObject({
  id: Id,
  email: z.string(),
  name: z.string(),
  role: z.enum(["user", "admin"]),
  active: z.boolean(),
  planName: z.string().nullable(),
  planId: Id.nullable(),
  interval: BillingInterval.nullable(),
  startsAt: IsoDateTime.nullable(),
  expiresAt: IsoDateTime.nullable(),
  /** Whole days from startsAt to expiresAt of the active subscription; null without one or when it never expires. */
  validityDays: z.number().int().nullable(),
  referrals: z.number().int(),
  commissionPct: DecimalString,
  limitOverrides: PlanLimits,
  lotSizes: z.partialRecord(z.enum(["BTC", "ETH", "XAUT"]), DecimalString).nullable(),
  createdAt: IsoDateTime,
});
export type AdminUserRow = z.infer<typeof AdminUserRow>;
export const AdminUsersPage = z.strictObject({ items: z.array(AdminUserRow), total: z.number().int(), page: z.number().int(), pageSize: z.number().int() });
export type AdminUsersPage = z.infer<typeof AdminUsersPage>;
export const AdminUserPatch = z
  .strictObject({
    validityDays: z.number().int().min(1).max(3650).optional(),
    active: z.boolean().optional(),
    commissionPct: DecimalString.refine((v) => Number(v) >= 0 && Number(v) <= 100, { message: "0..100" }).optional(),
    limitOverrides: PlanLimits.optional(),
    lotSizes: z.partialRecord(z.enum(["BTC", "ETH", "XAUT"]), DecimalString.refine((v) => Number(v) > 0, { message: "must be greater than zero" })).optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: "nothing to update" });
export type AdminUserPatch = z.infer<typeof AdminUserPatch>;
