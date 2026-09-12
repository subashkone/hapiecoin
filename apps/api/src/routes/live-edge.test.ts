// Live execution edge paths (ADR-025): unknown outcomes and reconciliation, pending exits, delisted products on
// retry and adjustment, wallet without a settling asset, USER-scoped exchanges, and route state guards.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LivePreview, Strategy } from "@hapiecoin/schema";
import { SEED } from "../db/seed.js";
import { createTestApp, type TestApp } from "../test-support/harness.js";

let t: TestApp;
let alice: string;
beforeAll(async () => {
  t = await createTestApp();
  alice = (await t.signUp("alice-edge@hapiecoin.test")).cookie;
  t.delta.accept("edge-key");
  await t.request("/v1/credentials", { cookie: alice, json: { brokerId: SEED.brokerId, apiKey: "edge-key", apiSecret: "edge-secret" } });
});
afterAll(() => t.close());
beforeEach(() => {
  t.trading.product("C-BTC-80000-250926", 101, "0.001").markAt("C-BTC-80000-250926", "1200").fillAt(101, "1201");
  t.trading.product("P-BTC-78000-250926", 102, "0.001").markAt("P-BTC-78000-250926", "900").fillAt(102, "899");
  t.trading.setBalances([{ asset: "USD", balance: "5000", availableBalance: "4000" }]);
});

const CALL = { kind: "call", side: "buy", strike: "80000", expiry: "2026-09-25", symbol: "C-BTC-80000-250926", lots: 10, price: "1200" };
const PUT = { kind: "put", side: "sell", strike: "78000", expiry: "2026-09-25", symbol: "P-BTC-78000-250926", lots: 10, price: "900" };
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
const draft = async (legs: unknown[] = [CALL]) => json<Strategy>(await t.request("/v1/strategies", { cookie: alice, json: { name: "Edge", asset: "BTC", legs } }));
const place = (id: string, key: string) => t.request(`/v1/strategies/${id}/live/place`, { cookie: alice, json: { confirm: "LIVE", brokerId: SEED.brokerId, idempotencyKey: key } });

