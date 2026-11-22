// Stop and target rules run by the API (ADR-059 §2.3; HC-TR-166): fired from the venue's marks, paper without orders,
// live through the exit path short legs first with retries, one fire per rule (across concurrent passes too), the
// other rule disarmed, the kill switch respected, a resting exit never re-sent, a missing credential holding the
// rule armed, everything audited, the trader told by mail and Telegram, the history carrying the batch.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Strategy } from "@hapiecoin/schema";
import { and, eq, like } from "drizzle-orm";
import { auditLog, brokerCredentials, strategies, strategyLegs, strategyRules, users } from "./db/schema.js";
import { SEED } from "./db/seed.js";
import { type RulesTickSource, evaluateRules, startRulesEngine } from "./rules-engine.js";
import { createTestApp, type TestApp } from "./test-support/harness.js";

let t: TestApp;
let alice: string;
let aliceId: string;
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
const T0 = Date.UTC(2026, 8, 11, 9);
const CALL = { kind: "call", side: "buy", strike: "80000", expiry: "2026-09-25", symbol: "C-BTC-80000-250926", lots: 10, price: "1200" };
const PUT = { kind: "put", side: "sell", strike: "78000", expiry: "2026-09-25", symbol: "P-BTC-78000-250926", lots: 10, price: "900" };
const ticks = (m: Record<string, number>, spot: number | null = null): RulesTickSource => ({ tick: () => Promise.resolve({ marks: new Map(Object.entries(m)), spot }) });
const down: RulesTickSource = { tick: () => Promise.reject(new Error("tickers offline")) };
const get = async (id: string) => json<Strategy>(await t.request(`/v1/strategies/${id}`, { cookie: alice }));
const arm = (id: string, rules: unknown[]) => t.request(`/v1/strategies/${id}/rules`, { method: "PUT", cookie: alice, json: { rules } });
const credential = () => t.request("/v1/credentials", { cookie: alice, json: { brokerId: SEED.brokerId, apiKey: "live-key", apiSecret: "live-secret" } });

beforeAll(async () => {
  t = await createTestApp();
  alice = (await t.signUp("rules@hapiecoin.test")).cookie;
  aliceId = (await json<{ id: string }>(await t.request("/v1/me", { cookie: alice }))).id;
  t.delta.accept("live-key");
  expect((await credential()).status).toBe(201);
});
afterAll(() => t.close());
beforeEach(() => {
  t.trading.product("C-BTC-80000-250926", 101, "0.001").markAt("C-BTC-80000-250926", "1200").fillAt(101, "1200");
  t.trading.product("P-BTC-78000-250926", 102, "0.001").markAt("P-BTC-78000-250926", "900").fillAt(102, "900");
  t.trading.setBalances([{ asset: "USD", balance: "5000", availableBalance: "4000" }]);
  t.trading.setPositions([]);
  t.trading.succeed(101).succeed(102); // a scripted refusal never outlives its case
  t.deps.config.trading.disabled = false;
});

async function paper(legs: unknown[] = [CALL, PUT], name = "Rules paper") {
  const s = await json<Strategy>(await t.request("/v1/strategies", { cookie: alice, json: { name, asset: "BTC", legs } }));
  const entries = Object.fromEntries(s.legs.map((l) => [l.id, l.price]));
  return json<Strategy>(await t.request(`/v1/strategies/${s.id}/start`, { cookie: alice, json: { mode: "paper", brokerId: SEED.brokerId, entries } }));
}
async function live(legs: unknown[] = [CALL, PUT], name = "Rules live") {
  const s = await json<Strategy>(await t.request("/v1/strategies", { cookie: alice, json: { name, asset: "BTC", legs } }));
  expect((await t.request(`/v1/strategies/${s.id}/live/place`, { cookie: alice, json: { confirm: "LIVE", brokerId: SEED.brokerId, idempotencyKey: `key-rules-${s.id.slice(-6)}`, expected: {} } })).status).toBe(200);
  return get(s.id);
}
const BOTH = { "C-BTC-80000-250926": 700, "P-BTC-78000-250926": 900 }; // call −5, put 0 → −5

describe("HC-TR-166 paper", () => {
  it("HC-SH-125 reads the tick once per venue and asset, and a venue this API does not read leaves its rules waiting (ADR-070)", async () => {
    const a = await paper();
    const b = await paper([CALL, PUT], "Rules paper two");
    expect((await arm(a.id, [{ kind: "stop", trigger: "money", value: "5" }])).status).toBe(200);
    expect((await arm(b.id, [{ kind: "stop", trigger: "money", value: "5" }])).status).toBe(200);
    const seen: string[] = [];
    const counting: RulesTickSource = {
      tick: (asset, venue) => {
        seen.push(`${venue}:${asset}`);
        return Promise.resolve({ marks: new Map([["C-BTC-80000-250926", 1200], ["P-BTC-78000-250926", 900]]), spot: null });
      },
    };
    expect(await evaluateRules(t.deps, counting, () => T0)).toEqual({ checked: 2, fired: [], skipped: 0 });
    expect(seen).toEqual(["delta_india:BTC"]); // two strategies, one venue, one asset: one read
    const silent: RulesTickSource = { tick: () => Promise.resolve(null) };
    expect(await evaluateRules(t.deps, silent, () => T0)).toEqual({ checked: 0, fired: [], skipped: 2 });
    // leave nothing armed for the cases that follow in this file
    expect((await arm(a.id, [])).status).toBe(200);
    expect((await arm(b.id, [])).status).toBe(200);
  });

  it("fires the stop when the P&L reaches the level, not before; exits every leg at the mark without any order; disarms the target; never fires twice", async () => {
    const s = await paper();
    const placed = t.trading.placed.length;
    expect((await arm(s.id, [{ kind: "stop", trigger: "money", value: "5" }, { kind: "target", trigger: "money", value: "3" }])).status).toBe(200);
    // call bought at 1,200 marks 800: −4; put sold at 900 marks 900: 0 → −4, above the −5 stop
    expect(await evaluateRules(t.deps, ticks({ "C-BTC-80000-250926": 800, "P-BTC-78000-250926": 900 }), () => T0)).toEqual({ checked: 2, fired: [], skipped: 0 });
    expect((await get(s.id)).status).toBe("paper");
    // a leg without a mark, or no marks at all: nothing is judged
    expect(await evaluateRules(t.deps, ticks({ "C-BTC-80000-250926": 700 }), () => T0)).toEqual({ checked: 0, fired: [], skipped: 2 });
    expect(await evaluateRules(t.deps, down, () => T0)).toEqual({ checked: 0, fired: [], skipped: 2 });
    // call at 700: −5 → the stop fires
    const report = await evaluateRules(t.deps, ticks(BOTH), () => T0 + 1000);
    expect(report.checked).toBe(2);
    expect(report.fired).toHaveLength(1);
    expect(t.trading.placed.length).toBe(placed); // paper: no order, ever
    const done = await get(s.id);
    expect(done.status).toBe("archived");
    expect(done.closeReason).toBe("stopped");
    expect(done.realizedPnl).toBe("-5");
    expect(done.legs.map((l) => [l.status, l.exitPrice, l.closeReason])).toEqual([["squared_off", "700", "stopped"], ["squared_off", "900", "stopped"]]);
    const stop = done.rules!.find((r) => r.kind === "stop")!;
    expect(stop).toMatchObject({ state: "fired", firedPnl: "-5", outcome: "closed", firedAt: new Date(T0 + 1000).toISOString() });
    expect(stop.note).toBe("Stop loss fired at P&L -5 USD: 2 legs exited");
    expect(done.rules!.find((r) => r.kind === "target")).toMatchObject({ state: "disarmed", note: "disarmed: the stop loss fired" });
    expect(done.adjustments[done.adjustments.length - 1]).toMatchObject({ batchId: `rule:${stop.id}`, closed: 2, realizedPnl: "-5" });
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.target, `strategy:${s.id}`));
    const fire = audits.find((a) => a.action === "strategy.rule_fire");
    expect(fire?.actorId).toBeNull();
    expect(fire?.after).toMatchObject({ outcome: "closed", archived: true });
    // nothing armed remains: the next tick judges nothing
    expect(await evaluateRules(t.deps, ticks({ "C-BTC-80000-250926": 100, "P-BTC-78000-250926": 900 }), () => T0 + 2000)).toEqual({ checked: 0, fired: [], skipped: 0 });
  });

  it("fires a percentage target on the credit received, books the reason target, and tells the trader by mail and Telegram", async () => {
    await t.db.update(users).set({ telegramChatId: "chat-42" }).where(eq(users.id, aliceId));
    const s = await paper([PUT], "Rules credit");
    // credit 9 USD; target 50 % of it = +4.5: the put must mark at 450 or below
    expect((await arm(s.id, [{ kind: "target", trigger: "pct", value: "50", basis: "credit", basisUsd: "9", channels: ["push", "email", "telegram"] }])).status).toBe(200);
    expect((await get(s.id)).rules![0]!.thresholdUsd).toBe("4.5");
    expect((await evaluateRules(t.deps, ticks({ "P-BTC-78000-250926": 460 }), () => T0)).fired).toHaveLength(0);
    const mails = t.mail.alerts.length;
    expect((await evaluateRules(t.deps, ticks({ "P-BTC-78000-250926": 450 }), () => T0)).fired).toHaveLength(1);
    const done = await get(s.id);
    expect(done.closeReason).toBe("target");
    expect(done.realizedPnl).toBe("4.5");
    expect(done.legs[0]!.closeReason).toBe("target");
    expect(t.mail.alerts.length).toBe(mails + 1);
    expect(t.mail.alerts[t.mail.alerts.length - 1]!.subject).toContain("Target fired · Rules credit");
    expect(t.telegram.sent[t.telegram.sent.length - 1]).toMatchObject({ chatId: "chat-42" });
    expect(t.telegram.sent[t.telegram.sent.length - 1]!.text).toContain("Target fired at P&L 4.5 USD: 1 leg exited");
    await t.db.update(users).set({ telegramChatId: null }).where(eq(users.id, aliceId));
  });

  it("two passes at once claim the rule once", async () => {
    const s = await paper([PUT], "Rules race");
    expect((await arm(s.id, [{ kind: "stop", trigger: "money", value: "1" }])).status).toBe(200);
    const reports = await Promise.all([evaluateRules(t.deps, ticks({ "P-BTC-78000-250926": 1100 }), () => T0), evaluateRules(t.deps, ticks({ "P-BTC-78000-250926": 1100 }), () => T0)]);
    expect(reports.flatMap((r) => r.fired)).toHaveLength(1);
    const done = await get(s.id);
    expect(done.adjustments.filter((a) => a.batchId?.startsWith("rule:"))).toHaveLength(1);
    expect(done.realizedPnl).toBe("-2"); // (1100 − 900) × 10 × 0.001, once
  });
});

