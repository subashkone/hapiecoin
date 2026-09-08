// Live batch bookkeeping (skipped / already placed / stopped), list payloads carrying orders and P&L, a live
// adjustment refused by the per-user kill switch, and an exit whose product the venue no longer lists (ADR-025).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LiveBatchResult, LivePreview, Strategy } from "@hapiecoin/schema";
import { eq } from "drizzle-orm";
import { brokerCredentials } from "../db/schema.js";
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

  it("a stored credential sealed under another encryption key is reported as 'reconnect', not as a wallet error (GAPS #42)", async () => {
    const s = await draft("sealed elsewhere");
    const [row] = await t.db.select().from(brokerCredentials).where(eq(brokerCredentials.brokerId, SEED.brokerId)).limit(1);
    const original = row!.apiSecretTag;
    await t.db.update(brokerCredentials).set({ apiSecretTag: Buffer.alloc(original.length, 7).toString("base64") }).where(eq(brokerCredentials.id, row!.id));
    try {
      const p = await json<LivePreview>(await t.request(`/v1/strategies/${s.id}/live/preview`, { cookie: alice, json: { brokerId: SEED.brokerId } }));
      expect(p.ok).toBe(false);
      expect(p.reasons).toContain("Your saved exchange key cannot be decrypted because the server's encryption key changed. Reconnect it in Settings → API Settings.");
      expect((await t.request(`/v1/strategies/${s.id}/live/place`, { cookie: alice, json: { brokerId: SEED.brokerId, idempotencyKey: "key-sealed-cover-1" } })).status).toBe(409);
    } finally {
      await t.db.update(brokerCredentials).set({ apiSecretTag: original }).where(eq(brokerCredentials.id, row!.id));
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

describe("HC-TR-145 exchange positions exit", () => {
  it("places reduce-only market orders for ticked positions, closes the matching live legs at the fill, archives an emptied strategy, and reports unknown or refused products", async () => {
    const s = await draft("positions", [CALL, { ...CALL, strike: "90000", symbol: "C-BTC-90000-250926" }]);
    const live = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/live/place`, { cookie: alice, json: { brokerId: SEED.brokerId, idempotencyKey: "key-pos-cover-001" } }));
    expect(live.orders.map((o) => o.state)).toEqual(["filled", "filled"]);
    t.trading.setPositions([
      { productId: 101, symbol: "C-BTC-80000-250926", size: 10, entryPrice: "1201", realizedPnl: "0", margin: "12" },
      { productId: 109, symbol: "C-BTC-90000-250926", size: 10, entryPrice: "301", realizedPnl: "0", margin: "4" },
      { productId: 555, symbol: "P-BTC-70000-250926", size: -3, entryPrice: "50", realizedPnl: "0", margin: "1" },
    ]);
    const listed = await json<{ positions: { productId: number; contractValue: string | null; mark: string | null }[] }>(await t.request(`/v1/strategies/live/positions?brokerId=${SEED.brokerId}`, { cookie: alice }));
    expect(listed.positions.find((p) => p.productId === 101)).toMatchObject({ contractValue: "0.001", mark: "1200" });
    expect(listed.positions.find((p) => p.productId === 555)).toMatchObject({ contractValue: null, mark: null }); // product unknown to the fake
    t.trading.fillAt(101, "1300").fillAt(109, "250").failWith(555, "market_disrupted", { once: true });
    const placedBefore = t.trading.placed.length;
    const r = await json<{ closed: { productId: number; fillPrice: string | null; state: string }[]; failed: { productId: number; error: string }[] }>(
      await t.request("/v1/strategies/live/positions/exit", { cookie: alice, json: { brokerId: SEED.brokerId, productIds: [101, 109, 555, 777], idempotencyKey: "key-pos-exit-0001" } }),
    );
    expect(r.closed).toEqual([
      { productId: 101, fillPrice: "1300", state: "closed" },
      { productId: 109, fillPrice: "250", state: "closed" },
    ]);
    expect(r.failed).toEqual([
      { productId: 555, error: expect.stringMatching(/disrupted/) as string },
      { productId: 777, error: "No open position for this product" },
    ]);
    const orders = t.trading.placed.slice(placedBefore).map((x) => x.input);
    expect(orders.map((o) => [o.productId, o.side, o.size, o.reduceOnly])).toEqual([
      [101, "sell", 10, true],
      [109, "sell", 10, true],
      [555, "buy", 3, true],
    ]);
    expect(orders[0]!.clientOrderId).toBe("hc-pos-101-osexit0001"); // last ten alphanumerics of the key
    const after = await get(s.id);
    expect(after.status).toBe("archived");
    expect(after.legs.map((l) => [l.status, l.exitPrice])).toEqual([
      ["squared_off", "1300"],
      ["squared_off", "250"],
    ]);
    // long 10 lots × 0.001 BTC: (1300 − 1201) × 0.01 + (250 − 301) × 0.01 = 0.99 − 0.51
    expect(Number(after.realizedPnl)).toBeCloseTo(0.48, 6);
  });

  it("lists a position without a symbol as unsized, and a partially filled exit stays pending with the leg open", async () => {
    const s = await draft("partial exit");
    await t.request(`/v1/strategies/${s.id}/live/place`, { cookie: alice, json: { brokerId: SEED.brokerId, idempotencyKey: "key-pos-cover-002" } });
    t.trading.setPositions([
      { productId: 101, symbol: "C-BTC-80000-250926", size: 10, entryPrice: "1201", realizedPnl: "0", margin: "12" },
      { productId: 9, symbol: null, size: 1, entryPrice: null, realizedPnl: null, margin: null },
    ]);
    const listed = await json<{ positions: { productId: number; contractValue: string | null; mark: string | null }[] }>(await t.request(`/v1/strategies/live/positions?brokerId=${SEED.brokerId}`, { cookie: alice }));
    expect(listed.positions.find((p) => p.productId === 9)).toMatchObject({ contractValue: null, mark: null });
    t.trading.partialNextOrder();
    const r = await json<{ closed: { productId: number; state: string; fillPrice: string | null }[]; failed: unknown[] }>(
      await t.request("/v1/strategies/live/positions/exit", { cookie: alice, json: { brokerId: SEED.brokerId, productIds: [101], idempotencyKey: "key-pos-exit-0004" } }),
    );
    expect(r.closed).toEqual([{ productId: 101, state: "pending", fillPrice: null }]);
    expect((await get(s.id)).legs[0]!.status).toBe("open");
  });

  it("refuses when trading is switched off for the account and needs a connected exchange", async () => {
    expect((await t.request(`/v1/admin/users/${aliceId}/trading`, { cookie: await t.adminCookie(), json: { disabled: true } })).status).toBe(200);
    try {
      expect((await t.request("/v1/strategies/live/positions/exit", { cookie: alice, json: { brokerId: SEED.brokerId, productIds: [101], idempotencyKey: "key-pos-exit-0002" } })).status).toBe(409);
    } finally {
      await t.request(`/v1/admin/users/${aliceId}/trading`, { cookie: await t.adminCookie(), json: { disabled: false } });
    }
    const bob = (await t.signUp("bob-cover@hapiecoin.test")).cookie;
    expect((await t.request("/v1/strategies/live/positions/exit", { cookie: bob, json: { brokerId: SEED.brokerId, productIds: [101], idempotencyKey: "key-pos-exit-0003" } })).status).toBe(409);
  });
});

