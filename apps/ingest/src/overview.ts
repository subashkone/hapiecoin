/**
 * The `overview` dataset (HC-MA-012..020, 030..036): folds the per-symbol snapshots already in the store plus
 * liquidations, Fear & Greed and markets into the one payload the Markets Hub and Futures overview read. It never
 * calls a provider itself, so it can run every refresh cheaply; a missing input simply leaves its field null.
 */
import { type AnalyticsSnapshot, AnalyticsSnapshot as SnapshotSchema, type MarketRow, type OverviewData, type OverviewSymbol, type SeriesPoint, analyticsKey } from "@hapiecoin/schema";
import { sumSeries } from "./jobs.js";
import type { SnapshotStore } from "./store.js";

const FIVE_MIN = 5 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const latest = (pts: readonly SeriesPoint[]): number | null => pts[pts.length - 1]?.v ?? null;

async function read<D extends AnalyticsSnapshot["dataset"]>(store: SnapshotStore, dataset: D, key: string): Promise<Extract<AnalyticsSnapshot, { dataset: D }> | null> {
  const s = await store.get(key);
  return s && s.dataset === dataset ? (s as Extract<AnalyticsSnapshot, { dataset: D }>) : null;
}

export async function buildOverview(store: SnapshotStore, symbols: readonly string[], now: () => number, ttlMs: number): Promise<AnalyticsSnapshot> {
  const [liq, fng, markets, btcLs] = await Promise.all([read(store, "liquidations", analyticsKey("liquidations")), read(store, "fear-greed", analyticsKey("fear-greed")), read(store, "markets", analyticsKey("markets")), read(store, "long-short", analyticsKey("long-short", "BTC"))]);
  const rows: OverviewSymbol[] = [];
  const histories: { points: SeriesPoint[] }[] = [];
  const sources = new Set<string>();
  for (const symbol of symbols) {
    const [oi, funding, ls] = await Promise.all([read(store, "open-interest", analyticsKey("open-interest", symbol)), read(store, "funding", analyticsKey("funding", symbol)), read(store, "long-short", analyticsKey("long-short", symbol))]);
    if (!oi) continue;
    oi.source.split(" · ").forEach((s) => sources.add(s));
    histories.push({ points: oi.data.aggregated });
    const bySymbol = liq?.data.bySymbol.find((b) => b.symbol === symbol.toUpperCase());
    const weighted = (): number | null => {
      const num = oi.data.venues.reduce((s, v) => s + v.oiUsd * (v.change24h ?? 0), 0);
      const den = oi.data.venues.reduce((s, v) => s + v.oiUsd, 0);
      return den > 0 ? num / den : null;
    };
    const change1h = (): number | null => {
      let num = 0;
      let den = 0;
      for (const v of oi.data.venues) {
        if (v.change1h === null) continue;
        num += v.oiUsd * v.change1h;
        den += v.oiUsd;
      }
      return den > 0 ? num / den : null;
    };
    rows.push({
      symbol: symbol.toUpperCase(),
      oiUsd: oi.data.totalUsd,
      oiChange1h: change1h(),
      oiChange24h: oi.data.venues.some((v) => v.change24h !== null) ? weighted() : null,
      funding: funding ? latest(funding.data.oiWeighted) : null,
      lsRatio: ls ? ls.data.latest.global.ratio : null,
      liq24hUsd: bySymbol ? bySymbol.longUsd + bySymbol.shortUsd : 0,
      venues: oi.data.venues.length,
    });
  }
  const oiHistory = sumSeries(histories, FIVE_MIN);
  const totalOiUsd = rows.reduce((s, r) => s + r.oiUsd, 0);
  const dayAgo = [...oiHistory].reverse().find((p) => p.t <= now() - DAY);
  const last = oiHistory.at(-1);
  const oiChange24h = dayAgo && last && dayAgo.v > 0 ? last.v / dayAgo.v - 1 : null;
  const marketRows = markets?.data.rows ?? [];
  const find = (sym: string) => marketRows.find((r) => r.symbol === sym) ?? null;
  const withChange = (r: MarketRow): r is MarketRow & { change24h: number } => r.change24h !== null;
  const withCap = (r: MarketRow): r is MarketRow & { marketCap: number } => r.marketCap !== null;
  const byChange = marketRows.filter(withChange).sort((a, b) => b.change24h - a.change24h);
  const data: OverviewData = {
    symbols: rows,
    totalOiUsd,
    oiChange24h,
    liquidations24h: liq ? { longUsd: liq.data.total.longUsd, shortUsd: liq.data.total.shortUsd } : { longUsd: 0, shortUsd: 0 },
    fearGreed: fng ? fng.data.latest : null,
    btcLongShort: btcLs ? btcLs.data.latest.global : null,
    markets: markets
      ? {
          btcPrice: find("BTC")?.price ?? null,
          btcChange24h: find("BTC")?.change24h ?? null,
          ethPrice: find("ETH")?.price ?? null,
          ethChange24h: find("ETH")?.change24h ?? null,
          btcDominance: markets.data.global.btcDominance,
          ethDominance: markets.data.global.ethDominance,
          totalMarketCap: markets.data.global.totalMarketCap,
          volume24h: markets.data.global.volume24h,
          gainers: byChange.slice(0, 8),
          losers: byChange.slice(-8).reverse(),
          heatmap: marketRows
            .filter(withCap)
            .sort((a, b) => b.marketCap - a.marketCap)
            .slice(0, 24)
            .map((r) => ({ symbol: r.symbol, marketCap: r.marketCap, change24h: r.change24h })),
        }
      : null,
    oiHistory,
    lsHistory: btcLs?.data.global ?? [],
    fearGreedHistory: (fng?.data.points ?? []).slice(-365),
  };
  if (liq && liq.source !== "no venue connected") liq.source.split(" · ").forEach((s) => sources.add(s));
  if (fng) sources.add("alternative.me");
  if (markets) sources.add("CoinGecko");
  const stale = [liq, fng, markets, btcLs].some((s) => s?.stale) || rows.length === 0;
  const snapshot: AnalyticsSnapshot = { dataset: "overview", key: analyticsKey("overview"), source: [...sources].join(" · ") || "no data yet", asOf: now(), ttlMs, stale, data };
  const out = SnapshotSchema.safeParse(snapshot);
  if (!out.success) throw new Error(`overview snapshot failed validation: ${out.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return out.data;
}
