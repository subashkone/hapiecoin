// Deterministic analytics snapshots for unit tests and Playwright (ADR-038): the same shapes the ingest service
// writes, generated from a seeded random walk so charts and tables have realistic, stable data.
import { type AnalyticsDataset, type AnalyticsSnapshot, type MarketRow, type OverviewData, type SeriesPoint, analyticsKey, fearGreedLabel } from "@hapiecoin/schema";

const NOW = Date.UTC(2026, 8, 9, 9, 0, 0);
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function walk(seed: number, n: number, stepMs: number, start: number, vol: number, min = 0): SeriesPoint[] {
  const r = rng(seed);
  const out: SeriesPoint[] = [];
  let v = start;
  for (let i = n - 1; i >= 0; i--) {
    out.push({ t: NOW - i * stepMs, v: Math.max(min, v) });
    v = v * (1 + (r() - 0.5) * vol);
  }
  return out;
}
const COINS: [string, string, number, number][] = [["BTC", "Bitcoin", 80_000, 1.6e12], ["ETH", "Ethereum", 3_000, 3.6e11], ["SOL", "Solana", 150, 7e10], ["XRP", "XRP", 0.55, 3e10], ["BNB", "BNB", 600, 8.7e10], ["DOGE", "Dogecoin", 0.12, 1.7e10], ["ADA", "Cardano", 0.4, 1.4e10], ["AVAX", "Avalanche", 30, 1.2e10], ["LINK", "Chainlink", 14, 8e9], ["LTC", "Litecoin", 70, 5e9]];

export function mockMarketRows(): MarketRow[] {
  return COINS.map(([symbol, name, price, cap], i) => {
    const r = rng(100 + i);
    const c24 = (r() - 0.45) * 8;
    return { rank: i + 1, symbol, name, price, change1h: (r() - 0.5) * 1.5, change24h: Number(c24.toFixed(2)), change7d: (r() - 0.4) * 20, marketCap: cap, volume24h: cap * 0.03, sparkline7d: walk(200 + i, 40, 4.2 * 3600e3, price, 0.02).map((p) => p.v) };
  });
}

function envelope<D extends AnalyticsDataset>(dataset: D, key: string, source: string, data: Extract<AnalyticsSnapshot, { dataset: D }>["data"], ttlMs = 60_000): AnalyticsSnapshot {
  return { dataset, key, source, asOf: NOW - 20_000, ttlMs, stale: false, data } as AnalyticsSnapshot;
}

export function mockOverview(): OverviewData {
  const rows = mockMarketRows();
  const symbols = COINS.map(([symbol], i) => {
    const r = rng(300 + i);
    const oiUsd = [8.4e9, 3.1e9, 9e8, 6e8, 5e8, 4e8, 3e8, 2.5e8, 2e8, 1.5e8][i]!;
    return { symbol, oiUsd, oiChange1h: (r() - 0.5) * 0.02, oiChange24h: (r() - 0.45) * 0.1, funding: (r() - 0.4) * 0.0003, lsRatio: 0.8 + r() * 0.8, liq24hUsd: oiUsd * 0.02, venues: 3 };
  });
  const totalOiUsd = symbols.reduce((s, x) => s + x.oiUsd, 0);
  const oiHistory = walk(1, 288, 5 * 60e3, totalOiUsd * 0.97, 0.004);
  const fg = walk(2, 365, 864e5, 50, 0.08, 1).map((p) => ({ t: p.t, v: Math.max(0, Math.min(100, Math.round(p.v))) }));
  const fgNow = fg[fg.length - 1]!;
  const byChange = [...rows].sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0));
  return {
    symbols,
    totalOiUsd,
    oiChange24h: 0.0234,
    liquidations24h: { longUsd: 1.987e8, shortUsd: 2.4e7 },
    fearGreed: { value: fgNow.v, label: fearGreedLabel(fgNow.v), at: fgNow.t },
    btcLongShort: { long: 0.5263, short: 0.4737, ratio: 1.11 },
    markets: { btcPrice: 80_000, btcChange24h: rows[0]!.change24h, ethPrice: 3_000, ethChange24h: rows[1]!.change24h, btcDominance: 55.1, ethDominance: 12.4, totalMarketCap: 2.9e12, volume24h: 9e10, gainers: byChange.slice(0, 8), losers: byChange.slice(-8).reverse(), heatmap: rows.map((r) => ({ symbol: r.symbol, marketCap: r.marketCap ?? 0, change24h: r.change24h })) },
    oiHistory,
    lsHistory: walk(3, 168, 3600e3, 1.1, 0.03, 0.3),
    fearGreedHistory: fg,
  };
}

/** Every snapshot keyed the way the API serves them; `symbol` datasets use BTC only. */
export function mockAnalyticsSnapshots(): Map<string, AnalyticsSnapshot> {
  const map = new Map<string, AnalyticsSnapshot>();
  map.set(analyticsKey("overview"), envelope("overview", analyticsKey("overview"), "Binance · Bybit · OKX · alternative.me · CoinGecko", mockOverview()));
  map.set(analyticsKey("markets"), envelope("markets", analyticsKey("markets"), "CoinGecko", { rows: mockMarketRows(), global: { totalMarketCap: 2.9e12, volume24h: 9e10, btcDominance: 55.1, ethDominance: 12.4 } }, 600_000));
  const fg = mockOverview().fearGreedHistory;
  const last = fg[fg.length - 1]!;
  map.set(analyticsKey("fear-greed"), envelope("fear-greed", analyticsKey("fear-greed"), "alternative.me", { points: fg, latest: { value: last.v, label: fearGreedLabel(last.v), at: last.t } }, 3_600_000));
  return map;
}
