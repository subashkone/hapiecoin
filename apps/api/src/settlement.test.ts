// Expiry settlement (ADR-059 §2.4; HC-TR-162 paper, HC-TR-163 live; GAPS #66): legs past the settlement instant
// close at intrinsic value from the spot at that instant, paper directly, live only once the exchange shows the
// contract gone; nothing settles without a spot or through an unreadable exchange; the strategy archives with
// closeReason "expired" and the Details history carries the batch.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Strategy } from "@hapiecoin/schema";
import { eq } from "drizzle-orm";
import { auditLog, brokerCredentials, ivSnapshots, strategies, strategyLegs } from "./db/schema.js";
import { SEED } from "./db/seed.js";
import { closeLegRow } from "./routes/strategies.js";
import { type SettlementSource, intrinsicAt, settleExpired, settlementInstant, snapshotSpotSource, startSettler } from "./settlement.js";
import { createTestApp, type TestApp } from "./test-support/harness.js";

let t: TestApp;
let alice: string;
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
const SETTLE = Date.UTC(2026, 8, 25, 12); // 25 Sep 2026 12:00 UTC, the BTC settlement instant of the fixtures
const LATER = SETTLE + 5 * 60_000; // past the grace
const CALL = {
  kind: "call",
  side: "buy",
  strike: "80000",
  expiry: "2026-09-25",
  symbol: "C-BTC-80000-250926",
  lots: 10,
  price: "1200",
};
const PUT = {
  kind: "put",
  side: "sell",
  strike: "78000",
  expiry: "2026-09-25",
  symbol: "P-BTC-78000-250926",
  lots: 10,
  price: "900",
};
const PERP = {
  kind: "future",
  side: "buy",
  strike: "",
  expiry: "PERP",
  symbol: "BTCUSD",
  lots: 2,
  price: "79500",
};
const fixed = (spot: number | null): SettlementSource => ({ spotAt: () => Promise.resolve(spot) });
const get = async (id: string) => json<Strategy>(await t.request(`/v1/strategies/${id}`, { cookie: alice }));

beforeAll(async () => {
  t = await createTestApp();
  alice = (await t.signUp("settle@hapiecoin.test")).cookie;
  t.delta.accept("live-key");
  expect(
    (
      await t.request("/v1/credentials", {
        cookie: alice,
        json: { brokerId: SEED.brokerId, apiKey: "live-key", apiSecret: "live-secret" },
      })
    ).status,
  ).toBe(201);
});
afterAll(() => t.close());
beforeEach(() => {
  t.trading
    .product("C-BTC-80000-250926", 101, "0.001")
    .markAt("C-BTC-80000-250926", "1200")
    .fillAt(101, "1200");
  t.trading
    .product("P-BTC-78000-250926", 102, "0.001")
    .markAt("P-BTC-78000-250926", "900")
    .fillAt(102, "900");
  t.trading.product("BTCUSD", 27, "0.001").markAt("BTCUSD", "79500").fillAt(27, "79500");
  t.trading.setBalances([{ asset: "USD", balance: "5000", availableBalance: "4000" }]);
  t.trading.setPositions([]);
  t.trading.positionsDown = false;
});

async function paper(legs: unknown[] = [CALL, PUT], name = "Settle paper") {
  const s = await json<Strategy>(
    await t.request("/v1/strategies", { cookie: alice, json: { name, asset: "BTC", legs } }),
  );
  const entries = Object.fromEntries(s.legs.map((l) => [l.id, l.price]));
  return json<Strategy>(
    await t.request(`/v1/strategies/${s.id}/start`, {
      cookie: alice,
      json: { mode: "paper", brokerId: SEED.brokerId, entries },
    }),
  );
}
async function live(legs: unknown[] = [CALL, PUT], name = "Settle live") {
  const s = await json<Strategy>(
    await t.request("/v1/strategies", { cookie: alice, json: { name, asset: "BTC", legs } }),
  );
  const res = await t.request(`/v1/strategies/${s.id}/live/place`, {
    cookie: alice,
    json: { brokerId: SEED.brokerId, idempotencyKey: `key-settle-${s.id.slice(-6)}`, expected: {} },
  });
  expect(res.status).toBe(200);
  return get(s.id);
}

describe("HC-TR-162 intrinsicAt", () => {
  it("values a call above the strike, a put below it, nothing out of the money, a future at the spot", () => {
    expect(intrinsicAt({ kind: "call", strike: "80000" }, 81000)).toBe(1000);
    expect(intrinsicAt({ kind: "call", strike: "80000" }, 79000)).toBe(0);
    expect(intrinsicAt({ kind: "put", strike: "78000" }, 77500)).toBe(500);
    expect(intrinsicAt({ kind: "put", strike: "78000" }, 79000)).toBe(0);
    expect(intrinsicAt({ kind: "future", strike: "" }, 79500)).toBe(79500);
  });
});

