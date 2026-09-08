// Plans, entitlements and the admin masters (Phase 4 item 1, ADR-030): the seeded catalogue, the subscription view
// with monthly usage, ₹0 activation vs 402 for paid plans, limits enforced on paper / live starts (HC-SH-054), and
// the admin CRUD, bulk and user-subscription edits behind RBAC.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdminUserRow, AdminUsersPage, MenuItem, Plan, Strategy, SubscriptionView } from "@hapiecoin/schema";
import { SEED } from "../db/seed.js";
import { createTestApp, type TestApp } from "../test-support/harness.js";

let t: TestApp;
let alice: string;
let aliceId: string;
let admin: string;
beforeAll(async () => {
  t = await createTestApp();
  alice = (await t.signUp("alice-billing@hapiecoin.test", { plan: "free" })).cookie;
  aliceId = ((await (await t.request("/v1/me", { cookie: alice })).json()) as { id: string }).id;
  admin = await t.adminCookie();
  t.trading.product("C-BTC-80000-250926", 101, "0.001").markAt("C-BTC-80000-250926", "1200").fillAt(101, "1201");
  t.trading.setBalances([{ asset: "USD", balance: "5000", availableBalance: "4000" }]);
});
afterAll(() => t.close());

const CALL = { kind: "call", side: "buy", strike: "80000", expiry: "2026-09-25", symbol: "C-BTC-80000-250926", lots: 10, price: "1200" };
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
const paperStart = async (cookie: string, name: string) => {
  const d = await json<Strategy>(await t.request("/v1/strategies", { cookie, json: { name, asset: "BTC", legs: [CALL] } }));
  return t.request(`/v1/strategies/${d.id}/start`, { cookie, json: { mode: "paper", brokerId: SEED.brokerId, entries: { [d.legs[0]!.id]: "1200" } } });
};
const view = async (cookie: string) => json<SubscriptionView>(await t.request("/v1/subscription", { cookie }));

describe("HC-AC-003..015 subscription view and the seeded catalogue", () => {
  it("a new user is on the Free plan with its monthly limits and usage; the catalogue lists four active plans in order", async () => {
    const v = await view(alice);
    expect(v.plan.state).toBe("free");
    expect(v.current).toBeNull();
    expect(v.effectivePlan?.name).toBe("Free");
    expect(v.plans.map((p) => p.name)).toEqual(["Free", "Basic", "Pro", "Elite"]);
    expect(v.accountActive).toBe(true);
    const paper = v.entitlements.find((e) => e.key === "paper_trading")!;
    expect(paper).toEqual({ key: "paper_trading", limit: 3, included: true, used: 0, overridden: false });
    expect(v.entitlements.find((e) => e.key === "live_trading")).toMatchObject({ included: false, limit: 0 });
    expect(v.entitlements.find((e) => e.key === "templates")).toMatchObject({ limit: 5, included: true });
    expect((await json<{ items: Plan[] }>(await t.request("/v1/plans", { cookie: alice }))).items).toHaveLength(4);
  });

  it("the seeded admin is on Pro yearly with unlimited paper trades and the linked menu items", async () => {
    const v = await view(admin);
    expect(v.plan.state).toBe("active");
    expect(v.current).toMatchObject({ planName: "Pro", planId: SEED.plans.pro, interval: "yearly", priceInr: "8999" });
    expect(v.entitlements.find((e) => e.key === "paper_trading")).toMatchObject({ limit: null, included: true });
    expect(v.entitlements.find((e) => e.key === "live_trading")).toMatchObject({ limit: 50, included: true });
    expect(v.menuItems).toEqual(["Market Analytics", "Price & P&L Alerts"]);
  });
});

