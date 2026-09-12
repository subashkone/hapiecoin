// IV history snapshotter and read side (ADR-056; GAPS #62, #31, #32): ATM IV per expiry from synthetic tickers, the
// front-expiry choice, retention, then the derived daily series, rank, realised vol, 24 h range and mark history.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Instrument, IvHistory, MarkHistory, Quote } from "@hapiecoin/schema";
import { ivRankLabel, ivRankOf, realisedVolOf } from "@hapiecoin/schema";
import { count } from "drizzle-orm";
import { instrumentMarks, ivSnapshots } from "./db/schema.js";
import { atmIvByExpiry, frontExpiry, snapshotOnce, startIvSnapshotter, type MarketSource } from "./iv-snapshot.js";
import { ivHistory, markHistory } from "./market-history.js";
import { createTestApp, type TestApp } from "./test-support/harness.js";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 10, 6, 0, 0); // 10 Sep 2026 06:00Z

function inst(symbol: string, kind: "call" | "put", strike: number, expiry: string, underlying: "BTC" | "ETH" | "XAUT" = "BTC"): Instrument {
  return { id: `delta_india:${symbol}`, venue: "delta_india", symbol, underlying, kind, strike: String(strike), expiry, contractSize: "0.001", tickSize: "0.1", quoteCurrency: "USD", venueProductId: symbol.length + strike, isActive: true };
}
function quote(symbol: string, mark: number, markIv: number | undefined, spot: number, ts = T0): Quote {
  return { instrumentId: `delta_india:${symbol}`, ts, mark: String(mark), oi: "1", spot: String(spot), ...(markIv === undefined ? {} : { markIv }) };
}

/** A BTC chain on two expiries and an ETH chain, with the IV and spot moving with `day`. */
function sourceFor(day: number, opts: { spot?: number; ivShift?: number } = {}): MarketSource {
  const spot = opts.spot ?? 79_000 + day * 300;
  const iv = 0.4 + (opts.ivShift ?? 0) + day * 0.01;
  const products = [
    inst("C-BTC-79000-110926", "call", 79_000, "2026-09-11"),
    inst("P-BTC-79000-110926", "put", 79_000, "2026-09-11"),
    inst("C-BTC-79000-250926", "call", 79_000, "2026-09-25"),
    inst("P-BTC-79000-250926", "put", 79_000, "2026-09-25"),
    inst("C-BTC-80000-250926", "call", 80_000, "2026-09-25"),
    inst("C-ETH-4000-250926", "call", 4_000, "2026-09-25", "ETH"),
    { ...inst("C-BTC-70000-250926", "call", 70_000, "2026-09-25"), isActive: false },
  ];
  return {
    venue: "delta_india",
    products: () => Promise.resolve(products),
    tickers: (u) => {
      if (u === "BTC")
        return Promise.resolve([
          quote("C-BTC-79000-110926", 500, iv - 0.05, spot),
          quote("P-BTC-79000-110926", 480, iv - 0.03, spot),
          quote("C-BTC-79000-250926", 1200, iv, spot),
          quote("P-BTC-79000-250926", 1100, iv + 0.02, spot),
          quote("C-BTC-80000-250926", 800, iv + 0.1, spot),
          quote("C-BTC-70000-250926", 9000, iv + 0.5, spot), // inactive: never stored
          quote("F-BTC-UNKNOWN", 1, 0.9, spot), // not an instrument we know
        ]);
      if (u === "ETH") return Promise.resolve([quote("C-ETH-4000-250926", 90, 0.6, 4_000)]);
      return Promise.reject(new Error("XAUT feed down"));
    },
  };
}

