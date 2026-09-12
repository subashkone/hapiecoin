// End-of-day chains (ADR-077; HC-SH-128): the first pass at or after the settlement hour records the day's chain once,
// the first record for a venue and underlying backfills the previous week from the mark stream, XAUT settles at 16:00,
// rows are pruned, and the read side folds rows into ladders per expiry.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Instrument, Quote } from "@hapiecoin/schema";
import { and, count, eq } from "drizzle-orm";
import { EOD_ROWS_RETENTION_DAYS, clearEodMemo, eodDays, eodDaysCached, pruneEod } from "./chain-eod.js";
import { chainEod } from "./db/schema.js";
import { snapshotOnce, type MarketSource } from "./iv-snapshot.js";
import { createTestApp, type TestApp } from "./test-support/harness.js";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const DAY = 86_400_000;
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 8, 10, 0, 0, 0); // 10 Sep 2026 00:00Z

function inst(symbol: string, kind: "call" | "put", strike: number, expiry: string, underlying: "BTC" | "ETH" | "XAUT" = "BTC"): Instrument {
  return { id: `delta_india:${symbol}`, venue: "delta_india", symbol, underlying, kind, strike: String(strike), expiry, contractSize: "0.001", tickSize: "0.1", quoteCurrency: "USD", venueProductId: symbol.length + strike, isActive: true };
}
function quote(symbol: string, mark: number, markIv: number | undefined, spot: number, ts: number): Quote {
  return { instrumentId: `delta_india:${symbol}`, ts, mark: String(mark), oi: "1", spot: String(spot), ...(markIv === undefined ? {} : { markIv }) };
}
/** A BTC ladder on one expiry and one XAUT option; marks move with the pass so passes are told apart. */
function sourceAt(ms: number, spot = 80_000): MarketSource {
  const products = [inst("C-BTC-79000-250926", "call", 79_000, "2026-09-25"), inst("P-BTC-79000-250926", "put", 79_000, "2026-09-25"), inst("C-BTC-81000-250926", "call", 81_000, "2026-09-25"), inst("C-XAUT-3400-250926", "call", 3_400, "2026-09-25", "XAUT")];
  const bump = (ms % DAY) / HOUR; // the hour of the pass, so a mark names its pass
  return {
    venue: "delta_india",
    products: () => Promise.resolve(products),
    tickers: (u) => {
      if (u === "BTC") return Promise.resolve([quote("C-BTC-79000-250926", 1200 + bump, 0.4, spot, ms), quote("P-BTC-79000-250926", 1100 + bump, undefined, spot, ms), quote("C-BTC-81000-250926", 700 + bump, 0.45, spot, ms)]);
      if (u === "XAUT") return Promise.resolve([quote("C-XAUT-3400-250926", 50 + bump, 0.2, 3_425, ms)]);
      return Promise.resolve([]);
    },
  };
}
const rowsFor = async (asset: "BTC" | "XAUT", day: string) => (await t.db.select({ n: count() }).from(chainEod).where(and(eq(chainEod.asset, asset), eq(chainEod.day, day))))[0]!.n;

