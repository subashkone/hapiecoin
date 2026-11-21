import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { plans, subscriptions } from "../db/schema.js";
import { SEED } from "../db/seed.js";
import { createTestApp, type TestApp } from "../test-support/harness.js";
import { planState } from "./plan.js";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const DAY = 24 * 60 * 60 * 1000;

describe("HC-SH-014 plan banner state", () => {
  it("free for a user without a subscription; active until <date> for the seeded admin (Pro, 365 days)", async () => {
    const { cookie } = await t.signUp("plan@hapiecoin.test", { plan: "free" });
    expect(await (await t.request("/v1/plan", { cookie })).json()).toEqual({ state: "free", access: true });
    const admin = await t.adminCookie();
    const body = (await (await t.request("/v1/plan", { cookie: admin })).json()) as {
      state: string;
      planName: string;
      daysLeft: number;
      expiresAt: string;
    };
    expect(body.state).toBe("active");
    expect(body.planName).toBe(SEED.planName);
    expect(body.daysLeft).toBeGreaterThan(300);
    expect(body.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("expiring soon at ≤ 7 days, expired after, and picks the latest subscription", async () => {
    const { cookie } = await t.signUp("plans@hapiecoin.test", { plan: "free" });
    const me = (await (await t.request("/v1/me", { cookie })).json()) as { id: string };
    const now = Date.now();
    await t.db
      .insert(subscriptions)
      .values({
        id: "sub_old",
        userId: me.id,
        planName: "Starter",
        status: "expired",
        startsAt: new Date(now - 100 * DAY),
        expiresAt: new Date(now - 50 * DAY),
        featureLimits: {},
      });
    await t.db
      .insert(subscriptions)
      .values({
        id: "sub_soon",
        userId: me.id,
        planName: "Pro",
        status: "active",
        startsAt: new Date(now - 10 * DAY),
        expiresAt: new Date(now + 3 * DAY),
        featureLimits: {},
      });
    const soon = (await (await t.request("/v1/plan", { cookie })).json()) as {
      state: string;
      daysLeft: number;
    };
    expect(soon.state).toBe("expiring_soon");
    expect(soon.daysLeft).toBeLessThanOrEqual(3);
    // GAPS #30: a cancelled lifetime row (NULL expiry) must not shadow the active dated one
    await t.db
      .insert(subscriptions)
      .values({
        id: "sub_cancelled_lifetime",
        userId: me.id,
        planName: "Legacy",
        status: "cancelled",
        startsAt: new Date(now - 400 * DAY),
        expiresAt: null,
        featureLimits: {},
      });
    const still = (await (await t.request("/v1/plan", { cookie })).json()) as { state: string; planName: string };
    expect(still).toMatchObject({ state: "expiring_soon", planName: "Pro" });
  });

  it("planState covers every branch", () => {
    const now = new Date("2026-09-07T00:00:00Z");
    const base = {
      id: "s",
      userId: "u",
      planName: "Pro",
      status: "active" as const,
      startsAt: now,
      featureLimits: {},
      createdAt: now,
      updatedAt: now,
    };
    expect(planState(undefined, now)).toEqual({ state: "free" });
    expect(planState({ ...base, expiresAt: null }, now)).toEqual({
      state: "active",
      planName: "Pro",
      expiresAt: null,
    });
    expect(planState({ ...base, status: "cancelled", expiresAt: null }, now)).toEqual({
      state: "expired",
      planName: "Pro",
      expiresAt: null,
    });
    expect(
      planState({ ...base, status: "cancelled", expiresAt: new Date(now.getTime() + DAY) }, now),
    ).toMatchObject({ state: "expired" });
    expect(planState({ ...base, expiresAt: new Date(now.getTime() - 1) }, now)).toMatchObject({
      state: "expired",
      daysLeft: 0,
    });
    expect(planState({ ...base, expiresAt: new Date(now.getTime() + 7 * DAY) }, now)).toMatchObject({
      state: "expiring_soon",
      daysLeft: 7,
    });
    expect(planState({ ...base, expiresAt: new Date(now.getTime() + 7 * DAY + 1) }, now)).toMatchObject({
      state: "active",
      daysLeft: 8,
    });
    expect(planState({ ...base, expiresAt: new Date(now.getTime() + 30 * DAY) }, now)).toMatchObject({
      state: "active",
      daysLeft: 30,
    });
  });
});

describe("HC-AC-075 the workspace needs a plan when no Free plan is on offer (ADR-107)", () => {
  const plan = async (cookie: string) => (await (await t.request("/v1/plan", { cookie })).json()) as { state: string; access: boolean };
  const view = async (cookie: string) => ((await (await t.request("/v1/subscription", { cookie })).json()) as { plan: { state: string; access: boolean } }).plan;
  const setFree = (active: boolean) => t.db.update(plans).set({ active }).where(eq(plans.id, SEED.plans.free));

  it("Free on: everyone gets in. Free off: only a running subscription or an admin does, and a lapsed one is out", async () => {
    const none = await t.signUp("gate-none@hapiecoin.test", { plan: "free" });
    const paid = await t.signUp("gate-paid@hapiecoin.test", { plan: "free" });
    const lapsed = await t.signUp("gate-lapsed@hapiecoin.test", { plan: "free" });
    const idOf = async (cookie: string) => ((await (await t.request("/v1/me", { cookie })).json()) as { id: string }).id;
    const admin = await t.adminCookie();
    // an admin puts one user on Pro by hand, with the payment note; another holds a subscription that ran out
    const granted = await t.request(`/v1/admin/users/${await idOf(paid.cookie)}/plan`, { cookie: admin, json: { planId: SEED.plans.pro, interval: "monthly", note: "  UPI ref 4411  " } });
    expect(granted.status).toBe(200);
    await t.db.insert(subscriptions).values({ id: "sub_gate_lapsed", userId: await idOf(lapsed.cookie), planName: "Pro", planId: SEED.plans.pro, interval: "monthly", status: "active", startsAt: new Date(Date.now() - 40 * DAY), expiresAt: new Date(Date.now() - DAY) });

    expect(await plan(none.cookie)).toEqual({ state: "free", access: true });
    expect((await plan(lapsed.cookie)).access).toBe(true); // the Free plan catches a lapsed subscriber
    expect((await view(none.cookie)).access).toBe(true);

    await setFree(false);
    try {
      expect(await plan(none.cookie)).toEqual({ state: "free", access: false });
      expect(await view(none.cookie)).toMatchObject({ state: "free", access: false });
      expect(await plan(paid.cookie)).toMatchObject({ state: "active", planName: "Pro", access: true });
      expect((await view(paid.cookie)).access).toBe(true);
      expect(await plan(lapsed.cookie)).toMatchObject({ state: "expired", access: false });
      expect((await view(lapsed.cookie)).access).toBe(false);
      expect((await plan(admin)).access).toBe(true);
      // an admin whose own plan is gone still runs the product
      await t.db.update(subscriptions).set({ status: "cancelled" }).where(eq(subscriptions.userId, await idOf(admin)));
      expect(await plan(admin)).toMatchObject({ state: "expired", access: true });
      expect((await view(admin)).access).toBe(true);
    } finally {
      await setFree(true);
    }
    expect((await plan(none.cookie)).access).toBe(true);
  });

  it("HC-AD-130 a manual grant keeps the admin's payment note in the user's history; a blank or over-long note is refused", async () => {
    const admin = await t.adminCookie();
    const u = await t.signUp("gate-note@hapiecoin.test", { plan: "free" });
    const id = ((await (await t.request("/v1/me", { cookie: u.cookie })).json()) as { id: string }).id;
    const grant = (json: unknown) => t.request(`/v1/admin/users/${id}/plan`, { cookie: admin, json });
    expect((await grant({ planId: SEED.plans.basic, interval: "monthly", note: "Bank transfer 21 Nov" })).status).toBe(200);
    expect((await grant({ planId: SEED.plans.basic, interval: "monthly" })).status).toBe(200);
    expect((await grant({ planId: SEED.plans.basic, interval: "monthly", note: "   " })).status).toBe(400);
    expect((await grant({ planId: SEED.plans.basic, interval: "monthly", note: "x".repeat(201) })).status).toBe(400);
    const d = (await (await t.request(`/v1/admin/users/${id}`, { cookie: admin })).json()) as { history: { action: string; after: { note: string | null } }[] };
    expect(d.history.map((h) => h.after.note)).toEqual([null, "Bank transfer 21 Nov"]);
    const bulk = await t.request("/v1/admin/users/bulk-plan", { cookie: admin, json: { ids: [id], planId: SEED.plans.pro, interval: "monthly", note: "Cash, batch of one" } });
    expect(bulk.status).toBe(200);
  });
});
