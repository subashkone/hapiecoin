// Market Analytics datasets (Phase 5 item 5, ADR-038; docs/research/market-analytics-data-sources.md). The ingest
// service writes one Snapshot per dataset + key into Redis; the API serves it read-only at /v1/analytics/{dataset}.
// Every payload carries its source and an `asOf` stamp so the UI can say where a number came from and how old it is.
import { z } from "zod";

export const ANALYTICS_VENUES = ["binance", "bybit", "okx", "delta"] as const;
export const AnalyticsVenue = z.enum(ANALYTICS_VENUES);
export type AnalyticsVenue = z.infer<typeof AnalyticsVenue>;
export const ANALYTICS_VENUE_LABELS: Record<AnalyticsVenue, string> = { binance: "Binance", bybit: "Bybit", okx: "OKX", delta: "Delta India" };

export const ANALYTICS_DATASETS = ["funding", "open-interest", "long-short", "taker-volume", "liquidations", "markets", "fear-greed", "overview", "options", "cycle", "rsi", "premium"] as const;
export const AnalyticsDataset = z.enum(ANALYTICS_DATASETS);
export type AnalyticsDataset = z.infer<typeof AnalyticsDataset>;

/** Base asset symbol as the venues quote it against USDT/USD ("BTC"). */
export const AnalyticsSymbol = z.string().regex(/^[A-Z0-9]{2,12}$/, "symbol must be 2–12 upper-case letters or digits");
export type AnalyticsSymbol = z.infer<typeof AnalyticsSymbol>;

/** Datasets keyed per symbol; the others have one snapshot ("-" key). */
export const SYMBOL_DATASETS: ReadonlySet<AnalyticsDataset> = new Set(["funding", "open-interest", "long-short", "taker-volume", "options"]);
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

/** Venues that publish option open interest we ingest (ADR-042). */
export const OPTIONS_VENUES = ["deribit", "delta"] as const;
export const OptionsVenue = z.enum(OPTIONS_VENUES);
export type OptionsVenue = z.infer<typeof OptionsVenue>;
export const OPTIONS_VENUE_LABELS: Record<OptionsVenue, string> = { deribit: "Deribit", delta: "Delta India" };

/** One expiry of one venue: open interest in underlying units per side and the max-pain strike (HC-MA-051). */
export const OptionsExpiry = z.strictObject({
  /** Settlement instant. */
  expiry: Ms,
  /** Venue label for the expiry ("25SEP26" or "250926"). */
  label: z.string(),
  /** Open interest in underlying units (BTC), calls and puts. */
  callOi: z.number().nonnegative(),
  putOi: z.number().nonnegative(),
  /** Strike at which option holders' aggregate intrinsic value is smallest; null without strikes. */
  maxPain: z.number().nullable(),
  strikes: z.number().int().nonnegative(),
});
export type OptionsExpiry = z.infer<typeof OptionsExpiry>;
export const OptionsVenueData = z.strictObject({
  venue: OptionsVenue,
  /** Open interest across every listed option, in underlying units and in USD at the venue's underlying price. */
  oiBase: z.number().nonnegative(),
  oiUsd: z.number().nonnegative(),
  volume24hUsd: z.number().nonnegative(),
  /** Put OI ÷ call OI (underlying units); null when there are no calls. */
  putCallOi: z.number().nullable(),
  underlyingPrice: z.number().positive(),
  instruments: z.number().int().nonnegative(),
  expiries: z.array(OptionsExpiry),
});
export type OptionsVenueData = z.infer<typeof OptionsVenueData>;
/** Options open interest per venue for one underlying (HC-MA-049..053). */
export const OptionsData = z.strictObject({ symbol: AnalyticsSymbol, venues: z.array(OptionsVenueData) });
export type OptionsData = z.infer<typeof OptionsData>;

/** One daily close with the cycle averages (null until enough history); the log-regression fit for the rainbow bands. */
export const CyclePoint = z.strictObject({ t: Ms, close: z.number().positive(), ma111: z.number().nullable(), ma350x2: z.number().nullable(), ma2y: z.number().nullable(), ma2yX5: z.number().nullable(), fit: z.number().positive() });
export type CyclePoint = z.infer<typeof CyclePoint>;
/** Daily BTC cycle indicators computed from spot closes (HC-MA-074..079): Pi Cycle, 2-year MA multiplier, rainbow fit. */
export const CycleData = z.strictObject({
  symbol: AnalyticsSymbol,
  points: z.array(CyclePoint),
  /** Multipliers applied to `fit` for the rainbow band edges, ascending; bands = multipliers.length − 1. */
  rainbowMultipliers: z.array(z.number().positive()),
  rainbowNames: z.array(z.string()),
  windowDays: z.number().int().positive(),
});
export type CycleData = z.infer<typeof CycleData>;

