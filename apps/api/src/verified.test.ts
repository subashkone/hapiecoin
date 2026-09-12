// Verified P&L (ADR-073; HC-TR-179 ingest, HC-TR-180 figures per account): fills read from the venue per key, deduped
// across passes, sized through the venue's products, realised with average cost and commissions off, one figure per
// account and in total; an unreadable venue is recorded on the account and never thrown.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { VerifiedPnl, VerifiedRefreshResult } from "@hapiecoin/schema";
import { eq } from "drizzle-orm";
import { venueFills } from "./db/schema.js";
import { SEED } from "./db/seed.js";
import { createTestApp, type TestApp } from "./test-support/harness.js";
import { computeVerified, ingestFills } from "./verified.js";

let t: TestApp;
let cookie: string;
let userId: string;
const MAIN = "vf-main-key-AAAA";
const SUB = "vf-sub-key-BBBB";
const NOW = Date.UTC(2026, 8, 12, 0); // the passes stamp their reads here: earlier than the clock, so the routes' 30 s gap counts from real time
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;

beforeAll(async () => {
  t = await createTestApp();
  cookie = (await t.signUp("verified@hapiecoin.test")).cookie;
  userId = (await json<{ id: string }>(await t.request("/v1/me", { cookie }))).id;
  t.delta.accept(MAIN).accept(SUB);
  expect((await t.request("/v1/credentials", { cookie, json: { brokerId: SEED.brokerId, label: "Main", apiKey: MAIN, apiSecret: "s" } })).status).toBe(201);
  t.trading.product("C-BTC-80000-250926", 101, "0.001").product("P-BTC-78000-250926", 102, "0.001");
});
afterAll(() => t.close());

