// Alerts (Phase 5 item 2, ADR-052): create per kind, list newest first, edit / pause / re-arm, delete, trigger with
// the email channel, and the ownership and state guards.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Alert, AlertList, Strategy } from "@hapiecoin/schema";
import { eq } from "drizzle-orm";
import { auditLog } from "../db/schema.js";
import { createTestApp, type TestApp } from "../test-support/harness.js";
import { alertSubject } from "./alerts.js";

let t: TestApp;
let alice: string;
let bob: string;
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
const CALL = { kind: "call", side: "buy", strike: "80000", expiry: "2026-09-25", symbol: "C-BTC-80000-250926", lots: 10, price: "1200", iv: 0.5 };

beforeAll(async () => {
  t = await createTestApp();
  alice = (await t.signUp("alice-alert@hapiecoin.test")).cookie;
  bob = (await t.signUp("bob-alert@hapiecoin.test")).cookie;
});
afterAll(() => t.close());

describe("HC-SH-095 / HC-SH-098 create and list", () => {
  it("creates price, IV and P&L alerts armed, lists them newest first, hides them from other users", async () => {
    expect((await json<AlertList>(await t.request("/v1/alerts", { cookie: alice }))).items).toEqual([]);
    const price = await t.request("/v1/alerts", { cookie: alice, json: { kind: "price", asset: "BTC", op: ">=", value: "82000", channels: ["push"] } });
    expect(price.status).toBe(201);
    const p = await json<Alert>(price);
    expect(p).toMatchObject({ kind: "price", asset: "BTC", op: ">=", value: "82000", channels: ["push"], state: "armed", strategyId: null, strategyName: null, lastValue: null, triggeredAt: null });
    const iv = await json<Alert>(await t.request("/v1/alerts", { cookie: alice, json: { kind: "iv", asset: "ETH", op: "<=", value: "30", channels: ["push", "email"] } }));
    expect(iv.state).toBe("armed");
    // a P&L alert snapshots the strategy name and must match its asset
    const s = await json<Strategy>(await t.request("/v1/strategies", { cookie: alice, json: { name: "Bull Call Spread", asset: "BTC", templateName: "Custom", legs: [CALL] } }));
    expect((await t.request("/v1/alerts", { cookie: alice, json: { kind: "pnl", asset: "ETH", strategyId: s.id, op: ">=", value: "20", channels: ["email"] } })).status).toBe(400);
    const pnl = await json<Alert>(await t.request("/v1/alerts", { cookie: alice, json: { kind: "pnl", asset: "BTC", strategyId: s.id, op: ">=", value: "20", channels: ["email"] } }));
    expect(pnl).toMatchObject({ strategyId: s.id, strategyName: "Bull Call Spread" });
    // bob's strategy is not alice's
    expect((await t.request("/v1/alerts", { cookie: bob, json: { kind: "pnl", asset: "BTC", strategyId: s.id, op: ">=", value: "20", channels: ["push"] } })).status).toBe(404);
    // validation
    expect((await t.request("/v1/alerts", { cookie: alice, json: { kind: "pnl", asset: "BTC", op: ">=", value: "20", channels: ["push"] } })).status).toBe(400);
    expect((await t.request("/v1/alerts", { cookie: alice, json: { kind: "price", asset: "BTC", op: ">=", value: "0", channels: ["push"] } })).status).toBe(400);
    expect((await t.request("/v1/alerts", { cookie: alice, json: { kind: "price", asset: "BTC", op: ">=", value: "1", channels: [] } })).status).toBe(400);
    expect((await t.request("/v1/alerts", { json: { kind: "price", asset: "BTC", op: ">=", value: "1", channels: ["push"] } })).status).toBe(401);
    const list = await json<AlertList>(await t.request("/v1/alerts", { cookie: alice }));
    expect(list.items.map((a) => a.id)).toEqual([pnl.id, iv.id, p.id]);
    expect((await json<AlertList>(await t.request("/v1/alerts", { cookie: bob }))).items).toEqual([]);
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.target, `alert:${p.id}`));
    expect(audits.map((a) => a.action)).toEqual(["alert.create"]);
  });
});