describe("HC-TR-166 live", () => {
  it("exits short legs first through the exchange, retries a refused leg the venue calls retryable, and the kill switch holds it", async () => {
    const s = await live();
    expect((await arm(s.id, [{ kind: "stop", trigger: "money", value: "5" }])).status).toBe(200);
    const placedBefore = t.trading.placed.length;
    // trading paused: crossed, but nothing is sent and the rule stays armed with the reason, written once
    t.deps.config.trading.disabled = true;
    expect(await evaluateRules(t.deps, ticks(BOTH), () => T0, { backoffMs: 0 })).toEqual({ checked: 1, fired: [], skipped: 1 });
    expect(await evaluateRules(t.deps, ticks(BOTH), () => T0, { backoffMs: 0 })).toEqual({ checked: 1, fired: [], skipped: 1 });
    expect((await get(s.id)).rules![0]).toMatchObject({ state: "armed", note: "not sent: Live trading is paused by the operator" });
    expect(t.trading.placed.length).toBe(placedBefore);
    t.deps.config.trading.disabled = false;
    // the put's exit is refused once (retryable), then fills on the retry
    t.trading.failWith(102, "market_disrupted", { once: true, retryable: true });
    t.trading.fillAt(101, "700").fillAt(102, "900");
    const report = await evaluateRules(t.deps, ticks(BOTH), () => T0 + 1000, { backoffMs: 1 }); // a real, tiny pause between attempts
    expect(report.fired).toHaveLength(1);
    const sent = t.trading.placed.slice(placedBefore);
    expect(sent.map((o) => [o.input.productId, o.input.side, o.input.reduceOnly])).toEqual([
      [102, "buy", true], // the short put first (refused once)
      [102, "buy", true], // its retry
      [101, "sell", true], // then the long call
    ]);
    const done = await get(s.id);
    expect(done.status).toBe("archived");
    expect(done.closeReason).toBe("stopped");
    expect(done.rules![0]).toMatchObject({ state: "fired", outcome: "closed" });
    expect(done.orders.filter((o) => o.purpose === "exit" && o.state === "closed")).toHaveLength(2);
  });

  it("a leg refused on every attempt stays open and the rule says so; a final refusal is not retried", async () => {
    const s = await live();
    expect((await arm(s.id, [{ kind: "stop", trigger: "money", value: "5" }])).status).toBe(200);
    const placedBefore = t.trading.placed.length;
    t.trading.failWith(102, "insufficient_margin", { retryable: false });
    t.trading.fillAt(101, "700");
    const report = await evaluateRules(t.deps, ticks(BOTH), () => T0, { attempts: 3, backoffMs: 0 });
    expect(report.fired).toHaveLength(1);
    expect(t.trading.placed.slice(placedBefore).map((o) => o.input.productId)).toEqual([102, 101]); // one try for the final refusal, then the call
    const done = await get(s.id);
    expect(done.status).toBe("live"); // the put is still open
    expect(done.legs.map((l) => [l.symbol, l.status])).toEqual([["C-BTC-80000-250926", "squared_off"], ["P-BTC-78000-250926", "open"]]);
    expect(done.rules![0]).toMatchObject({ state: "fired", outcome: "partial" });
    expect(done.rules![0]!.note).toContain("1 still open: P-BTC-78000-250926");
    expect(done.realizedPnl).toBe("-5"); // (700 − 1200) × 10 × 0.001 from the call
  });

  it("an exit the venue accepted but has not filled is never re-sent: the leg waits for the order sync", async () => {
    const s = await live([PUT], "Rules resting");
    expect((await arm(s.id, [{ kind: "stop", trigger: "money", value: "1" }])).status).toBe(200);
    const placedBefore = t.trading.placed.length;
    t.trading.partialNextOrder();
    const report = await evaluateRules(t.deps, ticks({ "P-BTC-78000-250926": 1100 }), () => T0, { attempts: 3, backoffMs: 0 });
    expect(report.fired).toHaveLength(1);
    expect(t.trading.placed.length).toBe(placedBefore + 1); // exactly one exit order
    const done = await get(s.id);
    expect(done.status).toBe("live");
    expect(done.legs[0]!.status).toBe("open");
    expect(done.orders.filter((o) => o.purpose === "exit").map((o) => o.state)).toEqual(["pending"]);
    expect(done.rules![0]).toMatchObject({ state: "fired", outcome: "partial" });
    expect(done.rules![0]!.note).toContain("1 still filling on the exchange: P-BTC-78000-250926");
    // the resting exit fills: the order sync books the leg with the rule's reason and closes the strategy
    const order = done.orders.find((o) => o.purpose === "exit")!;
    t.trading.complete(Number(order.venueOrderId), "1100");
    expect((await t.request(`/v1/strategies/${s.id}/live/sync`, { cookie: alice, json: {} })).status).toBe(200);
    const synced = await get(s.id);
    expect(synced.legs[0]).toMatchObject({ status: "squared_off", exitPrice: "1100", closeReason: "stopped" });
    expect(synced.status).toBe("archived");
    expect(synced.closeReason).toBe("stopped");
    expect(synced.realizedPnl).toBe("-2"); // (1100 − 900) × 10 × 0.001 sold
    expect(synced.rules![0]).toMatchObject({ state: "fired", outcome: "closed" });
    expect(synced.rules![0]!.note).toContain("booked by the order sync");
  });

  it("an exit whose request may not have reached the venue is sent once and reported, never retried", async () => {
    const s = await live([PUT], "Rules unknown");
    expect((await arm(s.id, [{ kind: "stop", trigger: "money", value: "1" }])).status).toBe(200);
    const placedBefore = t.trading.placed.length;
    t.trading.failWith(102, "unknown");
    expect((await evaluateRules(t.deps, ticks({ "P-BTC-78000-250926": 1100 }), () => T0, { attempts: 3, backoffMs: 0 })).fired).toHaveLength(1);
    expect(t.trading.placed.length).toBe(placedBefore + 1);
    const done = await get(s.id);
    expect(done.legs[0]!.status).toBe("open");
    expect(done.rules![0]).toMatchObject({ state: "fired", outcome: "partial" });
    expect(done.rules![0]!.note).toContain("may have reached the exchange: timed out");
    // the row stays pending for the sync; the venue never saw the order, so the sync marks it failed and the leg stays open for Reconcile
    expect(done.orders.filter((o) => o.purpose === "exit").map((o) => o.state)).toEqual(["pending"]);
    expect((await t.request(`/v1/strategies/${s.id}/live/sync`, { cookie: alice, json: {} })).status).toBe(200);
    const synced = await get(s.id);
    expect(synced.orders.filter((o) => o.purpose === "exit").map((o) => o.state)).toEqual(["failed"]);
    expect(synced.legs[0]!.status).toBe("open");
  });

  it("a never-filled entry is neither valued nor exited; a missing credential leaves the rule armed", async () => {
    t.trading.failWith(101, "insufficient_margin", { once: true, retryable: false });
    const s = await live();
    expect(s.legs.map((l) => [l.symbol, l.entryPrice])).toEqual([["C-BTC-80000-250926", null], ["P-BTC-78000-250926", "900"]]);
    expect((await arm(s.id, [{ kind: "stop", trigger: "money", value: "5" }])).status).toBe(200);
    // the credential is gone: crossed, but nothing can be sent and the rule stays armed
    // the key vanishes underneath a live strategy (the route refuses that, ADR-068; a vault or database loss would not)
    await t.db.update(strategies).set({ accountId: null }).where(eq(strategies.userId, aliceId));
    await t.db.delete(brokerCredentials).where(eq(brokerCredentials.userId, aliceId));
    const placedBefore = t.trading.placed.length;
    expect(await evaluateRules(t.deps, ticks({ "P-BTC-78000-250926": 1500 }), () => T0, { backoffMs: 0 })).toEqual({ checked: 1, fired: [], skipped: 1 });
    const held = (await get(s.id)).rules![0]!;
    expect(held.state).toBe("armed");
    expect(held.note).toMatch(/^not sent: /);
    expect(t.trading.placed.length).toBe(placedBefore);
    // the level is no longer crossed: the stale note clears
    expect(await evaluateRules(t.deps, ticks({ "P-BTC-78000-250926": 900 }), () => T0 + 500, { backoffMs: 0 })).toEqual({ checked: 1, fired: [], skipped: 0 });
    expect((await get(s.id)).rules![0]!.note).toBeNull();
    expect((await credential()).status).toBe(201);
    // the put alone is valued: (1500 − 900) × 10 × 0.001 sold = −6 → fires; only the put is exited
    t.trading.fillAt(102, "1500");
    expect((await evaluateRules(t.deps, ticks({ "P-BTC-78000-250926": 1500 }), () => T0 + 1000, { backoffMs: 0 })).fired).toHaveLength(1);
    expect(t.trading.placed.slice(placedBefore).map((o) => o.input.productId)).toEqual([102]);
    const done = await get(s.id);
    expect(done.status).toBe("live"); // the never-filled call is still an open leg for Retry
    expect(done.legs.map((l) => [l.symbol, l.status, l.entryPrice])).toEqual([["C-BTC-80000-250926", "open", null], ["P-BTC-78000-250926", "squared_off", "900"]]);
    expect(done.realizedPnl).toBe("-6");
  });
});

describe("HC-TR-166 the order sync books resting exits; the timer runs a pass", () => {
  it("a partial click exit that rested books its part at the fill with the reason squared off; a leg closed meanwhile is skipped; an unknown product is left alone", async () => {
    const s = await live([CALL, PUT], "Rules sync click"); // the call stays open throughout so the strategy stays live
    const put = s.legs[1]!.id;
    t.trading.partialNextOrder();
    // the click path: the exit rests, the route says so, the row is pending
    expect((await t.request(`/v1/strategies/${s.id}/legs/${put}/close`, { cookie: alice, json: { exitPrice: "950", lots: 4 } })).status).toBe(502);
    let now = await get(s.id);
    const order = now.orders.find((o) => o.purpose === "exit")!;
    expect(order.state).toBe("pending");
    // the product cannot be read at sync time: the fill is left for the trader, nothing is booked whole
    t.trading.complete(Number(order.venueOrderId), "950");
    t.trading.forget("P-BTC-78000-250926");
    expect((await t.request(`/v1/strategies/${s.id}/live/sync`, { cookie: alice, json: {} })).status).toBe(200);
    now = await get(s.id);
    expect(now.legs.map((l) => [l.symbol, l.lots, l.status])).toEqual([["C-BTC-80000-250926", 10, "open"], ["P-BTC-78000-250926", 10, "open"]]);
    t.trading.product("P-BTC-78000-250926", 102, "0.001").markAt("P-BTC-78000-250926", "900").fillAt(102, "900");
    // a second resting partial exit fills and syncs with the product known: 4 of 10 lots book at 950, squared off
    t.trading.partialNextOrder();
    expect((await t.request(`/v1/strategies/${s.id}/legs/${put}/close`, { cookie: alice, json: { exitPrice: "950", lots: 4 } })).status).toBe(502);
    now = await get(s.id);
    const second = now.orders.filter((o) => o.purpose === "exit" && o.state === "pending")[0]!;
    t.trading.complete(Number(second.venueOrderId), "950");
    expect((await t.request(`/v1/strategies/${s.id}/live/sync`, { cookie: alice, json: {} })).status).toBe(200);
    now = await get(s.id);
    expect(now.legs.filter((l) => l.symbol === "P-BTC-78000-250926").map((l) => [l.lots, l.status, l.closeReason ?? null, l.exitPrice])).toEqual([[6, "open", null, null], [4, "squared_off", "squared_off", "950"]]);
    expect(now.realizedPnl).toBe("-0.2"); // (950 − 900) × 4 × 0.001 sold
    // a third rests, then the put is reconciled away before it fills: the synced fill finds no open leg and books nothing
    t.trading.partialNextOrder();
    expect((await t.request(`/v1/strategies/${s.id}/legs/${put}/close`, { cookie: alice, json: { exitPrice: "950", lots: 2 } })).status).toBe(502);
    now = await get(s.id);
    const third = now.orders.filter((o) => o.purpose === "exit" && o.state === "pending")[0]!;
    expect((await t.request(`/v1/strategies/${s.id}/reconcile`, { cookie: alice, json: { legs: [{ legId: put, price: "940" }] } })).status).toBe(200);
    t.trading.complete(Number(third.venueOrderId), "950");
    expect((await t.request(`/v1/strategies/${s.id}/live/sync`, { cookie: alice, json: {} })).status).toBe(200);
    now = await get(s.id);
    expect(now.status).toBe("live"); // the call is still open
    expect(now.legs.filter((l) => l.symbol === "P-BTC-78000-250926").every((l) => l.status === "squared_off")).toBe(true);
    expect(now.realizedPnl).toBe("-0.44"); // −0.2 + (940 − 900) × 6 × 0.001 sold; the late fill booked nothing
  });

  it("marks are read once per underlying per pass; Telegram wanted but not linked is skipped quietly", async () => {
    const a = await paper([PUT], "Rules cache a");
    const b = await paper([PUT], "Rules cache b");
    expect((await arm(a.id, [{ kind: "stop", trigger: "money", value: "1", channels: ["push", "telegram"] }])).status).toBe(200);
    expect((await arm(b.id, [{ kind: "stop", trigger: "money", value: "1" }])).status).toBe(200);
    let reads = 0;
    const counted: RulesTickSource = { tick: () => { reads += 1; return Promise.resolve({ marks: new Map([["P-BTC-78000-250926", 1100]]), spot: null }); } };
    const telegrams = t.telegram.sent.length;
    const report = await evaluateRules(t.deps, counted, () => T0);
    expect(reads).toBe(1);
    expect(report.fired).toHaveLength(2);
    expect(t.telegram.sent.length).toBe(telegrams); // no chat linked: nothing sent, nothing thrown
  });

  it("startRulesEngine runs a pass on its interval, skips a tick while one is still running, and stops", async () => {
    // two legs on the same side: the exit order keeps them as they are (nothing to put first)
    const s = await paper([CALL, { ...CALL, strike: "82000", symbol: "C-BTC-82000-250926" }], "Rules by timer");
    expect((await arm(s.id, [{ kind: "stop", trigger: "money", value: "1" }])).status).toBe(200);
    let reads = 0;
    const slow: RulesTickSource = {
      tick: async () => {
        reads += 1;
        await new Promise((r) => setTimeout(r, 120)); // longer than the interval: the next tick finds a pass running
        return { marks: new Map([["C-BTC-80000-250926", 1000], ["C-BTC-82000-250926", 1000]]), spot: null };
      },
    };
    const stop = startRulesEngine(t.deps, slow, 30);
    try {
      await new Promise((r) => setTimeout(r, 500));
    } finally {
      stop();
    }
    expect(reads).toBeLessThan(10); // 500 ms / 30 ms would be 16 ticks; overlapping ones were skipped
    const done = await get(s.id);
    expect(done.status).toBe("archived");
    expect(done.closeReason).toBe("stopped");
    expect(done.legs.map((l) => l.status)).toEqual(["squared_off", "squared_off"]);
  });
});