describe("ADR-056 atmIvByExpiry / frontExpiry", () => {
  it("averages the call and put IV at the strike nearest the spot, per expiry, ignoring quotes without IV", () => {
    const products = [inst("C1", "call", 79_000, "2026-09-25"), inst("P1", "put", 79_000, "2026-09-25"), inst("C2", "call", 80_000, "2026-09-25"), inst("C3", "call", 79_500, "2026-10-30")];
    const quotes = [quote("C1", 1, 0.4, 79_100), quote("P1", 1, 0.5, 79_100), quote("C2", 1, 0.9, 79_100), quote("C3", 1, undefined, 79_100)];
    expect(atmIvByExpiry(products, quotes, 79_100)).toEqual([{ expiry: "2026-09-25", strike: 79_000, atmIv: 0.45 }]);
    // nearer strike wins even when it has one side only
    expect(atmIvByExpiry(products, quotes, 79_900)).toEqual([{ expiry: "2026-09-25", strike: 80_000, atmIv: 0.9 }]);
  });
  it("HC-SH-121 front expiry is the nearest with two or more days left at the venue's settlement hour, else the nearest", () => {
    const now = Date.UTC(2026, 8, 10, 6);
    expect(frontExpiry(["2026-09-25", "2026-09-11", "2026-10-30"], now)).toBe("2026-09-25");
    expect(frontExpiry(["2026-09-11"], now)).toBe("2026-09-11");
    expect(frontExpiry(["2026-09-13", "2026-09-11"], now)).toBe("2026-09-13");
    expect(frontExpiry([], now)).toBeNull();
    // ADR-066: the two-day rule counts to the venue's settlement hour; at 13:00 two days before, XAUT (16:00) still has two days, BTC (12:00) does not
    const at13 = Date.UTC(2026, 8, 9, 13, 0, 0);
    expect(frontExpiry(["2026-09-11", "2026-09-18"], at13)).toBe("2026-09-18");
    expect(frontExpiry(["2026-09-11", "2026-09-18"], at13, 16)).toBe("2026-09-11");
  });
});

describe("ADR-056 snapshotOnce, retention and the read side", () => {
  it("records every expiry with the front flag and every known option's mark; one failing underlying does not stop the others", async () => {
    const report = await snapshotOnce(t.deps, sourceFor(0), () => T0);
    expect(report.assets["BTC"]).toEqual({ expiries: 2, marks: 5, spot: 79_000, eod: 0 }); // 06:00: before the settlement hour, no end-of-day chain (ADR-077)
    expect(report.assets["ETH"]).toEqual({ expiries: 1, marks: 1, spot: 4_000, eod: 0 });
    expect(report.assets["XAUT"]).toEqual({ expiries: 0, marks: 0, spot: null });
    const rows = await t.db.select().from(ivSnapshots);
    expect(rows.map((r) => [r.asset, r.expiry, r.front, r.atmStrike])).toEqual([
      ["BTC", "2026-09-11", false, "79000"],
      ["BTC", "2026-09-25", true, "79000"],
      ["ETH", "2026-09-25", true, "4000"],
    ]);
    expect(Number(rows[1]!.atmIv)).toBeCloseTo(0.41, 9); // mean of 0.40 and 0.42
    const marks = await t.db.select().from(instrumentMarks);
    expect(marks.map((m) => m.symbol).sort()).toEqual(["C-BTC-79000-110926", "C-BTC-79000-250926", "C-BTC-80000-250926", "C-ETH-4000-250926", "P-BTC-79000-110926", "P-BTC-79000-250926"]);
    expect(marks.find((m) => m.symbol === "C-BTC-80000-250926")).toMatchObject({ mark: "800", markIv: String(0.4 + 0.1) });
  });

  it("builds the daily series from the last snapshot per day, ranks today's IV, computes realised vol and the 24 h range", async () => {
    // 40 more days, two snapshots on each; IV climbs 1 pt a day so the last day is the year's high
    for (let day = 1; day <= 40; day++) {
      await snapshotOnce(t.deps, sourceFor(day, { ivShift: -0.2 }), () => T0 + day * DAY);
      await snapshotOnce(t.deps, sourceFor(day), () => T0 + day * DAY + 6 * 3_600_000);
    }
    const now = () => T0 + 40 * DAY + 7 * 3_600_000;
    const h: IvHistory = await ivHistory(t.db, "BTC", now);
    expect(h.series).toHaveLength(41);
    expect(h.series[0]).toMatchObject({ day: "2026-09-10", spot: 79_000, expiry: "2026-09-25" });
    expect(h.series[0]!.atmIv).toBeCloseTo(0.41, 9);
    // the synthetic chain never rolls its expiries: once 25 Sep has under two days left the front falls back to the
    // nearest listed (11 Sep, mean IV = iv − 0.04), so the last day reads 0.76 and the series still ends at its high
    expect(h.series.at(-1)).toMatchObject({ day: "2026-10-20", expiry: "2026-09-11" });
    expect(h.current).toMatchObject({ expiry: "2026-09-11", spot: 79_000 + 40 * 300 });
    expect(h.current!.atmIv).toBeCloseTo(0.76, 9);
    expect(h.rank).toMatchObject({ rank: 100, percentile: 100, days: 41 });
    expect(h.rank!.low).toBeCloseTo(0.41, 9);
    expect(h.rank!.high).toBeCloseTo(0.76, 9);
    // spot rose 300 a day for 30 closes: realised vol is positive and the spread is IV minus it
    expect(h.realised!.days).toBe(30);
    expect(h.realised!.rv30).toBeGreaterThan(0);
    expect(h.realised!.spread).toBeCloseTo(h.current!.atmIv - h.realised!.rv30, 9);
    expect(h.spot24h).toEqual({ high: 79_000 + 40 * 300, low: 79_000 + 40 * 300 });
    expect(h.asOf).toBe(new Date(T0 + 40 * DAY + 6 * 3_600_000).toISOString());
    // the ETH series is separate; XAUT has nothing
    expect((await ivHistory(t.db, "ETH", now)).current).toMatchObject({ atmIv: 0.6, spot: 4_000 });
    expect((await ivHistory(t.db, "XAUT", now)).asOf).toBeNull();
    // the routes
    const res = await t.request("/v1/market/iv?asset=btc");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("max-age=60");
    expect(((await res.json()) as IvHistory).rank?.rank).toBe(100);
    expect((await t.request("/v1/market/iv?asset=XAUT")).status).toBe(503);
    expect((await t.request("/v1/market/iv?asset=DOGE")).status).toBe(400);
    // the routes read with the real clock, so the exact window is checked through markHistory with the test clock
    const m = (await (await t.request("/v1/market/marks/C-BTC-80000-250926?hours=24")).json()) as MarkHistory;
    expect(m.symbol).toBe("C-BTC-80000-250926");
    expect(m.points[0]).toMatchObject({ mark: 800 });
    const last24 = await markHistory(t.db, "C-BTC-80000-250926", 24, now);
    expect(last24.points).toHaveLength(2); // the two snapshots of the last day
    expect(last24.points.map((p) => p.markIv)).toEqual([0.4 - 0.2 + 0.4 + 0.1, 0.4 + 0.4 + 0.1].map((v) => Number(String(v))));
    expect((await (await t.request("/v1/market/marks/NOPE")).json()) as MarkHistory).toMatchObject({ points: [] });
    expect((await t.request("/v1/market/marks/NOPE?hours=0")).status).toBe(400);
    // marks keep seven days (ADR-056): the last run's retention leaves day 33's second snapshot and days 34..40
    const mh = await markHistory(t.db, "C-BTC-80000-250926", 24 * 41, now);
    expect(mh.points.length).toBe(15);
  });

  it("drops IV rows older than 400 days and marks older than 7 days on each run", async () => {
    const far = T0 + 500 * DAY;
    await snapshotOnce(t.deps, sourceFor(500), () => far);
    const [iv] = await t.db.select({ n: count() }).from(ivSnapshots);
    const [mk] = await t.db.select({ n: count() }).from(instrumentMarks);
    expect(iv!.n).toBe(3); // only the new run survives (BTC × 2 expiries + ETH)
    expect(mk!.n).toBe(6);
  });

  it("startIvSnapshotter runs at once and again on the interval without overlapping", async () => {
    let calls = 0;
    const src: MarketSource = { products: () => Promise.resolve([]), tickers: () => { calls += 1; return Promise.resolve([]); } };
    const stop = startIvSnapshotter(t.deps, src, 30);
    await new Promise((r) => setTimeout(r, 100));
    stop();
    const seen = calls;
    expect(seen).toBeGreaterThanOrEqual(3); // 3 underlyings on the first run
    await new Promise((r) => setTimeout(r, 60));
    expect(calls).toBe(seen);
  });
});

