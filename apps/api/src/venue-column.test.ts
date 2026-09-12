// ADR-065: every strategy, broker, alert and history row carries its venue; a broker of another venue cannot start
// or place a strategy; history reads are scoped to a venue.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Alert, Broker, IvHistory, LivePreview, MarkHistory, Strategy } from "@hapiecoin/schema";
import { eq } from "drizzle-orm";
import { brokers, instrumentMarks, ivSnapshots, strategies } from "./db/schema.js";
import { SEED } from "./db/seed.js";
import { ivHistory, markHistory } from "./market-history.js";
import { createTestApp, type TestApp } from "./test-support/harness.js";

let t: TestApp;
let alice: string;
beforeAll(async () => {
  t = await createTestApp();
  alice = (await t.signUp("alice-venue@hapiecoin.test")).cookie;
});
afterAll(() => t.close());

const CALL = { kind: "call", side: "buy", strike: "80000", expiry: "2026-09-25", symbol: "C-BTC-80000-250926", lots: 10, price: "1200" };
/** A broker row of a venue the app does not list yet: the column is text, the TypeScript enum is narrower. */
const OTHER_VENUE = "other_venue" as "delta_india";

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("HC-SH-120 [API] the venue column", () => {
  it("a new strategy, alert and broker carry the default venue, and the seed broker names it", async () => {
    const s = await json<Strategy>(await t.request("/v1/strategies", { cookie: alice, json: { name: "Venue", asset: "BTC", legs: [CALL] } }));
    expect(s.venue).toBe("delta_india");
    const explicit = await t.request("/v1/strategies", { cookie: alice, json: { name: "Venue 2", asset: "BTC", venue: "delta_india", legs: [CALL] } });
    expect(explicit.status).toBe(201);
    expect((await t.request("/v1/strategies", { cookie: alice, json: { name: "Venue 3", asset: "BTC", venue: "nse", legs: [CALL] } })).status).toBe(400);
    const a = await json<Alert>(await t.request("/v1/alerts", { cookie: alice, json: { kind: "price", asset: "BTC", op: ">=", value: "82000", channels: ["push"] } }));
    expect(a.venue).toBe("delta_india");
    const pnl = await json<Alert>(await t.request("/v1/alerts", { cookie: alice, json: { kind: "pnl", asset: "BTC", strategyId: s.id, op: ">=", value: "20", channels: ["push"] } }));
    expect(pnl.venue).toBe(s.venue); // a P&L alert watches its strategy's venue
    const b = await json<Broker>(await t.request("/v1/brokers", { cookie: alice, json: { name: "Mine", feePct: "0.05", gstPct: "18", feeCapPct: "10" } }));
    expect(b.venue).toBe("delta_india");
    const [seed] = await t.db.select({ venue: brokers.venue }).from(brokers).where(eq(brokers.id, SEED.brokerId));
    expect(seed?.venue).toBe("delta_india");
  });

  it("a broker of another venue cannot start a paper strategy or place it live", async () => {
    await t.db.insert(brokers).values({ id: "brk_other", name: "Other venue", feePct: "0.1", gstPct: "0", feeCapPct: "10", scope: "GLOBAL", ownerId: null, venue: OTHER_VENUE });
    const s = await json<Strategy>(await t.request("/v1/strategies", { cookie: alice, json: { name: "Venue start", asset: "BTC", legs: [CALL] } }));
    const start = await t.request(`/v1/strategies/${s.id}/start`, { cookie: alice, json: { mode: "paper", brokerId: "brk_other", entries: {} } });
    expect(start.status).toBe(409);
    expect((await json<{ message: string }>(start)).message).toContain("other_venue");
    // live: the preview passes (product, mark, wallet), then the credential step refuses the venue
    t.trading.product("C-BTC-80000-250926", 101, "0.001").markAt("C-BTC-80000-250926", "1200").fillAt(101, "1201");
    t.trading.setBalances([{ asset: "USD", balance: "50000", availableBalance: "40000" }]);
    t.delta.accept("other-key");
    expect((await t.request("/v1/credentials", { cookie: alice, json: { brokerId: "brk_other", apiKey: "other-key", apiSecret: "other-secret" } })).status).toBe(201);
    const p = await json<LivePreview>(await t.request(`/v1/strategies/${s.id}/live/preview`, { cookie: alice, json: { brokerId: "brk_other" } }));
    expect(p.ok).toBe(false);
    expect(p.reasons.some((r) => r.includes("other_venue"))).toBe(true); // the dialog shows the refusal before any placement
    const place = await t.request(`/v1/strategies/${s.id}/live/place`, { cookie: alice, json: { brokerId: "brk_other", idempotencyKey: "key-venue-0001", expected: {} } });
    expect(place.status).toBe(409);
    expect((await json<{ message: string }>(place)).message).toContain("other_venue");
    const [row] = await t.db.select({ status: strategies.status, brokerId: strategies.brokerId }).from(strategies).where(eq(strategies.id, s.id));
    expect(row).toEqual({ status: "draft", brokerId: null }); // nothing was stamped
    // batch: a paper strategy on the seed broker; the foreign broker is the batch's failed item, not a thrown 409
    const paper = await json<Strategy>(await t.request("/v1/strategies", { cookie: alice, json: { name: "Venue batch", asset: "BTC", legs: [CALL] } }));
    expect((await t.request(`/v1/strategies/${paper.id}/start`, { cookie: alice, json: { mode: "paper", brokerId: SEED.brokerId, entries: {} } })).status).toBe(200);
    const batch = await json<{ placed: string[]; failed: { id: string; error: string } | null; skipped: string[] }>(await t.request("/v1/strategies/live/batch", { cookie: alice, json: { ids: [paper.id], brokerId: "brk_other", idempotencyKey: "key-venue-0002" } }));
    expect(batch.placed).toEqual([]);
    expect(batch.failed?.id).toBe(paper.id);
    expect(batch.failed?.error).toContain("other_venue");
    const [after] = await t.db.select({ status: strategies.status, brokerId: strategies.brokerId }).from(strategies).where(eq(strategies.id, paper.id));
    expect(after).toEqual({ status: "paper", brokerId: SEED.brokerId });
  });

  it("history reads are scoped to the venue and the market routes accept only a listed one", async () => {
    const ts = new Date(t.now.value - 60_000);
    await t.db.insert(ivSnapshots).values([
      { asset: "ETH", expiry: "2026-09-25", ts, atmIv: "0.5", spot: "4000", atmStrike: "4000", front: true },
      { asset: "ETH", expiry: "2026-09-25", ts, atmIv: "0.9", spot: "9999", atmStrike: "9000", front: true, venue: OTHER_VENUE },
    ]);
    await t.db.insert(instrumentMarks).values([
      { asset: "ETH", symbol: "C-ETH-4000-250926", ts, mark: "100", markIv: "0.5" },
      { asset: "ETH", symbol: "C-ETH-4000-250926", ts, mark: "999", markIv: "0.9", venue: OTHER_VENUE },
    ]);
    const iv = await ivHistory(t.db, "ETH", () => t.now.value);
    expect(iv.venue).toBe("delta_india");
    expect(iv.current?.spot).toBe(4000);
    const marks = await markHistory(t.db, "C-ETH-4000-250926", 24, () => t.now.value);
    expect(marks.venue).toBe("delta_india");
    expect(marks.points.map((p) => p.mark)).toEqual([100]);
    const viaRoute = await json<IvHistory>(await t.request("/v1/market/iv?asset=ETH&venue=delta_india"));
    expect(viaRoute.current?.spot).toBe(4000);
    expect((await t.request("/v1/market/iv?asset=ETH&venue=nse")).status).toBe(400);
    const mh = await json<MarkHistory>(await t.request("/v1/market/marks/C-ETH-4000-250926?venue=delta_india"));
    expect(mh.points).toHaveLength(1);
    expect((await t.request("/v1/market/marks/C-ETH-4000-250926?venue=nse")).status).toBe(400);
  });

  it("HC-SH-122 a data-only venue (Deribit) takes exchanges and paper strategies but no keys and no live orders (ADR-067)", async () => {
    const b = await json<Broker>(await t.request("/v1/brokers", { cookie: alice, json: { name: "Deribit", feePct: "0", gstPct: "0", feeCapPct: "0", venue: "deribit" } }));
    expect(b.venue).toBe("deribit");
    const s = await json<Strategy>(await t.request("/v1/strategies", { cookie: alice, json: { name: "Deribit paper", asset: "BTC", venue: "deribit", legs: [{ ...CALL, symbol: "BTC-25SEP26-80000-C" }] } }));
    expect(s.venue).toBe("deribit");
    const gold = await t.request("/v1/strategies", { cookie: alice, json: { name: "Gold on Deribit", asset: "XAUT", venue: "deribit", legs: [{ ...CALL, symbol: "XAUT-25SEP26-4000-C" }] } });
    expect(gold.status).toBe(400); // HC-SH-124 / ADR-069: an asset the venue does not list is refused
    expect((await json<{ message: string }>(gold)).message).toContain("not listed on Deribit");
    expect((await t.request(`/v1/strategies/${s.id}/start`, { cookie: alice, json: { mode: "paper", brokerId: b.id, entries: {} } })).status).toBe(200);
    const keys = await t.request("/v1/credentials", { cookie: alice, json: { brokerId: b.id, apiKey: "k", apiSecret: "s" } });
    expect(keys.status).toBe(409);
    expect((await json<{ message: string }>(keys)).message).toContain("data-only");
    const p = await json<LivePreview>(await t.request(`/v1/strategies/${s.id}/live/preview`, { cookie: alice, json: { brokerId: b.id } }));
    expect(p.ok).toBe(false);
    expect(p.reasons.some((r) => r.includes("data-only"))).toBe(true);
    const place = await t.request(`/v1/strategies/${s.id}/live/place`, { cookie: alice, json: { brokerId: b.id, idempotencyKey: "key-deribit-0001", expected: {} } });
    expect(place.status).toBe(409);
    expect((await json<{ message: string }>(place)).message).toContain("data-only");
  });
});
