import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { subscriptions } from "../db/schema.js";
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
    expect(await (await t.request("/v1/plan", { cookie })).json()).toEqual({ state: "free" });
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
