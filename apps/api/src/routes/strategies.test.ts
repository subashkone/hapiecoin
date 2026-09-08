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
    expect(archived.legs.every((l) => l.status === "squared_off")).toBe(true);
    expect(archived.realizedPnl).toBe("0");
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.target, `strategy:${arch.id}`));
    expect(audits.map((a) => a.action)).toEqual(["strategy.create", "strategy.start", "strategy.stop_archive"]);
  });
});
