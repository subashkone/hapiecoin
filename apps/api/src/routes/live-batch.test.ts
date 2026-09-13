// Trade All → Live previewed as one batch (GAPS #4, ADR-087; HC-TR-191).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LiveBatchPreview, LiveBatchResult, Strategy } from "@hapiecoin/schema";
import { SEED } from "../db/seed.js";
import { createTestApp, type TestApp } from "../test-support/harness.js";

let t: TestApp;
let alice: string;
const CALL = { kind: "call", side: "buy", strike: "80000", expiry: "2026-09-25", symbol: "C-BTC-80000-250926", lots: 10, price: "1200" };
const PUT = { kind: "put", side: "sell", strike: "78000", expiry: "2026-09-25", symbol: "P-BTC-78000-250926", lots: 10, price: "900" };

beforeAll(async () => {
  t = await createTestApp();
  alice = (await t.signUp("alice-batch@hapiecoin.test")).cookie;
  t.delta.accept("live-key");
  expect((await t.request("/v1/credentials", { cookie: alice, json: { brokerId: SEED.brokerId, apiKey: "live-key", apiSecret: "live-secret" } })).status).toBe(201);
  // 10 lots × 0.001 × 1200 = 12 USD of premium per call strategy
  t.trading.product(CALL.symbol, 101, "0.001").markAt(CALL.symbol, "1200").fillAt(101, "1201");
  t.trading.product(PUT.symbol, 102, "0.001").markAt(PUT.symbol, "900").fillAt(102, "899");
});
afterAll(() => t.close());

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
async function paper(name: string, legs: unknown[] = [CALL], accountId?: string): Promise<Strategy> {
  const d = await json<Strategy>(await t.request("/v1/strategies", { cookie: alice, json: { name, asset: "BTC", legs } }));
  return json<Strategy>(await t.request(`/v1/strategies/${d.id}/start`, { cookie: alice, json: { mode: "paper", brokerId: SEED.brokerId, ...(accountId ? { accountId } : {}), entries: {} } }));
}
const previewBatch = (ids: string[]) => t.request("/v1/strategies/live/batch/preview", { cookie: alice, json: { ids, brokerId: SEED.brokerId } });
const batch = (ids: string[], key: string) => t.request("/v1/strategies/live/batch", { cookie: alice, json: { confirm: "LIVE", ids, brokerId: SEED.brokerId, idempotencyKey: key } });
const status = async (id: string) => (await json<Strategy>(await t.request(`/v1/strategies/${id}`, { cookie: alice }))).status;

