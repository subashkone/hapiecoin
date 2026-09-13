// Plans and entitlements contract (ADR-030): interval pricing rules, the partial limits map, the price breakdown
// with GST, the admin patch guards and the plan banner state.
import { describe, expect, it } from "vitest";
import { ActivateBody, AdminUserPatch, AdminUserRow, AdminUsersPage, BILLING_INTERVALS, BulkActiveBody, Entitlement, GST_PCT, INTERVAL_MONTHS, LIMIT_KEYS, LIMIT_LABELS, MenuItem, MenuItemInput, Plan, PlanInput, PlanLimits, PlanState, SubscriptionView, priceBreakdown } from "./billing.js";

const pricing = { priceInr: "999", discountPriceInr: "849", limits: { paper_trading: 0, live_trading: 50 } };
const intervals = { monthly: pricing, quarterly: { ...pricing, priceInr: "2699", discountPriceInr: null }, yearly: { ...pricing, priceInr: "8999", discountPriceInr: "7649" } };
const AT = "2026-09-08T00:00:00.000Z";
const plan = { id: "pln_pro", name: "Pro", description: "d", features: ["a"], intervals, menuItemIds: ["mnu_1"], active: true, sortOrder: 20, createdAt: AT, updatedAt: AT };

describe("[SCHEMA] billing", () => {
  it("intervals and limit keys are fixed; labels exist for every key", () => {
    expect(BILLING_INTERVALS).toEqual(["monthly", "quarterly", "yearly"]);
    expect(INTERVAL_MONTHS).toEqual({ monthly: 1, quarterly: 3, yearly: 12 });
    for (const k of LIMIT_KEYS) expect(LIMIT_LABELS[k]).toBeTruthy();
  });

  it("PlanLimits is a partial map of the known keys with non-negative integers", () => {
    expect(PlanLimits.parse({ paper_trading: 3 })).toEqual({ paper_trading: 3 });
    expect(PlanLimits.parse({})).toEqual({});
    expect(PlanLimits.safeParse({ paper_trading: -1 }).success).toBe(false);
    expect(PlanLimits.safeParse({ nope: 1 }).success).toBe(false);
  });

  it("PlanInput applies defaults and refuses a discount above the list price", () => {
    const ok = PlanInput.parse({ name: " Basic ", intervals });
    expect(ok).toMatchObject({ name: "Basic", description: "", features: [], menuItemIds: [], active: true, sortOrder: 100 });
    const bad = PlanInput.safeParse({ name: "X", intervals: { ...intervals, monthly: { priceInr: "100", discountPriceInr: "120", limits: {} } } });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]?.path).toEqual(["intervals", "monthly", "discountPriceInr"]);
    expect(PlanInput.safeParse({ name: "", intervals }).success).toBe(false);
    expect(PlanInput.safeParse({ name: "X", intervals: { ...intervals, monthly: { priceInr: "-1", discountPriceInr: null, limits: {} } } }).success).toBe(false);
  });

  it("Plan, MenuItem and lists parse; MenuItemInput defaults active", () => {
    expect(Plan.parse(plan).name).toBe("Pro");
    expect(Plan.safeParse({ ...plan, extra: 1 }).success).toBe(false);
    expect(MenuItemInput.parse({ displayName: "Reports", category: "Data", priceInr: "199" }).active).toBe(true);
    expect(MenuItem.parse({ id: "mnu_1", displayName: "Reports", category: "Data", priceInr: "199", active: true, linkedPlans: 2, createdAt: AT, updatedAt: AT }).linkedPlans).toBe(2);
    expect(BulkActiveBody.safeParse({ ids: [], active: true }).success).toBe(false);
    expect(ActivateBody.parse({ planId: "pln_pro", interval: "yearly" }).interval).toBe("yearly");
    expect(ActivateBody.safeParse({ planId: "pln_pro", interval: "weekly" }).success).toBe(false);
  });

  it("priceBreakdown: plan discount, coupon on the discounted price, GST on the subtotal, zero stays zero", () => {
    expect(GST_PCT).toBe(18);
    expect(priceBreakdown(pricing)).toEqual({ list: 999, planDiscount: 150, couponDiscount: 0, subtotal: 849, tax: 152.82, total: 1001.82 });
    expect(priceBreakdown(pricing, 10)).toEqual({ list: 999, planDiscount: 150, couponDiscount: 84.9, subtotal: 764.1, tax: 137.54, total: 901.64 });
    expect(priceBreakdown({ priceInr: "0", discountPriceInr: null, limits: {} })).toEqual({ list: 0, planDiscount: 0, couponDiscount: 0, subtotal: 0, tax: 0, total: 0 });
    expect(priceBreakdown({ priceInr: "100", discountPriceInr: null, limits: {} }, 100).total).toBe(0);
  });

  it("entitlements, the subscription view and the plan banner state parse", () => {
    const ent = Entitlement.parse({ key: "paper_trading", limit: null, included: true, used: 4, overridden: false });
    expect(ent.limit).toBeNull();
    expect(PlanState.parse({ state: "expiring_soon", planName: "Pro", expiresAt: AT, daysLeft: 3 }).daysLeft).toBe(3);
    expect(PlanState.parse({ state: "free" }).planName).toBeUndefined();
    const view = SubscriptionView.parse({ plan: { state: "active", planName: "Pro", expiresAt: AT, daysLeft: 30 }, current: { id: "sub_1", planId: "pln_pro", planName: "Pro", interval: "yearly", status: "active", startsAt: AT, expiresAt: AT, priceInr: "8999", paidInr: "0", currency: "INR" }, effectivePlan: plan, entitlements: [ent], plans: [plan], menuItems: ["Reports"], accountActive: true });
    expect(view.current?.planId).toBe("pln_pro");
    expect(SubscriptionView.safeParse({ ...view, entitlements: [{ ...ent, key: "nope" }] }).success).toBe(false);
  });

  it("admin rows and patches: validity, commission 0..100, lot sizes > 0, and nothing-to-update", () => {
    const row = AdminUserRow.parse({ id: "usr_1", email: "a@b.c", name: "A", role: "user", active: true, planName: null, planId: null, interval: null, startsAt: null, expiresAt: null, validityDays: null, referrals: 0, commissionPct: "0", limitOverrides: {}, lotSizes: { BTC: "0.001" }, createdAt: AT, mobile: null, referralCode: "ASHA2026", paidInr: "0", lastLoginAt: null, twoFactorEnabled: false });
    expect(row.lotSizes).toEqual({ BTC: "0.001" });
    expect(AdminUsersPage.parse({ items: [row], total: 1, page: 1, pageSize: 10 }).total).toBe(1);
    expect(AdminUserPatch.parse({ validityDays: 30 })).toEqual({ validityDays: 30 });
    expect(AdminUserPatch.safeParse({}).success).toBe(false);
    expect(AdminUserPatch.safeParse({ commissionPct: "150" }).success).toBe(false);
    expect(AdminUserPatch.safeParse({ commissionPct: "12.5" }).success).toBe(true);
    expect(AdminUserPatch.safeParse({ lotSizes: { BTC: "0" } }).success).toBe(false);
    expect(AdminUserPatch.safeParse({ lotSizes: { ETH: "0.02" } }).success).toBe(true);
    expect(AdminUserPatch.safeParse({ validityDays: 0 }).success).toBe(false);
    expect(AdminUserPatch.safeParse({ limitOverrides: { alerts: 5 } }).success).toBe(true);
  });
});