export const RSI_TIMEFRAMES = ["15m", "1h", "4h", "12h", "1d", "1w"] as const;
export const RsiTimeframe = z.enum(RSI_TIMEFRAMES);
export type RsiTimeframe = z.infer<typeof RsiTimeframe>;
export const RsiRow = z.strictObject({ symbol: AnalyticsSymbol, price: z.number().positive(), rsi: z.partialRecord(RsiTimeframe, z.number().min(0).max(100).nullable()) });
export type RsiRow = z.infer<typeof RsiRow>;
/** Wilder RSI per timeframe for every tracked symbol (HC-MA-081). */
export const RsiData = z.strictObject({ period: z.number().int().positive(), rows: z.array(RsiRow) });
export type RsiData = z.infer<typeof RsiData>;

/** Coinbase BTC-USD minus Binance BTC-USDT (USD), hourly history kept by the ingest (HC-MA-080). */
export const PremiumData = z.strictObject({
  symbol: AnalyticsSymbol,
  coinbaseUsd: z.number().positive(),
  binanceUsd: z.number().positive(),
  premiumUsd: z.number(),
  premiumPct: z.number(),
  points: z.array(SeriesPoint),
});
export type PremiumData = z.infer<typeof PremiumData>;

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
export const OptionsSnapshot = envelope("options", OptionsData);
export const CycleSnapshot = envelope("cycle", CycleData);
export const RsiSnapshot = envelope("rsi", RsiData);
export const PremiumSnapshot = envelope("premium", PremiumData);
export const AnalyticsSnapshot = z.discriminatedUnion("dataset", [FundingSnapshot, OpenInterestSnapshot, LongShortSnapshot, TakerVolumeSnapshot, LiquidationsSnapshot, MarketsSnapshot, FearGreedSnapshot, OverviewSnapshot, OptionsSnapshot, CycleSnapshot, RsiSnapshot, PremiumSnapshot]);
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

/**
 * Max pain (Deribit Insights method): the strike at which the aggregate intrinsic value of every open option is
 * smallest. `oi` is in underlying units per instrument; returns null without instruments.
 */
export function maxPain(instruments: readonly { strike: number; type: "call" | "put"; oi: number }[]): number | null {
  const strikes = [...new Set(instruments.map((i) => i.strike))].sort((a, b) => a - b);
  let best: { strike: number; pain: number } | null = null;
  for (const s of strikes) {
    let pain = 0;
    for (const i of instruments) pain += i.oi * (i.type === "call" ? Math.max(s - i.strike, 0) : Math.max(i.strike - s, 0));
    if (best === null || pain < best.pain) best = { strike: s, pain };
  }
  return best?.strike ?? null;
}

/** Wilder's RSI over closes (oldest first); null with fewer than `period + 1` closes. */
export function rsi(closes: readonly number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (loss === 0) return 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}

/** Simple moving average ending at each index; null until `n` values exist. */
export function sma(values: readonly number[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= n) sum -= values[i - n]!;
    out.push(i >= n - 1 ? sum / n : null);
  }
  return out;
}

/** Least-squares fit of ln(y) = a + b·i over the index; returns the fitted values (a straight line in log space). */
export function logLinearFit(values: readonly number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  values.forEach((v, i) => {
    const y = Math.log(v);
    sx += i;
    sy += y;
    sxx += i * i;
    sxy += i * y;
  });
  const den = n * sxx - sx * sx;
  const b = den === 0 ? 0 : (n * sxy - sx * sy) / den;
  const a = (sy - b * sx) / n;
  return values.map((_, i) => Math.exp(a + b * i));
}
export const RAINBOW_MULTIPLIERS = [0.45, 0.6, 0.8, 1.1, 1.45, 1.9, 2.5, 3.3, 4.3, 5.6] as const;
export const RAINBOW_NAMES = ["Basically a fire sale", "Buy", "Accumulate", "Still cheap", "Hold", "Is this a bubble?", "FOMO intensifies", "Sell, seriously", "Maximum bubble"] as const;
/** Index of the rainbow band a price sits in relative to the fit (0 = lowest). */
export function rainbowBand(price: number, fit: number, multipliers: readonly number[] = RAINBOW_MULTIPLIERS): number {
  const r = price / fit;
  let k = 0;
  while (k < multipliers.length - 2 && r > multipliers[k + 1]!) k += 1;
  return k;
}