describe("HC-SH-054 limits are enforced where the reference shows Upgrade Required", () => {
  it("the fourth paper trade of the month on Free answers 403 UPGRADE_REQUIRED with a plan-specific message; live is not included", async () => {
    for (let i = 1; i <= 3; i += 1) expect((await paperStart(alice, `paper ${i}`)).status).toBe(200);
    expect((await view(alice)).entitlements.find((e) => e.key === "paper_trading")!.used).toBe(3);
    const fourth = await paperStart(alice, "paper 4");
    expect(fourth.status).toBe(403);
    expect(await json<{ code: string; message: string }>(fourth)).toEqual({ code: "UPGRADE_REQUIRED", message: "Your Free plan allows 3 paper trades / month; you have used 3 this month. Upgrade for more." });
    const d = await json<Strategy>(await t.request("/v1/strategies", { cookie: alice, json: { name: "live try", asset: "BTC", legs: [CALL] } }));
    t.delta.accept("alice-key");
    await t.request("/v1/credentials", { cookie: alice, json: { brokerId: SEED.brokerId, apiKey: "alice-key", apiSecret: "alice-secret" } });
    const live = await t.request(`/v1/strategies/${d.id}/live/place`, { cookie: alice, json: { brokerId: SEED.brokerId, idempotencyKey: "key-billing-live-01" } });
    expect(live.status).toBe(403);
    expect((await json<{ message: string }>(live)).message).toBe("Live trading is not included in your Free plan. Upgrade to unlock it.");
    const batch = await t.request("/v1/strategies/live/batch", { cookie: alice, json: { ids: [d.id], brokerId: SEED.brokerId, idempotencyKey: "key-billing-batch-1" } });
    expect(batch.status).toBe(403);
  });

  it("an admin override lifts the limit for that user only; a deactivated account cannot trade or activate", async () => {
    const bob = (await t.signUp("bob-billing@hapiecoin.test", { plan: "free" })).cookie;
    const bobId = ((await (await t.request("/v1/me", { cookie: bob })).json()) as { id: string }).id;
    const patched = await json<AdminUserRow>(await t.request(`/v1/admin/users/${aliceId}`, { cookie: admin, method: "PATCH", json: { limitOverrides: { paper_trading: 5 } } }));
    expect(patched.limitOverrides).toEqual({ paper_trading: 5 });
    expect((await view(alice)).entitlements.find((e) => e.key === "paper_trading")).toMatchObject({ limit: 5, used: 3, overridden: true });
    expect((await paperStart(alice, "paper 4 again")).status).toBe(200);
    expect((await view(bob)).entitlements.find((e) => e.key === "paper_trading")).toMatchObject({ limit: 3, overridden: false });
    await t.request(`/v1/admin/users/${bobId}`, { cookie: admin, method: "PATCH", json: { active: false } });
    const off = await paperStart(bob, "deactivated");
    expect(off.status).toBe(403);
    expect((await json<{ code: string }>(off)).code).toBe("ACCOUNT_DEACTIVATED");
    expect((await t.request("/v1/subscription/activate", { cookie: bob, json: { planId: SEED.plans.free, interval: "monthly" } })).status).toBe(403);
    expect((await view(bob)).accountActive).toBe(false);
    await t.request(`/v1/admin/users/${bobId}`, { cookie: admin, method: "PATCH", json: { active: true } });
  });
});

describe("HC-AC-023 activation and 402 for paid plans", () => {
  it("₹0 plans activate without a checkout; paid plans answer 402 with the total; the same plan twice is a conflict", async () => {
    const carol = (await t.signUp("carol-billing@hapiecoin.test", { plan: "free" })).cookie;
    const paid = await t.request("/v1/subscription/activate", { cookie: carol, json: { planId: SEED.plans.pro, interval: "monthly" } });
    expect(paid.status).toBe(402);
    expect((await json<{ message: string }>(paid)).message).toMatch(/Pro · monthly costs ₹/);
    const free = await json<SubscriptionView>(await t.request("/v1/subscription/activate", { cookie: carol, json: { planId: SEED.plans.free, interval: "monthly" } }));
    expect(free.current).toMatchObject({ planName: "Free", interval: "monthly", paidInr: "0", expiresAt: null });
    expect(free.plan.state).toBe("active");
    expect((await t.request("/v1/subscription/activate", { cookie: carol, json: { planId: SEED.plans.free, interval: "monthly" } })).status).toBe(409);
    expect((await t.request("/v1/subscription/activate", { cookie: carol, json: { planId: "pln_nope", interval: "monthly" } })).status).toBe(404);
  });
});