describe("ADR-056 schema helpers", () => {
  it("ivRankOf, realisedVolOf and the label", () => {
    expect(ivRankOf([0.4], 0.4)).toBeNull();
    const mid = ivRankOf([0.4, 0.6, 0.8], 0.6)!;
    expect(mid.rank).toBeCloseTo(50, 9);
    expect(mid).toMatchObject({ percentile: (2 / 3) * 100, low: 0.4, high: 0.8, days: 3 });
    expect(ivRankOf([0.5, 0.5], 0.5)).toMatchObject({ rank: 50, percentile: 100 });
    expect(ivRankOf([0.4, 0.8], 0.2)).toMatchObject({ rank: 0, percentile: 0 });
    expect(realisedVolOf([100])).toBeNull();
    expect(realisedVolOf([100, 110])).toEqual({ rv: 0, days: 2 });
    const rv = realisedVolOf([100, 102, 99, 103, 101])!;
    expect(rv.days).toBe(5);
    expect(rv.rv).toBeGreaterThan(0.2);
    expect(realisedVolOf([100, 100, 100])).toEqual({ rv: 0, days: 3 });
    expect(ivRankLabel(10)).toMatch(/^Low/);
    expect(ivRankLabel(30)).toMatch(/^Below/);
    expect(ivRankLabel(60)).toMatch(/^Above/);
    expect(ivRankLabel(90)).toMatch(/^High/);
  });
});
