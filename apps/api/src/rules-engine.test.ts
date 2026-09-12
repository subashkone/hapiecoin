// Stop and target rules run by the API (ADR-059 §2.3; HC-TR-166): fired from the venue's marks, paper without orders,
// live through the exit path short legs first with retries, one fire per rule (across concurrent passes too), the
// other rule disarmed, the kill switch respected, a resting exit never re-sent, a missing credential holding the
// rule armed, everything audited, the trader told by mail and Telegram, the history carrying the batch.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Strategy } from "@hapiecoin/schema";
import { eq } from "drizzle-orm";
import { auditLog, brokerCredentials, strategies, users } from "./db/schema.js";
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
  expect((await t.request(`/v1/strategies/${s.id}/live/place`, { cookie: alice, json: { brokerId: SEED.brokerId, idempotencyKey: `key-rules-${s.id.slice(-6)}`, expected: {} } })).status).toBe(200);
  return get(s.id);
}
const BOTH = { "C-BTC-80000-250926": 700, "P-BTC-78000-250926": 900 }; // call −5, put 0 → −5

describe("HC-TR-166 paper", () => {
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