describe("HC-SH-128 the end-of-day chain", () => {
  it("is recorded once by the first pass at or after the settlement hour, backfilled from the previous week's marks, and XAUT waits for 16:00", async () => {
    // a week of 5-minute-style passes before any end-of-day write: two passes a day, at 11:00 and 11:55, both before the hour
    for (let back = 7; back >= 1; back--) {
      const dayStart = T0 - back * DAY;
      await snapshotOnce(t.deps, sourceAt(dayStart + 11 * HOUR, 79_000 + back), () => dayStart + 11 * HOUR);
      await snapshotOnce(t.deps, sourceAt(dayStart + 11 * HOUR + 55 * 60_000, 79_500 + back), () => dayStart + 11 * HOUR + 55 * 60_000);
    }
    expect(await eodDays(t.db, "delta_india", "BTC")).toEqual([]);
    const r = await snapshotOnce(t.deps, sourceAt(T0 + 6 * HOUR), () => T0 + 6 * HOUR); // 06:00: before the hour
    expect(r.assets["BTC"]?.eod).toBe(0);
    expect(await rowsFor("BTC", "2026-09-10")).toBe(0);
    const noon = await snapshotOnce(t.deps, sourceAt(T0 + 12 * HOUR, 80_250), () => T0 + 12 * HOUR);
    expect(noon.assets["BTC"]?.eod).toBe(3);
    expect(noon.assets["XAUT"]?.eod).toBe(0); // XAUT settles at 16:00
    expect(await rowsFor("BTC", "2026-09-10")).toBe(3);
    const later = await snapshotOnce(t.deps, sourceAt(T0 + 13 * HOUR, 80_900), () => T0 + 13 * HOUR);
    expect(later.assets["BTC"]?.eod).toBe(0); // once a day
    expect(await rowsFor("BTC", "2026-09-10")).toBe(3);
    const four = await snapshotOnce(t.deps, sourceAt(T0 + 16 * HOUR), () => T0 + 16 * HOUR);
    expect(four.assets["XAUT"]?.eod).toBe(1);
    // the day's rows carry the noon pass: mark 1200 + 12, spot 80 250, both sides folded into one ladder row
    const days = await eodDays(t.db, "delta_india", "BTC", { from: "2026-09-10", to: "2026-09-10" });
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ day: "2026-09-10", spot: 80_250, ts: T0 + 12 * HOUR });
    expect(days[0]!.expiries[0]!.rows).toEqual([
      { strike: 79_000, call: { mark: 1212, iv: 0.4 }, put: { mark: 1112, iv: undefined } },
      { strike: 81_000, call: { mark: 712, iv: 0.45 } },
    ]);
  });

  it("the backfill took each earlier day's last pass at or before the settlement hour, with that pass's spot", async () => {
    const all = await eodDays(t.db, "delta_india", "BTC");
    expect(all.map((d) => d.day)).toEqual(["2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10"]);
    const back3 = all.find((d) => d.day === "2026-09-07")!; // 3 days back: the 11:55 pass (the later of the two), spot 79 503
    expect(back3.spot).toBe(79_503);
    expect(back3.expiries[0]!.rows[0]!.call!.mark).toBeCloseTo(1200 + 11 + 55 / 60, 6);
    expect(all).toHaveLength(8);
    // XAUT's first EOD write (16:00 today) also backfilled its own days from its marks; the marks of 3 Sep were already
    // past the 7-day mark retention by then (pruned at noon), so its backfill reaches one day less than BTC's
    expect((await eodDays(t.db, "delta_india", "XAUT")).map((d) => d.day)).toEqual(["2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10"]);
    // a later day's first pass after the hour is a plain daily write: no second backfill, no duplicates
    const next = T0 + DAY;
    const w = await snapshotOnce(t.deps, sourceAt(next + 12 * HOUR + 30 * 60_000, 81_000), () => next + 12 * HOUR + 30 * 60_000);
    expect(w.assets["BTC"]?.eod).toBe(3);
    expect((await eodDays(t.db, "delta_india", "BTC")).length).toBe(9);
    // the memoised reader follows the table: a new day changes the stamp, the same table answers from memory
    clearEodMemo();
    const cached = await eodDaysCached(t.db, "delta_india", "BTC");
    expect(cached).toHaveLength(9);
    expect(await eodDaysCached(t.db, "delta_india", "BTC")).toBe(cached); // the same array: no reload
    const again = await snapshotOnce(t.deps, sourceAt(next + DAY + 12 * HOUR, 81_500), () => next + DAY + 12 * HOUR);
    expect(again.assets["BTC"]?.eod).toBe(3);
    expect(await eodDaysCached(t.db, "delta_india", "BTC")).toHaveLength(10);
  });

  it("rows older than the retention window are pruned", async () => {
    await pruneEod(t.db, new Date(T0 + (EOD_ROWS_RETENTION_DAYS + 3) * DAY)); // past every seeded day, the 12th included
    expect(await eodDays(t.db, "delta_india", "BTC")).toEqual([]);
  });
});
