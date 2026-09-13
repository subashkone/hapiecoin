// Live trading routes against the recording executor fake (trading-safety rule 2; ADR-025).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
const place = (id: string, key: string, expected: Record<string, string> = {}) => t.request(`/v1/strategies/${id}/live/place`, { cookie: alice, json: { confirm: "LIVE", brokerId: SEED.brokerId, idempotencyKey: key, expected } });

describe("HC-TR-186 the typed LIVE confirmation (ADR-078)", () => {
  // these refusals and placements burn the 20 / min order-route budget: a fresh window before and after
  beforeEach(() => {
    t.now.value += 61_000;
  });
  afterEach(() => {
    t.now.value += 61_000;
  });
  it("refuses a placement, a batch, a retry, a live adjustment that adds exposure and legs added to a live strategy without the word; a trim and a paper add need none", async () => {
    const s = await draft();
    const noWord = await t.request(`/v1/strategies/${s.id}/live/place`, { cookie: alice, json: { brokerId: SEED.brokerId, idempotencyKey: "key-noword-001", expected: {} } });
    expect(noWord.status).toBe(400);
    expect(((await noWord.json()) as { message: string }).message).toBe("Type LIVE to confirm a real order");
    const wrong = await t.request(`/v1/strategies/${s.id}/live/place`, { cookie: alice, json: { confirm: "yes", brokerId: SEED.brokerId, idempotencyKey: "key-noword-002", expected: {} } });
    expect(wrong.status).toBe(400);
    expect((await t.request("/v1/strategies/live/batch", { cookie: alice, json: { ids: [s.id], brokerId: SEED.brokerId, idempotencyKey: "key-noword-003" } })).status).toBe(400);
    expect(((await t.request(`/v1/strategies/${s.id}`, { cookie: alice }).then((r) => r.json())) as Strategy).status).toBe("draft"); // nothing moved
    // the word is read case-insensitively with spaces around it
    const live = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/live/place`, { cookie: alice, json: { confirm: " live ", brokerId: SEED.brokerId, idempotencyKey: "key-noword-004", expected: {} } }));
    expect(live.status).toBe("live");
    expect((await t.request(`/v1/strategies/${s.id}/live/retry`, { cookie: alice, json: {} })).status).toBe(400);
    const call = live.legs.find((l) => l.kind === "call")!;
    const trim = await t.request(`/v1/strategies/${s.id}/adjust`, { cookie: alice, json: { changes: [{ legId: call.id, lotsAfter: call.lots - 1, price: "0" }], idempotencyKey: "key-noword-005" } });
    expect(trim.status).toBe(200); // reducing risk never asks for the word
    const add = await t.request(`/v1/strategies/${s.id}/adjust`, { cookie: alice, json: { adds: [{ ...CALL, strike: "82000", symbol: "C-BTC-82000-250926", side: "sell", lots: 5, price: "700" }], idempotencyKey: "key-noword-006" } });
    expect(add.status).toBe(400);
    expect(((await add.json()) as { message: string }).message).toBe("Type LIVE to confirm a real order");
    const legs = await t.request(`/v1/strategies/${s.id}/legs`, { cookie: alice, json: { legs: [{ ...CALL, strike: "82000", symbol: "C-BTC-82000-250926", side: "sell", lots: 5, price: "700" }] } });
    expect(legs.status).toBe(400); // the older add-legs route is a live entry too
    // paper: an add needs no word on either route
    const paper = await json<Strategy>(await t.request("/v1/strategies", { cookie: alice, json: { name: "Paper add", asset: "BTC", legs: [CALL] } }));
    await t.request(`/v1/strategies/${paper.id}/start`, { cookie: alice, json: { mode: "paper", brokerId: SEED.brokerId, entries: {} } });
    const paperAdd = await t.request(`/v1/strategies/${paper.id}/adjust`, { cookie: alice, json: { adds: [{ ...PUT, strike: "76000", symbol: "P-BTC-76000-250926", side: "buy", lots: 5, price: "500" }], idempotencyKey: "key-noword-007" } });
    expect(paperAdd.status).toBe(200);
  });
});

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
    // GAPS #81: a net debit larger than the wallet is refused without any worst-loss figure from the client
    t.trading.setBalances([{ asset: "USD", balance: "2", availableBalance: "2" }]);
    const poor = await json<LivePreview>(await preview(s.id));
    expect(poor.ok).toBe(false);
    expect(poor.reasons.join(" | ")).toMatch(/below the premium this trade pays [(]3[)]/); // 12 paid for the call - 9 received for the put
    t.trading.setBalances([{ asset: "USD", balance: "5000", availableBalance: "4000" }]);
    // the margin-in-use figure is informational: a failed positions read leaves it unknown and does not block the preview
    t.trading.positionsDown = true;
    const p2 = await json<LivePreview>(await preview(s.id));
    t.trading.positionsDown = false;
    expect(p2.ok).toBe(true);
    expect(p2.marginUsed).toBeNull();
    expect(p2.available).toBe("4000");
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
    expect((await t.request(`/v1/strategies/${s.id}/live/place`, { cookie: bob, json: { confirm: "LIVE", brokerId: SEED.brokerId, idempotencyKey: "key-bob-0001" } })).status).toBe(409);
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
    const retried = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/live/retry`, { cookie: alice, json: { confirm: "LIVE" } }));
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
    expect(all.closeReason).toBe("squared_off"); // HC-TR-164
    expect(all.legs.every((l) => l.status === "squared_off" && l.closeReason === "squared_off")).toBe(true);
    expect(all.orders.filter((o) => o.purpose === "exit" && o.state === "closed")).toHaveLength(3); // partial exit + two full exits
  });

  it("an adjustment on a live strategy places entry orders; a refused leg stays open with a failed order for Retry", async () => {
    const s = await draft([CALL]);
    await place(s.id, "key-adj-000001");
    t.trading.product("C-BTC-82000-250926", 103).markAt("C-BTC-82000-250926", "700").fillAt(103, "705");
    t.trading.product("P-BTC-76000-250926", 104).markAt("P-BTC-76000-250926", "500").failWith(104, "insufficient_margin");
    const adj = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/legs`, { cookie: alice, json: { confirm: "LIVE", legs: [{ ...CALL, strike: "82000", symbol: "C-BTC-82000-250926", side: "sell", lots: 5 }, { ...PUT, strike: "76000", symbol: "P-BTC-76000-250926", lots: 5 }] } }));
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
    const res = await json<{ placed: string[]; failed: { id: string; error: string } | null; skipped: string[] }>(await t.request("/v1/strategies/live/batch", { cookie: alice, json: { confirm: "LIVE", ids: [a.id, b.id, c.id, "strat_nope"], brokerId: SEED.brokerId, idempotencyKey: "key-batch-00001" } }));
    expect(res.placed).toEqual([a.id, b.id]);
    expect(res.failed?.id).toBe(b.id);
    expect(res.failed?.error).toMatch(/margin/);
    expect(res.skipped).toEqual([]); // the unknown id comes after the failure, so it was never reached
    expect((await json<Strategy>(await t.request(`/v1/strategies/${c.id}`, { cookie: alice }))).status).toBe("paper");
    t.trading.setPositions([{ productId: 101, symbol: "C-BTC-80000-250926", size: 10, entryPrice: "1201", realizedPnl: "0", margin: "12" }]);
    const pos = await json<{ positions: unknown[]; balances: unknown[] }>(await t.request(`/v1/strategies/live/positions?brokerId=${SEED.brokerId}`, { cookie: alice }));
    expect(pos.positions).toHaveLength(1);
    expect(pos.balances[0]).toMatchObject({ asset: "USD", availableBalance: "4000" });
    // HC-TR-160: a venue that does not answer is 503, never an empty list the client could read as "holds nothing"
    t.trading.positionsDown = true;
    const placedBefore = t.trading.placed.length;
    expect((await t.request(`/v1/strategies/live/positions?brokerId=${SEED.brokerId}`, { cookie: alice })).status).toBe(503);
    expect((await t.request("/v1/strategies/live/positions/exit", { cookie: alice, json: { brokerId: SEED.brokerId, productIds: [101], idempotencyKey: "key-exit-down-001" } })).status).toBe(503);
    expect(t.trading.placed.length).toBe(placedBefore); // nothing was sent
    t.trading.positionsDown = false;
  });
});

describe("kill switch env", () => {
  it("TRADING_DISABLED refuses every placement", async () => {
    const off = await createTestApp({ TRADING_DISABLED: "1" });
    try {
      const cookie = (await off.signUp("kill@hapiecoin.test")).cookie;
      const s = await (await off.request("/v1/strategies", { cookie, json: { name: "k", asset: "BTC", legs: [CALL] } })).json() as Strategy;
      const res = await off.request(`/v1/strategies/${s.id}/live/place`, { cookie, json: { confirm: "LIVE", brokerId: SEED.brokerId, idempotencyKey: "key-kill-000001" } });
      expect(res.status).toBe(409);
      expect((await res.json() as { message: string }).message).toContain("paused by the operator");
    } finally {
      await off.close();
    }
  });
});

describe("HC-TR-088 adjustment batch on a live strategy (ADR-044)", () => {
  const adjust = (id: string, body: Record<string, unknown>) => t.request(`/v1/strategies/${id}/adjust`, { cookie: alice, json: body });
  const SOLD_CALL = { ...CALL, strike: "82000", symbol: "C-BTC-82000-250926", side: "sell", lots: 5, price: "700" };
  beforeEach(() => {
    t.trading.product("C-BTC-82000-250926", 103).markAt("C-BTC-82000-250926", "700").fillAt(103, "705");
  });

  it("previews the proposed batch instead of the open legs: trims and closes as reduce-only exits, adds as entries, the cap after netting", async () => {
    const s = await draft([CALL, PUT]);
    const live = await json<Strategy>(await place(s.id, "key-adj-live-000"));
    const [call, put] = live.legs;
    const p = await json<LivePreview>(await preview(s.id, { adds: [SOLD_CALL], changes: [{ legId: call!.id, lotsAfter: 4, price: "1300" }, { legId: put!.id, lotsAfter: 10, price: "900" }] }));
    expect(p.ok).toBe(true);
    expect(p.legs.map((l) => [l.legId, l.side, l.lots, l.mark])).toEqual([
      [call!.id, "sell", 6, "1200"], // the trim: 10 → 4 sells 6
      ["new-1", "sell", 5, "700"],
    ]);
    const capped = await json<LivePreview>(await preview(s.id, { adds: Array.from({ length: 9 }, () => SOLD_CALL), changes: [] }));
    expect(capped.ok).toBe(false);
    expect(capped.reasons).toContain("Maximum 10 active legs allowed per strategy");
    const withClose = await json<LivePreview>(await preview(s.id, { adds: Array.from({ length: 9 }, () => SOLD_CALL), changes: [{ legId: put!.id, lotsAfter: 0, price: "900" }] }));
    expect(withClose.reasons).not.toContain("Maximum 10 active legs allowed per strategy");
    expect(withClose.legs[0]).toMatchObject({ legId: put!.id, side: "buy", lots: 10 });
    expect((await preview(s.id, { changes: [{ legId: "leg_nope", lotsAfter: 0, price: "1" }] })).status).toBe(400);
    expect((await preview(s.id, { changes: [{ legId: call!.id, lotsAfter: 11, price: "1" }] })).status).toBe(400);
    // no overrides: the open legs, as before
    const plain = await json<LivePreview>(await preview(s.id));
    expect(plain.legs.map((l) => l.legId)).toEqual([call!.id, put!.id]);
  });

  it("places the exits first, then the entries, in one batch; fills set exits and entries; the history row carries the key", async () => {
    const s = await draft([CALL, PUT]);
    const live = await json<Strategy>(await place(s.id, "key-adj-live-001"));
    const [call, put] = live.legs;
    t.trading.fillAt(101, "1300").fillAt(102, "800");
    const res = await adjust(s.id, { confirm: "LIVE", adds: [SOLD_CALL], changes: [{ legId: call!.id, lotsAfter: 4, price: "0" }, { legId: put!.id, lotsAfter: 0, price: "0" }], expected: { "C-BTC-82000-250926": "700" }, idempotencyKey: "key-adj-live-002", reason: "roll up" });
    expect(res.status).toBe(200);
    const a = await json<Strategy>(res);
    // call entered at 1201 (fill), 6 lots out at 1300: +0.594 → 0.59 (P&L is booked to 2 dp); put entered at 899, 10 lots out at 800, sold: +0.99
    expect(a.realizedPnl).toBe("1.58");
    expect(a.legs.find((l) => l.id === call!.id)).toMatchObject({ status: "open", lots: 4, entryPrice: "1201" });
    expect(a.legs.find((l) => l.id === put!.id)).toMatchObject({ status: "squared_off", exitPrice: "800" });
    expect(a.legs.find((l) => l.symbol === "C-BTC-82000-250926")).toMatchObject({ status: "open", isAdjustment: true, entryPrice: "705" });
    const batch = a.orders.filter((o) => o.purpose !== "entry");
    expect(batch.map((o) => [o.purpose, o.side, o.size, o.state])).toEqual([
      ["exit", "sell", 6, "closed"],
      ["exit", "buy", 10, "closed"],
      ["adjustment", "sell", 5, "filled"],
    ]);
    expect(batch.every((o) => o.batchId === "key-adj-live-002")).toBe(true);
    expect(a.adjustments).toMatchObject([{ added: 1, trimmed: 1, closed: 1, realizedPnl: "1.58", batchId: "key-adj-live-002", reason: "roll up" }]);
    // repeating the key does not place again
    const again = await json<Strategy>(await adjust(s.id, { confirm: "LIVE", adds: [SOLD_CALL], idempotencyKey: "key-adj-live-002" }));
    expect(again.orders).toHaveLength(a.orders.length);
    expect(again.adjustments).toHaveLength(1);
  });

  it("an entry outside the mark band stays open with a failed order for Retry; a refused plan removes the added legs; a failed exit stops the batch with 502", async () => {
    const s = await draft([CALL]);
    const live = await json<Strategy>(await place(s.id, "key-adj-live-003"));
    const [call] = live.legs;
    // band: the Review showed 100, the venue mark is 700
    const off = await json<Strategy>(await adjust(s.id, { confirm: "LIVE", adds: [SOLD_CALL], expected: { "C-BTC-82000-250926": "100" } }));
    const added = off.legs.find((l) => l.symbol === "C-BTC-82000-250926");
    expect(added).toMatchObject({ status: "open", entryPrice: null });
    expect(off.orders.filter((o) => o.purpose === "adjustment").map((o) => o.state)).toEqual(["failed"]);
    expect(off.adjustments).toHaveLength(1);
    // plan refused (unknown product) with a close in the same batch: refused before the venue sees anything, the close included
    const unknown = await adjust(s.id, { confirm: "LIVE", adds: [{ ...SOLD_CALL, symbol: "C-BTC-99000-250926", strike: "99000" }], changes: [{ legId: call!.id, lotsAfter: 0, price: "0" }] });
    expect(unknown.status).toBe(409);
    expect((await json<{ message: string }>(unknown)).message).toContain("C-BTC-99000-250926");
    const afterUnknown = await json<Strategy>(await t.request(`/v1/strategies/${s.id}`, { cookie: alice }));
    expect(afterUnknown.legs).toHaveLength(off.legs.length);
    expect(afterUnknown.legs.find((l) => l.id === call!.id)).toMatchObject({ status: "open", lots: 10 });
    expect(afterUnknown.orders.filter((o) => o.purpose === "exit")).toEqual([]);
    expect(afterUnknown.adjustments).toHaveLength(1);
    // a failed exit stops the batch: the leg stays open, the adds are not inserted, the history row says why
    t.trading.failWith(101, "insufficient_margin", { once: true });
    const failed = await adjust(s.id, { confirm: "LIVE", changes:[{ legId: call!.id, lotsAfter: 0, price: "0" }], adds: [SOLD_CALL], reason: "hedge" });
    expect(failed.status).toBe(502);
    const afterFail = await json<Strategy>(await t.request(`/v1/strategies/${s.id}`, { cookie: alice }));
    expect(afterFail.legs.find((l) => l.id === call!.id)).toMatchObject({ status: "open", lots: 10 });
    expect(afterFail.legs).toHaveLength(off.legs.length);
    expect(afterFail.orders.filter((o) => o.purpose === "exit").map((o) => o.state)).toEqual(["failed"]);
    expect(afterFail.adjustments).toHaveLength(2);
    expect(afterFail.adjustments[1]).toMatchObject({ added: 0, trimmed: 0, closed: 0, realizedPnl: "0" });
    expect(afterFail.adjustments[1]!.reason).toMatch(/^hedge · Stopped: C-BTC-80000-250926: .*margin/i);
    // blocked account: refused before any order
    const admin = await t.adminCookie();
    await t.request(`/v1/admin/users/${aliceId}/trading`, { cookie: admin, json: { disabled: true } });
    expect((await adjust(s.id, { changes: [{ legId: call!.id, lotsAfter: 0, price: "0" }] })).status).toBe(409);
    await t.request(`/v1/admin/users/${aliceId}/trading`, { cookie: admin, json: { disabled: false } });
  });

  it("ADR-044 limit entries go at the reviewed mark: one that crosses fills, one that rests stays pending until sync; exits stay market", async () => {
    const s = await draft([CALL]);
    const live = await json<Strategy>(await place(s.id, "key-adj-limit-00"));
    const [call] = live.legs;
    t.trading.product("P-BTC-76000-250926", 105).markAt("P-BTC-76000-250926", "500").fillAt(105, "505");
    // sell C-82000 limit 700 with the venue at 705: crosses (sell at or below the fill) → filled; buy P-76000 limit 500 with the venue at 505: rests → pending
    const res = await adjust(s.id, { confirm: "LIVE", adds: [SOLD_CALL, { ...PUT, strike: "76000", symbol: "P-BTC-76000-250926", side: "buy", lots: 5, price: "500" }], changes: [{ legId: call!.id, lotsAfter: 6, price: "0" }], expected: { "C-BTC-82000-250926": "700", "P-BTC-76000-250926": "500" }, orderType: "limit", idempotencyKey: "key-adj-limit-01" });
    expect(res.status).toBe(200);
    const a = await json<Strategy>(res);
    const batch = a.orders.filter((o) => o.batchId === "key-adj-limit-01");
    expect(batch.map((o) => [o.purpose, o.orderType, o.state])).toEqual([
      ["exit", "market", "closed"],
      ["adjustment", "limit", "filled"],
      ["adjustment", "limit", "pending"],
    ]);
    const sent = t.trading.placed.slice(-2).map((p) => [p.input.orderType, p.input.limitPrice]);
    expect(sent).toEqual([
      ["limit", "700.0"], // on the product's 0.1 tick
      ["limit", "500.0"],
    ]);
    const resting = a.legs.find((l) => l.symbol === "P-BTC-76000-250926")!;
    expect(resting.entryPrice).toBeNull();
    expect(a.adjustments[0]).toMatchObject({ added: 2, trimmed: 1 });
    // the venue fills the resting limit later; sync books it
    t.trading.complete(Number(batch[2]!.venueOrderId), "500");
    const synced = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/live/sync`, { cookie: alice, method: "POST" }));
    expect(synced.orders.find((o) => o.id === batch[2]!.id)).toMatchObject({ state: "filled", fillPrice: "500" });
    expect(synced.legs.find((l) => l.id === resting.id)!.entryPrice).toBe("500");
    // a limit without an expected mark for its symbol goes at market
    const noBand = await json<Strategy>(await adjust(s.id, { confirm: "LIVE", adds: [SOLD_CALL], orderType: "limit", idempotencyKey: "key-adj-limit-02" }));
    expect(noBand.orders.filter((o) => o.batchId === "key-adj-limit-02").map((o) => [o.orderType, o.limitPrice])).toEqual([["market", null]]);
  });

  it("ADR-044 a limit price snaps to the product tick; a resting limit the venue cancels is retried as the same limit", async () => {
    const s = await draft([CALL]);
    await place(s.id, "key-adj-tick-00");
    t.trading.product("P-BTC-76000-250926", 105, "0.001", "live", "0.5").markAt("P-BTC-76000-250926", "500").fillAt(105, "520");
    // buy limit 500.3 on a 0.5 tick → 500.0 (down, the passive side for a buy); the venue is at 520 so it rests
    const a = await json<Strategy>(await adjust(s.id, { confirm: "LIVE", adds: [{ ...PUT, strike: "76000", symbol: "P-BTC-76000-250926", side: "buy", lots: 5, price: "500.3" }], expected: { "P-BTC-76000-250926": "500.3" }, orderType: "limit", idempotencyKey: "key-adj-tick-01" }));
    const resting = a.orders.find((o) => o.batchId === "key-adj-tick-01")!;
    expect(resting).toMatchObject({ orderType: "limit", limitPrice: "500.0", state: "pending" });
    expect(t.trading.placed.at(-1)!.input).toMatchObject({ orderType: "limit", limitPrice: "500.0" });
    // the venue cancels it: sync records that, the leg is still open with no entry, Retry sends the same limit again
    await t.trading.cancelOrder({ apiKey: "", apiSecret: "" }, Number(resting.venueOrderId));
    const synced = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/live/sync`, { cookie: alice, method: "POST" }));
    expect(synced.orders.find((o) => o.id === resting.id)!.state).toBe("cancelled");
    expect(synced.legs.at(-1)).toMatchObject({ status: "open", entryPrice: null });
    t.trading.fillAt(105, "499"); // now the venue is below the limit: the retried buy crosses
    const retried = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/live/retry`, { cookie: alice, json: { confirm: "LIVE" } }));
    expect(t.trading.placed.at(-1)!.input).toMatchObject({ orderType: "limit", limitPrice: "500.0", clientOrderId: resting.clientOrderId });
    expect(retried.orders.find((o) => o.id === resting.id)).toMatchObject({ state: "filled", fillPrice: "499", limitPrice: "500.0", attempts: 2 });
    expect(retried.legs.at(-1)!.entryPrice).toBe("499");
  });

  it("HC-TR-187 a resting limit is cancelled from the app: the venue is read back, the leg stays open without an entry, Retry sends it again; a filled order is booked as filled instead", async () => {
    t.now.value += 61_000; // a fresh order-rate window (20 order calls a minute per user)
    const s = await draft([CALL]);
    await place(s.id, "key-cancel-00");
    t.trading.product("P-BTC-76000-250926", 105, "0.001", "live", "0.5").markAt("P-BTC-76000-250926", "500").fillAt(105, "520");
    const a = await json<Strategy>(await adjust(s.id, { confirm: "LIVE", adds: [{ ...PUT, strike: "76000", symbol: "P-BTC-76000-250926", side: "buy", lots: 5, price: "500.3" }], expected: { "P-BTC-76000-250926": "500.3" }, orderType: "limit", idempotencyKey: "key-cancel-01" }));
    const resting = a.orders.find((o) => o.batchId === "key-cancel-01")!;
    expect(resting.state).toBe("pending");
    // a filled order, a market order and an exit order cannot be cancelled
    const filledEntry = a.orders.find((o) => o.state === "filled")!;
    expect((await t.request(`/v1/strategies/${s.id}/live/orders/${filledEntry.id}/cancel`, { cookie: alice, method: "POST" })).status).toBe(409);
    expect((await t.request(`/v1/strategies/${s.id}/live/orders/ord_nope/cancel`, { cookie: alice, method: "POST" })).status).toBe(404);
    // the cancel, without the typed word (it reduces exposure)
    const res = await t.request(`/v1/strategies/${s.id}/live/orders/${resting.id}/cancel`, { cookie: alice, method: "POST" });
    expect(res.status).toBe(200);
    const cancelled = await json<Strategy>(res);
    expect(cancelled.orders.find((o) => o.id === resting.id)).toMatchObject({ state: "cancelled", error: "cancelled from HapieCoin", limitPrice: "500.0" });
    expect(cancelled.legs.at(-1)).toMatchObject({ status: "open", entryPrice: null });
    expect(t.trading.cancelled).toContain(Number(resting.venueOrderId));
    // a second cancel is refused: the row is no longer resting
    expect((await t.request(`/v1/strategies/${s.id}/live/orders/${resting.id}/cancel`, { cookie: alice, method: "POST" })).status).toBe(409);
    // Retry sends the same limit again
    t.trading.fillAt(105, "499");
    const retried = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/live/retry`, { cookie: alice, json: { confirm: "LIVE" } }));
    expect(retried.orders.find((o) => o.id === resting.id)).toMatchObject({ state: "filled", fillPrice: "499", attempts: 2 });
    // a fill that beats the click: the cancel answers 200 with the fill booked
    t.trading.fillAt(105, "520");
    const b = await json<Strategy>(await adjust(s.id, { confirm: "LIVE", adds: [{ ...PUT, strike: "76000", symbol: "P-BTC-76000-250926", side: "buy", lots: 5, price: "500.3" }], expected: { "P-BTC-76000-250926": "500.3" }, orderType: "limit", idempotencyKey: "key-cancel-02" }));
    const resting2 = b.orders.find((o) => o.batchId === "key-cancel-02")!;
    t.trading.complete(Number(resting2.venueOrderId), "501"); // filled on the exchange just before the click
    const raced = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/live/orders/${resting2.id}/cancel`, { cookie: alice, method: "POST" }));
    expect(raced.orders.find((o) => o.id === resting2.id)).toMatchObject({ state: "filled", fillPrice: "501" });
    expect(raced.legs.at(-1)!.entryPrice).toBe("501");
  });

  it("HC-TR-187 the venue's word decides: a cancel whose read-back fails is booked on the accepted cancel, an exchange-side cancel found by the click keeps the exchange's reason, an unread refusal is a 409; sync learns a price the app never got", async () => {
    t.now.value += 61_000;
    const s = await draft([CALL]);
    await place(s.id, "key-cancel2-00");
    t.trading.product("P-BTC-76000-250926", 105, "0.001", "live", "0.5").markAt("P-BTC-76000-250926", "500").fillAt(105, "520");
    const rest = async (key: string) => (await json<Strategy>(await adjust(s.id, { confirm: "LIVE", adds: [{ ...PUT, strike: "76000", symbol: "P-BTC-76000-250926", side: "buy", lots: 5, price: "500.3" }], expected: { "P-BTC-76000-250926": "500.3" }, orderType: "limit", idempotencyKey: key }))).orders.find((o) => o.batchId === key)!;
    // accepted, read-back down: cancelled on the venue's word
    const a = await rest("key-cancel2-01");
    t.trading.ordersDown = true;
    const r1 = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/live/orders/${a.id}/cancel`, { cookie: alice, method: "POST" }));
    t.trading.ordersDown = false;
    expect(r1.orders.find((o) => o.id === a.id)).toMatchObject({ state: "cancelled", error: "cancelled from HapieCoin" });
    // the exchange had cancelled it a moment earlier: the click finds it cancelled and keeps the exchange's reason
    const b = await rest("key-cancel2-02");
    await t.trading.cancelOrder({ apiKey: "", apiSecret: "" }, Number(b.venueOrderId));
    const r2 = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/live/orders/${b.id}/cancel`, { cookie: alice, method: "POST" }));
    expect(r2.orders.find((o) => o.id === b.id)).toMatchObject({ state: "cancelled", error: "cancelled on the exchange" });
    // refused and unreadable: nothing is booked, the trader is told to sync
    const c = await rest("key-cancel2-03");
    await t.trading.cancelOrder({ apiKey: "", apiSecret: "" }, Number(c.venueOrderId));
    t.trading.ordersDown = true;
    const r3 = await t.request(`/v1/strategies/${s.id}/live/orders/${c.id}/cancel`, { cookie: alice, method: "POST" });
    t.trading.ordersDown = false;
    expect(r3.status).toBe(409);
    expect(((await r3.json()) as { message: string }).message).toContain("sync");
    expect((await json<Strategy>(await t.request(`/v1/strategies/${s.id}`, { cookie: alice }))).orders.find((o) => o.id === c.id)!.state).toBe("pending");
    // a re-price refused because the exchange had cancelled the order: booked as cancelled, the refusal says so
    const d = await rest("key-cancel2-04");
    await t.trading.cancelOrder({ apiKey: "", apiSecret: "" }, Number(d.venueOrderId));
    const r4 = await t.request(`/v1/strategies/${s.id}/live/orders/${d.id}/reprice`, { cookie: alice, json: { limitPrice: "505", confirm: "LIVE" } });
    expect(r4.status).toBe(409);
    expect(((await r4.json()) as { message: string }).message).toContain("already cancelled");
    // sync writes back a price the venue holds that the app never learned (an edit whose answer was lost)
    const e = await rest("key-cancel2-05");
    await t.trading.editOrder({ apiKey: "", apiSecret: "" }, { orderId: Number(e.venueOrderId), productId: 105, limitPrice: "507.5" });
    const synced = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/live/sync`, { cookie: alice, method: "POST" }));
    expect(synced.orders.find((o) => o.id === e.id)).toMatchObject({ state: "pending", limitPrice: "507.5" });
  });

  it("HC-TR-188 a resting limit is re-priced in place: the typed word, the tick snap, a fill at the new price; a refused edit re-reads the venue first", async () => {
    t.now.value += 61_000; // a fresh order-rate window (20 order calls a minute per user)
    const s = await draft([CALL]);
    await place(s.id, "key-reprice-00");
    t.trading.product("P-BTC-76000-250926", 105, "0.001", "live", "0.5").markAt("P-BTC-76000-250926", "500").fillAt(105, "520");
    const a = await json<Strategy>(await adjust(s.id, { confirm: "LIVE", adds: [{ ...PUT, strike: "76000", symbol: "P-BTC-76000-250926", side: "buy", lots: 5, price: "500.3" }], expected: { "P-BTC-76000-250926": "500.3" }, orderType: "limit", idempotencyKey: "key-reprice-01" }));
    const resting = a.orders.find((o) => o.batchId === "key-reprice-01")!;
    const url = `/v1/strategies/${s.id}/live/orders/${resting.id}/reprice`;
    expect((await t.request(url, { cookie: alice, json: { limitPrice: "505.3" } })).status).toBe(400); // no word
    expect((await t.request(url, { cookie: alice, json: { limitPrice: "0", confirm: "LIVE" } })).status).toBe(400); // not a price
    // 505.3 on a 0.5 tick, a buy → 505.0; the venue is at 520 so it still rests
    const moved = await json<Strategy>(await t.request(url, { cookie: alice, json: { limitPrice: "505.3", confirm: "LIVE" } }));
    expect(moved.orders.find((o) => o.id === resting.id)).toMatchObject({ state: "pending", limitPrice: "505.0", clientOrderId: resting.clientOrderId, venueOrderId: resting.venueOrderId });
    expect(t.trading.edited.at(-1)).toEqual({ orderId: Number(resting.venueOrderId), productId: 105, limitPrice: "505.0" });
    // a price across the venue's fill price fills at once and the leg gets its entry
    const filled = await json<Strategy>(await t.request(url, { cookie: alice, json: { limitPrice: "521", confirm: "LIVE" } }));
    expect(filled.orders.find((o) => o.id === resting.id)).toMatchObject({ state: "filled", fillPrice: "520", limitPrice: "521.0" });
    expect(filled.legs.at(-1)!.entryPrice).toBe("520");
    // no longer resting: a further re-price is refused
    expect((await t.request(url, { cookie: alice, json: { limitPrice: "530", confirm: "LIVE" } })).status).toBe(409);
    // a refused edit because the venue filled it a moment earlier: the fill is booked and the refusal says so
    const b = await json<Strategy>(await adjust(s.id, { confirm: "LIVE", adds: [{ ...PUT, strike: "76000", symbol: "P-BTC-76000-250926", side: "buy", lots: 5, price: "500.3" }], expected: { "P-BTC-76000-250926": "500.3" }, orderType: "limit", idempotencyKey: "key-reprice-02" }));
    const resting2 = b.orders.find((o) => o.batchId === "key-reprice-02")!;
    t.trading.complete(Number(resting2.venueOrderId), "502");
    const raced = await t.request(`/v1/strategies/${s.id}/live/orders/${resting2.id}/reprice`, { cookie: alice, json: { limitPrice: "510", confirm: "LIVE" } });
    expect(raced.status).toBe(409);
    expect(((await raced.json()) as { message: string }).message).toContain("filled before");
    const after = await json<Strategy>(await t.request(`/v1/strategies/${s.id}`, { cookie: alice }));
    expect(after.orders.find((o) => o.id === resting2.id)).toMatchObject({ state: "filled", fillPrice: "502" });
  });

  it("when a later exit fails, the earlier fill stays booked, the batch stops, the key is used up and a new key finishes the rest", async () => {
    const s = await draft([CALL, PUT]);
    const live = await json<Strategy>(await place(s.id, "key-adj-live-004"));
    const [call, put] = live.legs;
    t.trading.fillAt(101, "1300").failWith(102, "insufficient_margin", { once: true });
    const res = await adjust(s.id, { confirm: "LIVE", changes:[{ legId: call!.id, lotsAfter: 0, price: "0" }, { legId: put!.id, lotsAfter: 0, price: "0" }], adds: [SOLD_CALL], idempotencyKey: "key-adj-live-005", reason: "flatten" });
    expect(res.status).toBe(502);
    const after = await json<Strategy>(await t.request(`/v1/strategies/${s.id}`, { cookie: alice }));
    // the call's exit filled at 1300 against the 1201 entry: (1300 − 1201) × 10 × 0.001 = 0.99, booked
    expect(after.legs.find((l) => l.id === call!.id)).toMatchObject({ status: "squared_off", exitPrice: "1300" });
    expect(after.realizedPnl).toBe("0.99");
    expect(after.legs.find((l) => l.id === put!.id)).toMatchObject({ status: "open", lots: 10 });
    expect(after.legs).toHaveLength(2); // the add never went in
    expect(after.orders.filter((o) => o.purpose === "exit").map((o) => [o.symbol, o.state])).toEqual([
      ["C-BTC-80000-250926", "closed"],
      ["P-BTC-78000-250926", "failed"],
    ]);
    expect(after.adjustments).toMatchObject([{ added: 0, trimmed: 0, closed: 1, realizedPnl: "0.99", batchId: "key-adj-live-005" }]);
    expect(after.adjustments[0]!.reason).toMatch(/^flatten · Stopped: P-BTC-78000-250926: /);
    // the same key is used up: nothing more happens
    const same = await json<Strategy>(await adjust(s.id, { changes: [{ legId: put!.id, lotsAfter: 0, price: "0" }], idempotencyKey: "key-adj-live-005" }));
    expect(same.adjustments).toHaveLength(1);
    expect(same.legs.find((l) => l.id === put!.id)).toMatchObject({ status: "open" });
    // a new key finishes the rest
    const rest = await json<Strategy>(await adjust(s.id, { confirm: "LIVE", changes:[{ legId: put!.id, lotsAfter: 0, price: "0" }], adds: [SOLD_CALL], idempotencyKey: "key-adj-live-006" }));
    expect(rest.legs.every((l) => l.id === put!.id ? l.status === "squared_off" : true)).toBe(true);
    expect(rest.legs).toHaveLength(3);
    expect(rest.adjustments).toHaveLength(2);
    expect(rest.adjustments[1]).toMatchObject({ added: 1, closed: 1, batchId: "key-adj-live-006" });
  });
});

describe("HC-TR-161 reconcile on a live strategy sends nothing to the venue", () => {
  it("books the leg closed at the given price, leaves the other leg live, and the fake venue sees no order", async () => {
    const s = await draft();
    const live = await json<Strategy>(await place(s.id, "key-reconcile-0001", { [s.legs[0]!.id]: "1200", [s.legs[1]!.id]: "900" }));
    const put = live.legs.find((l) => l.kind === "put")!;
    const before = t.trading.placed.length;
    const res = await t.request(`/v1/strategies/${s.id}/reconcile`, { cookie: alice, json: { legs: [{ legId: put.id, price: "850" }], reason: "stop hit on the exchange" } });
    expect(res.status).toBe(200);
    const after = await json<Strategy>(res);
    expect(t.trading.placed.length).toBe(before); // no order, no reduce-only exit, nothing
    expect(after.status).toBe("live");
    expect(after.orders).toHaveLength(live.orders.length); // no exit order row either
    expect(after.legs.find((l) => l.id === put.id)).toMatchObject({ status: "squared_off", exitPrice: "850" });
    expect(after.legs.find((l) => l.kind === "call")).toMatchObject({ status: "open" });
    expect(after.realizedPnl).toBe("0.49"); // (899 − 850) × 10 × 0.001 on the sold put filled at 899
    expect(after.adjustments[after.adjustments.length - 1]).toMatchObject({ reason: "closed outside the app: stop hit on the exchange", closed: 1, trimmed: 0, added: 0 });
  });
});