describe("HC-SH-097 edit, pause, re-arm, delete", () => {
  it("patches the condition, pauses and re-arms, refuses other users, deletes", async () => {
    const a = await json<Alert>(await t.request("/v1/alerts", { cookie: alice, json: { kind: "price", asset: "XAUT", op: "<=", value: "3000", channels: ["push"] } }));
    const edited = await json<Alert>(await t.request(`/v1/alerts/${a.id}`, { cookie: alice, method: "PATCH", json: { value: "2950", channels: ["email"] } }));
    expect(edited).toMatchObject({ value: "2950", channels: ["email"], state: "armed" });
    const paused = await json<Alert>(await t.request(`/v1/alerts/${a.id}`, { cookie: alice, method: "PATCH", json: { state: "paused" } }));
    expect(paused.state).toBe("paused");
    const armed = await json<Alert>(await t.request(`/v1/alerts/${a.id}`, { cookie: alice, method: "PATCH", json: { state: "armed" } }));
    expect(armed.state).toBe("armed");
    expect((await t.request(`/v1/alerts/${a.id}`, { cookie: alice, method: "PATCH", json: {} })).status).toBe(400);
    expect((await t.request(`/v1/alerts/${a.id}`, { cookie: bob, method: "PATCH", json: { state: "paused" } })).status).toBe(404);
    expect((await t.request(`/v1/alerts/${a.id}`, { cookie: bob, method: "DELETE" })).status).toBe(404);
    expect((await t.request(`/v1/alerts/${a.id}`, { cookie: alice, method: "DELETE" })).status).toBe(204);
    expect((await t.request(`/v1/alerts/${a.id}`, { cookie: alice, method: "DELETE" })).status).toBe(404);
    expect((await json<AlertList>(await t.request("/v1/alerts", { cookie: alice }))).items.some((x) => x.id === a.id)).toBe(false);
  });
});

describe("HC-SH-096 trigger", () => {
  it("marks the alert triggered with the reading, mails the email channel, refuses a second trigger until re-armed", async () => {
    const a = await json<Alert>(await t.request("/v1/alerts", { cookie: alice, json: { kind: "price", asset: "BTC", op: ">=", value: "82000", channels: ["push", "email"] } }));
    const before = t.mail.alerts.length;
    const fired = await json<Alert>(await t.request(`/v1/alerts/${a.id}/trigger`, { cookie: alice, json: { value: "82010.5" } }));
    expect(fired).toMatchObject({ state: "triggered", lastValue: "82010.5" });
    expect(fired.triggeredAt).not.toBeNull();
    expect(t.mail.alerts.length).toBe(before + 1);
    const mail = t.mail.alerts[t.mail.alerts.length - 1]!;
    expect(mail.email).toBe("alice-alert@hapiecoin.test");
    expect(mail.subject).toBe("HapieCoin alert · BTC ≥ 82,000");
    expect(mail.text).toContain("Now: 82,010.5");
    // only an armed alert fires; re-arming clears the firing
    expect((await t.request(`/v1/alerts/${a.id}/trigger`, { cookie: alice, json: { value: "82020" } })).status).toBe(409);
    const rearmed = await json<Alert>(await t.request(`/v1/alerts/${a.id}`, { cookie: alice, method: "PATCH", json: { state: "armed" } }));
    expect(rearmed).toMatchObject({ state: "armed", triggeredAt: null, lastValue: "82010.5" });
    expect((await t.request(`/v1/alerts/${a.id}/trigger`, { cookie: bob, json: { value: "1" } })).status).toBe(404);
    // a push-only alert sends no mail; a bounced mailbox does not undo the trigger
    const push = await json<Alert>(await t.request("/v1/alerts", { cookie: alice, json: { kind: "iv", asset: "BTC", op: "<=", value: "30", channels: ["push"] } }));
    await t.request(`/v1/alerts/${push.id}/trigger`, { cookie: alice, json: { value: "29.5" } });
    expect(t.mail.alerts.length).toBe(before + 1);
    t.mail.bounce.add("alice-alert@hapiecoin.test");
    const bounced = await t.request(`/v1/alerts/${rearmed.id}/trigger`, { cookie: alice, json: { value: "82030" } });
    expect(bounced.status).toBe(200);
    expect((await json<Alert>(bounced)).state).toBe("triggered");
    t.mail.bounce.delete("alice-alert@hapiecoin.test");
  });

  it("alertSubject reads per kind", () => {
    expect(alertSubject({ kind: "price", asset: "BTC", strategyName: null, op: ">=", value: "82000" })).toBe("BTC ≥ 82,000");
    expect(alertSubject({ kind: "iv", asset: "ETH", strategyName: null, op: "<=", value: "30" })).toBe("ETH ATM IV ≤ 30%");
    expect(alertSubject({ kind: "pnl", asset: "BTC", strategyName: "Bull Call Spread", op: ">=", value: "20" })).toBe("Bull Call Spread · P&L ≥ +20");
    expect(alertSubject({ kind: "pnl", asset: "BTC", strategyName: null, op: "<=", value: "-15.5" })).toBe("BTC · P&L ≤ -15.5");
  });
});
