// Referrals and commissions (Phase 4 item 3, ADR-031): the referrer's view (link, code, stats, rows, chart), commission
// rows written on activation, admin tiles / rows / detail, Mark Paid with the not-paid reason rule, and bulk pay.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { AdminCommissionDetail, AdminCommissionsView, BulkPayResult, ReferralsView } from "@hapiecoin/schema";
import { subscriptions, users } from "../db/schema.js";
import { SEED } from "../db/seed.js";
import { recordReferralCommission, referralsView } from "../referrals.js";
import { createTestApp, type TestApp } from "../test-support/harness.js";

let t: TestApp;
let ria: string;
let riaCode: string;
let riaId: string;
let admin: string;
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;

beforeAll(async () => {
  t = await createTestApp();
  admin = await t.adminCookie();
  ria = (await t.signUp("ria-ref@hapiecoin.test", { plan: "free" })).cookie;
  const me = (await (await t.request("/v1/me", { cookie: ria })).json()) as { id: string; referralCode: string };
  riaId = me.id;
  riaCode = me.referralCode;
  await t.request(`/v1/admin/users/${riaId}`, { cookie: admin, method: "PATCH", json: { commissionPct: "20" } });
});
afterAll(() => t.close());

describe("HC-AC-037..055 My Referrals", () => {
  it("shows the link and code with no referrals yet, then the referred sign-ups with No Purchase rows", async () => {
    const empty = await json<ReferralsView>(await t.request("/v1/referrals", { cookie: ria }));
    expect(empty.code).toBe(riaCode);
    expect(empty.link).toBe(`${t.config.webUrl}/auth?tab=signup&ref=${riaCode}`);
    expect(empty.commissionPct).toBe("20");
    expect(empty.stats).toEqual({ referrals: 0, earnedInr: "0.00", paidInr: "0.00", pendingInr: "0.00" });
    expect(empty.rows).toEqual([]);
    const sam = (await t.signUp("sam-ref@hapiecoin.test", { plan: "free", ref: riaCode })).cookie;
    await t.request("/v1/subscription/activate", { cookie: sam, json: { planId: SEED.plans.free, interval: "monthly" } });
    const v = await json<ReferralsView>(await t.request("/v1/referrals", { cookie: ria }));
    expect(v.stats.referrals).toBe(1);
    expect(v.rows[0]).toMatchObject({ email: "sam-ref@hapiecoin.test", planName: "Free", interval: "monthly", amountInr: "0", commissionInr: "0", status: "not_paid" });
  });

  it("a paid subscription of a referred user becomes a pending commission at the referrer's percentage", async () => {
    const tom = (await t.signUp("tom-ref@hapiecoin.test", { plan: "free", ref: riaCode })).cookie;
    const tomId = ((await (await t.request("/v1/me", { cookie: tom })).json()) as { id: string }).id;
    // item 2's checkout will write a paid subscription and call the same function; simulate it here
    const startsAt = new Date();
    const [sub] = await t.db.insert(subscriptions).values({ id: "sub_tom_pro", userId: tomId, planName: "Pro", planId: SEED.plans.pro, interval: "monthly", priceInr: "999", paidInr: "849", currency: "INR", status: "active", startsAt, expiresAt: new Date(startsAt.getTime() + 30 * 86_400_000), featureLimits: {} }).returning();
    const row = await recordReferralCommission(t.deps, sub!);
    expect(row).toMatchObject({ referrerId: riaId, referredUserId: tomId, commissionInr: "169.80", commissionPct: "20", status: "pending" });
    expect(await recordReferralCommission(t.deps, sub!)).toMatchObject({ id: row!.id, status: "pending" }); // idempotent per subscription
    const v = await json<ReferralsView>(await t.request("/v1/referrals", { cookie: ria }));
    expect(v.stats).toEqual({ referrals: 2, earnedInr: "169.80", paidInr: "0.00", pendingInr: "169.80" });
    expect(v.rows.find((r) => r.email === "tom-ref@hapiecoin.test")).toMatchObject({ planName: "Pro", amountInr: "849", commissionInr: "169.80", status: "pending" });
    expect(v.byMonth).toHaveLength(1);
    expect(v.byMonth[0]).toMatchObject({ pendingInr: "169.80", paidInr: "0.00" });
    // a user without an inviter yields no row; self-referral is ignored
    const [self] = await t.db.select().from(users).where(eq(users.id, riaId)).limit(1);
    await t.db.update(users).set({ referredBy: riaCode }).where(eq(users.id, riaId));
    const [ownSub] = await t.db.insert(subscriptions).values({ id: "sub_ria_self", userId: riaId, planName: "Pro", planId: SEED.plans.pro, interval: "monthly", priceInr: "999", paidInr: "849", currency: "INR", status: "cancelled", startsAt, expiresAt: null, featureLimits: {} }).returning();
    expect(await recordReferralCommission(t.deps, ownSub!)).toBeNull();
    await t.db.update(users).set({ referredBy: self!.referredBy }).where(eq(users.id, riaId));
  });
});

