// Derived series for the PR 5.3 pages (HC-MA-041..048, 060..066, 084..087): alignment, liquidation windows, heatmap
// bands, funding arbitrage and the small formatters.
import type { LiquidationEvent } from "@hapiecoin/schema";
import { describe, expect, it } from "vitest";
import { alignTo, arbRows, binEvents, liqHeatmap, liqWindow, longShare, nextFundingIn, sparklineSeries, takerVolume24h, venueLabel } from "./derive";

const H = 3600e3;
const ev = (t: number, symbol: string, side: "long" | "short", price: number, usd: number, venue: LiquidationEvent["venue"] = "binance"): LiquidationEvent => ({ t, venue, symbol, side, price, qty: usd / price, usd });

describe("derive", () => {
  it("stamps a sparkline and aligns a second series to a base grid", () => {
    expect(sparklineSeries([1, 2, 3], 10 * H)).toEqual([{ t: 8 * H, v: 1 }, { t: 9 * H, v: 2 }, { t: 10 * H, v: 3 }]);
    const base = [{ t: 0, v: 0 }, { t: H, v: 0 }, { t: 2 * H, v: 0 }, { t: 10 * H, v: 0 }];
    expect(alignTo(base, [{ t: 0.5 * H, v: 5 }, { t: 2.2 * H, v: 7 }])).toEqual([5, 5, 7, null]);
    expect(alignTo(base, [])).toEqual([null, null, null, null]);
    expect(venueLabel("okx")).toBe("OKX");
    expect(venueLabel("other")).toBe("other");
  });
  it("bins events, picks buckets or events per window and flags a short buffer", () => {
    const now = 100 * H;
    const events = [ev(now - 10 * 60e3, "BTC", "long", 100, 10), ev(now - 20 * 60e3, "ETH", "short", 10, 5), ev(now - 3 * H, "BTC", "long", 100, 99), ev(now + 60e3, "BTC", "long", 100, 1)];
    const bins = binEvents(events, now - H, now, 5 * 60e3);
    expect(bins).toHaveLength(13);
    expect(bins.reduce((s, b) => s + b.longUsd, 0)).toBe(10);
    expect(bins.reduce((s, b) => s + b.shortUsd, 0)).toBe(5);
    expect(binEvents(events, now - H, now, 5 * 60e3, "BTC").reduce((s, b) => s + b.shortUsd, 0)).toBe(0);
    const buckets = [];
    for (let k = 24; k >= 0; k--) buckets.push({ t: now - k * H, longUsd: 1, shortUsd: 2 });
    const day = liqWindow({ buckets, recent: events, bucketMs: H }, 24, now);
    expect(day.fromEvents).toBe(false);
    expect(day.points).toHaveLength(25);
    expect(liqWindow({ buckets, recent: events, bucketMs: H }, 12, now).points).toHaveLength(13);
    const hour = liqWindow({ buckets, recent: events, bucketMs: H }, 1, now);
    expect(hour).toMatchObject({ fromEvents: true, binMs: 5 * 60e3, capped: false });
    const four = liqWindow({ buckets, recent: events.slice(0, 2), bucketMs: H }, 4, now);
    expect(four).toMatchObject({ fromEvents: true, binMs: 15 * 60e3, capped: true });
    expect(liqWindow({ buckets, recent: [], bucketMs: H }, 4, now).capped).toBe(false);
  });
  it("places captured liquidations on the price-band × hour grid", () => {
    const now = 50 * H + 30 * 60e3;
    const events = [ev(now - 60e3, "BTC", "short", 101.5, 10), ev(now - 60e3, "BTC", "long", 99.5, 20), ev(now - 60e3, "BTC", "long", 90, 5), ev(now - 60e3, "ETH", "long", 99.5, 7), ev(now - 13 * H, "BTC", "long", 99.5, 7), ev(now + H, "BTC", "long", 99.5, 7)];
    const g = liqHeatmap(events, "BTC", 100, now);
    expect(g.rows.map((r) => r.band)).toEqual([5, 4, 3, 2, 1, -1, -2, -3, -4, -5]);
    expect(g.hours).toHaveLength(12);
    expect(g.count).toBe(3);
    expect(g.max).toBe(20);
    expect(g.rows.find((r) => r.band === 2)?.cells[11]).toBe(10);
    expect(g.rows.find((r) => r.band === -1)?.cells[11]).toBe(20);
    expect(g.rows.find((r) => r.band === -5)?.cells[11]).toBe(5);
    expect(liqHeatmap(events, "BTC", 0, now).count).toBe(0);
  });
  it("builds the funding arbitrage rows and the small formatters", () => {
    const v = (venue: "binance" | "bybit" | "okx", rate: number, oiUsd: number | null) => ({ venue, rate, predicted: null, nextFundingAt: null, apr: rate * 3 * 365, oiUsd });
    const rows = arbRows([
      { symbol: "BTC", venues: [v("binance", 0.0003, 100), v("bybit", 0.0001, 50), v("okx", 0.0002, null)], history: [], oiWeighted: [] },
      { symbol: "ONE", venues: [v("binance", 0.0003, 100)], history: [], oiWeighted: [] },
      { symbol: "ETH", venues: [v("binance", 0.0001, null), v("okx", 0.0006, null)], history: [], oiWeighted: [] },
    ]);
    expect(rows.map((r) => r.symbol)).toEqual(["ETH", "BTC"]);
    expect(rows[1]).toMatchObject({ longLeg: "bybit", shortLeg: "binance", longRate: 0.0001, shortRate: 0.0003, minOi: 50 });
    expect(rows[1]?.spread).toBeCloseTo(0.0002, 10);
    expect(rows[1]?.estApr).toBeCloseTo(0.219, 6);
    expect(rows[0]?.minOi).toBeNull();
    expect(nextFundingIn(null)).toBe("—");
    expect(nextFundingIn(1000, 2000)).toBe("due");
    expect(nextFundingIn(65 * 60e3, 0)).toBe("1h 05m");
    expect(longShare(1)).toBe(50);
    expect(takerVolume24h([])).toBeNull();
    expect(takerVolume24h([{ buy: 1, sell: 2 }, { buy: 3, sell: 4 }], 1)).toBe(7);
  });
});
