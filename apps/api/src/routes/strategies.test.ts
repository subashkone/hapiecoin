import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Strategy } from "@hapiecoin/schema";
import { eq } from "drizzle-orm";
import { auditLog } from "../db/schema.js";
import { SEED } from "../db/seed.js";
import { createTestApp, type TestApp } from "../test-support/harness.js";

let t: TestApp;
let alice: string;
let bob: string;
beforeAll(async () => {
  t = await createTestApp();
  alice = (await t.signUp("alice-strat@hapiecoin.test")).cookie;
  bob = (await t.signUp("bob-strat@hapiecoin.test")).cookie;
});
afterAll(() => t.close());

const CALL = { kind: "call", side: "buy", strike: "80000", expiry: "2026-09-25", symbol: "C-BTC-80000-250926", lots: 10, price: "1200", iv: 0.5 };
const PUT = { kind: "put", side: "sell", strike: "78000", expiry: "2026-09-25", symbol: "P-BTC-78000-250926", lots: 10, price: "900", iv: 0.55 };

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
async function create(cookie: string, body: Record<string, unknown> = {}) {
  const res = await t.request("/v1/strategies", { cookie, json: { name: "Risk reversal", asset: "BTC", templateName: "Custom", legs: [CALL, PUT], ...body } });
  expect(res.status).toBe(201);
  return json<Strategy>(res);
}
async function startPaper(cookie: string, id: string, entries: Record<string, string>) {
  const res = await t.request(`/v1/strategies/${id}/start`, { cookie, json: { mode: "paper", brokerId: SEED.brokerId, entries } });
  expect(res.status).toBe(200);
  return json<Strategy>(res);
}

describe("HC-TR-020 / HC-TR-041..049 drafts", () => {
  it("creates a draft with legs, lists it newest first, and hides it from other users", async () => {
    const s = await create(alice);
    expect(Strategy.safeParse(s).success).toBe(true);
    expect(s.status).toBe("draft");
    expect(s.legs.map((l) => [l.kind, l.side, l.position, l.entryPrice])).toEqual([
      ["call", "buy", 0, null],
      ["put", "sell", 1, null],
    ]);
    const list = await json<{ items: Strategy[] }>(await t.request("/v1/strategies?status=draft", { cookie: alice }));
    expect(list.items.map((x) => x.id)).toContain(s.id);
    const other = await t.request(`/v1/strategies/${s.id}`, { cookie: bob });
    expect(other.status).toBe(404);
    expect(await json<{ items: Strategy[] }>(await t.request("/v1/strategies", { cookie: bob }))).toEqual({ items: [] });
    expect((await t.request("/v1/strategies", {})).status).toBe(401);
  });

  it("HC-TR-017 refuses more than 8 legs on a new strategy and a blank name", async () => {
    const many = await t.request("/v1/strategies", { cookie: alice, json: { name: "x", asset: "BTC", legs: Array.from({ length: 9 }, () => CALL) } });
    expect(many.status).toBe(400);
    const blank = await t.request("/v1/strategies", { cookie: alice, json: { name: "   ", asset: "BTC", legs: [CALL] } });
    expect(blank.status).toBe(400);
  });

  it("HC-TR-020 Update renames and replaces draft legs; HC-TR-047 archive / restore; HC-TR-048 delete", async () => {
    const s = await create(alice);
    const upd = await json<Strategy>(await t.request(`/v1/strategies/${s.id}`, { cookie: alice, method: "PATCH", json: { name: "Renamed", legs: [CALL], tags: ["btc", "test"] } }));
    expect(upd.name).toBe("Renamed");
    expect(upd.legs).toHaveLength(1);
    expect(upd.tags).toEqual(["btc", "test"]);
    const arch = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/archive`, { cookie: alice, method: "POST" }));
    expect(arch.status).toBe("archived");
    expect(arch.closedAt).not.toBeNull();
    expect((await t.request(`/v1/strategies/${s.id}/archive`, { cookie: alice, method: "POST" })).status).toBe(409);
    const back = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/restore`, { cookie: alice, method: "POST" }));
    expect(back.status).toBe("draft");
    expect((await t.request(`/v1/strategies/${s.id}`, { cookie: alice, method: "DELETE" })).status).toBe(204);
    expect((await t.request(`/v1/strategies/${s.id}`, { cookie: alice })).status).toBe(404);
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.target, `strategy:${s.id}`));
    expect(audits.map((a) => a.action)).toEqual(["strategy.create", "strategy.update", "strategy.archive", "strategy.restore", "strategy.delete"]);
  });
});

