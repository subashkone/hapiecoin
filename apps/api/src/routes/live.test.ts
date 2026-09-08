// Live trading routes against the recording executor fake (trading-safety rule 2; ADR-025).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LivePreview, Strategy } from "@hapiecoin/schema";
import { eq } from "drizzle-orm";
import { auditLog, users } from "../db/schema.js";
import { SEED } from "../db/seed.js";
import { createTestApp, type TestApp } from "../test-support/harness.js";

let t: TestApp;
let alice: string;
let aliceId: string;
beforeAll(async () => {
  t = await createTestApp();
  alice = (await t.signUp("alice-live@hapiecoin.test")).cookie;
  aliceId = ((await (await t.request("/v1/me", { cookie: alice })).json()) as { id: string }).id;
  // connect the (fake) exchange: the credential check accepts this key
  t.delta.accept("live-key");
  const res = await t.request("/v1/credentials", { cookie: alice, json: { brokerId: SEED.brokerId, apiKey: "live-key", apiSecret: "live-secret" } });
  expect(res.status).toBe(201);
});
afterAll(() => t.close());
beforeEach(() => {
  t.trading.product("C-BTC-80000-250926", 101, "0.001").markAt("C-BTC-80000-250926", "1200").fillAt(101, "1201");
  t.trading.product("P-BTC-78000-250926", 102, "0.001").markAt("P-BTC-78000-250926", "900").fillAt(102, "899");
  t.trading.product("BTCUSD", 27, "0.001").markAt("BTCUSD", "79500").fillAt(27, "79510");
  t.trading.setBalances([{ asset: "USD", balance: "5000", availableBalance: "4000" }]);
});

const CALL = { kind: "call", side: "buy", strike: "80000", expiry: "2026-09-25", symbol: "C-BTC-80000-250926", lots: 10, price: "1200" };
const PUT = { kind: "put", side: "sell", strike: "78000", expiry: "2026-09-25", symbol: "P-BTC-78000-250926", lots: 10, price: "900" };
async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
async function draft(legs: unknown[] = [CALL, PUT], name = "Live test") {
  return json<Strategy>(await t.request("/v1/strategies", { cookie: alice, json: { name, asset: "BTC", legs } }));
}
const preview = (id: string, extra: Record<string, unknown> = {}) => t.request(`/v1/strategies/${id}/live/preview`, { cookie: alice, json: { brokerId: SEED.brokerId, ...extra } });
const place = (id: string, key: string, expected: Record<string, string> = {}) => t.request(`/v1/strategies/${id}/live/place`, { cookie: alice, json: { brokerId: SEED.brokerId, idempotencyKey: key, expected } });