describe("HC-TR-162 paper settlement", () => {
  it("does nothing before the instant plus grace, then books both legs at intrinsic, archives with closeReason expired and audits", async () => {
    const s = await paper();
    expect(await settleExpired(t.deps, fixed(81000), () => SETTLE + 60_000)).toEqual({
      strategies: 0,
      settled: 0,
      archived: 0,
      skipped: 0,
    });
    expect((await get(s.id)).status).toBe("paper");
    const report = await settleExpired(t.deps, fixed(81000), () => LATER);
    expect(report).toMatchObject({ strategies: 1, settled: 2, archived: 1, skipped: 0 });
    const done = await get(s.id);
    expect(done.status).toBe("archived");
    expect(done.closeReason).toBe("expired");
    expect(done.closedAt).toBe(new Date(LATER).toISOString());
    // buy 80,000 call at 1,200 settles at 1,000: −200 × 10 × 0.001 = −2; sell 78,000 put at 900 settles at 0: +9
    expect(done.realizedPnl).toBe("7");
    expect(done.legs.map((l) => [l.status, l.exitPrice, l.closeReason])).toEqual([
      ["squared_off", "1000", "expired"],
      ["squared_off", "0", "expired"],
    ]);
    const last = done.adjustments[done.adjustments.length - 1]!;
    expect(last.batchId).toMatch(/^settle:/);
    expect(last).toMatchObject({ closed: 2, added: 0, trimmed: 0, realizedPnl: "7" });
    expect(last.reason).toContain("C-BTC-80000-250926 at 1000 (spot 81000)");
    const audits = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.target, `strategy:${s.id}`));
    expect(audits.map((a) => a.action)).toContain("strategy.settle");
    expect(audits.find((a) => a.action === "strategy.settle")?.actorId).toBeNull();
    // a second pass finds nothing
    expect(await settleExpired(t.deps, fixed(81000), () => LATER)).toEqual({
      strategies: 0,
      settled: 0,
      archived: 0,
      skipped: 0,
    });
  });

  it("leaves legs open without a spot and never settles the perpetual; a strategy with a perpetual stays paper", async () => {
    const s = await paper([CALL, PERP]);
    expect(await settleExpired(t.deps, fixed(null), () => LATER)).toMatchObject({
      strategies: 1,
      settled: 0,
      archived: 0,
      skipped: 1,
    });
    expect((await get(s.id)).legs.every((l) => l.status === "open")).toBe(true);
    expect(await settleExpired(t.deps, fixed(79000), () => LATER)).toMatchObject({
      strategies: 1,
      settled: 1,
      archived: 0,
    });
    const after = await get(s.id);
    expect(after.status).toBe("paper");
    expect(after.closeReason ?? null).toBeNull();
    expect(after.legs.map((l) => [l.symbol, l.status])).toEqual([
      ["C-BTC-80000-250926", "squared_off"],
      ["BTCUSD", "open"],
    ]);
    expect(after.realizedPnl).toBe("-12"); // out of the money: the whole 1,200 × 10 × 0.001 premium
  });
});