describe("HC-TR-050..057 start paper trading", () => {
  it("starts a draft at the given entry premiums, refuses live (item 2) and unknown exchanges", async () => {
    const s = await create(alice);
    const [call, put] = s.legs;
    const live = await t.request(`/v1/strategies/${s.id}/start`, { cookie: alice, json: { mode: "live", brokerId: SEED.brokerId, entries: {} } });
    expect(live.status).toBe(409);
    const bad = await t.request(`/v1/strategies/${s.id}/start`, { cookie: alice, json: { mode: "paper", brokerId: "brk_nope", entries: {} } });
    expect(bad.status).toBe(400);
    const started = await startPaper(alice, s.id, { [call!.id]: "1250.5" });
    expect(started.status).toBe("paper");
    expect(started.tradingMode).toBe("paper");
    expect(started.brokerId).toBe(SEED.brokerId);
    expect(started.startedAt).not.toBeNull();
    expect(started.legs.find((l) => l.id === call!.id)?.entryPrice).toBe("1250.5");
    expect(started.legs.find((l) => l.id === put!.id)?.entryPrice).toBe("900"); // falls back to the stored price
    expect((await t.request(`/v1/strategies/${s.id}/start`, { cookie: alice, json: { mode: "paper", brokerId: SEED.brokerId, entries: {} } })).status).toBe(409);
    // draft legs cannot be replaced once active
    expect((await t.request(`/v1/strategies/${s.id}`, { cookie: alice, method: "PATCH", json: { legs: [CALL] } })).status).toBe(409);
  });
});