describe("HC-TR-056 / HC-TR-088 live preview and safeguards", () => {
  it("sizes contracts from lots × lot size ÷ contract value, prices notional at the venue mark and reads the wallet", async () => {
    const s = await draft();
    const p = await json<LivePreview>(await preview(s.id));
    expect(p.ok).toBe(true);
    expect(p.legs.map((l) => [l.symbol, l.contracts, l.mark, l.notional])).toEqual([
      ["C-BTC-80000-250926", 10, "1200", "12"],
      ["P-BTC-78000-250926", 10, "900", "9"],
    ]);
    expect(p.notional).toBe("21");
    expect(p.available).toBe("4000");
    expect(p.availableAsset).toBe("USD");
    expect(p.limits).toEqual({ maxLegs: 10, maxNotionalUsd: 100_000, markBandPct: 5 });
  });

  it("reports every blocker: fractional contracts, unlisted product, notional over the limit, wallet below the worst loss, and the account kill switch", async () => {
    t.trading.product("C-BTC-80000-250926", 101, "0.003");
    t.trading.product("BTCUSD", 27, "0.001", "expired");
    const s = await draft([CALL, { ...CALL, kind: "future", strike: "", expiry: "PERP", symbol: "BTCUSD", lots: 2000 }, { ...PUT, symbol: "P-BTC-99999-250926" }]);
    const p = await json<LivePreview>(await preview(s.id, { worstLoss: -9999 }));
    expect(p.ok).toBe(false);
    expect(p.reasons.join("\n")).toMatch(/not a whole number/);
    expect(p.reasons.join("\n")).toMatch(/BTCUSD: product is expired/);
    expect(p.reasons.join("\n")).toMatch(/P-BTC-99999-250926: .*not listed/);
    expect(p.reasons.join("\n")).toMatch(/exceeds the 100000 USD limit/);
    expect(p.reasons.join("\n")).toMatch(/below the worst-loss estimate 9999/);
    // account kill switch (admin route) and the audit trail it leaves
    const admin = await t.adminCookie();
    const off = await t.request(`/v1/admin/users/${aliceId}/trading`, { cookie: admin, json: { disabled: true } });
    expect(off.status).toBe(200);
    expect((await t.request(`/v1/admin/users/${aliceId}/trading`, { cookie: alice, json: { disabled: true } })).status).toBe(403);
    const blocked = await json<LivePreview>(await preview(s.id));
    expect(blocked.reasons).toContain("Live trading is disabled for this account");
    expect((await place(s.id, "key-blocked-000")).status).toBe(409);
    await t.request(`/v1/admin/users/${aliceId}/trading`, { cookie: admin, json: { disabled: false } });
    const [u] = await t.db.select({ d: users.tradingDisabled }).from(users).where(eq(users.id, aliceId));
    expect(u?.d).toBe(false);
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.target, `user:${aliceId}`));
    expect(audits.map((a) => a.action)).toEqual(["user.trading_disable", "user.trading_enable"]);
  });

  it("refuses without a connected exchange", async () => {
    const bob = (await t.signUp("bob-live@hapiecoin.test")).cookie;
    const s = await json<Strategy>(await t.request("/v1/strategies", { cookie: bob, json: { name: "x", asset: "BTC", legs: [CALL] } }));
    const p = await json<LivePreview>(await t.request(`/v1/strategies/${s.id}/live/preview`, { cookie: bob, json: { brokerId: SEED.brokerId } }));
    expect(p.reasons).toContain("Connect your exchange in Settings → API Settings to enable live trading");
    expect((await t.request(`/v1/strategies/${s.id}/live/place`, { cookie: bob, json: { brokerId: SEED.brokerId, idempotencyKey: "key-bob-0001" } })).status).toBe(409);
  });
});