describe("unknown outcomes and reconciliation", () => {
  it("a timed-out placement stays pending; sync adopts the venue order by client id or marks it failed when the venue has nothing", async () => {
    const s = await draft([CALL, PUT]);
    t.trading.failWith(101, "unknown", { once: true });
    t.trading.failWith(102, "unknown", { once: true });
    const live = await json<Strategy>(await place(s.id, "key-unknown-001"));
    expect(live.orders.map((o) => o.state)).toEqual(["pending", "pending"]);
    expect(live.orders[0]!.error).toMatch(/timed out/);
    // the venue actually accepted the first one: seed an open order carrying the same client id
    const accepted = await t.trading.placeOrder({ apiKey: "edge-key", apiSecret: "edge-secret" }, { productId: 101, size: 10, side: "buy", clientOrderId: live.orders[0]!.clientOrderId });
    if (!accepted.ok) throw new Error("fake refused");
    t.trading.complete(accepted.order.id, "1203");
    // an already-closed order is not "open", so adoption goes through the open-orders list only for open ones;
    // seed an open one for the put too
    t.trading.partialNextOrder();
    const openPut = await t.trading.placeOrder({ apiKey: "edge-key", apiSecret: "edge-secret" }, { productId: 102, size: 10, side: "sell", clientOrderId: live.orders[1]!.clientOrderId });
    if (!openPut.ok) throw new Error("fake refused");
    const synced = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/live/sync`, { cookie: alice, method: "POST" }));
    const call = synced.orders.find((o) => o.legId === s.legs[0]!.id)!;
    const put = synced.orders.find((o) => o.legId === s.legs[1]!.id)!;
    expect(call.state).toBe("failed"); // closed orders are not in the open list and no venue id was known
    expect(put).toMatchObject({ state: "pending", venueOrderId: String(openPut.order.id) });
    // the put fills later; a cancelled order is reported as cancelled
    t.trading.complete(openPut.order.id, "897");
    const again = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/live/sync`, { cookie: alice, method: "POST" }));
    expect(again.orders.find((o) => o.legId === s.legs[1]!.id)).toMatchObject({ state: "filled", fillPrice: "897" });
    expect(again.legs[1]!.entryPrice).toBe("897");
  });

  it("a pending order the venue cancelled becomes cancelled on sync", async () => {
    const s = await draft([CALL]);
    t.trading.partialNextOrder();
    const live = await json<Strategy>(await place(s.id, "key-cancel-0001"));
    const venueId = Number(live.orders[0]!.venueOrderId);
    await t.trading.cancelOrder({ apiKey: "edge-key", apiSecret: "edge-secret" }, venueId, 101);
    const synced = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/live/sync`, { cookie: alice, method: "POST" }));
    expect(synced.orders[0]).toMatchObject({ state: "cancelled" });
  });

  it("an exit that only partially fills answers 502 and leaves the leg open with a pending exit order", async () => {
    const s = await draft([CALL]);
    const live = await json<Strategy>(await place(s.id, "key-pexit-00001"));
    t.trading.partialNextOrder();
    const res = await t.request(`/v1/strategies/${s.id}/legs/${live.legs[0]!.id}/close`, { cookie: alice, json: { exitPrice: "1" } });
    expect(res.status).toBe(502);
    expect((await json<{ message: string }>(res)).message).toMatch(/still filling/);
    const still = await json<Strategy>(await t.request(`/v1/strategies/${s.id}`, { cookie: alice }));
    expect(still.legs[0]!.status).toBe("open");
    expect(still.orders.filter((o) => o.purpose === "exit").map((o) => o.state)).toEqual(["pending"]);
  });
});

describe("retry, adjustment and preview edges", () => {
  it("retry skips a leg whose product was delisted, reports the reason, and refuses on a non-live strategy", async () => {
    const s = await draft([CALL]);
    t.trading.failWith(101, "market_disrupted", { once: true });
    const live = await json<Strategy>(await place(s.id, "key-retry-00001"));
    expect(live.orders[0]!.state).toBe("failed");
    t.trading.product("C-BTC-80000-250926", 101, "0.003"); // no longer a whole number of contracts
    const retried = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/live/retry`, { cookie: alice, json: { confirm: "LIVE" } }));
    expect(retried.orders[0]!.state).toBe("failed");
    const paper = await draft([CALL]);
    await t.request(`/v1/strategies/${paper.id}/start`, { cookie: alice, json: { mode: "paper", brokerId: SEED.brokerId, entries: {} } });
    expect((await t.request(`/v1/strategies/${paper.id}/live/retry`, { cookie: alice, json: { confirm: "LIVE" } })).status).toBe(409);
    expect((await t.request(`/v1/strategies/${paper.id}/live/sync`, { cookie: alice, method: "POST" })).status).toBe(409);
  });

  it("an adjustment on a live strategy is refused before any order when a product cannot be sized, and when the account is switched off", async () => {
    const s = await draft([CALL]);
    await place(s.id, "key-adj-edge-01");
    t.trading.product("C-BTC-90000-250926", 109, "0.003");
    const bad = await t.request(`/v1/strategies/${s.id}/legs`, { cookie: alice, json: { confirm: "LIVE", legs: [{ ...CALL, strike: "90000", symbol: "C-BTC-90000-250926" }] } });
    expect(bad.status).toBe(409);
    expect((await json<{ message: string }>(bad)).message).toMatch(/not a whole number/);
    expect((await json<Strategy>(await t.request(`/v1/strategies/${s.id}`, { cookie: alice }))).legs).toHaveLength(1);
    const off = await createTestApp({ TRADING_DISABLED: "true" });
    try {
      const cookie = (await off.signUp("edge-off@hapiecoin.test")).cookie;
      const d = await json<Strategy>(await off.request("/v1/strategies", { cookie, json: { name: "k", asset: "BTC", legs: [CALL] } }));
      const p = await json<LivePreview>(await off.request(`/v1/strategies/${d.id}/live/preview`, { cookie, json: { brokerId: SEED.brokerId } }));
      expect(p.reasons[0]).toBe("Live trading is paused by the operator");
      expect((await off.request("/v1/strategies/live/batch", { cookie, json: { confirm: "LIVE", ids: [d.id], brokerId: SEED.brokerId, idempotencyKey: "key-batch-off-01" } })).status).toBe(409);
    } finally {
      await off.close();
    }
  });

  it("preview without a settling-asset balance skips the wallet check; a USER-scoped exchange works with its own credential; positions need a credential", async () => {
    t.trading.setBalances([{ asset: "BTC", balance: "1", availableBalance: "1" }]);
    const s = await draft([CALL]);
    const p = await json<LivePreview>(await t.request(`/v1/strategies/${s.id}/live/preview`, { cookie: alice, json: { brokerId: SEED.brokerId, worstLoss: -99999 } }));
    expect(p.ok).toBe(true);
    expect(p.available).toBeNull();
    const mine = await json<{ id: string }>(await t.request("/v1/brokers", { cookie: alice, json: { name: "My venue", feePct: "0.1", gstPct: "18", feeCapPct: "10" } }));
    const noCred = await json<LivePreview>(await t.request(`/v1/strategies/${s.id}/live/preview`, { cookie: alice, json: { brokerId: mine.id } }));
    expect(noCred.reasons).toContain("Connect your exchange in Settings → API Settings to enable live trading");
    t.delta.accept("mine-key");
    await t.request("/v1/credentials", { cookie: alice, json: { brokerId: mine.id, apiKey: "mine-key", apiSecret: "mine-secret" } });
    const withCred = await json<LivePreview>(await t.request(`/v1/strategies/${s.id}/live/preview`, { cookie: alice, json: { brokerId: mine.id } }));
    expect(withCred.ok).toBe(true);
    expect((await t.request(`/v1/strategies/live/positions?brokerId=brk_unknown`, { cookie: alice })).status).toBe(400);
    const bob = (await t.signUp("bob-edge@hapiecoin.test")).cookie;
    expect((await t.request(`/v1/strategies/live/positions?brokerId=${SEED.brokerId}`, { cookie: bob })).status).toBe(409);
    expect((await t.request(`/v1/admin/users/usr_nope/trading`, { cookie: await t.adminCookie(), json: { disabled: true } })).status).toBe(404);
  });
});
