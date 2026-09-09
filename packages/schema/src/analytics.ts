// Market Analytics datasets (Phase 5 item 5, ADR-038; docs/research/market-analytics-data-sources.md). The ingest
// service writes one Snapshot per dataset + key into Redis; the API serves it read-only at /v1/analytics/{dataset}.
// Every payload carries its source and an `asOf` stamp so the UI can say where a number came from and how old it is.
import { z } from "zod";

export const ANALYTICS_VENUES = ["binance", "bybit", "okx", "delta"] as const;
export const AnalyticsVenue = z.enum(ANALYTICS_VENUES);
export type AnalyticsVenue = z.infer<typeof AnalyticsVenue>;
export const ANALYTICS_VENUE_LABELS: Record<AnalyticsVenue, string> = { binance: "Binance", bybit: "Bybit", okx: "OKX", delta: "Delta India" };

export const ANALYTICS_DATASETS = ["funding", "open-interest", "long-short", "taker-volume", "liquidations", "markets", "fear-greed", "overview"] as const;
export const AnalyticsDataset = z.enum(ANALYTICS_DATASETS);
export type AnalyticsDataset = z.infer<typeof AnalyticsDataset>;

/** Base asset symbol as the venues quote it against USDT/USD ("BTC"). */
export const AnalyticsSymbol = z.string().regex(/^[A-Z0-9]{2,12}$/, "symbol must be 2–12 upper-case letters or digits");
export type AnalyticsSymbol = z.infer<typeof AnalyticsSymbol>;

/** Datasets keyed per symbol; the others have one snapshot ("-" key). */
export const SYMBOL_DATASETS: ReadonlySet<AnalyticsDataset> = new Set(["funding", "open-interest", "long-short", "taker-volume"]);
export function analyticsKey(dataset: AnalyticsDataset, symbol?: string | null): string {
  return `${dataset}:${SYMBOL_DATASETS.has(dataset) ? (symbol ?? "").toUpperCase() : "-"}`;
}

/** Milliseconds since epoch. */
export const Ms = z.number().int().nonnegative();
export const SeriesPoint = z.strictObject({ t: Ms, v: z.number() });
export type SeriesPoint = z.infer<typeof SeriesPoint>;
export const VenueSeries = z.strictObject({ venue: AnalyticsVenue, points: z.array(SeriesPoint) });
export type VenueSeries = z.infer<typeof VenueSeries>;

/** Funding per venue plus the OI-weighted series the charts draw (rates as decimal fractions per 8 h: 0.0001 = 0.01 %). */
export const FundingData = z.strictObject({
  symbol: AnalyticsSymbol,
  venues: z.array(
    z.strictObject({
      venue: AnalyticsVenue,
      rate: z.number(),
      predicted: z.number().nullable(),
      nextFundingAt: Ms.nullable(),
      /** rate × 3 × 365, as a decimal fraction. */
      apr: z.number(),
      /** Open interest in USD used for the weighting, null when the venue did not report it. */
      oiUsd: z.number().nullable(),
    }),
  ),
  history: z.array(VenueSeries),
  oiWeighted: z.array(SeriesPoint),
});
export type FundingData = z.infer<typeof FundingData>;

export const OpenInterestData = z.strictObject({
  symbol: AnalyticsSymbol,
  venues: z.array(z.strictObject({ venue: AnalyticsVenue, oiUsd: z.number(), oiBase: z.number().nullable(), change1h: z.number().nullable(), change24h: z.number().nullable() })),
  totalUsd: z.number(),
  /** Per-venue history in USD (5 m resolution, provider window). */
  history: z.array(VenueSeries),
  aggregated: z.array(SeriesPoint),
});
export type OpenInterestData = z.infer<typeof OpenInterestData>;

const Ratio = z.strictObject({ long: z.number(), short: z.number(), ratio: z.number() });
export const LongShortData = z.strictObject({
  symbol: AnalyticsSymbol,
  venue: AnalyticsVenue,
  period: z.enum(["5m", "15m", "1h", "4h", "1d"]),
  global: z.array(SeriesPoint),
  topAccounts: z.array(SeriesPoint),
  topPositions: z.array(SeriesPoint),
  latest: z.strictObject({ global: Ratio, topAccounts: Ratio, topPositions: Ratio }),
});
export type LongShortData = z.infer<typeof LongShortData>;

export const TakerVolumeData = z.strictObject({
  symbol: AnalyticsSymbol,
  venue: AnalyticsVenue,
  period: z.enum(["5m", "15m", "1h", "4h", "1d"]),
  points: z.array(z.strictObject({ t: Ms, buy: z.number(), sell: z.number() })),
});
export type TakerVolumeData = z.infer<typeof TakerVolumeData>;

export const LiquidationSide = z.enum(["long", "short"]);
export const LiquidationEvent = z.strictObject({ t: Ms, venue: AnalyticsVenue, symbol: AnalyticsSymbol, side: LiquidationSide, price: z.number(), qty: z.number(), usd: z.number() });
export type LiquidationEvent = z.infer<typeof LiquidationEvent>;
const LongShortUsd = z.strictObject({ longUsd: z.number(), shortUsd: z.number() });
export const LiquidationsData = z.strictObject({
  /** Rolling window the buckets and totals cover. */
  windowMs: z.number().int().positive(),
  bucketMs: z.number().int().positive(),
  buckets: z.array(LongShortUsd.extend({ t: Ms })),
  byVenue: z.array(LongShortUsd.extend({ venue: AnalyticsVenue })),
  bySymbol: z.array(LongShortUsd.extend({ symbol: AnalyticsSymbol })),
  total: LongShortUsd,
  /** Newest first, capped by the ingest service. */
  recent: z.array(LiquidationEvent),
});
export type LiquidationsData = z.infer<typeof LiquidationsData>;

