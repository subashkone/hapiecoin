/**
 * Zod schemas for the raw Delta Exchange India payloads this package consumes.
 * Shapes verified against spec/fixtures/delta-products.json (972 products, 04 Sep 2026),
 * spec/fixtures/delta-tickers.json (307 BTC call tickers) and a live WebSocket probe on 07 Sep 2026.
 *
 * Only the fields the normaliser needs are declared; unknown keys are stripped by Zod so a new
 * venue field never breaks parsing. Venue decimals arrive as strings and stay strings here.
 */
import { z } from "zod";

/** Venue decimal as sent ("0.100000000000000000", "-23.86507888"). Canonicalised in normalize.ts. */
const decimal = z.string();

/** Some numeric fields are numbers in REST and may be strings on other channels; accept both. */
const numberish = z.union([z.number(), z.string()]);

export const RawAsset = z.object({
  id: z.number(),
  symbol: z.string(),
});

export const RawProduct = z.object({
  id: z.number(),
  symbol: z.string(),
  contract_type: z.string(),
  state: z.string(),
  trading_status: z.string().nullish(),
  strike_price: decimal.nullish(),
  settlement_time: z.string().nullish(),
  contract_value: decimal,
  tick_size: decimal,
  underlying_asset: RawAsset,
  quoting_asset: RawAsset,
  settling_asset: RawAsset.nullish(),
});
export type RawProduct = z.infer<typeof RawProduct>;

export const RawPaginationMeta = z
  .object({
    after: z.string().nullish(),
    before: z.string().nullish(),
    limit: z.number().nullish(),
    total_count: z.number().nullish(),
  })
  .partial();

export const RawProductsResponse = z.object({
  success: z.literal(true),
  result: z.array(RawProduct),
  meta: RawPaginationMeta.nullish(),
});
export type RawProductsResponse = z.infer<typeof RawProductsResponse>;

export const RawGreeks = z.object({
  delta: decimal.nullish(),
  gamma: decimal.nullish(),
  theta: decimal.nullish(),
  vega: decimal.nullish(),
  rho: decimal.nullish(),
  spot: decimal.nullish(),
});

export const RawQuotes = z.object({
  best_bid: decimal.nullish(),
  best_ask: decimal.nullish(),
  bid_size: numberish.nullish(),
  ask_size: numberish.nullish(),
  bid_iv: decimal.nullish(),
  ask_iv: decimal.nullish(),
  mark_iv: decimal.nullish(),
  impact_mid_price: decimal.nullish(),
});

/** REST /v2/tickers element and the legacy `v2/ticker` WebSocket frame share this shape. */
export const RawTicker = z.object({
  symbol: z.string(),
  product_id: z.number(),
  contract_type: z.string().nullish(),
  underlying_asset_symbol: z.string().nullish(),
  strike_price: decimal.nullish(),
  mark_price: decimal,
  spot_price: decimal.nullish(),
  /** Open interest in underlying units ("18.9470"). */
  oi: decimal.nullish(),
  /** Open interest in contracts ("18947"). */
  oi_contracts: decimal.nullish(),
  /** 24 h volume in underlying units; a JS number in REST (0.9570000000000001). */
  volume: numberish.nullish(),
  /** Mark implied volatility as a decimal fraction ("0.42445466"). */
  mark_vol: decimal.nullish(),
  greeks: RawGreeks.nullish(),
  quotes: RawQuotes.nullish(),
  /** Venue timestamp in microseconds. */
  timestamp: z.number().nullish(),
  /** ISO time string (present in REST). */
  time: z.string().nullish(),
});
export type RawTicker = z.infer<typeof RawTicker>;

export const RawTickersResponse = z.object({
  success: z.literal(true),
  result: z.array(RawTicker),
});
export type RawTickersResponse = z.infer<typeof RawTickersResponse>;

export const RawTickerResponse = z.object({
  success: z.literal(true),
  result: RawTicker,
});
export type RawTickerResponse = z.infer<typeof RawTickerResponse>;

/** /v2/history/candles element: `{ time, open, high, low, close, volume }` (time in seconds). */
export const RawCandle = z.object({
  time: z.number(),
  open: numberish,
  high: numberish,
  low: numberish,
  close: numberish,
  volume: numberish.nullish(),
});
export type RawCandle = z.infer<typeof RawCandle>;

export const RawCandlesResponse = z.object({
  success: z.literal(true),
  result: z.array(RawCandle),
});
export type RawCandlesResponse = z.infer<typeof RawCandlesResponse>;

/** Delta's `success: false` envelope (`{ success: false, error: { code, context } }`). */
export const RawErrorResponse = z.object({
  success: z.literal(false),
  error: z
    .object({
      code: z.string().nullish(),
      context: z.unknown().optional(),
    })
    .nullish(),
});

// --- WebSocket frames -------------------------------------------------------------------------

/** Every frame carries a `type`; the client dispatches on it and ignores unknown types. */
export const RawWsEnvelope = z.object({ type: z.string() });

/** Sent every 30 s after `{ type: "enable_heartbeat" }` (docs: reconnect if none within 35 s). */
export const RawWsHeartbeat = z.object({
  type: z.literal("heartbeat"),
  ts_origin: z.number().nullish(),
  ts_publish: z.number().nullish(),
});

/** Acknowledgement of subscribe/unsubscribe; per-channel `error` when a subscription is refused. */
export const RawWsSubscriptions = z.object({
  type: z.literal("subscriptions"),
  channels: z.array(
    z.object({
      name: z.string(),
      symbols: z.array(z.string()).nullish(),
      error: z.string().nullish(),
    }),
  ),
});
export type RawWsSubscriptions = z.infer<typeof RawWsSubscriptions>;

/** Legacy verbose ticker frame (`wss://socket.india.delta.exchange`, channel `v2/ticker`). */
export const RawWsV2Ticker = RawTicker.extend({ type: z.literal("v2/ticker") });
export type RawWsV2Ticker = z.infer<typeof RawWsV2Ticker>;

const compactCell = z.union([z.string(), z.number(), z.null()]);

/**
 * Compact ticker frame on the new public endpoint (`wss://public-socket.india.delta.exchange`,
 * channel `ticker`). Field order per Delta docs:
 *   g   = [delta, gamma, rho, theta, vega]      (null entries for futures)
 *   q   = [best_ask, ask_size, best_bid, bid_size, impact_mid_price]
 *   qiv = [ask_iv, bid_iv, mark_iv]
 *   oi  = [oi_contracts, oi_change_usd_6h]
 */
export const RawWsCompactTickerEntry = z.object({
  s: z.string(),
  i: z.number(),
  m: decimal,
  g: z.array(compactCell).nullish(),
  q: z.array(compactCell).nullish(),
  qiv: z.array(compactCell).nullish(),
  oi: z.array(compactCell).nullish(),
});
export type RawWsCompactTickerEntry = z.infer<typeof RawWsCompactTickerEntry>;

export const RawWsCompactTicker = z.object({
  type: z.literal("ticker"),
  sy: z.string(),
  sp: decimal.nullish(),
  /** Microseconds. */
  ts: z.number(),
  d: z.array(RawWsCompactTickerEntry),
});
export type RawWsCompactTicker = z.infer<typeof RawWsCompactTicker>;

export const RawWsError = z.object({
  type: z.literal("error"),
  message: z.string().nullish(),
  error: z.unknown().optional(),
});

/** Render Zod issues as short strings for DeltaSchemaError. */
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.map(String).join(".") || "<root>"}: ${issue.message}`);
}
