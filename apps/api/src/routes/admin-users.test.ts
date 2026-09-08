// Admin · User Management (Phase 4 item 4a, ADR-032): list search / filters / sort / paging with the new columns,
// the drawer detail, comped plan changes (single and bulk), invitations by mail, and the role / account rules.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { AdminUserDetail, AdminUserRow, AdminUsersPage, BulkPlanResult } from "@hapiecoin/schema";
import { subscriptions, users } from "../db/schema.js";
import { SEED } from "../db/seed.js";
import { createTestApp, type TestApp } from "../test-support/harness.js";

let t: TestApp;
let admin: string;
let ria: string;
let riaId: string;
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
const list = (query: string, cookie = admin) => t.request(`/v1/admin/users${query}`, { cookie }).then((r) => json<AdminUsersPage>(r));

beforeAll(async () => {
  t = await createTestApp();
  admin = await t.adminCookie();
  ria = (await t.signUp("ria-adm@hapiecoin.test", { plan: "free", name: "Ria Kapoor", mobile: "9000000011" })).cookie;
  riaId = ((await (await t.request("/v1/me", { cookie: ria })).json()) as { id: string }).id;
  await t.signUp("sam-adm@hapiecoin.test", { plan: "elite", name: "Sam Rao" });
  await t.signUp("tom-adm@hapiecoin.test", { plan: "free", name: "Tom Iyer" });
});
afterAll(() => t.close());