describe("HC-TR-163 live settlement", () => {
  it("settles only what the exchange no longer holds, skips a strategy whose exchange cannot be read, sends no order", async () => {
    const s = await live();
    const placed = t.trading.placed.length;
    t.trading.positionsDown = true;
    expect(await settleExpired(t.deps, fixed(81000), () => LATER)).toMatchObject({
      strategies: 1,
      settled: 0,
      skipped: 2,
    });
    const untouched = await get(s.id);
    expect(untouched.status).toBe("live");
    expect(untouched.legs.map((l) => [l.status, l.closeReason ?? null])).toEqual([
      ["open", null],
      ["open", null],
    ]);
    t.trading.positionsDown = false;
    // a position the venue could not name: the read is unusable, nothing is booked
    t.trading.setPositions([
      { productId: 999, symbol: null, size: 3, entryPrice: null, realizedPnl: null, margin: null },
    ]);
    expect(await settleExpired(t.deps, fixed(81000), () => LATER)).toMatchObject({
      strategies: 1,
      settled: 0,
      skipped: 2,
    });
    // the exchange still holds the put: only the call settles
    t.trading.setPositions([
      {
        productId: 102,
        symbol: "P-BTC-78000-250926",
        size: -10,
        entryPrice: "900",
        realizedPnl: "0",
        margin: "10",
      },
    ]);
    expect(await settleExpired(t.deps, fixed(81000), () => LATER)).toMatchObject({
      strategies: 1,
      settled: 1,
      archived: 0,
      skipped: 1,
    });
    const mid = await get(s.id);
    expect(mid.status).toBe("live");
    expect(mid.legs.map((l) => [l.symbol, l.status, l.closeReason ?? null])).toEqual([
      ["C-BTC-80000-250926", "squared_off", "expired"],
      ["P-BTC-78000-250926", "open", null],
    ]);
    // the exchange settled the put too
    t.trading.setPositions([]);
    expect(await settleExpired(t.deps, fixed(81000), () => LATER)).toMatchObject({
      strategies: 1,
      settled: 1,
      archived: 1,
      skipped: 0,
    });
    const done = await get(s.id);
    expect(done.status).toBe("archived");
    expect(done.closeReason).toBe("expired");
    expect(done.realizedPnl).toBe("7");
    expect(t.trading.placed.length).toBe(placed); // bookkeeping only
  });

  it("a live entry that never filled is closed with no P&L, never at the planned premium", async () => {
    t.trading.failWith(101, "insufficient_margin");
    const s = await live();
    expect(s.legs.map((l) => [l.symbol, l.status, l.entryPrice])).toEqual([
      ["C-BTC-80000-250926", "open", null],
      ["P-BTC-78000-250926", "open", "900"],
    ]);
    t.trading.setPositions([]);
    expect(await settleExpired(t.deps, fixed(81000), () => LATER)).toMatchObject({
      strategies: 1,
      settled: 2,
      archived: 1,
      skipped: 0,
    });
    const done = await get(s.id);
    expect(done.status).toBe("archived");
    expect(done.realizedPnl).toBe("9"); // the put only: the refused call adds nothing
    expect(done.legs.map((l) => [l.status, l.exitPrice, l.closeReason])).toEqual([
      ["squared_off", null, "expired"],
      ["squared_off", "0", "expired"],
    ]);
    expect(done.adjustments[done.adjustments.length - 1]!.reason).toContain(
      "C-BTC-80000-250926 never filled",
    );
  });
});

describe("HC-TR-163 a live strategy whose credential is gone", () => {
  it("is skipped and left for the next pass, nothing booked", async () => {
    const s = await live();
    // the key vanishes underneath a live strategy (the route refuses that, ADR-068; a vault or database loss would not)
    const meId = ((await (await t.request("/v1/me", { cookie: alice })).json()) as { id: string }).id;
    await t.db.update(strategies).set({ accountId: null }).where(eq(strategies.userId, meId));
    await t.db.delete(brokerCredentials).where(eq(brokerCredentials.userId, meId));
    t.trading.setPositions([]);
    expect(await settleExpired(t.deps, fixed(81000), () => LATER)).toMatchObject({ strategies: 1, settled: 0, archived: 0, skipped: 2 });
    expect((await get(s.id)).status).toBe("live");
    expect((await t.request("/v1/credentials", { cookie: alice, json: { brokerId: SEED.brokerId, apiKey: "live-key", apiSecret: "live-secret" } })).status).toBe(201);
    // with the credential back the next pass books it
    expect(await settleExpired(t.deps, fixed(81000), () => LATER)).toMatchObject({ strategies: 1, settled: 2, archived: 1, skipped: 0 });
  });
});

describe("HC-TR-162 the write is guarded", () => {
  it("closeLegRow refuses a leg squared off since the caller read it, whole or in part", async () => {
    const s = await paper();
    const [row] = await t.db.select().from(strategies).where(eq(strategies.id, s.id)).limit(1);
    const [stale] = await t.db.select().from(strategyLegs).where(eq(strategyLegs.id, s.legs[0]!.id)).limit(1);
    expect((await t.request(`/v1/strategies/${s.id}/legs/${s.legs[0]!.id}/close`, { cookie: alice, json: { exitPrice: "1050" } })).status).toBe(200);
    await expect(closeLegRow(t.deps, row!, stale!, "1", undefined, "0.001", new Date())).rejects.toThrow(/already squared off|squared off meanwhile/);
    const fresh = { ...stale!, status: "open" as const }; // a caller holding a copy that still says open
    await expect(closeLegRow(t.deps, row!, fresh, "1", undefined, "0.001", new Date())).rejects.toThrow(/squared off meanwhile/);
    await expect(closeLegRow(t.deps, row!, fresh, "1", 4, "0.001", new Date())).rejects.toThrow(/squared off meanwhile/);
    expect((await get(s.id)).realizedPnl).toBe("-1.5"); // the one real close only
    expect((await t.request(`/v1/strategies/${s.id}/close`, { cookie: alice, json: { exits: { [s.legs[1]!.id]: "900" } } })).status).toBe(200); // leave nothing open for the later passes
  });

  it("startSettler runs a pass on its interval and stops", async () => {
    const s = await paper([{ ...CALL, expiry: "2026-09-04", symbol: "C-BTC-80000-040926" }], "Settle by timer");
    const stop = startSettler(t.deps, fixed(81000), 40);
    try {
      await new Promise((r) => setTimeout(r, 400));
    } finally {
      stop();
    }
    const done = await get(s.id);
    expect(done.status).toBe("archived");
    expect(done.closeReason).toBe("expired");
  });
});

