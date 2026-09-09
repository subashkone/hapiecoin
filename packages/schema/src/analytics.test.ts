// Analytics dataset schemas (ADR-038): keys, envelopes, labels and the funding APR helper.
import { describe, expect, it } from "vitest";
import { ANALYTICS_DATASETS, AnalyticsSnapshot, AnalyticsSymbol, FearGreedSnapshot, FundingSnapshot, LiquidationsData, MarketRow, OverviewSnapshot, SYMBOL_DATASETS, analyticsKey, fearGreedLabel, fundingApr } from "./analytics.js";

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