describe("HC-AD-086..089, 094, 099 users list", () => {
  it("carries mobile, referral code, amount paid and last login; searches, filters by plan and status, sorts and pages", async () => {
    const all = await list("");
    expect(all.total).toBeGreaterThanOrEqual(4);
    const riaRow = all.items.find((u) => u.id === riaId)!;
    expect(riaRow).toMatchObject({ name: "Ria Kapoor", mobile: "9000000011", paidInr: "0.00", planName: null });
    expect(riaRow.referralCode).toMatch(/^[A-Z0-9]{6,12}$/);
    expect(riaRow.lastLoginAt).not.toBeNull(); // she has a session from sign-up
    expect((await list("?q=RIA")).items.map((u) => u.email)).toEqual(["ria-adm@hapiecoin.test"]);
    expect((await list("?plan=free")).items.every((u) => u.planId === null)).toBe(true);
    expect((await list(`?plan=${SEED.plans.elite}`)).items.map((u) => u.email)).toContain("sam-adm@hapiecoin.test");
    expect((await list("?status=free")).items.some((u) => u.id === riaId)).toBe(true);
    const byName = await list("?sort=name&dir=asc");
    const names = byName.items.map((u) => u.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    const byPlan = await list("?sort=planName&dir=desc");
    expect(byPlan.items.at(-1)?.planName).toBeNull(); // nulls last either way
    expect((await list("?sort=nope")).items).toBeUndefined(); // 400 answers no page
    expect((await t.request("/v1/admin/users?page=99", { cookie: admin })).status).toBe(200);
    expect((await list("?page=99")).items).toEqual([]);
    expect((await t.request("/v1/admin/users", { cookie: ria })).status).toBe(403);
  });
});

describe("HC-AD-101..107 user detail", () => {
  it("returns the row, the subscriptions, plan defaults, referrals and the audit history; 404 for a stranger", async () => {
    const d = await json<AdminUserDetail>(await t.request(`/v1/admin/users/${riaId}`, { cookie: admin }));
    expect(d.user.id).toBe(riaId);
    expect(d.subscription).toBeNull();
    expect(d.planDefaults.planName).toBe("Free");
    expect(d.planDefaults.limits).toHaveProperty("paper_trading");
    expect(d.referrals).toMatchObject({ count: 0, earnedInr: "0.00", rows: [] });
    expect(d.history).toEqual([]);
    expect((await t.request("/v1/admin/users/usr_nope", { cookie: admin })).status).toBe(404);
    expect((await t.request(`/v1/admin/users/${riaId}`, { cookie: ria })).status).toBe(403);
  });
});

describe("HC-AD-100, 104 comped plans", () => {
  it("sets a plan at ₹0 for one user (cancelling the current one), in bulk for many, and refuses unknown plans", async () => {
    const row = await json<AdminUserRow>(await t.request(`/v1/admin/users/${riaId}/plan`, { cookie: admin, json: { planId: SEED.plans.pro, interval: "yearly" } }));
    expect(row).toMatchObject({ planName: "Pro", interval: "yearly", paidInr: "0.00" });
    expect(row.expiresAt).not.toBeNull();
    const again = await json<AdminUserRow>(await t.request(`/v1/admin/users/${riaId}/plan`, { cookie: admin, json: { planId: SEED.plans.basic, interval: "monthly" } }));
    expect(again.planName).toBe("Basic");
    const subs = await t.db.select().from(subscriptions).where(eq(subscriptions.userId, riaId));
    expect(subs.map((s) => s.status).sort()).toEqual(["active", "cancelled"]);
    const d = await json<AdminUserDetail>(await t.request(`/v1/admin/users/${riaId}`, { cookie: admin }));
    expect(d.subscriptions.map((s) => s.status)).toEqual(["active", "cancelled"]);
    expect(d.subscription?.daysLeft).toBeGreaterThan(0);
    expect(d.history.map((h) => h.action)).toEqual(["admin.user.set_plan", "admin.user.set_plan"]);
    expect(d.history[0]?.actorEmail).toBe(SEED.adminEmail);
    expect((await t.request(`/v1/admin/users/${riaId}/plan`, { cookie: admin, json: { planId: "pln_nope", interval: "monthly" } })).status).toBe(404);
    expect((await t.request("/v1/admin/users/usr_nope/plan", { cookie: admin, json: { planId: SEED.plans.pro, interval: "monthly" } })).status).toBe(404);
    const [tom] = await t.db.select().from(users).where(eq(users.email, "tom-adm@hapiecoin.test")).limit(1);
    const bulk = await json<BulkPlanResult>(await t.request("/v1/admin/users/bulk-plan", { cookie: admin, json: { ids: [riaId, tom!.id, "usr_nope"], planId: SEED.plans.elite, interval: "quarterly" } }));
    expect(bulk).toEqual({ updated: 2, planName: "Elite" });
    expect((await list("?q=tom-adm")).items[0]).toMatchObject({ planName: "Elite", interval: "quarterly" });
    expect(await json<BulkPlanResult>(await t.request("/v1/admin/users/bulk-plan", { cookie: admin, json: { ids: ["usr_nope"], planId: SEED.plans.elite, interval: "quarterly" } }))).toEqual({ updated: 0, planName: "" });
    expect((await t.request("/v1/admin/users/bulk-plan", { cookie: admin, json: { ids: ["usr_nope"], planId: "pln_nope", interval: "quarterly" } })).status).toBe(404);
  });
});

describe("HC-AD-108 invite", () => {
  it("creates the user, emails a sign-in link, optionally comps a plan, and refuses a known email", async () => {
    const res = await t.request("/v1/admin/users/invite", { cookie: admin, json: { name: "New Trader", email: "New.Trader@hapiecoin.test", mobile: "9000000099", planId: SEED.plans.basic, interval: "monthly" } });
    expect(res.status).toBe(201);
    const row = await json<AdminUserRow>(res);
    expect(row).toMatchObject({ email: "new.trader@hapiecoin.test", name: "New Trader", mobile: "9000000099", planName: "Basic", role: "user", active: true });
    const mail = t.mail.invites.find((m) => m.email === "new.trader@hapiecoin.test");
    expect(mail?.link).toBe(`${t.config.webUrl}/auth?tab=login&email=new.trader%40hapiecoin.test`);
    expect(mail?.invitedBy).toBe(SEED.adminName);
    expect((await t.request("/v1/admin/users/invite", { cookie: admin, json: { name: "Dup", email: "new.trader@hapiecoin.test" } })).status).toBe(409);
    expect((await t.request("/v1/admin/users/invite", { cookie: admin, json: { name: "Bad", email: "nope" } })).status).toBe(400);
    // the invitee can sign in by OTP straight away
    const { cookie } = await t.signInOtp("new.trader@hapiecoin.test");
    expect((await t.request("/v1/me", { cookie })).status).toBe(200);
  });
});

describe("edge columns and referrals in the detail", () => {
  it("an invitee before first sign-in has no last login, mobile or lot sizes; sorts by paid, last login and ends; referral rows with and without a commission", async () => {
    const res = await t.request("/v1/admin/users/invite", { cookie: admin, json: { name: "Plain Invitee", email: "plain@hapiecoin.test" } });
    expect(res.status).toBe(201);
    const row = await json<AdminUserRow>(res);
    expect(row).toMatchObject({ mobile: null, lastLoginAt: null, planName: null, lotSizes: null, paidInr: "0.00" });
    const d = await json<AdminUserDetail>(await t.request(`/v1/admin/users/${row.id}`, { cookie: admin }));
    expect(d.subscription).toBeNull();
    expect(d.history[0]).toMatchObject({ action: "admin.user.invite", actorEmail: SEED.adminEmail });
    const byPaid = await list("?sort=paidInr&dir=asc");
    expect(byPaid.items[0]?.paidInr).toBe("0.00");
    const byLogin = await list("?sort=lastLoginAt&dir=desc");
    expect(byLogin.items.at(-1)?.lastLoginAt).toBeNull();
    const byEnds = await list("?sort=expiresAt&dir=asc");
    expect(byEnds.items.length).toBeGreaterThan(0);
    // ria refers two sign-ups: one activates Free (a No Purchase commission row), one never activates
    const riaCode = ((await (await t.request("/v1/me", { cookie: ria })).json()) as { referralCode: string }).referralCode;
    const kid = (await t.signUp("kid-adm@hapiecoin.test", { plan: "free", ref: riaCode })).cookie;
    await t.request("/v1/subscription/activate", { cookie: kid, json: { planId: SEED.plans.free, interval: "monthly" } });
    await t.signUp("kid2-adm@hapiecoin.test", { plan: "free", ref: riaCode });
    const rd = await json<AdminUserDetail>(await t.request(`/v1/admin/users/${riaId}`, { cookie: admin }));
    expect(rd.referrals.count).toBe(2);
    expect(rd.referrals.rows.map((r) => r.planName).sort()).toEqual(["Free", null].sort());
    expect(rd.referrals.rows.every((r) => r.status === "not_paid")).toBe(true);
    // a comped Free plan never expires; an invite naming a plan without an interval comps nothing
    const free = await json<AdminUserRow>(await t.request(`/v1/admin/users/${row.id}/plan`, { cookie: admin, json: { planId: SEED.plans.free, interval: "monthly" } }));
    expect(free).toMatchObject({ planName: "Free", expiresAt: null, validityDays: null });
    const half = await json<AdminUserRow>(await t.request("/v1/admin/users/invite", { cookie: admin, json: { name: "Half", email: "half@hapiecoin.test", planId: SEED.plans.pro } }));
    expect(half.planName).toBeNull();
    const byEndsDesc = await list("?sort=expiresAt&dir=desc");
    expect(byEndsDesc.items.at(-1)?.expiresAt).toBeNull();
  });
});

describe("ADR-032 role and account rules", () => {
  it("promotes and demotes, never the acting admin's own role or account, never the last admin, never a deactivated account", async () => {
    const meId = ((await (await t.request("/v1/me", { cookie: admin })).json()) as { id: string }).id;
    expect((await t.request(`/v1/admin/users/${meId}`, { cookie: admin, method: "PATCH", json: { role: "user" } })).status).toBe(409);
    expect((await t.request(`/v1/admin/users/${meId}`, { cookie: admin, method: "PATCH", json: { active: false } })).status).toBe(409);
    expect((await t.request(`/v1/admin/users/${riaId}`, { cookie: admin, method: "PATCH", json: { role: "user" } })).status).toBe(200); // no-op demotion of a user is fine
    await t.request(`/v1/admin/users/${riaId}`, { cookie: admin, method: "PATCH", json: { active: false } });
    expect((await t.request(`/v1/admin/users/${riaId}`, { cookie: admin, method: "PATCH", json: { role: "admin" } })).status).toBe(409);
    await t.request(`/v1/admin/users/${riaId}`, { cookie: admin, method: "PATCH", json: { active: true } });
    const promoted = await json<AdminUserRow>(await t.request(`/v1/admin/users/${riaId}`, { cookie: admin, method: "PATCH", json: { role: "admin", name: "Ria K.", mobile: null } }));
    expect(promoted).toMatchObject({ role: "admin", name: "Ria K.", mobile: null });
    // her existing session now passes the admin guard, and the seeded admin can be demoted while she is active
    expect((await t.request("/v1/admin/users", { cookie: ria })).status).toBe(200);
    expect((await t.request(`/v1/admin/users/${meId}`, { cookie: ria, method: "PATCH", json: { role: "user" } })).status).toBe(200);
    // she is now the last active admin: demoting herself is refused as own role, and the seeded admin cannot demote her either
    expect((await t.request(`/v1/admin/users/${riaId}`, { cookie: ria, method: "PATCH", json: { role: "user" } })).status).toBe(409);
    expect((await t.request(`/v1/admin/users/${riaId}`, { cookie: admin, method: "PATCH", json: { role: "user" } })).status).toBe(403); // the seeded account is a plain user now
    await t.request(`/v1/admin/users/${meId}`, { cookie: ria, method: "PATCH", json: { role: "admin" } }); // restore
    expect((await t.request(`/v1/admin/users/${riaId}`, { cookie: admin, method: "PATCH", json: { role: "user" } })).status).toBe(200);
    const d = await json<AdminUserDetail>(await t.request(`/v1/admin/users/${riaId}`, { cookie: admin }));
    expect(d.history[0]?.action).toBe("admin.user.update");
  });
});