describe("HC-TR-170 leg stop, spot level and time exit", () => {
  it("a leg stop at a multiple of the entry exits that leg alone and leaves the strategy stop armed, which then fires on what is left", async () => {
    const s = await paper();
    const put = s.legs.find((l) => l.symbol === PUT.symbol)!;
    expect((await arm(s.id, [{ kind: "stop", trigger: "money", value: "12" }, { kind: "leg_stop", trigger: "multiple", value: "2", legId: put.id }])).status).toBe(200);
    expect((await get(s.id)).rules!.find((r) => r.kind === "leg_stop")).toMatchObject({ thresholdUsd: "1800", legId: put.id, scope: "leg", state: "armed" });
    // the put at 1,700 is below twice its 900 entry; the P&L (−8) is above the −12 stop
    expect((await evaluateRules(t.deps, ticks({ "C-BTC-80000-250926": 1200, "P-BTC-78000-250926": 1700 }), () => T0)).fired).toEqual([]);
    const report = await evaluateRules(t.deps, ticks({ "C-BTC-80000-250926": 1200, "P-BTC-78000-250926": 1800 }), () => T0 + 1000);
    expect(report.fired).toHaveLength(1);
    const after = await get(s.id);
    expect(after.status).toBe("paper");
    expect(after.legs.map((l) => [l.symbol, l.status, l.exitPrice, l.closeReason])).toEqual([
      ["C-BTC-80000-250926", "open", null, null],
      ["P-BTC-78000-250926", "squared_off", "1800", "stopped"],
    ]);
    expect(after.realizedPnl).toBe("-9");
    const legStop = after.rules!.find((r) => r.kind === "leg_stop")!;
    expect(legStop).toMatchObject({ state: "fired", outcome: "closed", firedPnl: "-9" });
    expect(legStop.note).toBe("Leg stop fired at P&L -9 USD (P-BTC-78000-250926 at 1800, entry 900): 1 leg exited");
    expect(after.rules!.find((r) => r.kind === "stop")).toMatchObject({ state: "armed" });
    // the call at 700 takes the total to −14: the strategy stop fires on the leg that is left
    expect((await evaluateRules(t.deps, ticks({ "C-BTC-80000-250926": 700, "P-BTC-78000-250926": 1800 }), () => T0 + 2000)).fired).toHaveLength(1);
    const done = await get(s.id);
    expect(done).toMatchObject({ status: "archived", closeReason: "stopped", realizedPnl: "-14" });
    expect(done.rules!.map((r) => [r.kind, r.state])).toEqual([["stop", "fired"], ["leg_stop", "fired"]]);
  });

  it("a leg stop at a price with strategy scope exits every leg and disarms the rest", async () => {
    const s = await paper([CALL, PUT], "Rules leg all");
    const put = s.legs.find((l) => l.symbol === PUT.symbol)!;
    expect((await arm(s.id, [{ kind: "leg_stop", trigger: "price", value: "1500", legId: put.id, scope: "strategy" }, { kind: "target", trigger: "money", value: "1" }])).status).toBe(200);
    expect((await evaluateRules(t.deps, ticks({ "C-BTC-80000-250926": 1200, "P-BTC-78000-250926": 1500 }), () => T0)).fired).toHaveLength(1);
    const done = await get(s.id);
    expect(done).toMatchObject({ status: "archived", closeReason: "stopped", realizedPnl: "-6" });
    expect(done.legs.map((l) => [l.status, l.closeReason])).toEqual([["squared_off", "stopped"], ["squared_off", "stopped"]]);
    expect(done.rules!.find((r) => r.kind === "target")).toMatchObject({ state: "disarmed", note: "disarmed: the leg stop fired" });
  });

  it("a leg stop whose leg was closed by a click is disarmed and says so; a spot rule waits for a spot and fires on it", async () => {
    const s = await paper();
    const call = s.legs.find((l) => l.symbol === CALL.symbol)!;
    expect((await arm(s.id, [{ kind: "leg_stop", trigger: "price", value: "500", legId: call.id }, { kind: "spot", trigger: "below", value: "78000" }])).status).toBe(200);
    expect((await t.request(`/v1/strategies/${s.id}/legs/${call.id}/close`, { method: "POST", cookie: alice, json: { exitPrice: "1100" } })).status).toBe(200);
    // no spot this tick: the spot rule waits; the leg stop has nothing to watch any more
    expect((await evaluateRules(t.deps, ticks({ "P-BTC-78000-250926": 900 }), () => T0)).fired).toEqual([]);
    expect((await get(s.id)).rules!.map((r) => [r.kind, r.state, r.note])).toEqual([["leg_stop", "disarmed", "disarmed: the leg it watched is closed"], ["spot", "armed", null]]);
    expect((await evaluateRules(t.deps, ticks({ "P-BTC-78000-250926": 900 }, 78_500), () => T0 + 1000)).fired).toEqual([]);
    expect((await evaluateRules(t.deps, ticks({ "P-BTC-78000-250926": 850 }, 77_990), () => T0 + 2000)).fired).toHaveLength(1);
    const done = await get(s.id);
    expect(done).toMatchObject({ status: "archived", closeReason: "stopped", realizedPnl: "-0.5" });
    const spot = done.rules!.find((r) => r.kind === "spot")!;
    expect(spot.note).toBe("Spot level fired at P&L -0.5 USD (spot 77990): 1 leg exited");
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.target, `strategy:${s.id}`));
    expect(audits.filter((a) => a.action === "strategy.rule_fire").at(-1)?.before).toMatchObject({ kind: "spot", spot: 77_990, level: "78000" });
  });

  it("live: a leg-scope stop sends one exit for its leg only; a leg whose exit is still filling is never sent another by the next rule that crosses", async () => {
    const s = await live([CALL, PUT], "Rules live leg");
    const put = s.legs.find((l) => l.symbol === PUT.symbol)!;
    expect((await arm(s.id, [{ kind: "leg_stop", trigger: "price", value: "1500", legId: put.id }, { kind: "stop", trigger: "money", value: "15" }])).status).toBe(200);
    const before = t.trading.placed.length;
    t.trading.partialNextOrder(); // the put's exit rests on the exchange
    expect((await evaluateRules(t.deps, ticks({ "C-BTC-80000-250926": 1200, "P-BTC-78000-250926": 1500 }), () => T0, { attempts: 3, backoffMs: 0 })).fired).toHaveLength(1);
    expect(t.trading.placed.length).toBe(before + 1); // exactly one order, for the put
    let now = await get(s.id);
    expect(now.status).toBe("live");
    expect(now.legs.map((l) => [l.symbol, l.status])).toEqual([["C-BTC-80000-250926", "open"], ["P-BTC-78000-250926", "open"]]);
    expect(now.orders.filter((o) => o.purpose === "exit").map((o) => [o.legId, o.state])).toEqual([[put.id, "pending"]]);
    expect(now.rules!.find((r) => r.kind === "leg_stop")).toMatchObject({ state: "fired", outcome: "partial" });
    expect(now.rules!.find((r) => r.kind === "stop")).toMatchObject({ state: "armed" });
    // the call at 100 takes the P&L to −17: the strategy stop fires, exits the call, and leaves the put to its resting exit
    expect((await evaluateRules(t.deps, ticks({ "C-BTC-80000-250926": 100, "P-BTC-78000-250926": 1500 }), () => T0 + 1000, { attempts: 3, backoffMs: 0 })).fired).toHaveLength(1);
    expect(t.trading.placed.length).toBe(before + 2); // one more, for the call; nothing again for the put
    now = await get(s.id);
    expect(now.legs.map((l) => [l.symbol, l.status, l.closeReason])).toEqual([["C-BTC-80000-250926", "squared_off", "stopped"], ["P-BTC-78000-250926", "open", null]]);
    const stop = now.rules!.find((r) => r.kind === "stop")!;
    expect(stop).toMatchObject({ state: "fired", outcome: "partial" });
    expect(stop.note).toContain("1 still filling on the exchange: P-BTC-78000-250926 (an earlier exit is still filling · sync)");
    expect(now.orders.filter((o) => o.purpose === "exit" && o.legId === put.id)).toHaveLength(1);
  });

  it("a leg stop on a long leg fires when its mark falls to the level, not while it is above", async () => {
    const s = await paper([CALL], "Rules long leg");
    const call = s.legs[0]!;
    expect((await arm(s.id, [{ kind: "leg_stop", trigger: "price", value: "1000", legId: call.id }])).status).toBe(200);
    expect((await evaluateRules(t.deps, ticks({ "C-BTC-80000-250926": 1100 }), () => T0)).fired).toEqual([]);
    expect((await get(s.id)).legs[0]!.status).toBe("open");
    expect((await evaluateRules(t.deps, ticks({ "C-BTC-80000-250926": 1000 }), () => T0 + 1000)).fired).toHaveLength(1);
    const done = await get(s.id);
    expect(done).toMatchObject({ status: "archived", closeReason: "stopped", realizedPnl: "-2" });
    expect(done.legs[0]).toMatchObject({ status: "squared_off", exitPrice: "1000", closeReason: "stopped" });
  });

  it("a time exit fires at the instant or at the days to expiry with the reason squared off; with only a perpetual open a days rule is void", async () => {
    const s = await paper();
    // the route refuses an instant already passed on the real clock, so the exit is an hour from now
    const atMs = Date.now() + 3_600_000;
    const at = new Date(atMs).toISOString();
    expect((await arm(s.id, [{ kind: "time", trigger: "at", value: at }])).status).toBe(200);
    expect((await evaluateRules(t.deps, ticks({ "C-BTC-80000-250926": 1200, "P-BTC-78000-250926": 900 }), () => atMs - 1000)).fired).toEqual([]);
    expect((await get(s.id)).rules![0]).toMatchObject({ state: "armed" });
    expect((await evaluateRules(t.deps, ticks({ "C-BTC-80000-250926": 1200, "P-BTC-78000-250926": 900 }), () => atMs)).fired).toHaveLength(1);
    const done = await get(s.id);
    expect(done).toMatchObject({ status: "archived", closeReason: "squared_off", realizedPnl: "0" });
    expect(done.legs.map((l) => l.closeReason)).toEqual(["squared_off", "squared_off"]);
    expect(done.rules![0]!.note).toBe(`Time exit fired at P&L 0 USD (at ${at}): 2 legs exited`);
    // two days to the 25 Sep 12:00 UTC settlement
    const s2 = await paper([CALL, PUT], "Rules dte");
    expect((await arm(s2.id, [{ kind: "time", trigger: "dte", value: "2" }])).status).toBe(200);
    const settle = Date.UTC(2026, 8, 25, 12);
    const day = 86_400_000;
    expect((await evaluateRules(t.deps, ticks({ "C-BTC-80000-250926": 1200, "P-BTC-78000-250926": 900 }), () => settle - 2.1 * day)).fired).toEqual([]);
    expect((await evaluateRules(t.deps, ticks({ "C-BTC-80000-250926": 1200, "P-BTC-78000-250926": 900 }), () => settle - 1.9 * day)).fired).toHaveLength(1);
    expect((await get(s2.id)).rules![0]!.note).toContain("(1.9 days to expiry)");
    // only the perpetual: there is no expiry to count to
    const s3 = await paper([{ kind: "future", side: "buy", strike: "", expiry: "PERP", symbol: "BTCUSD", lots: 1, price: "79000" }], "Rules perp");
    expect((await arm(s3.id, [{ kind: "time", trigger: "dte", value: "1" }])).status).toBe(200);
    expect((await evaluateRules(t.deps, ticks({ BTCUSD: 79_000 }), () => T0)).fired).toEqual([]);
    expect((await get(s3.id)).rules![0]).toMatchObject({ state: "disarmed", note: "disarmed: no dated leg is open" });
  });
});