export const MarketRow = z.strictObject({
  rank: z.number().int().positive(),
  symbol: AnalyticsSymbol,
  name: z.string(),
  price: z.number(),
  change1h: z.number().nullable(),
  change24h: z.number().nullable(),
  change7d: z.number().nullable(),
  marketCap: z.number().nullable(),
  volume24h: z.number().nullable(),
  sparkline7d: z.array(z.number()),
});
export type MarketRow = z.infer<typeof MarketRow>;
export const MarketsData = z.strictObject({
  rows: z.array(MarketRow),
  global: z.strictObject({ totalMarketCap: z.number().nullable(), volume24h: z.number().nullable(), btcDominance: z.number().nullable(), ethDominance: z.number().nullable() }),
});
export type MarketsData = z.infer<typeof MarketsData>;

export const FearGreedData = z.strictObject({
  points: z.array(SeriesPoint),
  latest: z.strictObject({ value: z.number().int().min(0).max(100), label: z.string(), at: Ms }),
});
export type FearGreedData = z.infer<typeof FearGreedData>;

/** One row per tracked symbol, folded from the per-symbol snapshots by the ingest service (the hub's Derivatives columns). */
export const OverviewSymbol = z.strictObject({
  symbol: AnalyticsSymbol,
  oiUsd: z.number(),
  oiChange1h: z.number().nullable(),
  oiChange24h: z.number().nullable(),
  /** Latest OI-weighted funding rate per 8 h, decimal fraction. */
  funding: z.number().nullable(),
  lsRatio: z.number().nullable(),
  liq24hUsd: z.number(),
  venues: z.number().int().nonnegative(),
});
export type OverviewSymbol = z.infer<typeof OverviewSymbol>;
/** Everything the Markets Hub and Futures overview tiles need in one read (HC-MA-012..020, 030..036). */
export const OverviewData = z.strictObject({
  symbols: z.array(OverviewSymbol),
  totalOiUsd: z.number(),
  oiChange24h: z.number().nullable(),
  liquidations24h: z.strictObject({ longUsd: z.number(), shortUsd: z.number() }),
  fearGreed: z.strictObject({ value: z.number().int().min(0).max(100), label: z.string(), at: Ms }).nullable(),
  btcLongShort: z.strictObject({ long: z.number(), short: z.number(), ratio: z.number() }).nullable(),
  /** From the markets dataset; null until CoinGecko is configured. */
  markets: z
    .strictObject({
      btcPrice: z.number().nullable(),
      btcChange24h: z.number().nullable(),
      ethPrice: z.number().nullable(),
      ethChange24h: z.number().nullable(),
      btcDominance: z.number().nullable(),
      ethDominance: z.number().nullable(),
      totalMarketCap: z.number().nullable(),
      volume24h: z.number().nullable(),
      gainers: z.array(MarketRow),
      losers: z.array(MarketRow),
      heatmap: z.array(z.strictObject({ symbol: AnalyticsSymbol, marketCap: z.number(), change24h: z.number().nullable() })),
    })
    .nullable(),
  /** Aggregated open interest across tracked symbols (5 m grid, provider window). */
  oiHistory: z.array(SeriesPoint),
  /** BTC global long/short ratio, hourly. */
  lsHistory: z.array(SeriesPoint),
  /** Daily Fear & Greed, last 365 points at most. */
  fearGreedHistory: z.array(SeriesPoint),
});
export type OverviewData = z.infer<typeof OverviewData>;

/** The envelope every dataset travels in. `stale` is set when the last refresh failed and the previous data is being served. */
function envelope<D extends AnalyticsDataset, T extends z.ZodType>(dataset: D, data: T) {
  return z.strictObject({
    dataset: z.literal(dataset),
    key: z.string(),
    /** Human-readable provenance, e.g. "Binance · Bybit · OKX". */
    source: z.string(),
    asOf: Ms,
    /** How long the reader may treat the payload as fresh. */
    ttlMs: z.number().int().positive(),
    stale: z.boolean(),
    data,
  });
}
export const FundingSnapshot = envelope("funding", FundingData);
export const OpenInterestSnapshot = envelope("open-interest", OpenInterestData);
export const LongShortSnapshot = envelope("long-short", LongShortData);
export const TakerVolumeSnapshot = envelope("taker-volume", TakerVolumeData);
export const LiquidationsSnapshot = envelope("liquidations", LiquidationsData);
export const MarketsSnapshot = envelope("markets", MarketsData);
export const FearGreedSnapshot = envelope("fear-greed", FearGreedData);
export const OverviewSnapshot = envelope("overview", OverviewData);
export const AnalyticsSnapshot = z.discriminatedUnion("dataset", [FundingSnapshot, OpenInterestSnapshot, LongShortSnapshot, TakerVolumeSnapshot, LiquidationsSnapshot, MarketsSnapshot, FearGreedSnapshot, OverviewSnapshot]);
export type AnalyticsSnapshot = z.infer<typeof AnalyticsSnapshot>;
export type SnapshotOf<D extends AnalyticsDataset> = Extract<AnalyticsSnapshot, { dataset: D }>;

/** Fear & Greed label bands as alternative.me publishes them. */
export function fearGreedLabel(value: number): string {
  if (value <= 24) return "Extreme Fear";
  if (value <= 44) return "Fear";
  if (value <= 55) return "Neutral";
  if (value <= 75) return "Greed";
  return "Extreme Greed";
}

/** Funding rate per 8 h → annualised decimal fraction. */
export const fundingApr = (rate: number): number => rate * 3 * 365;