describe("HC-TR-191 Trade All → Live is previewed as one batch before any order goes out", () => {
  it("each strategy passes on its own, the batch fails the wallet together: the preview says so and the batch places nothing; with the wallet raised both go live", async () => {
    t.now.value += 61_000;
    t.trading.setBalances([{ asset: "USD", balance: "20", availableBalance: "20" }]);
    const a = await paper("batch a");
    const b = await paper("batch b");
    const refused = await json<LiveBatchPreview>(await previewBatch([a.id, b.id, "strat_nope"]));
    expect(refused.items.map((i) => [i.name, i.paper, i.ok])).toEqual([["batch a", true, true], ["batch b", true, true], ["strat_nope", false, false]]);
    expect(refused.items[0]).toMatchObject({ notional: "12", debit: "12" });
    expect(refused.items[0]!.legs[0]).toMatchObject({ symbol: CALL.symbol, mark: "1200" });
    expect(refused).toMatchObject({ ok: false, notional: "24", debit: "24", available: "20", availableAsset: "USD" });
    expect(refused.reasons).toEqual(["Available USD 20 is below the premium these 2 trades pay together (24)"]);
    const stopped = await batch([a.id, b.id], "batch-key-001");
    expect(stopped.status).toBe(409);
    expect((await json<{ message: string }>(stopped)).message).toContain("pay together");
    expect(await status(a.id)).toBe("paper");
    expect(await status(b.id)).toBe("paper");
    t.trading.setBalances([{ asset: "USD", balance: "5000", availableBalance: "4000" }]);
    const ok = await json<LiveBatchPreview>(await previewBatch([a.id, b.id]));
    expect(ok).toMatchObject({ ok: true, reasons: [], debit: "24", available: "4000" });
    const r = await json<LiveBatchResult>(await batch([a.id, b.id, "strat_nope"], "batch-key-001"));
    expect(r).toEqual({ placed: [a.id, b.id], failed: null, skipped: ["strat_nope"] });
    expect(await status(a.id)).toBe("live");
    // a repeat of the same key answers the same result: the live rows count as placed, nothing is sent twice
    const again = await json<LiveBatchResult>(await batch([a.id, b.id], "batch-key-001"));
    expect(again).toEqual({ placed: [a.id, b.id], failed: null, skipped: [] });
  });

  it("one strategy failing its own check refuses the whole batch by name, and a credit spread counts as premium received", async () => {
    t.now.value += 61_000;
    const good = await paper("credit", [PUT]);
    const big = await paper("too big", [{ ...CALL, lots: 90_000 }]); // 90 000 × 0.001 × 1200 = 108 000 USD, over the per-placement cap
    const p = await json<LiveBatchPreview>(await previewBatch([good.id, big.id]));
    expect(p.ok).toBe(false);
    expect(p.items[0]).toMatchObject({ ok: true, debit: "-9" });
    expect(p.items[1]!.ok).toBe(false);
    expect(p.items[1]!.reasons[0]).toMatch(/exceeds the .* limit per placement/);
    expect(p.reasons).toHaveLength(1); // and the premium paid (108 000; the credit is not netted) is more than the wallet holds: both truths are named
    expect(p.reasons[0]).toContain("pay together");
    const stopped = await batch([good.id, big.id], "batch-key-002");
    expect(stopped.status).toBe(409);
    expect((await json<{ message: string }>(stopped)).message).toMatch(/^too big: /);
    expect(await status(good.id)).toBe("paper");
    // untick the refused one: the rest goes through
    expect((await json<LiveBatchResult>(await batch([good.id], "batch-key-003"))).placed).toEqual([good.id]);
  });

  it("strategies on different keys are checked against their own wallets, on one key their premiums add up", async () => {
    t.now.value += 61_000;
    t.delta.accept("sub-key");
    const sub = await json<{ id: string }>(await t.request("/v1/credentials", { cookie: alice, json: { brokerId: SEED.brokerId, label: "Sub 1", apiKey: "sub-key", apiSecret: "s" } }));
    const { items } = await json<{ items: { id: string; label: string }[] }>(await t.request("/v1/credentials", { cookie: alice }));
    const main = items.find((k) => k.label === "Main")!.id;
    t.trading.setBalances([{ asset: "USD", balance: "20", availableBalance: "20" }]); // the fake answers every key with the same wallet
    const x = await paper("on main", [CALL], main);
    const y = await paper("on sub", [CALL], sub.id);
    const z = await paper("also main", [CALL], main);
    const apart = await json<LiveBatchPreview>(await previewBatch([x.id, y.id]));
    expect(apart.items.map((i) => i.ok)).toEqual([true, true]);
    expect(apart).toMatchObject({ ok: true, reasons: [], debit: "24", available: null, marginUsed: null }); // two wallets: no single figure for the whole
    const together = await json<LiveBatchPreview>(await previewBatch([x.id, z.id]));
    expect(together).toMatchObject({ ok: false, available: "20" });
    expect(together.reasons).toEqual(["Available USD 20 is below the premium these 2 trades pay together (24)"]);
    // premiums received are not netted against premiums paid: the credit leg does not fund the debit one
    const credit = await paper("credit main", [PUT], main);
    const netted = await json<LiveBatchPreview>(await previewBatch([x.id, z.id, credit.id]));
    expect(netted.ok).toBe(false);
    expect(netted.debit).toBe("15"); // 12 + 12 − 9 for the figure shown; the rule still sums the 24 paid
    expect(netted.reasons[0]).toContain("these 3 trades pay together (24)");
    t.trading.setBalances([{ asset: "USD", balance: "5000", availableBalance: "4000" }]);
  });
});