describe("HC-TR-199 time exit before the nearest settlement (ADR-097)", () => {
  // the arm route refuses an instant already passed on the real clock, so the calendar expires a month out
  const code = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCFullYear() % 100).padStart(2, "0")}`;
  const near = new Date(Date.now() + 30 * 86_400_000);
  const far = new Date(near.getTime() + 7 * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const NEAR = { kind: "put", side: "sell", strike: "78000", expiry: iso(near), symbol: `P-BTC-78000-${code(near)}`, lots: 10, price: "900" };
  const FAR = { kind: "put", side: "buy", strike: "78000", expiry: iso(far), symbol: `P-BTC-78000-${code(far)}`, lots: 10, price: "1100" };
  const settle = Date.UTC(near.getUTCFullYear(), near.getUTCMonth(), near.getUTCDate(), 12);

  it("a settle rule fires at the nearest settlement less the minutes and closes every leg of a calendar, the far leg at its mark", async () => {
    const s = await paper([NEAR, FAR], "Rules calendar");
    expect((await arm(s.id, [{ kind: "time", trigger: "settle", value: "15" }])).status).toBe(200);
    const armed = (await get(s.id)).rules![0]!;
    expect(armed).toMatchObject({ kind: "time", trigger: "settle", value: "15", state: "armed", thresholdUsd: String(settle - 15 * 60_000) });
    const marks = { [NEAR.symbol]: 20, [FAR.symbol]: 400 };
    expect((await evaluateRules(t.deps, ticks(marks), () => settle - 15 * 60_000 - 1000)).fired).toEqual([]);
    expect((await evaluateRules(t.deps, ticks(marks), () => settle - 15 * 60_000)).fired).toHaveLength(1);
    const done = await get(s.id);
    // short leg 900 -> 20 (+880 x 10 x 0.001 = +8.8), long leg 1100 -> 400 (-7), both booked
    expect(done).toMatchObject({ status: "archived", closeReason: "squared_off", realizedPnl: "1.8" });
    expect(done.legs.map((l) => [l.status, l.exitPrice, l.closeReason])).toEqual([["squared_off", "20", "squared_off"], ["squared_off", "400", "squared_off"]]);
    expect(done.rules![0]!.note).toContain("(15 min before the nearest settlement, at ");
    expect(done.rules![0]!.note).toContain("2 legs exited");
  });

  it("a settle rule missed while the server was down fires on the first tick back: the near leg already settled, the far leg is closed alone, the note says late", async () => {
    const s = await paper([NEAR, FAR], "Rules calendar late");
    expect((await arm(s.id, [{ kind: "time", trigger: "settle", value: "015" }])).status).toBe(200);
    expect((await get(s.id)).rules![0]).toMatchObject({ value: "15" }); // a leading zero is not kept
    // the settler booked the near leg at its settlement value while the engine was down
    const nearLeg = (await get(s.id)).legs.find((l) => l.symbol === NEAR.symbol)!;
    expect((await t.request(`/v1/strategies/${s.id}/legs/${nearLeg.id}/close`, { cookie: alice, json: { exitPrice: "0" } })).status).toBe(200);
    const report = await evaluateRules(t.deps, ticks({ [FAR.symbol]: 300 }), () => settle + 3_600_000);
    expect(report.fired).toHaveLength(1);
    const done = await get(s.id);
    expect(done.status).toBe("archived");
    expect(done.legs.find((l) => l.symbol === FAR.symbol)).toMatchObject({ status: "squared_off", exitPrice: "300", closeReason: "squared_off" });
    expect(done.rules![0]!.note).toContain(", late)");
  });

  it("a settle rule is disarmed, not fired, when the expiry it counted to is no longer held before the instant (the near leg rolled or closed by hand)", async () => {
    const s = await paper([NEAR, FAR], "Rules calendar rolled");
    expect((await arm(s.id, [{ kind: "time", trigger: "settle", value: "15" }])).status).toBe(200);
    const nearLeg = (await get(s.id)).legs.find((l) => l.symbol === NEAR.symbol)!;
    expect((await t.request(`/v1/strategies/${s.id}/legs/${nearLeg.id}/close`, { cookie: alice, json: { exitPrice: "850" } })).status).toBe(200);
    // a tick a day before the instant: the far leg stays, the rule is void with the reason
    expect((await evaluateRules(t.deps, ticks({ [FAR.symbol]: 1000 }), () => settle - 86_400_000)).fired).toEqual([]);
    const after = await get(s.id);
    expect(after.status).toBe("paper");
    expect(after.legs.find((l) => l.symbol === FAR.symbol)).toMatchObject({ status: "open" });
    expect(after.rules![0]).toMatchObject({ state: "disarmed", note: "disarmed: the expiry it counted to is no longer held; arm it again" });
  });

  it("a live calendar's settle fire sends two market exits through the exchange, the short leg first", async () => {
    t.trading.product(NEAR.symbol, 201, "0.001").markAt(NEAR.symbol, "900").fillAt(201, "900").succeed(201);
    t.trading.product(FAR.symbol, 202, "0.001").markAt(FAR.symbol, "1100").fillAt(202, "1100").succeed(202);
    const s = await live([NEAR, FAR], "Rules calendar live");
    expect((await arm(s.id, [{ kind: "time", trigger: "settle", value: "15" }])).status).toBe(200);
    const placedBefore = t.trading.placed.length;
    t.trading.fillAt(201, "20").fillAt(202, "400");
    expect((await evaluateRules(t.deps, ticks({ [NEAR.symbol]: 20, [FAR.symbol]: 400 }), () => settle - 15 * 60_000, { backoffMs: 0 })).fired).toHaveLength(1);
    expect(t.trading.placed.slice(placedBefore).map((o) => [o.input.productId, o.input.side, o.input.reduceOnly])).toEqual([
      [201, "buy", true], // the sold near put first
      [202, "sell", true], // then the bought far put
    ]);
    const done = await get(s.id);
    expect(done).toMatchObject({ status: "archived", closeReason: "squared_off" });
    expect(done.rules![0]).toMatchObject({ state: "fired", outcome: "closed" });
  });

  it("the arm route refuses a settle rule with no dated leg to count to", async () => {
    const s = await paper([{ kind: "future", side: "buy", strike: "", expiry: "PERP", symbol: "BTCUSD", lots: 1, price: "79000" }], "Rules perp settle");
    const r = await arm(s.id, [{ kind: "time", trigger: "settle", value: "15" }]);
    expect(r.status).toBe(400);
    expect(await r.text()).toContain("No dated leg to count to");
    expect((await arm(s.id, [{ kind: "time", trigger: "settle", value: "0" }])).status).toBe(400);
  });
});

describe("HC-TR-210 a target that trails (ADR-103)", () => {
  // one put sold at 900, 10 lots of 0.001: P&L = (900 − mark) × 0.01
  const at = (mark: number) => ticks({ "P-BTC-78000-250926": mark });
  const target = async (id: string) => (await get(id)).rules!.find((r) => r.kind === "target")!;

  it("does nothing below the target, starts the trail at it without exiting, raises the best with the P&L and exits on a fall to the best less the give-back", async () => {
    const s = await paper([PUT], "Rules trail");
    expect((await arm(s.id, [{ kind: "target", trigger: "money", value: "3", trail: { trigger: "money", value: "1" } }])).status).toBe(200);
    expect(await target(s.id)).toMatchObject({ thresholdUsd: "3", trail: { trigger: "money", value: "1" }, peakPnl: null });
    // +2, then back to +1: under the target the rule only watches
    expect((await evaluateRules(t.deps, at(700), () => T0)).fired).toHaveLength(0);
    expect((await evaluateRules(t.deps, at(800), () => T0)).fired).toHaveLength(0);
    expect((await target(s.id)).peakPnl).toBeNull();
    // +3: a fixed target would close here; the trail starts instead
    expect(await evaluateRules(t.deps, at(600), () => T0 + 1000)).toEqual({ checked: 1, fired: [], skipped: 0 });
    expect(await target(s.id)).toMatchObject({ state: "armed", peakPnl: "3" });
    expect((await get(s.id)).status).toBe("paper");
    // +5: the best rises; +4.5: above the exit level of +4, and the best never comes down
    expect((await evaluateRules(t.deps, at(400), () => T0 + 2000)).fired).toHaveLength(0);
    expect((await target(s.id)).peakPnl).toBe("5");
    expect((await evaluateRules(t.deps, at(450), () => T0 + 3000)).fired).toHaveLength(0);
    expect((await target(s.id)).peakPnl).toBe("5");
    // +3.9: at or under +4 → out, with the reason a target books
    expect((await evaluateRules(t.deps, at(510), () => T0 + 4000)).fired).toHaveLength(1);
    const done = await get(s.id);
    expect(done.status).toBe("archived");
    expect(done.closeReason).toBe("target");
    expect(done.realizedPnl).toBe("3.9");
    const rule = done.rules!.find((r) => r.kind === "target")!;
    expect(rule).toMatchObject({ state: "fired", firedPnl: "3.9", peakPnl: "5", outcome: "closed" });
    expect(rule.note).toBe("Target fired at P&L 3.9 USD (trailed from the best 5 USD, exit level 4 USD): 1 leg exited");
  });

  it("a percentage give-back is taken from the best", async () => {
    const s = await paper([PUT], "Rules trail pct");
    expect((await arm(s.id, [{ kind: "target", trigger: "money", value: "3", trail: { trigger: "pct", value: "50" } }])).status).toBe(200);
    expect((await evaluateRules(t.deps, at(300), () => T0)).fired).toHaveLength(0); // +6: the trail starts, exit level +3
    expect((await evaluateRules(t.deps, at(580), () => T0)).fired).toHaveLength(0); // +3.2
    expect((await evaluateRules(t.deps, at(620), () => T0)).fired).toHaveLength(1); // +2.8
    expect((await target(s.id)).note).toBe("Target fired at P&L 2.8 USD (trailed from the best 6 USD, exit level 3 USD): 1 leg exited");
  });

  it("the stop loss still wins while the target trails", async () => {
    const s = await paper([PUT], "Rules trail stop");
    expect((await arm(s.id, [{ kind: "stop", trigger: "money", value: "5" }, { kind: "target", trigger: "money", value: "3", trail: { trigger: "money", value: "1" } }])).status).toBe(200);
    expect((await evaluateRules(t.deps, at(500), () => T0)).fired).toHaveLength(0); // +4: trailing
    expect((await evaluateRules(t.deps, at(1400), () => T0)).fired).toHaveLength(1); // −5 in one tick
    const done = await get(s.id);
    expect(done.closeReason).toBe("stopped");
    expect(done.rules!.find((r) => r.kind === "target")).toMatchObject({ state: "disarmed", peakPnl: "4" });
  });

  it("saving the rules again keeps the best when the target and the give-back are unchanged, and starts over when they changed", async () => {
    const s = await paper([PUT], "Rules trail edit");
    const trailing = { kind: "target", trigger: "money", value: "3", trail: { trigger: "money", value: "1" } };
    expect((await arm(s.id, [trailing])).status).toBe(200);
    expect((await evaluateRules(t.deps, at(400), () => T0)).fired).toHaveLength(0);
    expect((await target(s.id)).peakPnl).toBe("5");
    // a stop is added beside it: the exit level of +4 survives the save
    expect((await arm(s.id, [{ kind: "stop", trigger: "money", value: "9" }, trailing])).status).toBe(200);
    expect((await target(s.id)).peakPnl).toBe("5");
    // a wider give-back, typed with more decimals than cents: stored as money, and the best still stands (exit +3)
    expect((await arm(s.id, [{ ...trailing, trail: { trigger: "money", value: "2.004" } }])).status).toBe(200);
    expect(await target(s.id)).toMatchObject({ trail: { trigger: "money", value: "2" }, peakPnl: "5" });
    // a lower target keeps it too; a target raised above the best starts over and waits for the new level
    expect((await arm(s.id, [{ ...trailing, value: "4" }])).status).toBe(200);
    expect((await target(s.id)).peakPnl).toBe("5");
    expect((await arm(s.id, [{ ...trailing, value: "6" }])).status).toBe(200);
    expect((await target(s.id)).peakPnl).toBeNull();
    // and a fixed target carries no best at all
    expect((await arm(s.id, [{ kind: "target", trigger: "money", value: "30" }])).status).toBe(200);
    expect(await target(s.id)).toMatchObject({ trail: null, peakPnl: null });
    expect((await arm(s.id, [])).status).toBe(200);
  });

  it("the best is kept in whole cents rounded down, and a P&L that stays put fires nothing however small the give-back", async () => {
    const s = await paper([PUT], "Rules trail cents");
    expect((await arm(s.id, [{ kind: "target", trigger: "money", value: "3", trail: { trigger: "pct", value: "0.0005" } }])).status).toBe(200);
    // (900 − 599.4) × 0.01 = +3.006: stored as 3, never 3.01
    expect((await evaluateRules(t.deps, at(599.4), () => T0)).fired).toHaveLength(0);
    expect((await target(s.id)).peakPnl).toBe("3");
    const before = (await target(s.id)).updatedAt;
    expect((await evaluateRules(t.deps, at(599.4), () => T0 + 2000)).fired).toHaveLength(0);
    expect(await target(s.id)).toMatchObject({ state: "armed", peakPnl: "3", updatedAt: before }); // no new best: nothing written
    expect((await arm(s.id, [])).status).toBe(200);
  });

  it("live: nothing is sent when the trail starts; the fall sends one exit; the kill switch holds it armed with the best intact", async () => {
    const s = await live([PUT], "Rules trail live");
    expect((await arm(s.id, [{ kind: "target", trigger: "money", value: "3", trail: { trigger: "money", value: "1" } }])).status).toBe(200);
    const placedBefore = t.trading.placed.length;
    expect((await evaluateRules(t.deps, at(400), () => T0, { backoffMs: 0 })).fired).toHaveLength(0); // +5: the trail starts
    expect(t.trading.placed.length).toBe(placedBefore);
    t.deps.config.trading.disabled = true;
    expect(await evaluateRules(t.deps, at(510), () => T0 + 1000, { backoffMs: 0 })).toEqual({ checked: 1, fired: [], skipped: 1 });
    expect(await target(s.id)).toMatchObject({ state: "armed", peakPnl: "5", note: "not sent: Live trading is paused by the operator" });
    expect(t.trading.placed.length).toBe(placedBefore);
    t.deps.config.trading.disabled = false;
    t.trading.fillAt(102, "510");
    expect((await evaluateRules(t.deps, at(510), () => T0 + 2000, { backoffMs: 0 })).fired).toHaveLength(1);
    expect(t.trading.placed.slice(placedBefore).map((o) => [o.input.productId, o.input.side, o.input.reduceOnly])).toEqual([[102, "buy", true]]);
    const done = await get(s.id);
    expect(done.status).toBe("archived");
    expect(done.closeReason).toBe("target");
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.target, `strategy:${s.id}`));
    expect(audits.find((a) => a.action === "strategy.rule_fire")?.before).toMatchObject({ detail: "trailed from the best 5 USD, exit level 4 USD" });
  });

  it("the realised total is read with the legs, not from the start of the pass", async () => {
    const s = await paper([CALL, PUT], "Rules trail total");
    expect((await arm(s.id, [{ kind: "target", trigger: "money", value: "3", trail: { trigger: "money", value: "1" } }])).status).toBe(200);
    // the first tick read asks for the marks; by then the pass holds its joined rows. A realised +4 lands now, as a
    // close from another request would: the valuation must see it (call 0, put 0, realised +4 → the trail starts)
    const late: RulesTickSource = {
      tick: async () => {
        await t.db.update(strategies).set({ realizedPnl: "4" }).where(eq(strategies.id, s.id));
        return { marks: new Map([["C-BTC-80000-250926", 1200], ["P-BTC-78000-250926", 900]]), spot: null };
      },
    };
    expect((await evaluateRules(t.deps, late, () => T0)).fired).toHaveLength(0);
    expect((await target(s.id)).peakPnl).toBe("4");
    expect((await arm(s.id, [])).status).toBe(200);
  });

  it("the arm route refuses a trail on another kind, and a give-back that is not below the target", async () => {
    const s = await paper([PUT], "Rules trail refusals");
    expect((await arm(s.id, [{ kind: "stop", trigger: "money", value: "5", trail: { trigger: "money", value: "1" } }])).status).toBe(400);
    expect((await arm(s.id, [{ kind: "target", trigger: "money", value: "3", trail: { trigger: "money", value: "3" } }])).status).toBe(400);
    expect((await arm(s.id, [{ kind: "target", trigger: "money", value: "3", trail: { trigger: "pct", value: "100" } }])).status).toBe(400);
    expect((await get(s.id)).rules).toEqual([]);
  });
});

describe("HC-TR-212 a leg stop that trails the rest (ADR-104)", () => {
  const SCALL = { ...CALL, side: "sell" };
  const C = CALL.symbol;
  const P = PUT.symbol;
  const kinds = async (id: string) => (await get(id)).rules!.map((r) => [r.kind, r.state]);
  const trailOf = async (id: string) => (await get(id)).rules!.find((r) => r.kind === "trail");

  it("the stopped leg exits alone, the trail starts from the realised total of that moment, the best gain of the rest only rises and the rest exits on a fall of the percentage from it", async () => {
    const s = await paper([SCALL, PUT], "Rules rest pct");
    const [call, put] = [s.legs.find((l) => l.symbol === C)!, s.legs.find((l) => l.symbol === P)!];
    const stops = [call, put].map((l) => ({ kind: "leg_stop", trigger: "multiple", value: "2", legId: l.id, trail: { trigger: "pct", value: "15" } }));
    expect((await arm(s.id, stops)).status).toBe(200);
    expect((await get(s.id)).rules!.map((r) => [r.kind, r.scope, r.trail])).toEqual([["leg_stop", "leg", { trigger: "pct", value: "15" }], ["leg_stop", "leg", { trigger: "pct", value: "15" }]]);
    // the call sold at 1,200 marks 2,400: its stop fires (−12); the put sold at 900 marks 500 (+4) and stays
    expect((await evaluateRules(t.deps, ticks({ [C]: 2400, [P]: 500 }), () => T0)).fired).toHaveLength(1);
    let now = await get(s.id);
    expect(now.status).toBe("paper");
    expect(now.legs.map((l) => [l.symbol, l.status])).toEqual([[C, "squared_off"], [P, "open"]]);
    expect(now.rules!.find((r) => r.kind === "leg_stop" && r.legId === call.id)!.note).toBe(`Leg stop fired at P&L -8 USD (${C} at 2400, entry 1200): 1 leg exited, now trailing the rest (give-back 15 %)`);
    expect(await trailOf(s.id)).toMatchObject({ state: "armed", trigger: "pct", value: "15", thresholdUsd: "-12", scope: "strategy", peakPnl: null, legId: null });
    expect(now.rules!.find((r) => r.kind === "leg_stop" && r.legId === put.id)).toMatchObject({ state: "armed" });
    // the rest stands +4 since the stop: the best is 4, the exit 3.4; at +6 the exit is 5.1; +5.2 is above it
    expect((await evaluateRules(t.deps, ticks({ [P]: 500 }), () => T0 + 1000)).fired).toEqual([]);
    expect((await trailOf(s.id))!.peakPnl).toBe("4");
    expect((await evaluateRules(t.deps, ticks({ [P]: 300 }), () => T0 + 2000)).fired).toEqual([]);
    expect((await evaluateRules(t.deps, ticks({ [P]: 380 }), () => T0 + 3000)).fired).toEqual([]);
    expect((await trailOf(s.id))!.peakPnl).toBe("6");
    // +5 is at or under 5.1: the put exits at its mark and the strategy closes
    expect((await evaluateRules(t.deps, ticks({ [P]: 400 }), () => T0 + 4000)).fired).toHaveLength(1);
    now = await get(s.id);
    expect(now).toMatchObject({ status: "archived", closeReason: "stopped", realizedPnl: "-7" });
    const trail = now.rules!.find((r) => r.kind === "trail")!;
    expect(trail).toMatchObject({ state: "fired", outcome: "closed", peakPnl: "6", firedPnl: "-7" });
    expect(trail.note).toBe("Trail on the rest fired at P&L -7 USD (the rest stands at 5 USD, best 6 USD, exit level 5.1 USD): 1 leg exited");
    expect(now.rules!.find((r) => r.kind === "leg_stop" && r.legId === put.id)).toMatchObject({ state: "disarmed", note: "disarmed: the trail on the rest fired" });
  });

  it("a percentage waits until the rest is in profit, and the other leg's own stop still wins while the trail runs", async () => {
    const s = await paper([SCALL, PUT], "Rules rest waits");
    const stops = s.legs.map((l) => ({ kind: "leg_stop", trigger: "multiple", value: "2", legId: l.id, trail: { trigger: "pct", value: "15" } }));
    expect((await arm(s.id, stops)).status).toBe(200);
    expect((await evaluateRules(t.deps, ticks({ [C]: 2400, [P]: 1000 }), () => T0)).fired).toHaveLength(1);
    // the put is 1 under water: there is no profit to take a share of, nothing is kept and nothing fires
    expect((await evaluateRules(t.deps, ticks({ [P]: 1000 }), () => T0 + 1000)).fired).toEqual([]);
    expect(await trailOf(s.id)).toMatchObject({ state: "armed", peakPnl: null });
    expect((await evaluateRules(t.deps, ticks({ [P]: 800 }), () => T0 + 2000)).fired).toEqual([]);
    expect((await trailOf(s.id))!.peakPnl).toBe("1");
    // the put at twice its entry crosses its own stop and the trail at once: the leg stop is judged first
    expect((await evaluateRules(t.deps, ticks({ [P]: 1800 }), () => T0 + 3000)).fired).toHaveLength(1);
    const done = await get(s.id);
    expect(done).toMatchObject({ status: "archived", closeReason: "stopped", realizedPnl: "-21" });
    expect(done.rules!.find((r) => r.kind === "trail")).toMatchObject({ state: "disarmed", note: "disarmed: the leg stop fired" });
  });

  it("a money give-back starts at once even under water; a second stop set to trail keeps the one trail already running", async () => {
    const P76 = { kind: "put", side: "sell", strike: "76000", expiry: "2026-09-25", symbol: "P-BTC-76000-250926", lots: 10, price: "500" };
    const s = await paper([SCALL, PUT, P76], "Rules rest money");
    const [call, put] = [s.legs.find((l) => l.symbol === C)!, s.legs.find((l) => l.symbol === P)!];
    expect((await arm(s.id, [
      { kind: "leg_stop", trigger: "multiple", value: "2", legId: call.id, trail: { trigger: "money", value: "2.004" } },
      { kind: "leg_stop", trigger: "multiple", value: "2", legId: put.id, trail: { trigger: "money", value: "1" } },
    ])).status).toBe(200);
    expect((await evaluateRules(t.deps, ticks({ [C]: 2400, [P]: 1000, [P76.symbol]: 500 }), () => T0)).fired).toHaveLength(1);
    expect((await get(s.id)).rules!.find((r) => r.legId === call.id)!.note).toContain("now trailing the rest (give-back 2 USD)");
    expect((await evaluateRules(t.deps, ticks({ [P]: 1000, [P76.symbol]: 500 }), () => T0 + 1000)).fired).toEqual([]);
    expect(await trailOf(s.id)).toMatchObject({ trigger: "money", value: "2", thresholdUsd: "-12", peakPnl: "-1" }); // exit at −3
    // the 78,000 put reaches its own stop: it exits alone, and no second trail is armed beside the first
    expect((await evaluateRules(t.deps, ticks({ [P]: 1800, [P76.symbol]: 500 }), () => T0 + 2000)).fired).toHaveLength(1);
    let now = await get(s.id);
    expect(now.status).toBe("paper");
    expect(now.rules!.find((r) => r.legId === put.id)!.note).toContain("the trail on the rest is already running");
    expect(now.rules!.filter((r) => r.kind === "trail").map((r) => [r.state, r.thresholdUsd])).toEqual([["armed", "-12"]]);
    // that put's −9 is realised now and counts as a fall of the rest: −9 is under the −3 exit, the last leg goes
    expect((await evaluateRules(t.deps, ticks({ [P76.symbol]: 500 }), () => T0 + 3000)).fired).toHaveLength(1);
    now = await get(s.id);
    expect(now).toMatchObject({ status: "archived", closeReason: "stopped", realizedPnl: "-21" });
    expect(await kinds(s.id)).toEqual([["leg_stop", "fired"], ["leg_stop", "fired"], ["trail", "fired"]]);
  });

  it("a leg stop without a give-back arms no trail; the last open leg's stop arms none either", async () => {
    const s = await paper([SCALL, PUT], "Rules rest none");
    const [call, put] = [s.legs.find((l) => l.symbol === C)!, s.legs.find((l) => l.symbol === P)!];
    expect((await arm(s.id, [{ kind: "leg_stop", trigger: "multiple", value: "2", legId: call.id }, { kind: "leg_stop", trigger: "multiple", value: "2", legId: put.id, trail: { trigger: "pct", value: "15" } }])).status).toBe(200);
    expect((await evaluateRules(t.deps, ticks({ [C]: 2400, [P]: 500 }), () => T0)).fired).toHaveLength(1);
    expect((await get(s.id)).rules!.map((r) => [r.kind, r.legId, r.state])).toEqual(expect.arrayContaining([["leg_stop", call.id, "fired"], ["leg_stop", put.id, "armed"]]));
    expect((await get(s.id)).rules).toHaveLength(2);
    expect((await get(s.id)).rules!.find((r) => r.legId === call.id)!.note).toBe(`Leg stop fired at P&L -8 USD (${C} at 2400, entry 1200): 1 leg exited`);
    // the put is the last leg: its stop closes the strategy, there is no rest to trail
    expect((await evaluateRules(t.deps, ticks({ [P]: 1800 }), () => T0 + 1000)).fired).toHaveLength(1);
    expect(await get(s.id)).toMatchObject({ status: "archived", closeReason: "stopped" });
    expect(await kinds(s.id)).toEqual([["leg_stop", "fired"], ["leg_stop", "fired"]]);
  });

  it("saving the rules again keeps the running trail's level and best, takes a new give-back, removes it when left out, and never starts one", async () => {
    const s = await paper([SCALL, PUT], "Rules rest edit");
    const [call, put] = [s.legs.find((l) => l.symbol === C)!, s.legs.find((l) => l.symbol === P)!];
    const putStop = { kind: "leg_stop", trigger: "multiple", value: "2", legId: put.id };
    // nothing is running yet: a trail cannot be armed by hand
    expect((await arm(s.id, [{ kind: "trail", trigger: "pct", value: "15" }])).status).toBe(400);
    expect((await arm(s.id, [{ kind: "leg_stop", trigger: "multiple", value: "2", legId: call.id, trail: { trigger: "pct", value: "15" } }, putStop])).status).toBe(200);
    expect((await evaluateRules(t.deps, ticks({ [C]: 2400, [P]: 500 }), () => T0)).fired).toHaveLength(1);
    expect((await evaluateRules(t.deps, ticks({ [P]: 500 }), () => T0 + 1000)).fired).toEqual([]);
    expect(await trailOf(s.id)).toMatchObject({ value: "15", thresholdUsd: "-12", peakPnl: "4" });
    // saved again with the same give-back (another rule was edited): the level and the best stay
    expect((await arm(s.id, [putStop, { kind: "trail", trigger: "pct", value: "15" }])).status).toBe(200);
    expect(await trailOf(s.id)).toMatchObject({ state: "armed", trigger: "pct", value: "15", basis: null, thresholdUsd: "-12", peakPnl: "4" });
    // a changed give-back keeps the level and starts again from where the rest stands: under the old best of 4 a
    // 20 % give-back would exit at 3.2, and the rest at 3 would be closed by the save itself
    expect((await arm(s.id, [putStop, { kind: "trail", trigger: "pct", value: "20" }])).status).toBe(200);
    expect(await trailOf(s.id)).toMatchObject({ value: "20", thresholdUsd: "-12", peakPnl: null });
    expect((await evaluateRules(t.deps, ticks({ [P]: 600 }), () => T0 + 2000)).fired).toEqual([]);
    expect((await trailOf(s.id))!.peakPnl).toBe("3");
    expect((await arm(s.id, [putStop, { kind: "trail", trigger: "money", value: "1.004" }])).status).toBe(200);
    expect(await trailOf(s.id)).toMatchObject({ trigger: "money", value: "1", thresholdUsd: "-12", peakPnl: null });
    // a give-back that is nothing, or everything, is refused and the running trail stands
    expect((await arm(s.id, [{ kind: "trail", trigger: "money", value: "0.004" }])).status).toBe(400);
    expect((await arm(s.id, [{ kind: "trail", trigger: "pct", value: "100" }])).status).toBe(400);
    expect(await trailOf(s.id)).toMatchObject({ state: "armed", value: "1" });
    expect((await arm(s.id, [putStop])).status).toBe(200);
    expect(await trailOf(s.id)).toBeUndefined();
    expect((await arm(s.id, [putStop, { kind: "trail", trigger: "pct", value: "15" }])).status).toBe(400);
    expect((await arm(s.id, [])).status).toBe(200);
  });

  it("a trail switched from money to a percentage under water waits instead of firing on the old best, and a percentage of a few cents is never the whole give-back", async () => {
    const s = await paper([SCALL, PUT], "Rules rest restart");
    const call = s.legs.find((l) => l.symbol === C)!;
    expect((await arm(s.id, [{ kind: "leg_stop", trigger: "multiple", value: "2", legId: call.id, trail: { trigger: "money", value: "2" } }])).status).toBe(200);
    expect((await evaluateRules(t.deps, ticks({ [C]: 2400, [P]: 1000 }), () => T0)).fired).toHaveLength(1);
    expect((await evaluateRules(t.deps, ticks({ [P]: 1000 }), () => T0 + 1000)).fired).toEqual([]);
    expect((await trailOf(s.id))!.peakPnl).toBe("-1");
    // 15 % of a best of −1 would put the exit at −0.85, above where the rest stands: the save drops the best instead
    expect((await arm(s.id, [{ kind: "trail", trigger: "pct", value: "15" }])).status).toBe(200);
    expect((await evaluateRules(t.deps, ticks({ [P]: 1000 }), () => T0 + 2000)).fired).toEqual([]);
    expect(await trailOf(s.id)).toMatchObject({ state: "armed", trigger: "pct", peakPnl: null });
    // a cent of profit starts it; 15 % of a cent is nothing, so the give-back is the 0.10 USD minimum (exit −0.09)
    expect((await evaluateRules(t.deps, ticks({ [P]: 899 }), () => T0 + 3000)).fired).toEqual([]);
    expect((await trailOf(s.id))!.peakPnl).toBe("0.01");
    expect((await evaluateRules(t.deps, ticks({ [P]: 899.5 }), () => T0 + 4000)).fired).toEqual([]);
    expect((await evaluateRules(t.deps, ticks({ [P]: 905 }), () => T0 + 5000)).fired).toEqual([]);
    expect((await evaluateRules(t.deps, ticks({ [P]: 911 }), () => T0 + 6000)).fired).toHaveLength(1);
    const done = await get(s.id);
    expect(done.status).toBe("archived");
    expect(done.rules!.find((r) => r.kind === "trail")!.note).toContain("best 0.01 USD, exit level -0.09 USD");
  });

  it("the arm route refuses a give-back on a leg stop that exits everything, and one that is nothing or everything", async () => {
    const s = await paper([SCALL, PUT], "Rules rest refusals");
    const call = s.legs.find((l) => l.symbol === C)!;
    const stop = { kind: "leg_stop", trigger: "multiple", value: "2", legId: call.id };
    expect((await arm(s.id, [{ ...stop, scope: "strategy", trail: { trigger: "pct", value: "15" } }])).status).toBe(400);
    expect((await arm(s.id, [{ ...stop, trail: { trigger: "pct", value: "100" } }])).status).toBe(400);
    expect((await arm(s.id, [{ ...stop, trail: { trigger: "money", value: "0" } }])).status).toBe(400);
    expect((await arm(s.id, [{ kind: "spot", trigger: "below", value: "70000", trail: { trigger: "pct", value: "15" } }])).status).toBe(400);
    expect((await get(s.id)).rules).toEqual([]);
  });

  it("live: no trail starts while the stopped leg's exit is unconfirmed; on a strategy whose exit fills at once the trail starts, and its fire sends one reduce-only exit for the rest", async () => {
    const resting = await live([CALL, PUT], "Rules rest live resting");
    const stopOn = (s: Strategy) => [{ kind: "leg_stop", trigger: "price", value: "1500", legId: s.legs.find((l) => l.symbol === P)!.id, trail: { trigger: "money", value: "1" } }];
    expect((await arm(resting.id, stopOn(resting))).status).toBe(200);
    t.trading.partialNextOrder(); // the put's exit rests on the exchange
    expect((await evaluateRules(t.deps, ticks({ [C]: 1200, [P]: 1500 }), () => T0, { backoffMs: 0 })).fired).toHaveLength(1);
    let now = await get(resting.id);
    expect(now.rules!.find((r) => r.kind === "leg_stop")).toMatchObject({ state: "fired", outcome: "partial" });
    expect(now.rules!.find((r) => r.kind === "leg_stop")!.note).toContain("the trail on the rest did not start: this leg's exit is not confirmed");
    expect(now.rules!.some((r) => r.kind === "trail")).toBe(false);

    const s = await live([CALL, PUT], "Rules rest live");
    expect((await arm(s.id, stopOn(s))).status).toBe(200);
    t.trading.fillAt(102, "1500");
    const before = t.trading.placed.length;
    expect((await evaluateRules(t.deps, ticks({ [C]: 1200, [P]: 1500 }), () => T0 + 1000, { backoffMs: 0 })).fired).toHaveLength(1);
    expect(t.trading.placed.slice(before).map((o) => [o.input.productId, o.input.side, o.input.reduceOnly])).toEqual([[102, "buy", true]]);
    expect(await trailOf(s.id)).toMatchObject({ state: "armed", thresholdUsd: "-6", peakPnl: null });
    // the call bought at 1,200 marks 1,300: the rest is +1, the exit 0; nothing is sent while it holds
    expect((await evaluateRules(t.deps, ticks({ [C]: 1300 }), () => T0 + 2000, { backoffMs: 0 })).fired).toEqual([]);
    expect(t.trading.placed.length).toBe(before + 1);
    t.trading.fillAt(101, "1200");
    expect((await evaluateRules(t.deps, ticks({ [C]: 1200 }), () => T0 + 3000, { backoffMs: 0 })).fired).toHaveLength(1);
    expect(t.trading.placed.slice(before + 1).map((o) => [o.input.productId, o.input.side, o.input.reduceOnly])).toEqual([[101, "sell", true]]);
    now = await get(s.id);
    expect(now).toMatchObject({ status: "archived", closeReason: "stopped", realizedPnl: "-6" });
  });
});

describe("HC-TR-236 take profit in steps (ADR-120)", () => {
  // a sold strangle of 100 lots a leg: premium (900 + 1,100) x 100 x 0.001 = 200 USD
  const SP = { kind: "put", side: "sell", strike: "78000", expiry: "2026-09-25", symbol: "P-BTC-78000-250926", lots: 100, price: "900" };
  const SC = { kind: "call", side: "sell", strike: "82000", expiry: "2026-09-25", symbol: "C-BTC-82000-250926", lots: 100, price: "1100" };
  const at = (put: number, call: number) => ticks({ "P-BTC-78000-250926": put, "C-BTC-82000-250926": call });
  // four equal parts: a quarter of 100, a third of the 75 left, half of the 50 left; the last 25 are held
  const STEPS = [
    { kind: "step", trigger: "pct", value: "25", closeShare: "0.25" },
    { kind: "step", trigger: "pct", value: "50", closeShare: "0.3333" },
    { kind: "step", trigger: "pct", value: "75", closeShare: "0.5" },
  ];
  const open = (s: Strategy) => s.legs.filter((l) => l.status === "open").map((l) => `${l.kind} ${l.lots}`).sort();

  it("HC-TR-236 a step fires when the open lots are up by its share of their premium, closes its lots on every leg and keeps the rest; it never fires twice and the next one waits for its own level", async () => {
    const s = await paper([SP, SC], "Rules steps");
    expect((await arm(s.id, STEPS)).status).toBe(200);
    expect((await get(s.id)).rules!.filter((r) => r.kind === "step").sort((a, b) => Number(a.value) - Number(b.value)).map((r) => [r.value, r.closeShare, r.thresholdUsd, r.state])).toEqual([["25", "0.25", "25", "armed"], ["50", "0.3333", "50", "armed"], ["75", "0.5", "75", "armed"]]);
    // up 45 of 200: 22.5 %
    expect((await evaluateRules(t.deps, at(700, 850), () => T0)).fired).toHaveLength(0);
    // up 50 of 200: 25 %. A quarter of each leg goes at the mark: 225 x 25 x 0.001 = 5.625 and 275 x 25 x 0.001 = 6.875,
    // each booked to the cent as every close is (5.63 + 6.88)
    expect((await evaluateRules(t.deps, at(675, 825), () => T0)).fired).toHaveLength(1);
    let now = await get(s.id);
    expect(now).toMatchObject({ status: "paper", realizedPnl: "12.51" });
    expect(open(now)).toEqual(["call 75", "put 75"]);
    expect(now.legs.filter((l) => l.status === "squared_off").map((l) => [l.lots, l.closeReason, l.exitPrice])).toEqual(expect.arrayContaining([[25, "target", "675"], [25, "target", "825"]]));
    const first = now.rules!.find((r) => r.kind === "step" && r.value === "25")!;
    expect(first).toMatchObject({ state: "fired", outcome: "closed" });
    expect(first.note).toContain("Profit step fired");
    expect(first.note).toContain("50 lots closed on 2 legs, the rest kept");
    // the other steps are still armed, and the same prices fire nothing more: the open lots are up 25 %, not 50
    expect(now.rules!.filter((r) => r.kind === "step" && r.state === "armed").map((r) => r.value).sort()).toEqual(["50", "75"]);
    expect((await evaluateRules(t.deps, at(675, 825), () => T0)).fired).toHaveLength(0);
    // 50 %: a third of the 75 left, 25 lots a leg: 11.25 + 13.75 = 25 more
    expect((await evaluateRules(t.deps, at(450, 550), () => T0)).fired).toHaveLength(1);
    now = await get(s.id);
    expect(now).toMatchObject({ status: "paper", realizedPnl: "37.51" });
    expect(open(now)).toEqual(["call 50", "put 50"]);
  });

  it("HC-TR-236 a leg stop in the middle of the steps closes its leg whole and the steps go on with the leg that is left, judged on that leg alone; the held part goes at settlement or by a click", async () => {
    const s = await paper([SP, SC], "Rules steps and a stop");
    const call = s.legs.find((l) => l.kind === "call")!;
    expect((await arm(s.id, [...STEPS, { kind: "leg_stop", trigger: "multiple", value: "3", legId: call.id, scope: "leg" }])).status).toBe(200);
    expect((await evaluateRules(t.deps, at(675, 825), () => T0)).fired).toHaveLength(1);
    // the call triples: the stop is judged before a step and takes all 75 lots of it; one fire a tick
    expect((await evaluateRules(t.deps, at(200, 3300), () => T0)).fired).toHaveLength(1);
    let now = await get(s.id);
    expect(open(now)).toEqual(["put 75"]);
    expect(now.rules!.filter((r) => r.kind === "step" && r.state === "armed").map((r) => r.value).sort()).toEqual(["50", "75"]);
    // the put alone is up 700 of 900, 77.8 %: the 50 % step goes first (a third of 75), then the 75 % one (half of 50)
    expect((await evaluateRules(t.deps, at(200, 3300), () => T0)).fired).toHaveLength(1);
    expect(open(await get(s.id))).toEqual(["put 50"]);
    expect((await evaluateRules(t.deps, at(200, 3300), () => T0)).fired).toHaveLength(1);
    now = await get(s.id);
    expect(open(now)).toEqual(["put 25"]);
    expect(now.status).toBe("paper");
    expect(now.rules!.filter((r) => r.state === "armed")).toHaveLength(0);
    expect((await evaluateRules(t.deps, at(100, 3300), () => T0)).fired).toHaveLength(0);
  });

  it("HC-TR-236 a step waits when the open lots have no premium to measure against, keeps the last lot of a leg, and on a trade that went live says it is on paper only", async () => {
    t.now.value += 5 * 60_000;
    // the trades the cases above left open would answer the ticks below: they are put away first
    await t.db.update(strategies).set({ status: "archived" }).where(like(strategies.name, "Rules steps%"));
    // bought and sold at the same price: the open legs cancel out, so there is no premium to take a share of. The route
    // refuses it; a position that became so after arming (its call turned into a bought one here) waits and fires nothing
    const flat = await paper([{ ...SP, side: "buy" }, { ...SP, strike: "77000", symbol: "P-BTC-77000-250926" }], "Rules steps flat");
    const refused = await arm(flat.id, [STEPS[0]]);
    expect(refused.status).toBe(400);
    expect(JSON.stringify(await refused.json())).toContain("Profit steps need a premium to measure against: the open legs nearly cancel out");
    await t.db.update(strategies).set({ status: "archived" }).where(eq(strategies.id, flat.id));
    const turned = await paper([SP, { ...SC, price: "900" }], "Rules steps turned flat");
    expect((await arm(turned.id, [STEPS[0]])).status).toBe(200);
    await t.db.update(strategyLegs).set({ side: "buy" }).where(and(eq(strategyLegs.strategyId, turned.id), eq(strategyLegs.kind, "call")));
    const pass = await evaluateRules(t.deps, at(100, 100), () => T0);
    expect(pass.fired).toHaveLength(0);
    expect(pass.skipped).toBeGreaterThanOrEqual(1);
    expect((await get(turned.id)).rules!.find((r) => r.kind === "step")!.state).toBe("armed");
    await t.db.update(strategies).set({ status: "archived" }).where(eq(strategies.id, turned.id));

    // every leg down to its last lot when the level is reached: the step is void and says so, it is not "taken"
    const last = await paper([{ ...SP, lots: 2 }, { ...SC, lots: 2 }], "Rules steps nothing to spare");
    expect((await arm(last.id, [{ kind: "step", trigger: "pct", value: "25", closeShare: "0.5" }])).status).toBe(200);
    await t.db.update(strategyLegs).set({ lots: 1 }).where(eq(strategyLegs.strategyId, last.id));
    expect((await evaluateRules(t.deps, at(450, 550), () => T0)).fired).toHaveLength(0);
    const voided = await get(last.id);
    expect(voided.rules!.find((r) => r.kind === "step")).toMatchObject({ state: "disarmed", note: "disarmed: no leg has a lot to spare" });
    expect(open(voided)).toEqual(["call 1", "put 1"]);
    await t.db.update(strategies).set({ status: "archived" }).where(eq(strategies.id, last.id));

    // two lots a leg and one step; then a click takes a lot of the put: the step takes one of the call and leaves the put's last lot
    const two = await paper([{ ...SP, lots: 2 }, { ...SC, lots: 2 }], "Rules steps last lot");
    expect((await arm(two.id, [{ kind: "step", trigger: "pct", value: "25", closeShare: "0.5" }])).status).toBe(200);
    await t.db.update(strategyLegs).set({ lots: 1 }).where(and(eq(strategyLegs.strategyId, two.id), eq(strategyLegs.kind, "put")));
    expect((await evaluateRules(t.deps, at(450, 550), () => T0)).fired).toHaveLength(1);
    const after = await get(two.id);
    expect(open(after)).toEqual(["call 1", "put 1"]);
    expect(after.rules!.find((r) => r.kind === "step")!.note).toContain("1 lot closed on 1 leg, the rest kept");

    // a paper trade with a step armed that is live by the time it would fire: held with the reason, nothing sent
    const s = await paper([SP, SC], "Rules steps gone live");
    expect((await arm(s.id, [STEPS[0]])).status).toBe(200);
    await t.db.update(strategies).set({ status: "live" }).where(eq(strategies.id, s.id));
    const placed = t.trading.placed.length;
    expect((await evaluateRules(t.deps, at(450, 550), () => T0)).fired).toHaveLength(0);
    expect(t.trading.placed).toHaveLength(placed);
    expect((await get(s.id)).rules!.find((r) => r.kind === "step")).toMatchObject({ state: "armed", note: "not sent: profit steps are on paper trades only for now" });
    await t.db.update(strategies).set({ status: "archived" }).where(eq(strategies.id, s.id));
  });

  it("HC-TR-236 the arm route: steps or a target, never both; each step its own level and a share above 0 and below 1; a leg too small for the parts and a live trade are refused", async () => {
    t.now.value += 5 * 60_000; // past the write limit the cases above have used
    const s = await paper([SP, SC], "Rules steps refused");
    const bad = async (rules: unknown[]) => (await arm(s.id, rules)).status;
    expect(await bad([...STEPS, { kind: "target", trigger: "money", value: "50" }])).toBe(400);
    expect(await bad([STEPS[0], { ...STEPS[1]!, value: "25" }])).toBe(400);
    expect(await bad([{ kind: "step", trigger: "pct", value: "25" }])).toBe(400);
    expect(await bad([{ kind: "step", trigger: "pct", value: "25", closeShare: "1" }])).toBe(400);
    expect(await bad([{ kind: "step", trigger: "pct", value: "0.5", closeShare: "0.5" }])).toBe(400);
    expect(await bad([{ kind: "step", trigger: "money", value: "25", closeShare: "0.5" }])).toBe(400);
    expect(await bad([{ kind: "stop", trigger: "money", value: "50", closeShare: "0.5" }])).toBe(400);
    expect(await bad([...STEPS, { kind: "step", trigger: "pct", value: "85", closeShare: "0.5" }, { kind: "step", trigger: "pct", value: "95", closeShare: "0.5" }])).toBe(400);
    // three lots a leg cannot be closed in four parts
    t.now.value += 5 * 60_000;
    const small = await paper([{ ...SP, lots: 3 }, { ...SC, lots: 3 }], "Rules steps small");
    const res = await arm(small.id, STEPS);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("3 lots cannot be closed in 4 parts");
    expect((await arm(small.id, STEPS.slice(0, 2))).status).toBe(200);
    // paper only for now
    await credential();
    const l = await live([CALL, PUT], "Rules steps live");
    const refused = await arm(l.id, [STEPS[0]]);
    expect(refused.status).toBe(409);
    expect(JSON.stringify(await refused.json())).toContain("Profit steps are on paper trades only for now");
  });
});

describe("HC-TR-240 the profit lock (ADR-121)", () => {
  const SP = { kind: "put", side: "sell", strike: "78000", expiry: "2026-09-25", symbol: "P-BTC-78000-250926", lots: 100, price: "900" };
  const SC = { kind: "call", side: "sell", strike: "82000", expiry: "2026-09-25", symbol: "C-BTC-82000-250926", lots: 100, price: "1100" };
  const at = (put: number, call: number) => ticks({ "P-BTC-78000-250926": put, "C-BTC-82000-250926": call });
  const lockOf = async (id: string) => (await get(id)).rules!.find((r) => r.kind === "lock")!;

  it("HC-TR-240 nothing happens below the level; reaching it sets the floor and exits nothing; the trade closes when the profit is back at the floor, which never moves; the dialog's save leaves the lock alone and cannot type one", async () => {
    t.now.value += 5 * 60_000;
    await t.db.update(strategies).set({ status: "archived" }).where(like(strategies.name, "Rules %"));
    // premium 200: locked at half of it, floor at a quarter (what Autopilot arms)
    const s = await paper([SP, SC], "Rules lock");
    await t.db.insert(strategyRules).values({ id: "rule_lock_1", strategyId: s.id, kind: "lock", trigger: "money", value: "100", thresholdUsd: "50", scope: "strategy", channels: ["push"], state: "armed" });
    // the profit at 80, then down to 40: under the level the floor is not there yet
    expect((await evaluateRules(t.deps, at(500, 700), () => T0)).fired).toHaveLength(0);
    expect((await evaluateRules(t.deps, at(700, 900), () => T0)).fired).toHaveLength(0);
    expect((await lockOf(s.id)).peakPnl ?? null).toBeNull();
    // saving another rule from the dialog keeps the lock; a lock in the body is refused
    expect((await arm(s.id, [{ kind: "stop", trigger: "money", value: "150" }])).status).toBe(200);
    expect((await get(s.id)).rules!.map((r) => r.kind).sort()).toEqual(["lock", "stop"]);
    expect((await arm(s.id, [{ kind: "lock", trigger: "money", value: "100" }])).status).toBe(400);
    // 100 reached: locked, nothing exits; higher still, the floor stays where it is
    expect((await evaluateRules(t.deps, at(400, 600), () => T0)).fired).toHaveLength(0);
    expect(await lockOf(s.id)).toMatchObject({ state: "armed", peakPnl: "100", thresholdUsd: "50" });
    expect((await evaluateRules(t.deps, at(200, 300), () => T0)).fired).toHaveLength(0);
    expect(await lockOf(s.id)).toMatchObject({ peakPnl: "100", thresholdUsd: "50" });
    // back to 60: above the floor; at 50 it closes everything with the reason target and disarms the stop
    expect((await evaluateRules(t.deps, at(600, 800), () => T0)).fired).toHaveLength(0);
    expect((await evaluateRules(t.deps, at(650, 850), () => T0)).fired).toEqual(["rule_lock_1"]);
    const done = await get(s.id);
    expect(done).toMatchObject({ status: "archived", closeReason: "target", realizedPnl: "50" });
    expect(done.legs.every((l) => l.status === "squared_off" && l.closeReason === "target")).toBe(true);
    const fired = done.rules!.find((r) => r.kind === "lock")!;
    expect(fired.note).toContain("Profit lock fired at P&L 50 USD (locked when the profit reached 100 USD, floor 50 USD)");
    expect(done.rules!.find((r) => r.kind === "stop")!.state).toBe("disarmed");
  });

  it("HC-TR-240 a stopped option's loss is in the profit the lock judges; a fall through the floor between two ticks closes below it; Disarm removes a lock with the rest", async () => {
    t.now.value += 5 * 60_000;
    await t.db.update(strategies).set({ status: "archived" }).where(like(strategies.name, "Rules %"));
    const s = await paper([SP, SC], "Rules lock and a stop");
    const call = s.legs.find((l) => l.kind === "call")!;
    expect((await arm(s.id, [{ kind: "leg_stop", trigger: "multiple", value: "3", legId: call.id, scope: "leg" }])).status).toBe(200);
    await t.db.insert(strategyRules).values({ id: "rule_lock_3", strategyId: s.id, kind: "lock", trigger: "money", value: "100", thresholdUsd: "50", scope: "strategy", channels: ["push"], state: "armed" });
    // the call triples and is bought back at 3,300: 220 lost on it; the put is worth nothing more to lose
    expect((await evaluateRules(t.deps, at(900, 3300), () => T0)).fired).toHaveLength(1);
    expect((await get(s.id)).realizedPnl).toBe("-220");
    // the put down to 10: 89 gained on it, the trade at -131 in all. The put alone is far past "half its premium", but the
    // lock looks at the whole trade, the stopped call's loss included: not reached
    expect((await evaluateRules(t.deps, at(10, 3300), () => T0)).fired).toHaveLength(0);
    expect((await lockOf(s.id)).peakPnl ?? null).toBeNull();
    await t.db.update(strategies).set({ status: "archived" }).where(eq(strategies.id, s.id));

    // reached at 150, then a fall straight to 10 between two ticks: closed at 10, under the floor of 50
    const g = await paper([SP, SC], "Rules lock gap");
    await t.db.insert(strategyRules).values({ id: "rule_lock_4", strategyId: g.id, kind: "lock", trigger: "money", value: "100", thresholdUsd: "50", scope: "strategy", channels: ["push"], state: "armed" });
    expect((await evaluateRules(t.deps, at(200, 300), () => T0)).fired).toHaveLength(0);
    expect((await evaluateRules(t.deps, at(850, 1050), () => T0)).fired).toEqual(["rule_lock_4"]);
    expect(await get(g.id)).toMatchObject({ status: "archived", closeReason: "target", realizedPnl: "10" });

    // Disarm (DELETE rules) takes the lock with every other armed rule
    const d = await paper([SP, SC], "Rules lock disarm");
    await t.db.insert(strategyRules).values({ id: "rule_lock_5", strategyId: d.id, kind: "lock", trigger: "money", value: "100", thresholdUsd: "50", scope: "strategy", channels: ["push"], state: "armed" });
    expect((await t.request(`/v1/strategies/${d.id}/rules`, { method: "DELETE", cookie: alice })).status).toBe(200);
    expect(((await get(d.id)).rules ?? []).filter((r) => r.state === "armed")).toHaveLength(0);
    await t.db.update(strategies).set({ status: "archived" }).where(eq(strategies.id, d.id));
  });

  it("HC-TR-240 a trade that never reaches the level is never closed by the lock, however far it falls", async () => {
    t.now.value += 5 * 60_000;
    const s = await paper([SP, SC], "Rules lock never");
    await t.db.insert(strategyRules).values({ id: "rule_lock_2", strategyId: s.id, kind: "lock", trigger: "money", value: "100", thresholdUsd: "50", scope: "strategy", channels: ["push"], state: "armed" });
    expect((await evaluateRules(t.deps, at(2000, 2500), () => T0)).fired).toHaveLength(0);
    expect(await lockOf(s.id)).toMatchObject({ state: "armed" });
    expect((await get(s.id)).status).toBe("paper");
    await t.db.update(strategies).set({ status: "archived" }).where(eq(strategies.id, s.id));
  });
});

describe("HC-TR-244 a leg buy-back (ADR-123)", () => {
  // a sold strangle of 100 lots a leg: the put sold at 900, the call at 1,100
  const SP = { kind: "put", side: "sell", strike: "78000", expiry: "2026-09-25", symbol: "P-BTC-78000-250926", lots: 100, price: "900" };
  const SC = { kind: "call", side: "sell", strike: "82000", expiry: "2026-09-25", symbol: "C-BTC-82000-250926", lots: 100, price: "1100" };
  const at = (put: number, call: number) => ticks({ "P-BTC-78000-250926": put, "C-BTC-82000-250926": call });
  const rulesOf = async (id: string) => ((await get(id)).rules ?? []).map((r) => `${r.kind} ${r.legId === null ? "" : r.legId} ${r.state}`).sort();

  it("HC-TR-244 a sold option is bought back alone once its mark has fallen to the level; the other option and its stop stay, and the stop of the one bought back ends", async () => {
    t.now.value += 5 * 60_000;
    await t.db.update(strategies).set({ status: "archived" }).where(like(strategies.name, "Rules %"));
    const s = await paper([SP, SC], "Rules buy-back");
    const put = s.legs.find((l) => l.kind === "put")!;
    const call = s.legs.find((l) => l.kind === "call")!;
    const stop = (legId: string) => ({ kind: "leg_stop", trigger: "multiple", value: "3", legId, scope: "leg" });
    expect((await arm(s.id, [{ kind: "leg_take", trigger: "price", value: "5", legId: call.id }, stop(call.id), stop(put.id)])).status).toBe(200);
    expect((await get(s.id)).rules!.find((r) => r.kind === "leg_take")).toMatchObject({ trigger: "price", value: "5", thresholdUsd: "5", legId: call.id, scope: "leg", state: "armed" });
    // a little above the level: nothing
    expect((await evaluateRules(t.deps, at(900, 5.01), () => T0)).fired).toHaveLength(0);
    // at the level: the call alone is bought back at 5: (1,100 - 5) x 100 lots x 0.001 = 109.5
    expect((await evaluateRules(t.deps, at(900, 5), () => T0)).fired).toHaveLength(1);
    let after = await get(s.id);
    expect(after).toMatchObject({ status: "paper", realizedPnl: "109.5" });
    expect(after.legs.map((l) => `${l.kind} ${l.status} ${l.closeReason ?? ""} ${l.exitPrice ?? ""}`).sort()).toEqual(["call squared_off target 5", "put open  "]);
    const fired = after.rules!.find((r) => r.kind === "leg_take")!;
    expect(fired).toMatchObject({ state: "fired", outcome: "closed" });
    expect(fired.note).toContain("Leg buy-back fired");
    expect(fired.note).toContain("C-BTC-82000-250926 at 5");
    expect(fired.note).toContain("1 leg exited");
    // the next tick: the stop that watched the call is void; the put's own stop keeps watching
    expect((await evaluateRules(t.deps, at(900, 600), () => T0)).fired).toHaveLength(0);
    expect(await rulesOf(s.id)).toEqual([`leg_stop ${call.id} disarmed`, `leg_stop ${put.id} armed`, `leg_take ${call.id} fired`].sort());
    // and it still stops the put at triple: (900 - 2,700) x 0.1 = -180, the trade closed as stopped with 109.5 - 180
    expect((await evaluateRules(t.deps, at(2700, 600), () => T0)).fired).toHaveLength(1);
    after = await get(s.id);
    expect(after).toMatchObject({ status: "archived", closeReason: "stopped", realizedPnl: "-70.5" });
  });

  it("HC-TR-244 the last open option bought back closes the trade with the reason target; a trade that has gone live holds the rule and sends nothing", async () => {
    t.now.value += 5 * 60_000;
    const one = await paper([SC], "Rules buy-back last");
    expect((await arm(one.id, [{ kind: "leg_take", trigger: "price", value: "20", legId: one.legs[0]!.id }])).status).toBe(200);
    expect((await evaluateRules(t.deps, at(900, 12), () => T0)).fired).toHaveLength(1);
    expect(await get(one.id)).toMatchObject({ status: "archived", closeReason: "target", realizedPnl: "108.8" });

    const s = await paper([SP, SC], "Rules buy-back gone live");
    expect((await arm(s.id, [{ kind: "leg_take", trigger: "price", value: "5", legId: s.legs.find((l) => l.kind === "call")!.id }])).status).toBe(200);
    await t.db.update(strategies).set({ status: "live" }).where(eq(strategies.id, s.id));
    const placed = t.trading.placed.length;
    expect((await evaluateRules(t.deps, at(900, 4), () => T0)).fired).toHaveLength(0);
    expect(t.trading.placed).toHaveLength(placed);
    expect((await get(s.id)).rules!.find((r) => r.kind === "leg_take")).toMatchObject({ state: "armed", note: "not sent: a buy-back of a cheap leg is on paper trades only for now" });
    await t.db.update(strategies).set({ status: "archived" }).where(eq(strategies.id, s.id));
  });

  it("HC-TR-244 a mark of nothing is no mark and never fires a buy-back; two options at the level are bought back on successive ticks; after a stopped option the trade ends as stopped", async () => {
    t.now.value += 5 * 60_000;
    await t.db.update(strategies).set({ status: "archived" }).where(like(strategies.name, "Rules %"));
    const s = await paper([SP, SC], "Rules buy-back both");
    const take = (legId: string) => ({ kind: "leg_take", trigger: "price", value: "5", legId });
    expect((await arm(s.id, s.legs.map((l) => take(l.id)))).status).toBe(200);
    // a venue's placeholder for a missing price: zero is under the level, and must not read as a fall to it
    const zero = await evaluateRules(t.deps, at(900, 0), () => T0);
    expect(zero.fired).toHaveLength(0);
    expect(zero.skipped).toBeGreaterThan(0);
    expect((await get(s.id)).legs.every((l) => l.status === "open")).toBe(true);
    // both at the level on one tick: one fire a strategy a tick, the other on the next; the second closes the trade
    expect((await evaluateRules(t.deps, at(4, 5), () => T0)).fired).toHaveLength(1);
    expect((await get(s.id)).status).toBe("paper");
    expect((await evaluateRules(t.deps, at(4, 5), () => T0)).fired).toHaveLength(1);
    // (900 - 4) x 0.1 + (1,100 - 5) x 0.1 = 89.6 + 109.5
    expect(await get(s.id)).toMatchObject({ status: "archived", closeReason: "target", realizedPnl: "199.1" });

    // the put is stopped at triple (-180); the call, bought back cheap later, is the last leg: a losing trade, ended as stopped
    t.now.value += 5 * 60_000;
    const l = await paper([SP, SC], "Rules buy-back after a stop");
    const put = l.legs.find((x) => x.kind === "put")!;
    const call = l.legs.find((x) => x.kind === "call")!;
    expect((await arm(l.id, [{ kind: "leg_stop", trigger: "multiple", value: "3", legId: put.id, scope: "leg" }, take(call.id)])).status).toBe(200);
    expect((await evaluateRules(t.deps, at(2700, 600), () => T0)).fired).toHaveLength(1);
    expect((await evaluateRules(t.deps, at(2700, 5), () => T0)).fired).toHaveLength(1);
    expect(await get(l.id)).toMatchObject({ status: "archived", closeReason: "stopped", realizedPnl: "-70.5" });
  });

  it("HC-TR-244 the arm route: an open sold option of a paper trade, at a level below the price it was sold at", async () => {
    t.now.value += 5 * 60_000;
    const s = await paper([SP, SC, { ...CALL, strike: "84000", symbol: "C-BTC-84000-250926" }], "Rules buy-back refused");
    const call = s.legs.find((l) => l.kind === "call" && l.side === "sell")!;
    const long = s.legs.find((l) => l.side === "buy")!;
    const why = async (rules: unknown[]) => {
      const res = await arm(s.id, rules);
      return `${res.status} ${JSON.stringify(await res.json())}`;
    };
    const take = (legId: string, value = "5") => ({ kind: "leg_take", trigger: "price", value, legId });
    expect(await why([take("leg_nope")])).toContain("400");
    expect(await why([take(long.id)])).toContain("a buy-back is for a sold option");
    expect(await why([take(call.id, "1100")])).toContain("the buy-back level must be below the price it was sold at");
    expect(await why([take(call.id, "1500")])).toContain("the buy-back level must be below the price it was sold at");
    expect(await why([take(call.id), take(call.id, "2")])).toContain("400");
    expect((await arm(s.id, [take(call.id, "1099")])).status).toBe(200);
    // paper only for now: the same trade once it is live is refused
    await t.db.update(strategies).set({ status: "live" }).where(eq(strategies.id, s.id));
    const refused = await arm(s.id, [take(call.id)]);
    expect(refused.status).toBe(409);
    expect(JSON.stringify(await refused.json())).toContain("A buy-back of a cheap leg is on paper trades only for now");
    await t.db.update(strategies).set({ status: "archived" }).where(eq(strategies.id, s.id));
  });
});

describe("HC-TR-247 a leg buy-back as a share of the price sold at (ADR-124)", () => {
  const SP = { kind: "put", side: "sell", strike: "78000", expiry: "2026-09-25", symbol: "P-BTC-78000-250926", lots: 100, price: "900" };
  const SC = { kind: "call", side: "sell", strike: "82000", expiry: "2026-09-25", symbol: "C-BTC-82000-250926", lots: 100, price: "1100" };
  const at = (put: number, call: number) => ticks({ "P-BTC-78000-250926": put, "C-BTC-82000-250926": call });

  it("HC-TR-247 armed as a multiple of the leg's entry price, the level is that share of it; the option is bought back alone there; the whole price or a level that rounds to nothing is refused", async () => {
    t.now.value += 5 * 60_000;
    await t.db.update(strategies).set({ status: "archived" }).where(like(strategies.name, "Rules %"));
    const s = await paper([SP, SC], "Rules buy-back share");
    const call = s.legs.find((l) => l.kind === "call")!;
    const share = (value: string) => ({ kind: "leg_take", trigger: "multiple", value, legId: call.id });
    const why = async (rules: unknown[]) => {
      const res = await arm(s.id, rules);
      return `${res.status} ${JSON.stringify(await res.json())}`;
    };
    expect(await why([share("1")])).toContain("400");
    expect(await why([share("0.000001")])).toContain("the level rounds to nothing");
    // 20 % of 1,100 is 220
    expect((await arm(s.id, [share("0.2")])).status).toBe(200);
    expect((await get(s.id)).rules!.find((r) => r.kind === "leg_take")).toMatchObject({ trigger: "multiple", value: "0.2", thresholdUsd: "220", legId: call.id, scope: "leg", state: "armed" });
    expect((await evaluateRules(t.deps, at(900, 221), () => T0)).fired).toHaveLength(0);
    // at 220: (1,100 - 220) x 100 lots x 0.001 = 88 banked, the put kept
    expect((await evaluateRules(t.deps, at(900, 220), () => T0)).fired).toHaveLength(1);
    const after = await get(s.id);
    expect(after).toMatchObject({ status: "paper", realizedPnl: "88" });
    expect(after.legs.map((l) => `${l.kind} ${l.status}`).sort()).toEqual(["call squared_off", "put open"]);
    await t.db.update(strategies).set({ status: "archived" }).where(eq(strategies.id, s.id));
  });
});
