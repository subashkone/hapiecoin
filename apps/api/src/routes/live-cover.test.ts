// Live batch bookkeeping (skipped / already placed / stopped), list payloads carrying orders and P&L, a live
// adjustment refused by the per-user kill switch, and an exit whose product the venue no longer lists (ADR-025).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LiveBatchResult, Strategy } from "@hapiecoin/schema";
import { SEED } from "../db/seed.js";
import { createTestApp, type TestApp } from "../test-support/harness.js";

let t: TestApp;
let alice: string;
let aliceId: string;
beforeAll(async () => {
  t = await createTestApp();
  alice = (await t.signUp("alice-cover@hapiecoin.test")).cookie;
  aliceId = ((await (await t.request("/v1/me", { cookie: alice })).json()) as { id: string }).id;
  t.delta.accept("cover-key");
  await t.request("/v1/credentials", { cookie: alice, json: { brokerId: SEED.brokerId, apiKey: "cover-key", apiSecret: "cover-secret" } });
});
afterAll(() => t.close());
beforeEach(() => {
  t.trading.product("C-BTC-80000-250926", 101, "0.001").markAt("C-BTC-80000-250926", "1200").fillAt(101, "1201");
  t.trading.product("C-BTC-90000-250926", 109, "0.001").markAt("C-BTC-90000-250926", "300").fillAt(109, "301");
  t.trading.setBalances([{ asset: "USD", balance: "5000", availableBalance: "4000" }]);
});

const CALL = { kind: "call", side: "buy", strike: "80000", expiry: "2026-09-25", symbol: "C-BTC-80000-250926", lots: 10, price: "1200" };
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
const draft = async (name: string, legs: unknown[] = [CALL]) => json<Strategy>(await t.request("/v1/strategies", { cookie: alice, json: { name, asset: "BTC", legs } }));
const paper = async (name: string, legs: unknown[] = [CALL]) => {
  const d = await draft(name, legs);
  return json<Strategy>(await t.request(`/v1/strategies/${d.id}/start`, { cookie: alice, json: { mode: "paper", brokerId: SEED.brokerId, entries: Object.fromEntries(d.legs.map((l) => [l.id, l.price])) } }));
};
const get = async (id: string) => json<Strategy>(await t.request(`/v1/strategies/${id}`, { cookie: alice }));

describe("HC-TR-089 batch bookkeeping", () => {
  it("skips non-paper ids, places in order, stops at the first refusal, and a repeat with the same key places nothing twice", async () => {
    const d = await draft("still a draft");
    const a = await paper("A");
    t.trading.product("C-BTC-70000-250926", 107, "0.003"); // 10 lots × 0.001 ÷ 0.003 is not whole → preview refuses
    const b = await paper("B", [{ ...CALL, strike: "70000", symbol: "C-BTC-70000-250926" }]);
    const c = await paper("C");
    const body = { ids: [d.id, a.id, b.id, c.id], brokerId: SEED.brokerId, idempotencyKey: "key-batch-cover-1" };
    const r1 = await json<LiveBatchResult>(await t.request("/v1/strategies/live/batch", { cookie: alice, json: body }));
    expect(r1).toEqual({ placed: [a.id], failed: { id: b.id, error: expect.stringMatching(/not a whole number/) as string }, skipped: [d.id] });
    expect((await get(a.id)).status).toBe("live");
    expect((await get(b.id)).status).toBe("paper");
    expect((await get(c.id)).status).toBe("paper"); // never reached
    const placedBefore = t.trading.placed.length;
    // same key again: A is reported as placed from its recorded batch, B refuses again, C is still not reached
    const r2 = await json<LiveBatchResult>(await t.request("/v1/strategies/live/batch", { cookie: alice, json: body }));
    expect(r2.placed).toEqual([a.id]);
    expect(r2.skipped).toEqual([d.id]);
    expect(r2.failed?.id).toBe(b.id);
    expect(t.trading.placed.length).toBe(placedBefore);
    // once B is fixed, a new key continues with B and C
    t.trading.product("C-BTC-70000-250926", 107, "0.001").markAt("C-BTC-70000-250926", "2000").fillAt(107, "2001");
    const r3 = await json<LiveBatchResult>(await t.request("/v1/strategies/live/batch", { cookie: alice, json: { ...body, ids: [b.id, c.id], idempotencyKey: "key-batch-cover-2" } }));
    expect(r3).toEqual({ placed: [b.id, c.id], failed: null, skipped: [] });
    const again = await json<LiveBatchResult>(await t.request("/v1/strategies/live/batch", { cookie: alice, json: { ...body, ids: [b.id, c.id], idempotencyKey: "key-batch-cover-2" } }));
    expect(again).toEqual({ placed: [b.id, c.id], failed: null, skipped: [] });
    expect(t.trading.placed.length).toBe(placedBefore + 2);
  });
});

describe("list payloads and live guards", () => {
  it("the list carries each strategy's orders and P&L history", async () => {
    const s = await draft("listed");
    await t.request(`/v1/strategies/${s.id}/live/place`, { cookie: alice, json: { brokerId: SEED.brokerId, idempotencyKey: "key-list-cover-01" } });
    await t.request(`/v1/strategies/${s.id}/pnl`, { cookie: alice, json: { day: "2026-09-08", pnl: "1.5" } });
    const list = await json<{ items: Strategy[] }>(await t.request("/v1/strategies", { cookie: alice }));
    const mine = list.items.find((x) => x.id === s.id)!;
    expect(mine.orders.map((o) => o.state)).toEqual(["filled"]);
    expect(mine.pnlHistory).toEqual([{ day: "2026-09-08", pnl: "1.5" }]);
  });

  it("an adjustment on a live strategy is refused with no leg left behind when the operator has switched the account off", async () => {
    const s = await draft("switched off");
    await t.request(`/v1/strategies/${s.id}/live/place`, { cookie: alice, json: { brokerId: SEED.brokerId, idempotencyKey: "key-kill-cover-01" } });
    expect((await t.request(`/v1/admin/users/${aliceId}/trading`, { cookie: await t.adminCookie(), json: { disabled: true } })).status).toBe(200);
    try {
      const res = await t.request(`/v1/strategies/${s.id}/legs`, { cookie: alice, json: { legs: [{ ...CALL, strike: "90000", symbol: "C-BTC-90000-250926" }] } });
      expect(res.status).toBe(409);
      expect((await json<{ message: string }>(res)).message).toMatch(/disabled for this account/);
      expect((await get(s.id)).legs).toHaveLength(1);
    } finally {
      await t.request(`/v1/admin/users/${aliceId}/trading`, { cookie: await t.adminCookie(), json: { disabled: false } });
    }
  });

  it("closing a live leg whose product the venue no longer lists answers 502 and leaves the leg open", async () => {
    const s = await draft("delisted", [{ ...CALL, strike: "90000", symbol: "C-BTC-90000-250926" }]);
    const live = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/live/place`, { cookie: alice, json: { brokerId: SEED.brokerId, idempotencyKey: "key-delist-cover-1" } }));
    expect(live.orders[0]!.state).toBe("filled");
    t.trading.forget("C-BTC-90000-250926");
    const res = await t.request(`/v1/strategies/${s.id}/legs/${live.legs[0]!.id}/close`, { cookie: alice, json: { exitPrice: "1" } });
    expect(res.status).toBe(502);
    expect((await json<{ message: string }>(res)).message).toMatch(/not listed/);
    expect((await get(s.id)).legs[0]!.status).toBe("open");
  });
});