describe("HC-AD-004..028, 042..051 admin masters", () => {
  it("plans: create, duplicate name refused, update, bulk deactivate, and a non-admin is refused", async () => {
    const intervals = { monthly: { priceInr: "100", discountPriceInr: "90", limits: { paper_trading: 10 } }, quarterly: { priceInr: "270", discountPriceInr: null, limits: { paper_trading: 10 } }, yearly: { priceInr: "1000", discountPriceInr: "900", limits: { paper_trading: 0 } } };
    expect((await t.request("/v1/admin/plans", { cookie: alice })).status).toBe(403);
    const created = await json<Plan>(await t.request("/v1/admin/plans", { cookie: admin, json: { name: "Starter", description: "d", features: ["one"], intervals, menuItemIds: [SEED.menuItems.alerts], active: true, sortOrder: 5 } }));
    expect(created).toMatchObject({ name: "Starter", active: true, sortOrder: 5 });
    expect((await t.request("/v1/admin/plans", { cookie: admin, json: { name: "starter", intervals } })).status).toBe(409);
    const bad = await t.request("/v1/admin/plans", { cookie: admin, json: { name: "Bad", intervals: { ...intervals, monthly: { priceInr: "100", discountPriceInr: "150", limits: {} } } } });
    expect(bad.status).toBe(400);
    const updated = await json<Plan>(await t.request(`/v1/admin/plans/${created.id}`, { cookie: admin, method: "PATCH", json: { name: "Starter", description: "changed", features: [], intervals, menuItemIds: [], active: false, sortOrder: 5 } }));
    expect(updated).toMatchObject({ description: "changed", active: false });
    expect((await json<{ items: Plan[] }>(await t.request("/v1/plans", { cookie: alice }))).items.map((p) => p.name)).not.toContain("Starter");
    const bulk = await json<{ items: Plan[] }>(await t.request("/v1/admin/plans/bulk", { cookie: admin, json: { ids: [created.id], active: true } }));
    expect(bulk.items[0]!.active).toBe(true);
    expect((await json<{ items: Plan[] }>(await t.request("/v1/admin/plans", { cookie: admin }))).items.map((p) => p.name)).toEqual(["Free", "Starter", "Basic", "Pro", "Elite"]);
    expect((await t.request(`/v1/admin/plans/pln_nope`, { cookie: admin, method: "PATCH", json: { name: "X", intervals } })).status).toBe(404);
  });

  it("menu items: list with linked-plan counts, create, update, bulk", async () => {
    const list = await json<{ items: MenuItem[] }>(await t.request("/v1/admin/menu-items", { cookie: admin }));
    expect(list.items.find((m) => m.id === SEED.menuItems.alerts)?.linkedPlans).toBeGreaterThanOrEqual(3);
    const created = await json<MenuItem>(await t.request("/v1/admin/menu-items", { cookie: admin, json: { displayName: "Backtests", category: "Analytics", priceInr: "399" } }));
    expect(created).toMatchObject({ displayName: "Backtests", linkedPlans: 0, active: true });
    const updated = await json<MenuItem>(await t.request(`/v1/admin/menu-items/${created.id}`, { cookie: admin, method: "PATCH", json: { displayName: "Backtests", category: "Analytics", priceInr: "449", active: true } }));
    expect(updated.priceInr).toBe("449");
    const bulk = await json<{ items: MenuItem[] }>(await t.request("/v1/admin/menu-items/bulk", { cookie: admin, json: { ids: [created.id], active: false } }));
    expect(bulk.items[0]!.active).toBe(false);
    expect((await t.request("/v1/admin/menu-items/mnu_nope", { cookie: admin, method: "PATCH", json: { displayName: "x", category: "y", priceInr: "1" } })).status).toBe(404);
  });

  it("user subscriptions: search, status filter, pagination, validity edit, commission, lot sizes, bulk toggle", async () => {
    const page = await json<AdminUsersPage>(await t.request("/v1/admin/users?q=billing&status=all&page=1", { cookie: admin }));
    expect(page.pageSize).toBe(10);
    expect(page.items.map((u) => u.email)).toEqual(expect.arrayContaining(["alice-billing@hapiecoin.test", "bob-billing@hapiecoin.test", "carol-billing@hapiecoin.test"]));
    const alicRow = page.items.find((u) => u.email === "alice-billing@hapiecoin.test")!;
    expect(alicRow).toMatchObject({ planName: null, referrals: 0, commissionPct: "0", active: true, lotSizes: null });
    const carol = page.items.find((u) => u.email === "carol-billing@hapiecoin.test")!;
    expect(carol).toMatchObject({ planName: "Free", interval: "monthly", validityDays: null });
    expect((await json<AdminUsersPage>(await t.request("/v1/admin/users?status=free&q=billing", { cookie: admin }))).items.every((u) => u.planName === null)).toBe(true);
    expect((await json<AdminUsersPage>(await t.request("/v1/admin/users?status=active", { cookie: admin }))).items.map((u) => u.email)).toContain(SEED.adminEmail);
    // validity on the seeded admin's Pro subscription
    const adminRow = (await json<AdminUsersPage>(await t.request("/v1/admin/users?status=active", { cookie: admin }))).items.find((u) => u.email === SEED.adminEmail)!;
    expect(adminRow.validityDays).toBe(365);
    const extended = await json<AdminUserRow>(await t.request(`/v1/admin/users/${adminRow.id}`, { cookie: admin, method: "PATCH", json: { validityDays: 400, commissionPct: "12.5", lotSizes: { BTC: "0.002" } } }));
    expect(extended.validityDays).toBe(400);
    expect(extended.commissionPct).toBe("12.5");
    expect(extended.lotSizes).toMatchObject({ BTC: "0.002", ETH: "0.01" });
    expect((await t.request(`/v1/admin/users/${alicRow.id}`, { cookie: admin, method: "PATCH", json: { validityDays: 30 } })).status).toBe(409); // no active subscription
    expect((await t.request(`/v1/admin/users/${alicRow.id}`, { cookie: admin, method: "PATCH", json: { commissionPct: "150" } })).status).toBe(400); // 0..100
    expect((await t.request(`/v1/admin/users/usr_nope`, { cookie: admin, method: "PATCH", json: { active: true } })).status).toBe(404);
    const bulk = await json<{ updated: number }>(await t.request("/v1/admin/users/bulk", { cookie: admin, json: { ids: [alicRow.id, adminRow.id], active: false } }));
    expect(bulk.updated).toBe(1); // the admin's own account is skipped
    expect((await json<AdminUsersPage>(await t.request("/v1/admin/users?status=deactivated", { cookie: admin }))).items.map((u) => u.id)).toContain(alicRow.id);
    await t.request("/v1/admin/users/bulk", { cookie: admin, json: { ids: [alicRow.id], active: true } });
    expect((await t.request("/v1/admin/users", { cookie: alice })).status).toBe(403);
  });
});

describe("admin users · referrals, expired filter, self-protection", () => {
  it("counts referrals from the sign-up ref, lists nobody as expired yet, and never bulk-deactivates the acting admin alone", async () => {
    const aliceMe = (await (await t.request("/v1/me", { cookie: alice })).json()) as { referralCode: string };
    await t.signUp("dave-billing@hapiecoin.test", { plan: "free", ref: aliceMe.referralCode });
    const page = await json<AdminUsersPage>(await t.request("/v1/admin/users?q=alice-billing", { cookie: admin }));
    expect(page.items[0]?.referrals).toBe(1);
    expect((await json<AdminUsersPage>(await t.request("/v1/admin/users?status=expired", { cookie: admin }))).total).toBe(0);
    const adminMe = (await (await t.request("/v1/me", { cookie: admin })).json()) as { id: string };
    expect(await json<{ updated: number }>(await t.request("/v1/admin/users/bulk", { cookie: admin, json: { ids: [adminMe.id], active: false } }))).toEqual({ updated: 0 });
    expect((await t.request("/v1/admin/users?page=0", { cookie: admin })).status).toBe(400);
  });
});