describe("HC-TR-179 fills are read per key, deduped across passes, and a failed read is recorded, not thrown", () => {
  it("a long round trip: two fills in, realised once with commissions off; a second pass adds nothing", async () => {
    t.trading.addFill(MAIN, { id: "f-1", productId: 101, side: "buy", size: 10, price: "1200", commission: "0.6", filledAt: "2026-09-10T09:00:00.000Z" });
    t.trading.addFill(MAIN, { id: "f-2", productId: 101, side: "sell", size: 10, price: "1500", commission: "0.75", filledAt: "2026-09-11T09:00:00.000Z" });
    expect(await ingestFills(t.deps, { userId, now: () => NOW })).toEqual({ accounts: 1, read: 2, added: 2, skipped: 0, errors: [] });
    expect(await ingestFills(t.deps, { userId, now: () => NOW })).toEqual({ accounts: 1, read: 2, added: 0, skipped: 0, errors: [] });
    // the button's gap: an account read within the gap is skipped, not read again
    expect(await ingestFills(t.deps, { userId, now: () => NOW + 1000, minGapMs: 30_000 })).toEqual({ accounts: 1, read: 0, added: 0, skipped: 1, errors: [] });
    const v = await computeVerified(t.deps, userId, NOW);
    expect(v.accounts.map((a) => [a.label, a.fills, a.realizedUsd, a.commissionUsd, a.skipped, a.partialProducts, a.backfilling, a.error])).toEqual([["Main", 2, "1.65", "1.35", 0, 0, false, null]]);
    expect(v.total).toEqual({ all: "1.65", gross: "3", d7: "1.65", d30: "1.65", commission: "1.35" });
    expect(v.since).toBe("2026-09-10T09:00:00.000Z");
    expect(v.lastReadAt).toBe(new Date(NOW).toISOString());
    expect(v.accounts[0]!.lastFillAt).toBe("2026-09-11T09:00:00.000Z");
    expect(v.journalRealizedUsd).toBe("0");
    expect(v.difference).toBe("3"); // gross to gross: the Journal books no fees
    const raw = await t.db.select({ raw: venueFills.raw, venueFillId: venueFills.venueFillId, contractValue: venueFills.contractValue }).from(venueFills).where(eq(venueFills.userId, userId));
    expect(raw.map((r) => r.venueFillId).sort()).toEqual(["f-1", "f-2"]);
    expect(raw[0]!.raw).toMatchObject({ product_id: 101, product_symbol: "C-BTC-80000-250926" }); // the venue's row as received, not HapieCoin's shape
    expect(raw.map((r) => r.contractValue)).toEqual(["0.001", "0.001"]); // sized at ingest, while the product is served
  });

  it("the routes: GET answers the figures for the signed-in trader only; POST re-reads now and reports the pass", async () => {
    expect((await t.request("/v1/verified/pnl")).status).toBe(401);
    const got = await json<VerifiedPnl>(await t.request("/v1/verified/pnl", { cookie }));
    expect(got.total.all).toBe("1.65");
    t.trading.addFill(MAIN, { id: "f-3", productId: 102, side: "sell", size: 4, price: "50", filledAt: "2026-09-12T08:00:00.000Z" }); // still open: nothing realised
    const r = await json<VerifiedRefreshResult>(await t.request("/v1/verified/refresh", { method: "POST", cookie }));
    expect(r).toEqual({ accounts: 1, read: 3, added: 1, skipped: 0, errors: [] });
    expect((await json<VerifiedRefreshResult>(await t.request("/v1/verified/refresh", { method: "POST", cookie }))).skipped).toBe(1); // read again within 30 s: skipped
    const after = await json<VerifiedPnl>(await t.request("/v1/verified/pnl", { cookie }));
    expect(after.fills).toBe(3);
    expect(after.total.all).toBe("1.65");
  });

  it("a second key sees only its own fills; the totals add the accounts up", async () => {
    expect((await t.request("/v1/credentials", { cookie, json: { brokerId: SEED.brokerId, label: "Sub 1", apiKey: SUB, apiSecret: "s" } })).status).toBe(201);
    t.trading.addFill(SUB, { id: "s-1", productId: 101, side: "sell", size: 5, price: "1000", filledAt: "2026-09-11T10:00:00.000Z" });
    t.trading.addFill(SUB, { id: "s-2", productId: 101, side: "buy", size: 5, price: "900", commission: "0.1", filledAt: "2026-09-11T11:00:00.000Z" }); // (900 − 1000) × 5 × 0.001 × −1 = +0.5, less 0.1
    expect(await ingestFills(t.deps, { userId, now: () => NOW + 60_000 })).toEqual({ accounts: 2, read: 5, added: 2, skipped: 0, errors: [] });
    const v = await computeVerified(t.deps, userId, NOW);
    expect(v.accounts.map((a) => [a.label, a.fills, a.realizedUsd])).toEqual([
      ["Main", 3, "1.65"],
      ["Sub 1", 2, "0.4"],
    ]);
    expect(v.total.all).toBe("2.05");
    expect(v.total.gross).toBe("3.5");
    expect(v.total.commission).toBe("1.45");
    expect(v.fills).toBe(5);
  });

  it("an unreadable venue is recorded on that account and the other one still reads; the next good pass clears it", async () => {
    t.trading.fillsDown = true;
    const r = await ingestFills(t.deps, { userId, now: () => NOW + 60_000 });
    expect(r.accounts).toBe(2);
    expect(r.errors).toEqual(["Main: The exchange did not answer the fills read", "Sub 1: The exchange did not answer the fills read"]); // a sentence, never the venue's code alone
    const v = await computeVerified(t.deps, userId, NOW + 60_000);
    expect(v.accounts.map((a) => a.error !== null)).toEqual([true, true]);
    expect(v.total.all).toBe("2.05"); // the figures held stand
    t.trading.fillsDown = false;
    expect((await ingestFills(t.deps, { userId, now: () => NOW + 120_000 })).errors).toEqual([]);
    expect((await computeVerified(t.deps, userId, NOW + 120_000)).accounts.map((a) => a.error)).toEqual([null, null]);
  });

  it("a busy account's first pass reads maxPages pages and remembers where it stopped; the next passes backfill the older pages until the venue's history ends", async () => {
    const other = (await t.signUp("verified-busy@hapiecoin.test")).cookie;
    const otherId = (await json<{ id: string }>(await t.request("/v1/me", { cookie: other }))).id;
    t.delta.accept("vf-busy-key-CCCC");
    expect((await t.request("/v1/credentials", { cookie: other, json: { brokerId: SEED.brokerId, apiKey: "vf-busy-key-CCCC", apiSecret: "s" } })).status).toBe(201);
    for (let i = 0; i < 105; i += 1) t.trading.addFill("vf-busy-key-CCCC", { id: `b-${i}`, productId: 101, side: "buy", size: 1, price: "100", filledAt: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString() });
    expect(await ingestFills(t.deps, { userId: otherId, maxPages: 1, now: () => NOW })).toMatchObject({ accounts: 1, read: 100, added: 100 });
    let v = await computeVerified(t.deps, otherId, NOW);
    expect(v.fills).toBe(100);
    expect(v.accounts[0]!.backfilling).toBe(true);
    expect(v.since).toBe(new Date(Date.UTC(2026, 8, 1, 0, 5)).toISOString()); // the figures say since when
    // the next pass: the newest page is all known (seen), then the backfill reads the five oldest from the kept cursor
    expect(await ingestFills(t.deps, { userId: otherId, maxPages: 5, now: () => NOW + 60_000 })).toMatchObject({ read: 105, added: 5 });
    v = await computeVerified(t.deps, otherId, NOW);
    expect(v.fills).toBe(105);
    expect(v.accounts[0]!.backfilling).toBe(false);
    expect(v.since).toBe(new Date(Date.UTC(2026, 8, 1, 0, 0)).toISOString());
    // a later burst larger than a page: the newest-first walk keeps going until it meets a held fill, nothing is skipped
    for (let i = 105; i < 330; i += 1) t.trading.addFill("vf-busy-key-CCCC", { id: `b-${i}`, productId: 101, side: "buy", size: 1, price: "100", filledAt: new Date(Date.UTC(2026, 8, 2, 0, i)).toISOString() });
    expect(await ingestFills(t.deps, { userId: otherId, maxPages: 1, now: () => NOW + 120_000 })).toMatchObject({ added: 225 });
    expect((await computeVerified(t.deps, otherId, NOW)).fills).toBe(330);
  });

  it("a product whose venue position is not what the fills add up to is named as partial, never guessed", async () => {
    const other = (await t.signUp("verified-partial@hapiecoin.test")).cookie;
    const otherId = (await json<{ id: string }>(await t.request("/v1/me", { cookie: other }))).id;
    t.delta.accept("vf-partial-key-DDDD");
    expect((await t.request("/v1/credentials", { cookie: other, json: { brokerId: SEED.brokerId, apiKey: "vf-partial-key-DDDD", apiSecret: "s" } })).status).toBe(201);
    // the fills read only hold the exit of a position opened before them; the venue is flat, the fills say short 10
    t.trading.addFill("vf-partial-key-DDDD", { id: "p-1", productId: 101, side: "sell", size: 10, price: "1500", filledAt: "2026-09-11T09:00:00.000Z" });
    t.trading.setPositions([]);
    expect((await ingestFills(t.deps, { userId: otherId, now: () => NOW })).errors).toEqual([]);
    const v = await computeVerified(t.deps, otherId, NOW);
    expect(v.accounts[0]!.partialProducts).toBe(1);
    expect(v.total.all).toBe("0"); // an open short realises nothing: no phantom gain
    // once the venue holds what the fills say, the product is whole again
    t.trading.setPositions([{ productId: 101, symbol: "C-BTC-80000-250926", size: -10, entryPrice: "1500", realizedPnl: "0", margin: "10" }]);
    await ingestFills(t.deps, { userId: otherId, now: () => NOW + 60_000 });
    expect((await computeVerified(t.deps, otherId, NOW)).accounts[0]!.partialProducts).toBe(0);
    t.trading.setPositions([]);
  });
});