describe("HC-TR-057 / HC-TR-063 / HC-TR-084 / HC-TR-085 placement, idempotency, retry and sync", () => {
  it("places one market order per leg through the executor, fills set the entry premiums, and a repeat of the key is a no-op", async () => {
    const s = await draft();
    const before = t.trading.placed.length;
    const live = await json<Strategy>(await place(s.id, "key-place-0001", { [s.legs[0]!.id]: "1200", [s.legs[1]!.id]: "900" }));
    expect(live.status).toBe("live");
    expect(live.tradingMode).toBe("live");
    expect(live.orderBatchId).toBe("key-place-0001");
    expect(live.legs.map((l) => l.entryPrice)).toEqual(["1201", "899"]);
    expect(live.orders.map((o) => [o.purpose, o.state, o.size, o.fillPrice, o.attempts])).toEqual([
      ["entry", "filled", 10, "1201", 1],
      ["entry", "filled", 10, "899", 1],
    ]);
    expect(live.orders[0]!.clientOrderId).toBe(`hc-${s.legs[0]!.id}-1`);
    const sent = t.trading.placed.slice(before);
    expect(sent.map((p) => [p.input.productId, p.input.side, p.input.size, p.input.reduceOnly])).toEqual([
      [101, "buy", 10, false],
      [102, "sell", 10, false],
    ]);
    expect(sent[0]!.creds).toEqual({ apiKey: "live-key", apiSecret: "live-secret" });
    // repeat with the same idempotency key: nothing placed again
    const again = await json<Strategy>(await place(s.id, "key-place-0001"));
    expect(again.orders).toHaveLength(2);
    expect(t.trading.placed.length).toBe(before + 2);
    // a live strategy cannot be placed twice under a new key either
    expect((await place(s.id, "key-place-0002")).status).toBe(409);
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.target, `strategy:${s.id}`));
    expect(audits.map((a) => a.action)).toContain("strategy.live_place");
  });

  it("the mark band refuses a leg whose mark moved, a venue refusal leaves a failed order, and Retry re-places with the same client id", async () => {
    const s = await draft();
    t.trading.failWith(102, "insufficient_margin", { once: true });
    const live = await json<Strategy>(await place(s.id, "key-band-00001", { [s.legs[0]!.id]: "1000" }));
    expect(live.status).toBe("live");
    const byLeg = (id: string) => live.orders.find((o) => o.legId === id)!;
    expect(byLeg(s.legs[0]!.id)).toMatchObject({ state: "failed" });
    expect(byLeg(s.legs[0]!.id).error).toMatch(/beyond the 5 % band/);
    expect(byLeg(s.legs[1]!.id)).toMatchObject({ state: "failed" });
    expect(byLeg(s.legs[1]!.id).error).toMatch(/margin/);
    expect(live.legs.every((l) => l.entryPrice === null)).toBe(true);
    const retried = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/live/retry`, { cookie: alice, method: "POST" }));
    expect(retried.orders.map((o) => [o.legId === s.legs[0]!.id ? "call" : "put", o.state, o.attempts])).toEqual(expect.arrayContaining([["call", "filled", 2], ["put", "filled", 2]]));
    expect(retried.orders.every((o) => o.clientOrderId.endsWith("-1"))).toBe(true); // same client order ids
    expect(retried.legs.map((l) => l.entryPrice)).toEqual(["1201", "899"]);
  });

  it("a partial fill stays pending until sync reconciles it from the venue", async () => {
    const s = await draft([CALL]);
    t.trading.partialNextOrder();
    const live = await json<Strategy>(await place(s.id, "key-partial-001"));
    expect(live.orders[0]).toMatchObject({ state: "pending" });
    expect(live.legs[0]!.entryPrice).toBeNull();
    const venueId = Number(live.orders[0]!.venueOrderId);
    t.trading.complete(venueId, "1210");
    const synced = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/live/sync`, { cookie: alice, method: "POST" }));
    expect(synced.orders[0]).toMatchObject({ state: "filled", fillPrice: "1210" });
    expect(synced.legs[0]!.entryPrice).toBe("1210");
  });
});

