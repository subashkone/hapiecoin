// Market history shapes and helpers (ADR-056): IV rank / percentile, realised vol from closes, the rank label, and
// the strict objects the API returns.
import { describe, expect, it } from "vitest";
import { IvHistory, IvPoint, MarkHistory, ivRankLabel, ivRankOf, realisedVolOf } from "./market-history.js";

describe("HC-WS-096 ivRankOf", () => {
  it("needs two points, ranks between the low and the high, counts the percentile at or below", () => {
    expect(ivRankOf([], 0.4)).toBeNull();
    expect(ivRankOf([0.4], 0.4)).toBeNull();
    const mid = ivRankOf([0.4, 0.6, 0.8], 0.6)!;
    expect(mid.rank).toBeCloseTo(50, 9);
    expect(mid).toMatchObject({ percentile: (2 / 3) * 100, low: 0.4, high: 0.8, days: 3 });
    expect(ivRankOf([0.4, 0.8], 0.9)).toMatchObject({ rank: 100, percentile: 100 });
    expect(ivRankOf([0.4, 0.8], 0.2)).toMatchObject({ rank: 0, percentile: 0 });
    // a flat year reads mid-range rather than dividing by zero
    expect(ivRankOf([0.5, 0.5, 0.5], 0.5)).toMatchObject({ rank: 50, percentile: 100, low: 0.5, high: 0.5 });
  });
});

describe("HC-WS-097 realisedVolOf", () => {
  it("annualises the sample stdev of log returns; degenerate inputs read null or zero", () => {
    expect(realisedVolOf([])).toBeNull();
    expect(realisedVolOf([100])).toBeNull();
    expect(realisedVolOf([100, 110])).toEqual({ rv: 0, days: 2 });
    expect(realisedVolOf([100, 100, 100])).toEqual({ rv: 0, days: 3 });
    // closes at or below zero are skipped; two valid returns remain
    expect(realisedVolOf([100, 0, 100, 102, 99])).toMatchObject({ days: 5 });
    expect(realisedVolOf([100, -5])).toBeNull();
    const up = realisedVolOf([100, 102, 99, 103, 101])!;
    // log returns ≈ +1.98 %, −2.99 %, +3.96 %, −1.96 %: sample stdev ≈ 3.2 % a day → ≈ 61 % a year
    expect(up.rv).toBeGreaterThan(0.55);
    expect(up.rv).toBeLessThan(0.7);
  });
});

describe("ivRankLabel", () => {
  it("names the four bands", () => {
    expect(ivRankLabel(0)).toMatch(/^Low/);
    expect(ivRankLabel(19.9)).toMatch(/^Low/);
    expect(ivRankLabel(20)).toMatch(/^Below/);
    expect(ivRankLabel(50)).toMatch(/^Above/);
    expect(ivRankLabel(80)).toMatch(/^High/);
    expect(ivRankLabel(100)).toMatch(/^High/);
  });
});

describe("shapes", () => {
  const point = { day: "2026-09-10", atmIv: 0.42, spot: 79_521.5, expiry: "2026-09-25" };
  it("IvPoint, IvHistory and MarkHistory are strict", () => {
    expect(IvPoint.safeParse(point).success).toBe(true);
    expect(IvPoint.safeParse({ ...point, spot: 0 }).success).toBe(false);
    expect(IvPoint.safeParse({ ...point, extra: 1 }).success).toBe(false);
    const history = {
      asset: "BTC",
      venue: "delta_india",
      asOf: "2026-09-10T06:00:00.000Z",
      current: { atmIv: 0.42, spot: 79_521.5, expiry: "2026-09-25", ts: "2026-09-10T06:00:00.000Z" },
      rank: { rank: 55, percentile: 60, low: 0.3, high: 0.6, days: 120 },
      realised: { rv30: 0.35, days: 30, spread: 0.07 },
      spot24h: { high: 80_000, low: 79_000 },
      series: [point],
    };
    expect(IvHistory.safeParse(history).success).toBe(true);
    expect(IvHistory.safeParse({ ...history, current: null, rank: null, realised: null, spot24h: null, series: [] }).success).toBe(true);
    expect(IvHistory.safeParse({ ...history, rank: { ...history.rank, rank: 101 } }).success).toBe(false);
    expect(IvHistory.safeParse({ ...history, asset: "DOGE" }).success).toBe(false);
    expect(MarkHistory.safeParse({ symbol: "C-BTC-80000-250926", venue: "delta_india", hours: 24, points: [{ ts: "2026-09-10T06:00:00.000Z", mark: 1200.5, markIv: null }] }).success).toBe(true);
    expect(MarkHistory.safeParse({ symbol: "", venue: "delta_india", hours: 24, points: [] }).success).toBe(false);
  });
});
