// Promotional emails (Phase 4 item 4c, ADR-035): recipients by segment, per-recipient rendering, delivery rows with
// failures, the test send, history and detail, RBAC.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Campaign, CampaignDetail, CampaignList, RecipientList, SendEmailResult } from "@hapiecoin/schema";
import { eq } from "drizzle-orm";
import { subscriptions } from "../db/schema.js";
import { SEED } from "../db/seed.js";
import { createTestApp, type TestApp } from "../test-support/harness.js";

let t: TestApp;
let admin: string;
let plain: string;
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;

beforeAll(async () => {
  t = await createTestApp();
  admin = await t.adminCookie();
  plain = (await t.signUp("plain-em@hapiecoin.test", { plan: "free", name: "Pia Plain" })).cookie;
  await t.signUp("elite-em@hapiecoin.test", { plan: "elite", name: "Eli Elite" });
  const expired = (await t.signUp("old-em@hapiecoin.test", { plan: "free", name: "Ola Old" })).cookie;
  const oldId = ((await (await t.request("/v1/me", { cookie: expired })).json()) as { id: string }).id;
  await t.request(`/v1/admin/users/${oldId}/plan`, { cookie: admin, json: { planId: SEED.plans.pro, interval: "monthly" } });
  await t.db.update(subscriptions).set({ expiresAt: new Date(Date.now() - 86_400_000) }).where(eq(subscriptions.userId, oldId)); // the Pro comp ended yesterday
  const off = (await t.signUp("off-em@hapiecoin.test", { plan: "free", name: "Off Line" })).cookie;
  const offId = ((await (await t.request("/v1/me", { cookie: off })).json()) as { id: string }).id;
  await t.request(`/v1/admin/users/${offId}`, { cookie: admin, method: "PATCH", json: { active: false } });
});
afterAll(() => t.close());

describe("HC-AD-073, 074, 076 recipients", () => {
  it("lists active users with a status, filters by search and segment, never offers deactivated accounts", async () => {
    const all = await json<RecipientList>(await t.request("/v1/admin/emails/recipients", { cookie: admin }));
    const by = Object.fromEntries(all.items.map((r) => [r.email, r.status]));
    expect(by["plain-em@hapiecoin.test"]).toBe("free");
    expect(by["elite-em@hapiecoin.test"]).toBe("active");
    expect(by["old-em@hapiecoin.test"]).toBe("expired");
    expect(by["off-em@hapiecoin.test"]).toBeUndefined();
    expect(all.capped).toBe(false);
    expect((await json<RecipientList>(await t.request("/v1/admin/emails/recipients?segment=paid", { cookie: admin }))).items.map((r) => r.email).filter((e) => e !== SEED.adminEmail)).toEqual(["elite-em@hapiecoin.test"]); // the seeded admin is on a plan too
    expect((await json<RecipientList>(await t.request("/v1/admin/emails/recipients?segment=expired", { cookie: admin }))).items.map((r) => r.email)).toEqual(["old-em@hapiecoin.test"]);
    expect((await json<RecipientList>(await t.request("/v1/admin/emails/recipients?segment=free", { cookie: admin }))).items.map((r) => r.email)).toEqual(expect.arrayContaining(["plain-em@hapiecoin.test"]));
    expect((await json<RecipientList>(await t.request("/v1/admin/emails/recipients?q=PIA", { cookie: admin }))).items.map((r) => r.email)).toEqual(["plain-em@hapiecoin.test"]);
    expect((await t.request("/v1/admin/emails/recipients", { cookie: plain })).status).toBe(403);
  });
});

describe("HC-AD-078..085, 125 send, test send, history", () => {
  it("renders placeholders per recipient, records deliveries and failures, lists history and detail; test send records nothing", async () => {
    const list = await json<RecipientList>(await t.request("/v1/admin/emails/recipients", { cookie: admin }));
    const ids = list.items.filter((r) => r.email !== SEED.adminEmail).map((r) => r.id);
    t.mail.bounce.add("old-em@hapiecoin.test");
    const res = await t.request("/v1/admin/emails/send", { cookie: admin, json: { userIds: ids, subject: "Hi {{name}}", message: "Your {{plan}} plan ({{email}}) ends {{expiry}}.", segment: "all" } });
    expect(res.status).toBe(201);
    const { campaign } = await json<SendEmailResult>(res);
    expect(campaign).toMatchObject({ subject: "Hi {{name}}", segment: "all", sentBy: SEED.adminName, recipients: 3, delivered: 2, failed: 1 });
    const eli = t.mail.promos.find((m) => m.email === "elite-em@hapiecoin.test");
    expect(eli?.subject).toBe("Hi Eli Elite");
    expect(eli?.text).toMatch(/^Your Elite plan \(elite-em@hapiecoin\.test\) ends \d{2} \w{3,4} \d{4}\.$/);
    expect(t.mail.promos.find((m) => m.email === "plain-em@hapiecoin.test")?.text).toBe("Your Free plan (plain-em@hapiecoin.test) ends no end date.");
    const history = await json<CampaignList>(await t.request("/v1/admin/emails/campaigns", { cookie: admin }));
    expect(history.items.map((c) => c.id)).toEqual([campaign.id]);
    const detail = await json<CampaignDetail>(await t.request(`/v1/admin/emails/campaigns/${campaign.id}`, { cookie: admin }));
    expect(detail.recipients).toHaveLength(3);
    expect(detail.recipients.find((r) => r.email === "old-em@hapiecoin.test")).toMatchObject({ status: "failed", error: expect.stringContaining("550") as string });
    expect(detail.recipients.filter((r) => r.status === "sent")).toHaveLength(2);
    expect((await t.request("/v1/admin/emails/campaigns/cmp_nope", { cookie: admin })).status).toBe(404);
    // validation and refusals
    expect((await t.request("/v1/admin/emails/send", { cookie: admin, json: { userIds: [], subject: "s", message: "m" } })).status).toBe(400);
    expect((await t.request("/v1/admin/emails/send", { cookie: admin, json: { userIds: ["usr_nope"], subject: "s", message: "m" } })).status).toBe(400);
    expect((await t.request("/v1/admin/emails/send", { cookie: plain, json: { userIds: ids, subject: "s", message: "m" } })).status).toBe(403);
    // test send: to the admin, with the admin's own values, nothing recorded
    const before = t.mail.promos.length;
    const test = await json<{ email: string; subject: string }>(await t.request("/v1/admin/emails/test", { cookie: admin, json: { subject: "Test for {{name}}", message: "{{plan}}" } }));
    expect(test).toEqual({ email: SEED.adminEmail, subject: `Test for ${SEED.adminName}` });
    expect(t.mail.promos.length).toBe(before + 1);
    expect((await json<CampaignList>(await t.request("/v1/admin/emails/campaigns", { cookie: admin }))).items).toHaveLength(1);
    // a second campaign lands first in history
    const second = await json<SendEmailResult>(await t.request("/v1/admin/emails/send", { cookie: admin, json: { userIds: [ids[0]!], subject: "Second", message: "m", segment: "free" } }));
    const two = await json<CampaignList>(await t.request("/v1/admin/emails/campaigns", { cookie: admin }));
    expect(two.items.map((c: Campaign) => c.id)).toEqual([second.campaign.id, campaign.id]);
  });
});