describe("HC-TR-070 / HC-TR-072 / HC-TR-086 / HC-TR-088 exits and adjustments on a live strategy", () => {
  it("square off a leg, partial exit and square off all place reduce-only opposite orders; square off all archives", async () => {
    const s = await draft();
    const live = await json<Strategy>(await place(s.id, "key-exit-00001"));
    const [call, put] = live.legs;
    const before = t.trading.placed.length;
    // client-side exit price is ignored for live: the venue fill (1201) is the exit
    const one = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/legs/${put!.id}/close`, { cookie: alice, json: { exitPrice: "1", lots: 4 } }));
    const exitOrder = t.trading.placed[before]!.input;
    expect(exitOrder).toMatchObject({ productId: 102, side: "buy", size: 4, reduceOnly: true });
    expect(exitOrder.clientOrderId).toMatch(new RegExp(`^hc-${put!.id}-x`));
    expect(one.legs.find((l) => l.id === put!.id)).toMatchObject({ status: "open", lots: 6 });
    const split = one.legs.find((l) => l.id !== put!.id && l.kind === "put");
    expect(split).toMatchObject({ status: "squared_off", exitPrice: "899", lots: 4 }); // fake fills the put at 899
    expect(one.orders.filter((o) => o.purpose === "exit")).toHaveLength(1);
    // venue refusal on an exit leaves the leg untouched and answers 502
    t.trading.failWith(101, "market_disrupted", { once: true });
    const refused = await t.request(`/v1/strategies/${s.id}/legs/${call!.id}/close`, { cookie: alice, json: { exitPrice: "1" } });
    expect(refused.status).toBe(502);
    expect((await json<{ message: string }>(refused)).message).toMatch(/disrupted/);
    const still = await json<Strategy>(await t.request(`/v1/strategies/${s.id}`, { cookie: alice }));
    expect(still.legs.find((l) => l.id === call!.id)?.status).toBe("open");
    // square off all: exits for every open leg, then archived
    const all = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/close`, { cookie: alice, json: { exits: {} } }));
    expect(all.status).toBe("archived");
    expect(all.legs.every((l) => l.status === "squared_off")).toBe(true);
    expect(all.orders.filter((o) => o.purpose === "exit" && o.state === "closed")).toHaveLength(3); // partial exit + two full exits
  });

  it("an adjustment on a live strategy places entry orders; a refused leg stays open with a failed order for Retry", async () => {
    const s = await draft([CALL]);
    await place(s.id, "key-adj-000001");
    t.trading.product("C-BTC-82000-250926", 103).markAt("C-BTC-82000-250926", "700").fillAt(103, "705");
    t.trading.product("P-BTC-76000-250926", 104).markAt("P-BTC-76000-250926", "500").failWith(104, "insufficient_margin");
    const adj = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/legs`, { cookie: alice, json: { legs: [{ ...CALL, strike: "82000", symbol: "C-BTC-82000-250926", side: "sell", lots: 5 }, { ...PUT, strike: "76000", symbol: "P-BTC-76000-250926", lots: 5 }] } }));
    expect(adj.legs).toHaveLength(3);
    expect(adj.legs[1]).toMatchObject({ isAdjustment: true, entryPrice: "705", symbol: "C-BTC-82000-250926" });
    expect(adj.legs[2]).toMatchObject({ isAdjustment: true, entryPrice: null, symbol: "P-BTC-76000-250926", status: "open" });
    expect(adj.orders.filter((o) => o.purpose === "adjustment").map((o) => o.state)).toEqual(["filled", "failed"]);
  });

  it("Trade All → Live places every ticked paper strategy in order and stops at the first failure; positions come from the venue", async () => {
    const a = await draft([CALL], "batch a");
    const b = await draft([PUT], "batch b");
    const c = await draft([CALL], "batch c");
    for (const s of [a, b, c]) await t.request(`/v1/strategies/${s.id}/start`, { cookie: alice, json: { mode: "paper", brokerId: SEED.brokerId, entries: {} } });
    t.trading.failWith(102, "insufficient_margin", { once: true });
    const res = await json<{ placed: string[]; failed: { id: string; error: string } | null; skipped: string[] }>(await t.request("/v1/strategies/live/batch", { cookie: alice, json: { ids: [a.id, b.id, c.id, "strat_nope"], brokerId: SEED.brokerId, idempotencyKey: "key-batch-00001" } }));
    expect(res.placed).toEqual([a.id, b.id]);
    expect(res.failed?.id).toBe(b.id);
    expect(res.failed?.error).toMatch(/margin/);
    expect(res.skipped).toEqual([]); // the unknown id comes after the failure, so it was never reached
    expect((await json<Strategy>(await t.request(`/v1/strategies/${c.id}`, { cookie: alice }))).status).toBe("paper");
    t.trading.setPositions([{ productId: 101, symbol: "C-BTC-80000-250926", size: 10, entryPrice: "1201", realizedPnl: "0", margin: "12" }]);
    const pos = await json<{ positions: unknown[]; balances: unknown[] }>(await t.request(`/v1/strategies/live/positions?brokerId=${SEED.brokerId}`, { cookie: alice }));
    expect(pos.positions).toHaveLength(1);
    expect(pos.balances[0]).toMatchObject({ asset: "USD", availableBalance: "4000" });
  });
});

describe("kill switch env", () => {
  it("TRADING_DISABLED refuses every placement", async () => {
    const off = await createTestApp({ TRADING_DISABLED: "1" });
    try {
      const cookie = (await off.signUp("kill@hapiecoin.test")).cookie;
      const s = await (await off.request("/v1/strategies", { cookie, json: { name: "k", asset: "BTC", legs: [CALL] } })).json() as Strategy;
      const res = await off.request(`/v1/strategies/${s.id}/live/place`, { cookie, json: { brokerId: SEED.brokerId, idempotencyKey: "key-kill-000001" } });
      expect(res.status).toBe(409);
      expect((await res.json() as { message: string }).message).toContain("paused by the operator");
    } finally {
      await off.close();
    }
  });
});