describe("HC-TR-071 / HC-TR-079 / HC-TR-080 / HC-TR-081 adjustments, square off, partial exit, stop", () => {
  it("adds adjustments up to 10 open legs, squares off fully and partially with realised P&L at the lot size", async () => {
    const s = await create(alice);
    const started = await startPaper(alice, s.id, {});
    const [call, put] = started.legs;
    // adjustment
    const adj = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/legs`, { cookie: alice, json: { legs: [{ ...CALL, strike: "82000", symbol: "C-BTC-82000-250926", side: "sell", lots: 5 }] } }));
    expect(adj.legs).toHaveLength(3);
    expect(adj.legs[2]).toMatchObject({ isAdjustment: true, status: "open", entryPrice: "1200", position: 2 });
    const tooMany = await t.request(`/v1/strategies/${s.id}/legs`, { cookie: alice, json: { legs: Array.from({ length: 8 }, () => CALL) } });
    expect(tooMany.status).toBe(409);
    // full square off of the sold put: entry 900, exit 800, 10 lots × 0.001 BTC, sell → +1.00
    const closed = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/legs/${put!.id}/close`, { cookie: alice, json: { exitPrice: "800" } }));
    expect(closed.legs.find((l) => l.id === put!.id)).toMatchObject({ status: "squared_off", exitPrice: "800" });
    expect(closed.realizedPnl).toBe("1");
    expect((await t.request(`/v1/strategies/${s.id}/legs/${put!.id}/close`, { cookie: alice, json: { exitPrice: "800" } })).status).toBe(409);
    // partial exit of the bought call: 4 of 10 lots at 1300 → (1300−1200)×4×0.001 = +0.40; the leg keeps 6 lots
    const partial = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/legs/${call!.id}/close`, { cookie: alice, json: { exitPrice: "1300", lots: 4 } }));
    expect(partial.realizedPnl).toBe("1.4");
    expect(partial.legs.find((l) => l.id === call!.id)).toMatchObject({ status: "open", lots: 6 });
    const split = partial.legs.find((l) => l.id !== call!.id && l.kind === "call" && l.status === "squared_off");
    expect(split).toMatchObject({ lots: 4, exitPrice: "1300", entryPrice: "1200", position: 0 });
    expect((await t.request(`/v1/strategies/${s.id}/legs/${call!.id}/close`, { cookie: alice, json: { exitPrice: "1300", lots: 7 } })).status).toBe(400);
    // P&L history upsert
    const p1 = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/pnl`, { cookie: alice, json: { day: "2026-09-08", pnl: "12.5" } }));
    const p2 = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/pnl`, { cookie: alice, json: { day: "2026-09-08", pnl: "13" } }));
    expect(p1.pnlHistory).toEqual([{ day: "2026-09-08", pnl: "12.5" }]);
    expect(p2.pnlHistory).toEqual([{ day: "2026-09-08", pnl: "13" }]);
    // history comes back sorted by day whatever the insert order
    const p3 = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/pnl`, { cookie: alice, json: { day: "2026-09-07", pnl: "1" } }));
    expect(p3.pnlHistory.map((p) => p.day)).toEqual(["2026-09-07", "2026-09-08"]);
    // square off all needs an exit for every open leg, then the paper strategy stays paper with no open legs
    const missing = await t.request(`/v1/strategies/${s.id}/close`, { cookie: alice, json: { exits: {} } });
    expect(missing.status).toBe(400);
    const open = partial.legs.filter((l) => l.status === "open");
    const exits = Object.fromEntries(open.map((l) => [l.id, "1000"]));
    const all = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/close`, { cookie: alice, json: { exits } }));
    expect(all.status).toBe("paper");
    expect(all.legs.every((l) => l.status === "squared_off")).toBe(true);
    // call 6 lots: (1000−1200)×6×0.001 = −1.2; adjustment sold call 5 lots: (1000−1200)×5×0.001×−1 = +1.0 → 1.4 − 1.2 + 1.0 = 1.2
    expect(all.realizedPnl).toBe("1.2");
    expect((await t.request(`/v1/strategies/${s.id}/close`, { cookie: alice, json: { exits } })).status).toBe(409);
  });

  it("HC-TR-081 stop keeps a draft (entries cleared) or archives with legs closed at the given exits", async () => {
    const keep = await startPaper(alice, (await create(alice)).id, {});
    const draft = await json<Strategy>(await t.request(`/v1/strategies/${keep.id}/stop`, { cookie: alice, json: { archive: false } }));
    expect(draft.status).toBe("draft");
    expect(draft.tradingMode).toBeNull();
    expect(draft.startedAt).toBeNull();
    expect(draft.legs.every((l) => l.entryPrice === null && l.status === "open")).toBe(true);
    expect((await t.request(`/v1/strategies/${keep.id}/stop`, { cookie: alice, json: { archive: false } })).status).toBe(409);

    const arch = await startPaper(alice, (await create(alice)).id, {});
    const noExits = await t.request(`/v1/strategies/${arch.id}/stop`, { cookie: alice, json: { archive: true } });
    expect(noExits.status).toBe(400);
    const exits = Object.fromEntries(arch.legs.map((l) => [l.id, l.entryPrice ?? "0"]));
    const archived = await json<Strategy>(await t.request(`/v1/strategies/${arch.id}/stop`, { cookie: alice, json: { archive: true, exits } }));
    expect(archived.status).toBe("archived");
    expect(archived.closedAt).not.toBeNull();
    expect(archived.legs.every((l) => l.status === "squared_off" && l.closeReason === "squared_off")).toBe(true);
    expect(archived.closeReason).toBe("squared_off"); // HC-TR-164
    expect(archived.realizedPnl).toBe("0");
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.target, `strategy:${arch.id}`));
    expect(audits.map((a) => a.action)).toEqual(["strategy.create", "strategy.start", "strategy.stop_archive"]);
  });
});

describe("HC-TR-071 / HC-TR-088 adjustment batch on a paper strategy (ADR-044)", () => {
  const adjust = (cookie: string, id: string, body: Record<string, unknown>) => t.request(`/v1/strategies/${id}/adjust`, { cookie, json: body });
  const reconcile = (cookie: string, id: string, body: Record<string, unknown>) => t.request(`/v1/strategies/${id}/reconcile`, { cookie, json: body });
  const SOLD_CALL = { ...CALL, strike: "82000", symbol: "C-BTC-82000-250926", side: "sell", lots: 5, price: "700" };

  it("trims, closes and adds in one batch, books realised P&L on the closed lots and keeps the reason as history", async () => {
    const s = await create(alice);
    const started = await startPaper(alice, s.id, {});
    const [call, put] = started.legs;
    const res = await adjust(alice, s.id, {
      adds: [SOLD_CALL],
      changes: [
        { legId: call!.id, lotsAfter: 6, price: "1300" }, // trims 4 of 10: (1300−1200)×4×0.001 = +0.40
        { legId: put!.id, lotsAfter: 0, price: "800" }, // closes: (800−900)×10×0.001×−1 = +1.00
      ],
      expected: { "C-BTC-82000-250926": "700" },
      idempotencyKey: "key-adj-paper-01",
      reason: "  spot ran above the wings  ",
    });
    expect(res.status).toBe(200);
    const a = await json<Strategy>(res);
    expect(Strategy.safeParse(a).success).toBe(true);
    expect(a.realizedPnl).toBe("1.4");
    expect(a.legs.find((l) => l.id === call!.id)).toMatchObject({ status: "open", lots: 6 });
    expect(a.legs.find((l) => l.id === put!.id)).toMatchObject({ status: "squared_off", exitPrice: "800", lots: 10 });
    expect(a.legs.filter((l) => l.status === "squared_off" && l.kind === "call")).toMatchObject([{ lots: 4, exitPrice: "1300", entryPrice: "1200" }]);
    expect(a.legs.find((l) => l.symbol === "C-BTC-82000-250926")).toMatchObject({ status: "open", isAdjustment: true, entryPrice: "700", lots: 5, side: "sell", position: 2 });
    expect(a.adjustments).toMatchObject([{ reason: "spot ran above the wings", added: 1, trimmed: 1, closed: 1, realizedPnl: "1.4", batchId: "key-adj-paper-01" }]);
    expect(a.adjustments[0]!.at).toBeTruthy();
    // the same key again is the same batch: nothing changes
    const again = await json<Strategy>(await adjust(alice, s.id, { adds: [SOLD_CALL], idempotencyKey: "key-adj-paper-01" }));
    expect(again.legs).toHaveLength(a.legs.length);
    expect(again.adjustments).toHaveLength(1);
    expect(again.realizedPnl).toBe("1.4");
    // a batch without a key or reason still leaves a history row
    const more = await json<Strategy>(await adjust(alice, s.id, { adds: [SOLD_CALL] }));
    expect(more.adjustments).toHaveLength(2);
    expect(more.adjustments[1]).toMatchObject({ reason: null, added: 1, trimmed: 0, closed: 0, realizedPnl: "0" });
    expect(more.adjustments[1]!.batchId).toMatch(/^adj:/);
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.target, `strategy:${s.id}`));
    expect(audits.filter((x) => x.action === "strategy.adjust")).toHaveLength(2);
  });

  it("HC-TR-161 reconcile books lots closed outside the app at the given price, keeps the reason, archives when nothing is open, refuses bad legs", async () => {
    const s = await create(alice);
    const started = await startPaper(alice, s.id, {});
    const [call, put] = started.legs;
    expect((await reconcile(alice, s.id, { legs: [{ legId: "leg_nope", price: "1" }] })).status).toBe(400);
    expect((await reconcile(alice, s.id, { legs: [{ legId: call!.id, lots: 99, price: "1" }] })).status).toBe(400);
    expect((await reconcile(alice, s.id, { legs: [{ legId: call!.id, price: "1" }, { legId: call!.id, price: "1" }] })).status).toBe(400);
    const res = await reconcile(alice, s.id, { legs: [{ legId: call!.id, lots: 4, price: "1300" }], reason: "stop hit on the exchange" });
    expect(res.status).toBe(200);
    const a = await json<Strategy>(res);
    expect(a.status).toBe("paper");
    expect(a.realizedPnl).toBe("0.4"); // (1300 − 1200) × 4 × 0.001, booked without any order
    expect(a.legs.find((l) => l.id === call!.id)).toMatchObject({ status: "open", lots: 6 });
    expect(a.legs.find((l) => l.status === "squared_off")).toMatchObject({ lots: 4, closeReason: "outside_app" }); // HC-TR-164
    expect(a.closeReason ?? null).toBeNull();
    const last = a.adjustments[a.adjustments.length - 1]!;
    expect(last).toMatchObject({ reason: "closed outside the app: stop hit on the exchange", added: 0, trimmed: 1, closed: 0, realizedPnl: "0.4" });
    expect(last.batchId).toMatch(/^reconcile:/);
    const done = await json<Strategy>(await reconcile(alice, s.id, { legs: [{ legId: call!.id, price: "1300" }, { legId: put!.id, price: "800" }] }));
    expect(done.status).toBe("archived");
    expect(done.closedAt).toBeTruthy();
    expect(done.closeReason).toBe("outside_app");
    expect(done.legs.every((l) => l.status === "squared_off" && l.closeReason === "outside_app")).toBe(true);
    expect(done.adjustments[done.adjustments.length - 1]).toMatchObject({ reason: "closed outside the app", closed: 2, trimmed: 0 });
    expect((await reconcile(alice, s.id, { legs: [{ legId: put!.id, price: "1" }] })).status).toBe(409);
    const draft = await create(alice);
    expect((await reconcile(alice, draft.id, { legs: [{ legId: draft.legs[0]!.id, price: "1" }] })).status).toBe(409);
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.target, `strategy:${s.id}`));
    expect(audits.filter((x) => x.action === "strategy.reconcile")).toHaveLength(2);
  });

  it("refuses unknown, closed or doubled legs, more lots than open, empty batches, drafts and other users' strategies", async () => {
    const s = await create(alice);
    expect((await adjust(alice, s.id, { adds: [SOLD_CALL] })).status).toBe(409); // still a draft
    const started = await startPaper(alice, s.id, {});
    const [call, put] = started.legs;
    expect((await adjust(bob, s.id, { adds: [SOLD_CALL] })).status).toBe(404);
    expect((await adjust(alice, s.id, {})).status).toBe(400);
    expect((await adjust(alice, s.id, { adds: [], changes: [] })).status).toBe(400);
    const unknown = await adjust(alice, s.id, { changes: [{ legId: "leg_nope", lotsAfter: 0, price: "1" }] });
    expect(unknown.status).toBe(400);
    expect((await json<{ message: string }>(unknown)).message).toContain("not an open leg");
    const tooMany = await adjust(alice, s.id, { changes: [{ legId: call!.id, lotsAfter: 11, price: "1" }] });
    expect(tooMany.status).toBe(400);
    expect((await json<{ message: string }>(tooMany)).message).toContain('add lots through "adds"');
    const doubled = await adjust(alice, s.id, { changes: [{ legId: call!.id, lotsAfter: 10, price: "1" }, { legId: call!.id, lotsAfter: 0, price: "1" }] }); // even when the first entry is a no-op
    expect(doubled.status).toBe(400);
    expect((await json<{ message: string }>(doubled)).message).toContain("listed twice");
    expect((await adjust(alice, s.id, { adds: [SOLD_CALL], expected: { "C-BTC-82000-250926": "0" } })).status).toBe(400);
    // lots after equal to the open lots is a no-op, so a batch of only no-ops is empty
    const noop = await adjust(alice, s.id, { changes: [{ legId: call!.id, lotsAfter: 10, price: "1" }] });
    expect(noop.status).toBe(400);
    expect((await json<{ message: string }>(noop)).message).toBe("Nothing to adjust");
    // a closed leg is no longer open
    await t.request(`/v1/strategies/${s.id}/legs/${put!.id}/close`, { cookie: alice, json: { exitPrice: "800" } });
    expect((await adjust(alice, s.id, { changes: [{ legId: put!.id, lotsAfter: 0, price: "1" }] })).status).toBe(400);
    const after = await json<Strategy>(await t.request(`/v1/strategies/${s.id}`, { cookie: alice }));
    expect(after.adjustments).toEqual([]);
    expect(after.legs.find((l) => l.id === call!.id)).toMatchObject({ status: "open", lots: 10 });
  });

  it("HC-TR-017 counts the cap after the closes in the same batch", async () => {
    const s = await create(alice);
    const started = await startPaper(alice, s.id, {});
    const [call] = started.legs;
    const nine = Array.from({ length: 9 }, (_, i) => ({ ...SOLD_CALL, strike: String(82000 + i * 500), symbol: `C-BTC-${82000 + i * 500}-250926` }));
    expect((await adjust(alice, s.id, { adds: nine })).status).toBe(409); // 2 + 9 = 11
    const ok = await json<Strategy>(await adjust(alice, s.id, { adds: nine, changes: [{ legId: call!.id, lotsAfter: 0, price: "1200" }] })); // 2 − 1 + 9 = 10
    expect(ok.legs.filter((l) => l.status === "open")).toHaveLength(10);
    expect(ok.adjustments[0]).toMatchObject({ added: 9, trimmed: 0, closed: 1, realizedPnl: "0" });
    expect((await adjust(alice, s.id, { adds: [SOLD_CALL] })).status).toBe(409);
    expect((await adjust(alice, s.id, { adds: Array.from({ length: 11 }, () => SOLD_CALL) })).status).toBe(400); // over the body limit
  });

  it("two requests with the same key at once apply once: the history row's (strategy, batch) key is unique", async () => {
    const s = await create(alice);
    await startPaper(alice, s.id, {});
    const body = { adds: [SOLD_CALL], idempotencyKey: "key-adj-paper-race" };
    const [a, b] = await Promise.all([adjust(alice, s.id, body), adjust(alice, s.id, body)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const after = await json<Strategy>(await t.request(`/v1/strategies/${s.id}`, { cookie: alice }));
    expect(after.legs).toHaveLength(3);
    expect(after.adjustments).toHaveLength(1);
  });
});
