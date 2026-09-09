import type { AnalyticsSnapshot } from "@hapiecoin/schema";
import { describe, expect, it } from "vitest";
import { buildOverview } from "./overview.js";
import { MemoryStore } from "./store.js";
import { T0 } from "./test-support/fixtures.js";

const env = (s: Omit<AnalyticsSnapshot, "asOf" | "ttlMs" | "stale">, stale = false): AnalyticsSnapshot => ({ ...s, asOf: T0, ttlMs: 60_000, stale }) as AnalyticsSnapshot;
const oi = (symbol: string, total: number, change24h: number | null, change1h: number | null): AnalyticsSnapshot =>
  env({ dataset: "open-interest", key: `open-interest:${symbol}`, source: "Binance · OKX", data: { symbol, venues: [{ venue: "binance", oiUsd: total * 0.75, oiBase: null, change1h, change24h }, { venue: "okx", oiUsd: total * 0.25, oiBase: null, change1h: null, change24h: null }], totalUsd: total, history: [], aggregated: [{ t: T0 - 25 * 3_600_000, v: total * 0.9 }, { t: T0 - 300_000, v: total }] } });

describe("[INGEST] overview", () => {
  it("folds per-symbol snapshots, liquidations, fear & greed, BTC long/short and markets into one payload", async () => {
    const store = new MemoryStore(() => T0);
    await store.set(oi("BTC", 8e9, 0.02, 0.005), 1e6);
    await store.set(oi("ETH", 3e9, null, null), 1e6);
    await store.set(env({ dataset: "funding", key: "funding:BTC", source: "Binance", data: { symbol: "BTC", venues: [], history: [], oiWeighted: [{ t: 1, v: 0.0001 }, { t: 2, v: 0.0002 }] } }), 1e6);
    await store.set(env({ dataset: "long-short", key: "long-short:BTC", source: "Binance", data: { symbol: "BTC", venue: "binance", period: "1h", global: [{ t: 1, v: 1.2 }], topAccounts: [], topPositions: [], latest: { global: { long: 0.55, short: 0.45, ratio: 1.2 }, topAccounts: { long: 0, short: 0, ratio: 0 }, topPositions: { long: 0, short: 0, ratio: 0 } } } }), 1e6);
    await store.set(env({ dataset: "liquidations", key: "liquidations:-", source: "Binance · OKX", data: { windowMs: 1, bucketMs: 1, buckets: [], byVenue: [], bySymbol: [{ symbol: "BTC", longUsd: 100, shortUsd: 50 }], total: { longUsd: 100, shortUsd: 50 }, recent: [] } }), 1e6);
    await store.set(env({ dataset: "fear-greed", key: "fear-greed:-", source: "alternative.me", data: { points: Array.from({ length: 400 }, (_, i) => ({ t: i, v: 40 })), latest: { value: 40, label: "Fear", at: 399 } } }, true), 1e6);
    const row = (symbol: string, price: number, change24h: number | null, marketCap: number | null) => ({ rank: 1, symbol, name: symbol, price, change1h: null, change24h, change7d: null, marketCap, volume24h: null, sparkline7d: [] });
    await store.set(env({ dataset: "markets", key: "markets:-", source: "CoinGecko", data: { rows: [row("BTC", 80000, 1.5, 1.6e12), row("ETH", 3000, -2, 3.6e11), row("SOL", 150, null, null)], global: { totalMarketCap: 2.9e12, volume24h: 9e10, btcDominance: 55, ethDominance: 12 } } }), 1e6);

    const s = await buildOverview(store, ["BTC", "ETH", "SOL"], () => T0, 60_000);
    if (s.dataset !== "overview") throw new Error("wrong dataset");
    expect(s.source).toBe("Binance · OKX · alternative.me · CoinGecko");
    expect(s.stale).toBe(true); // fear & greed was stale
    expect(s.data.symbols.map((x) => x.symbol)).toEqual(["BTC", "ETH"]); // SOL has no OI snapshot
    expect(s.data.symbols[0]).toEqual({ symbol: "BTC", oiUsd: 8e9, oiChange1h: 0.005, oiChange24h: 0.02 * 0.75, funding: 0.0002, lsRatio: 1.2, liq24hUsd: 150, venues: 2 });
    expect(s.data.symbols[1]).toMatchObject({ symbol: "ETH", oiChange1h: null, oiChange24h: null, funding: null, lsRatio: null, liq24hUsd: 0 });
    expect(s.data.totalOiUsd).toBe(1.1e10);
    expect(s.data.oiChange24h).toBeCloseTo(1.1e10 / (1.1e10 * 0.9) - 1, 9);
    expect(s.data.liquidations24h).toEqual({ longUsd: 100, shortUsd: 50 });
    expect(s.data.fearGreed).toEqual({ value: 40, label: "Fear", at: 399 });
    expect(s.data.fearGreedHistory).toHaveLength(365);
    expect(s.data.btcLongShort).toEqual({ long: 0.55, short: 0.45, ratio: 1.2 });
    expect(s.data.markets?.btcPrice).toBe(80000);
    expect(s.data.markets?.gainers.map((r) => r.symbol)).toEqual(["BTC", "ETH"]);
    expect(s.data.markets?.losers.map((r) => r.symbol)).toEqual(["ETH", "BTC"]);
    expect(s.data.markets?.heatmap.map((h) => h.symbol)).toEqual(["BTC", "ETH"]);
    expect(s.data.oiHistory.length).toBeGreaterThan(0);
    expect(s.data.lsHistory).toEqual([{ t: 1, v: 1.2 }]);
  });
  it("is stale with 'no data yet' when nothing has been ingested, and skips a liquidation source with no venue", async () => {
    const store = new MemoryStore(() => T0);
    const empty = await buildOverview(store, ["BTC"], () => T0, 1000);
    if (empty.dataset !== "overview") throw new Error("wrong dataset");
    expect(empty.stale).toBe(true);
    expect(empty.source).toBe("no data yet");
    expect(empty.data).toMatchObject({ symbols: [], totalOiUsd: 0, oiChange24h: null, fearGreed: null, btcLongShort: null, markets: null, liquidations24h: { longUsd: 0, shortUsd: 0 } });
    await store.set(env({ dataset: "liquidations", key: "liquidations:-", source: "no venue connected", data: { windowMs: 1, bucketMs: 1, buckets: [], byVenue: [], bySymbol: [], total: { longUsd: 0, shortUsd: 0 }, recent: [] } }, true), 1e6);
    const zeroOi = env({ dataset: "open-interest", key: "open-interest:BTC", source: "Bybit", data: { symbol: "BTC", venues: [{ venue: "bybit", oiUsd: 0, oiBase: null, change1h: 0.1, change24h: 0.1 }], totalUsd: 0, history: [], aggregated: [] } });
    await store.set(zeroOi, 1e6);
    const s = await buildOverview(store, ["BTC"], () => T0, 1000);
    if (s.dataset !== "overview") throw new Error("wrong dataset");
    expect(s.source).toBe("Bybit");
    expect(s.data.symbols[0]).toMatchObject({ oiChange1h: null, oiChange24h: null }); // zero OI → no weighted change
    expect(s.data.oiChange24h).toBeNull();
    await store.set(env({ dataset: "open-interest", key: "open-interest:BTC", source: "Bybit", data: { symbol: "BTC", venues: [], totalUsd: 0, history: [], aggregated: [] } }), 1e6);
    const noVenues = await buildOverview(store, ["BTC"], () => T0, 1000);
    expect(noVenues.dataset === "overview" && noVenues.data.symbols[0]?.oiChange24h).toBeNull();
  });
  it("fills null market fields when BTC/ETH are missing, skips rows without a cap in the heatmap, and rejects an invalid fold", async () => {
    const store = new MemoryStore(() => T0);
    await store.set(oi("SOL", 1e9, 0.1, 0.1), 1e6);
    await store.set(env({ dataset: "funding", key: "funding:SOL", source: "Binance", data: { symbol: "SOL", venues: [], history: [], oiWeighted: [] } }), 1e6); // empty weighted series → funding null
    const row = (symbol: string, marketCap: number | null) => ({ rank: 1, symbol, name: symbol, price: 1, change1h: null, change24h: 1, change7d: null, marketCap, volume24h: null, sparkline7d: [] });
    await store.set(env({ dataset: "markets", key: "markets:-", source: "CoinGecko", data: { rows: [row("SOL", 1e9), row("XYZ", null)], global: { totalMarketCap: null, volume24h: null, btcDominance: null, ethDominance: null } } }), 1e6);
    const s = await buildOverview(store, ["SOL"], () => T0, 1000);
    if (s.dataset !== "overview") throw new Error("wrong dataset");
    expect(s.data.markets).toMatchObject({ btcPrice: null, btcChange24h: null, ethPrice: null, ethChange24h: null });
    expect(s.data.symbols[0]?.funding).toBeNull();
    expect(s.data.markets?.heatmap).toEqual([{ symbol: "SOL", marketCap: 1e9, change24h: 1 }]);
    await store.set(env({ dataset: "fear-greed", key: "fear-greed:-", source: "alternative.me", data: { points: [], latest: { value: 101, label: "?", at: 1 } } }), 1e6);
    await expect(buildOverview(store, ["SOL"], () => T0, 1000)).rejects.toThrow(/failed validation/);
  });
});