describe("HC-AD-052..058, 118, 119 admin commissions", () => {
  it("tiles, rows per referrer, month filter and search, detail dialog rows, and RBAC", async () => {
    const v = await json<AdminCommissionsView>(await t.request("/v1/admin/commissions", { cookie: admin }));
    expect(v.tiles).toEqual({ totalInr: "169.80", paidInr: "0.00", pendingInr: "169.80" });
    const row = v.rows.find((r) => r.referrerId === riaId)!;
    expect(row).toMatchObject({ referrals: 2, commissionPct: "20", totalInr: "169.80", pendingInr: "169.80", status: "pending" });
    expect(v.months).toHaveLength(1);
    expect((await json<AdminCommissionsView>(await t.request(`/v1/admin/commissions?month=${v.months[0]}`, { cookie: admin }))).rows).toHaveLength(1);
    expect((await json<AdminCommissionsView>(await t.request("/v1/admin/commissions?month=1999-01", { cookie: admin }))).rows).toHaveLength(0);
    expect((await json<AdminCommissionsView>(await t.request("/v1/admin/commissions?q=nobody", { cookie: admin }))).rows).toHaveLength(0);
    expect((await t.request("/v1/admin/commissions?month=bad", { cookie: admin })).status).toBe(400);
    const d = await json<AdminCommissionDetail>(await t.request(`/v1/admin/commissions/${riaId}`, { cookie: admin }));
    expect(d.referrer.commissionPct).toBe("20");
    expect(d.rows.map((r) => r.status).sort()).toEqual(["not_paid", "pending"]);
    expect((await t.request("/v1/admin/commissions/usr_nope", { cookie: admin })).status).toBe(404);
    expect((await t.request("/v1/admin/commissions", { cookie: ria })).status).toBe(403);
  });

  it("Not Paid needs a reason; Paid settles the pending rows; a second mark is a conflict; bulk pay settles the rest", async () => {
    expect((await t.request(`/v1/admin/commissions/${riaId}/mark`, { cookie: admin, json: { status: "not_paid" } })).status).toBe(400);
    const refused = await json<{ rows: number; amountInr: string }>(await t.request(`/v1/admin/commissions/${riaId}/mark`, { cookie: admin, json: { status: "not_paid", note: "bank details missing", proofUrl: "https://example.com/ticket/1" } }));
    expect(refused).toEqual({ rows: 1, amountInr: "169.80" });
    let v = await json<ReferralsView>(await t.request("/v1/referrals", { cookie: ria }));
    expect(v.rows.find((r) => r.email === "tom-ref@hapiecoin.test")?.status).toBe("not_paid");
    // reopen by recording again (a refreshed subscription): not_paid rows are refreshed to pending, paid ones never
    const [sub] = await t.db.select().from(subscriptions).where(eq(subscriptions.id, "sub_tom_pro")).limit(1);
    await recordReferralCommission(t.deps, sub!);
    const paid = await json<{ rows: number; amountInr: string }>(await t.request(`/v1/admin/commissions/${riaId}/mark`, { cookie: admin, json: { status: "paid" } }));
    expect(paid).toEqual({ rows: 1, amountInr: "169.80" });
    expect((await t.request(`/v1/admin/commissions/${riaId}/mark`, { cookie: admin, json: { status: "paid" } })).status).toBe(409);
    v = await json<ReferralsView>(await t.request("/v1/referrals", { cookie: ria }));
    expect(v.stats).toEqual({ referrals: 2, earnedInr: "169.80", paidInr: "169.80", pendingInr: "0.00" });
    expect(await recordReferralCommission(t.deps, sub!)).toMatchObject({ status: "paid" }); // settled rows stay settled
    const a = await json<AdminCommissionsView>(await t.request("/v1/admin/commissions", { cookie: admin }));
    expect(a.rows.find((r) => r.referrerId === riaId)).toMatchObject({ status: "paid", paidInr: "169.80", pendingInr: "0.00", lastNote: "bank details missing" });
    // bulk: another pending row for a second referred user, then settle everything
    const uma = (await t.signUp("uma-ref@hapiecoin.test", { plan: "free", ref: riaCode })).cookie;
    const umaId = ((await (await t.request("/v1/me", { cookie: uma })).json()) as { id: string }).id;
    const [umaSub] = await t.db.insert(subscriptions).values({ id: "sub_uma_basic", userId: umaId, planName: "Basic", planId: SEED.plans.basic, interval: "yearly", priceInr: "4499", paidInr: "4049", currency: "INR", status: "active", startsAt: new Date(), expiresAt: null, featureLimits: {} }).returning();
    await recordReferralCommission(t.deps, umaSub!);
    expect(await json<BulkPayResult>(await t.request("/v1/admin/commissions/bulk-pay", { cookie: admin, json: { referrerIds: ["usr_nope"] } }))).toEqual({ settledRows: 0, referrers: 0, amountInr: "0.00" });
    expect(await json<BulkPayResult>(await t.request("/v1/admin/commissions/bulk-pay", { cookie: admin, json: {} }))).toEqual({ settledRows: 1, referrers: 1, amountInr: "809.80" });
    expect((await json<AdminCommissionsView>(await t.request("/v1/admin/commissions", { cookie: admin }))).tiles.pendingInr).toBe("0.00");
  });

  it("edge cases: unknown referrer id, unknown or missing referral code, missing user, two referrers sorted by name", async () => {
    expect((await t.request("/v1/admin/commissions/usr_nope/mark", { cookie: admin, json: { status: "paid" } })).status).toBe(404);
    // a sign-up with a code nobody owns, and one without a code, write no commission row
    const ghost = (await t.signUp("ghost-ref@hapiecoin.test", { plan: "free", ref: "NOPE1234" })).cookie;
    const ghostId = ((await (await t.request("/v1/me", { cookie: ghost })).json()) as { id: string }).id;
    const [ghostSub] = await t.db.insert(subscriptions).values({ id: "sub_ghost", userId: ghostId, planName: "Pro", planId: SEED.plans.pro, interval: "monthly", priceInr: "999", paidInr: null, currency: "INR", status: "active", startsAt: new Date(), expiresAt: null, featureLimits: {} }).returning();
    expect(await recordReferralCommission(t.deps, ghostSub!)).toBeNull();
    const lone = (await t.signUp("lone-ref@hapiecoin.test", { plan: "free" })).cookie;
    const loneId = ((await (await t.request("/v1/me", { cookie: lone })).json()) as { id: string }).id;
    const [loneSub] = await t.db.insert(subscriptions).values({ id: "sub_lone", userId: loneId, planName: "Pro", planId: SEED.plans.pro, interval: "monthly", priceInr: "999", paidInr: "849", currency: "INR", status: "active", startsAt: new Date(), expiresAt: null, featureLimits: {} }).returning();
    expect(await recordReferralCommission(t.deps, loneSub!)).toBeNull();
    await expect(referralsView(t.deps, "usr_nope")).rejects.toThrow(/user not found/);
    // a second referrer with a settled row: both referrers have nothing pending, so the list falls back to name order
    const zed = (await t.signUp("zed-ref@hapiecoin.test", { plan: "free" })).cookie;
    const zedMe = (await (await t.request("/v1/me", { cookie: zed })).json()) as { id: string; referralCode: string };
    await t.request(`/v1/admin/users/${zedMe.id}`, { cookie: admin, method: "PATCH", json: { commissionPct: "10" } });
    const yan = (await t.signUp("yan-ref@hapiecoin.test", { plan: "free", ref: zedMe.referralCode })).cookie;
    const yanId = ((await (await t.request("/v1/me", { cookie: yan })).json()) as { id: string }).id;
    const [yanSub] = await t.db.insert(subscriptions).values({ id: "sub_yan", userId: yanId, planName: "Pro", planId: SEED.plans.pro, interval: "monthly", priceInr: "999", paidInr: "849", currency: "INR", status: "active", startsAt: new Date(), expiresAt: null, featureLimits: {} }).returning();
    expect(await recordReferralCommission(t.deps, yanSub!)).toMatchObject({ referrerId: zedMe.id, commissionInr: "84.90", status: "pending" });
    expect(await json<{ rows: number; amountInr: string }>(await t.request(`/v1/admin/commissions/${zedMe.id}/mark`, { cookie: admin, json: { status: "paid", proofUrl: "https://example.com/neft/2" } }))).toEqual({ rows: 1, amountInr: "84.90" });
    const a = await json<AdminCommissionsView>(await t.request("/v1/admin/commissions", { cookie: admin }));
    expect(a.rows).toHaveLength(2);
    expect(a.rows.map((r) => r.pendingInr)).toEqual(["0.00", "0.00"]);
    expect(a.rows.map((r) => r.name)).toEqual([...a.rows.map((r) => r.name)].sort((x, y) => x.localeCompare(y)));
    expect(a.tiles).toEqual({ totalInr: "1064.50", paidInr: "1064.50", pendingInr: "0.00" }); // 169.80 + 809.80 + 84.90    // a referred user's second, ₹0 subscription: the newest row represents them in the list, the paid one still counts
    const [tom] = await t.db.select().from(users).where(eq(users.email, "tom-ref@hapiecoin.test")).limit(1);
    const [tomFree] = await t.db.insert(subscriptions).values({ id: "sub_tom_free", userId: tom!.id, planName: "Free", planId: SEED.plans.free, interval: "monthly", priceInr: "0", paidInr: null, currency: "INR", status: "active", startsAt: new Date(Date.now() + 1000), expiresAt: null, featureLimits: {} }).returning();
    expect(await recordReferralCommission(t.deps, tomFree!, new Date(Date.now() + 1000))).toMatchObject({ amountInr: "0", commissionInr: "0", status: "not_paid" });
    const v = await json<ReferralsView>(await t.request("/v1/referrals", { cookie: ria }));
    expect(v.rows.find((r) => r.email === "tom-ref@hapiecoin.test")).toMatchObject({ planName: "Free", status: "not_paid" });
    expect(v.stats.paidInr).toBe("979.60");
    // a referrer whose only referral never paid is listed as No Purchase
    const wes = (await t.signUp("wes-ref@hapiecoin.test", { plan: "free" })).cookie;
    const wesMe = (await (await t.request("/v1/me", { cookie: wes })).json()) as { id: string; referralCode: string };
    const vic = (await t.signUp("vic-ref@hapiecoin.test", { plan: "free", ref: wesMe.referralCode })).cookie;
    await t.request("/v1/subscription/activate", { cookie: vic, json: { planId: SEED.plans.free, interval: "monthly" } });
    const b = await json<AdminCommissionsView>(await t.request("/v1/admin/commissions", { cookie: admin }));
    expect(b.rows.find((r) => r.referrerId === wesMe.id)).toMatchObject({ referrals: 1, totalInr: "0.00", status: "not_paid", lastNote: null });
  });
});