describe("HC-TR-162 a close during the pass", () => {
  it("skips a leg the trader closed after the pass started and keeps that close's P&L in the total", async () => {
    const s = await paper();
    const call = s.legs[0]!;
    // the spot read is the pass's first await after the select: the trader squares the call off meanwhile
    const racing: SettlementSource = {
      spotAt: async () => {
        expect(
          (
            await t.request(`/v1/strategies/${s.id}/legs/${call.id}/close`, {
              cookie: alice,
              json: { exitPrice: "1050" },
            })
          ).status,
        ).toBe(200);
        return 81000;
      },
    };
    expect(await settleExpired(t.deps, racing, () => LATER)).toMatchObject({
      strategies: 1,
      settled: 1,
      archived: 1,
      skipped: 1,
    });
    const done = await get(s.id);
    expect(done.legs.map((l) => [l.symbol, l.exitPrice, l.closeReason])).toEqual([
      ["C-BTC-80000-250926", "1050", "squared_off"],
      ["P-BTC-78000-250926", "0", "expired"],
    ]);
    expect(done.realizedPnl).toBe("7.5"); // (1050 − 1200) × 10 × 0.001 = −1.5 from the trader's close, +9 from the settled put
    expect(done.status).toBe("archived");
    expect(done.closeReason).toBe("expired");
  });
});

describe("HC-TR-162 snapshotSpotSource", () => {
  it("takes the snapshot nearest the instant within the window, else the live spot while the instant is fresh, else null", async () => {
    const source = snapshotSpotSource(
      t.deps,
      () => Promise.resolve(82000),
      () => SETTLE + 10 * 60_000,
    );
    expect(await source.spotAt("ETH", SETTLE)).toBe(82000); // no ETH snapshot: live spot, the instant is 10 min old
    const stale = snapshotSpotSource(
      t.deps,
      () => Promise.resolve(82000),
      () => SETTLE + 60 * 60_000,
    );
    expect(await stale.spotAt("ETH", SETTLE)).toBeNull(); // an hour later the live spot says nothing about the instant
    const failing = snapshotSpotSource(
      t.deps,
      () => Promise.reject(new Error("offline")),
      () => SETTLE + 60_000,
    );
    expect(await failing.spotAt("ETH", SETTLE)).toBeNull();
    await t.db.insert(ivSnapshots).values([
      {
        asset: "BTC",
        expiry: "2026-09-25",
        ts: new Date(SETTLE - 8 * 60_000),
        atmIv: "0.5",
        spot: "80900",
        atmStrike: "81000",
        front: true,
      },
      {
        asset: "BTC",
        expiry: "2026-09-25",
        ts: new Date(SETTLE + 2 * 60_000),
        atmIv: "0.5",
        spot: "81050",
        atmStrike: "81000",
        front: true,
      },
      {
        asset: "BTC",
        expiry: "2026-10-30",
        ts: new Date(SETTLE + 2 * 60_000),
        atmIv: "0.5",
        spot: "81050",
        atmStrike: "81000",
        front: false,
      },
      {
        asset: "BTC",
        expiry: "2026-09-25",
        ts: new Date(SETTLE + 45 * 60_000),
        atmIv: "0.5",
        spot: "83000",
        atmStrike: "83000",
        front: true,
      },
    ]);
    expect(await source.spotAt("BTC", SETTLE)).toBe(81050); // nearest within 30 min, the 45-minute row is outside the window
  });
});

describe("HC-SH-121 settlementInstant reads the venue calendar (ADR-066)", () => {
  it("BTC and ETH settle at 12:00 UTC, XAUT at 16:00; the perpetual and an impossible date give null", () => {
    expect(settlementInstant("2026-09-25", "BTC", "delta_india")).toBe(Date.UTC(2026, 8, 25, 12));
    expect(settlementInstant("2026-09-25", "ETH", "delta_india")).toBe(Date.UTC(2026, 8, 25, 12));
    expect(settlementInstant("2026-09-25", "XAUT", "delta_india")).toBe(Date.UTC(2026, 8, 25, 16));
    expect(settlementInstant("PERP", "BTC", "delta_india")).toBeNull();
    expect(settlementInstant("2026-02-30", "BTC", "delta_india")).toBeNull();
  });
});
