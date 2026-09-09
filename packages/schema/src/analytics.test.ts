// Analytics dataset schemas (ADR-038): keys, envelopes, labels and the funding APR helper.
import { describe, expect, it } from "vitest";
import { ANALYTICS_DATASETS, AnalyticsSnapshot, AnalyticsSymbol, CycleSnapshot, FearGreedSnapshot, FundingSnapshot, LiquidationsData, MarketRow, OptionsSnapshot, OverviewSnapshot, PremiumSnapshot, RAINBOW_MULTIPLIERS, RsiSnapshot, SYMBOL_DATASETS, analyticsKey, fearGreedLabel, fundingApr, logLinearFit, maxPain, rainbowBand, rsi, sma } from "./analytics.js";

describe("[SCHEMA] analytics maths (PR 5.4a)", () => {
  it("finds max pain, computes Wilder RSI, SMA and the log-linear fit, and names rainbow bands", () => {
    // holders lose most at 100: calls above 100 and puts below 100 both expire worthless
    expect(maxPain([{ strike: 90, type: "put", oi: 1 }, { strike: 100, type: "call", oi: 2 }, { strike: 100, type: "put", oi: 2 }, { strike: 110, type: "call", oi: 1 }])).toBe(100);
    expect(maxPain([])).toBeNull();
    expect(rsi([1, 2, 3], 14)).toBeNull();
    expect(rsi(Array.from({ length: 20 }, (_, i) => 100 + i), 14)).toBe(100); // only gains
    const mixed = rsi([44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64], 14);
    expect(mixed).toBeGreaterThan(50);
    expect(mixed).toBeLessThan(100);
    expect(sma([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
    const fit = logLinearFit([1, Math.E, Math.E ** 2]);
    expect(fit[1]).toBeCloseTo(Math.E, 9);
    expect(logLinearFit([])).toEqual([]);
    expect(logLinearFit([7])).toEqual([7]);
    expect(rainbowBand(1, 1)).toBe(2); // ratio 1 sits in the 0.8..1.1 band (index 2)
    expect(rainbowBand(100, 1)).toBe(RAINBOW_MULTIPLIERS.length - 2);
    expect(rainbowBand(0.1, 1)).toBe(0);
  });
  it("accepts the options, cycle, rsi and premium envelopes", () => {
    const base = { source: "x", asOf: 1_788_900_000_000, ttlMs: 60_000, stale: false };
    expect(OptionsSnapshot.safeParse({ ...base, dataset: "options", key: "options:BTC", data: { symbol: "BTC", venues: [{ venue: "deribit", oiBase: 1, oiUsd: 80000, volume24hUsd: 5, putCallOi: 0.5, underlyingPrice: 80000, instruments: 2, expiries: [{ expiry: 1, label: "25SEP26", callOi: 1, putOi: 0.5, maxPain: 80000, strikes: 2 }] }] } }).success).toBe(true);
    expect(CycleSnapshot.safeParse({ ...base, dataset: "cycle", key: "cycle:-", data: { symbol: "BTC", points: [{ t: 1, close: 1, ma111: null, ma350x2: null, ma2y: null, ma2yX5: null, fit: 1 }], rainbowMultipliers: [...RAINBOW_MULTIPLIERS], rainbowNames: ["a"], windowDays: 1000 } }).success).toBe(true);
    expect(RsiSnapshot.safeParse({ ...base, dataset: "rsi", key: "rsi:-", data: { period: 14, rows: [{ symbol: "BTC", price: 1, rsi: { "15m": 50, "1h": null } }] } }).success).toBe(true);
    expect(PremiumSnapshot.safeParse({ ...base, dataset: "premium", key: "premium:-", data: { symbol: "BTC", coinbaseUsd: 80001, binanceUsd: 80000, premiumUsd: 1, premiumPct: 0.0000125, points: [{ t: 1, v: 1 }] } }).success).toBe(true);
    expect(analyticsKey("options", "eth")).toBe("options:ETH");
    expect(analyticsKey("rsi")).toBe("rsi:-");
  });
});

describe("[SCHEMA] analytics keys", () => {
  it("keys per-symbol datasets by upper-cased symbol and the rest by '-'", () => {
    expect(analyticsKey("funding", "btc")).toBe("funding:BTC");
    expect(analyticsKey("open-interest", "ETH")).toBe("open-interest:ETH");
    expect(analyticsKey("markets", "BTC")).toBe("markets:-");
    expect(analyticsKey("fear-greed")).toBe("fear-greed:-");
    expect(analyticsKey("funding")).toBe("funding:");
    for (const d of ANALYTICS_DATASETS) expect(typeof SYMBOL_DATASETS.has(d)).toBe("boolean");
  });
  it("validates symbols", () => {
    expect(AnalyticsSymbol.safeParse("BTC").success).toBe(true);
    expect(AnalyticsSymbol.safeParse("1000PEPE").success).toBe(true);
    expect(AnalyticsSymbol.safeParse("btc").success).toBe(false);
    expect(AnalyticsSymbol.safeParse("B").success).toBe(false);
  });
});

describe("[SCHEMA] analytics envelopes", () => {
  const base = { key: "funding:BTC", source: "Binance · Bybit · OKX", asOf: 1_788_900_000_000, ttlMs: 60_000, stale: false };
  it("accepts a funding snapshot and rejects an unknown field or a wrong dataset literal", () => {
    const snap = { ...base, dataset: "funding", data: { symbol: "BTC", venues: [{ venue: "binance", rate: 0.0001, predicted: null, nextFundingAt: null, apr: fundingApr(0.0001), oiUsd: 1e9 }], history: [{ venue: "binance", points: [{ t: 1, v: 0.0001 }] }], oiWeighted: [{ t: 1, v: 0.0001 }] } };
    expect(FundingSnapshot.safeParse(snap).success).toBe(true);
    expect(AnalyticsSnapshot.safeParse(snap).success).toBe(true);
    expect(AnalyticsSnapshot.safeParse({ ...snap, dataset: "markets" }).success).toBe(false);
    expect(FundingSnapshot.safeParse({ ...snap, extra: 1 }).success).toBe(false);
  });
  it("accepts fear-greed and liquidations shapes", () => {
    expect(FearGreedSnapshot.safeParse({ ...base, key: "fear-greed:-", dataset: "fear-greed", data: { points: [{ t: 1, v: 40 }], latest: { value: 40, label: "Fear", at: 1 } } }).success).toBe(true);
    expect(LiquidationsData.safeParse({ windowMs: 86_400_000, bucketMs: 3_600_000, buckets: [{ t: 0, longUsd: 1, shortUsd: 2 }], byVenue: [{ venue: "okx", longUsd: 1, shortUsd: 2 }], bySymbol: [{ symbol: "BTC", longUsd: 1, shortUsd: 2 }], total: { longUsd: 1, shortUsd: 2 }, recent: [{ t: 1, venue: "binance", symbol: "BTC", side: "long", price: 100, qty: 1, usd: 100 }] }).success).toBe(true);
    expect(MarketRow.safeParse({ rank: 1, symbol: "BTC", name: "Bitcoin", price: 1, change1h: null, change24h: 0.1, change7d: null, marketCap: null, volume24h: null, sparkline7d: [] }).success).toBe(true);
    expect(analyticsKey("overview")).toBe("overview:-");
    expect(OverviewSnapshot.safeParse({ ...base, key: "overview:-", dataset: "overview", data: { symbols: [{ symbol: "BTC", oiUsd: 1, oiChange1h: null, oiChange24h: 0.1, funding: 0.0001, lsRatio: 1.2, liq24hUsd: 5, venues: 3 }], totalOiUsd: 1, oiChange24h: null, liquidations24h: { longUsd: 1, shortUsd: 2 }, fearGreed: null, btcLongShort: null, markets: null, oiHistory: [], lsHistory: [], fearGreedHistory: [] } }).success).toBe(true);
  });
  it("labels Fear & Greed bands and annualises funding", () => {
    expect([0, 24, 25, 44, 45, 55, 56, 75, 76, 100].map(fearGreedLabel)).toEqual(["Extreme Fear", "Extreme Fear", "Fear", "Fear", "Neutral", "Neutral", "Greed", "Greed", "Extreme Greed", "Extreme Greed"]);
    expect(fundingApr(0.0001)).toBeCloseTo(0.1095, 6);
  });
});
