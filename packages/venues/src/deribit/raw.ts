/**
 * Zod shapes of the Deribit v2 public API payloads the adapter consumes (docs.deribit.com api-reference and a
 * live capture on 11 Sep 2026: spec/fixtures/deribit-*.json). Only the fields we read are declared; unknown keys
 * are stripped. Prices are numbers in the coin (inverse options), IVs are percentages, timestamps epoch ms.
 */
import { z } from "zod";

/** JSON-RPC error member; a reply carries either `result` or `error`. */
export const RawRpcError = z.object({
  code: z.number(),
  message: z.string(),
  data: z.unknown().optional(),
});
export type RawRpcError = z.infer<typeof RawRpcError>;

export const RawRpcErrorResponse = z.object({ error: RawRpcError });

export const RawInstrument = z.object({
  instrument_name: z.string(),
  instrument_id: z.number(),
  kind: z.string(),
  option_type: z.enum(["call", "put"]).optional(),
  strike: z.number().optional(),
  /** Settlement instant, epoch ms (options settle 08:00 UTC). */
  expiration_timestamp: z.number(),
  base_currency: z.string(),
  quote_currency: z.string(),
  counter_currency: z.string().optional(),
  settlement_currency: z.string().optional(),
  settlement_period: z.string().optional(),
  /** Coin units per contract (1 for options). */
  contract_size: z.number(),
  /** Minimum price increment in the coin. */
  tick_size: z.number(),
  min_trade_amount: z.number().optional(),
  is_active: z.boolean(),
  state: z.string().optional(),
  /** "reversed" (inverse) or "linear". */
  instrument_type: z.string().optional(),
  price_index: z.string().optional(),
});
export type RawInstrument = z.infer<typeof RawInstrument>;

export const RawInstrumentsResponse = z.object({ result: z.array(RawInstrument) });

export const RawGreeks = z.object({
  delta: z.number(),
  gamma: z.number(),
  vega: z.number(),
  theta: z.number(),
  rho: z.number(),
});

export const RawStats = z.object({
  /** 24 h volume in the coin. */
  volume: z.number().nullish(),
  volume_usd: z.number().nullish(),
});

/** `public/ticker` result and the `ticker.<name>.<interval>` notification data (same shape). */
export const RawTicker = z.object({
  instrument_name: z.string(),
  timestamp: z.number(),
  state: z.string().optional(),
  /** Mark in the coin per contract. */
  mark_price: z.number(),
  /** Percent; 0 when no quote. */
  mark_iv: z.number().nullish(),
  bid_iv: z.number().nullish(),
  ask_iv: z.number().nullish(),
  best_bid_price: z.number().nullish(),
  best_ask_price: z.number().nullish(),
  /** Contracts (coin units for options). */
  best_bid_amount: z.number().nullish(),
  best_ask_amount: z.number().nullish(),
  index_price: z.number(),
  /** Forward the venue values the option on. */
  underlying_price: z.number().nullish(),
  underlying_index: z.string().nullish(),
  /** Coin units. */
  open_interest: z.number().nullish(),
  greeks: RawGreeks.nullish(),
  stats: RawStats.nullish(),
  estimated_delivery_price: z.number().nullish(),
  interest_rate: z.number().nullish(),
});
export type RawTicker = z.infer<typeof RawTicker>;

export const RawTickerResponse = z.object({ result: RawTicker });

/** The recorded near-the-money tickers fixture (`{ result: RawTicker[] }`). */
export const RawTickersResponse = z.object({ result: z.array(RawTicker) });

/** One row of `public/get_book_summary_by_currency` (the REST seed: no greeks, no index; the delivery estimate is the index). */
export const RawBookSummary = z.object({
  instrument_name: z.string(),
  creation_timestamp: z.number().optional(),
  mark_price: z.number().nullish(),
  mark_iv: z.number().nullish(),
  bid_price: z.number().nullish(),
  ask_price: z.number().nullish(),
  open_interest: z.number().nullish(),
  volume: z.number().nullish(),
  volume_usd: z.number().nullish(),
  underlying_price: z.number().nullish(),
  estimated_delivery_price: z.number().nullish(),
  interest_rate: z.number().nullish(),
});
export type RawBookSummary = z.infer<typeof RawBookSummary>;

export const RawBookSummaryResponse = z.object({ result: z.array(RawBookSummary) });

export const RawIndexPriceResponse = z.object({ result: z.object({ index_price: z.number(), estimated_delivery_price: z.number().optional() }) });

// --- WebSocket JSON-RPC frames

export const RawRpcReply = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.number().nullable(),
  result: z.unknown().optional(),
  error: RawRpcError.optional(),
});
export type RawRpcReply = z.infer<typeof RawRpcReply>;

export const RawRpcNotification = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.string(),
  params: z.unknown(),
});

export const RawSubscriptionParams = z.object({ channel: z.string(), data: z.unknown() });

export const RawHeartbeatParams = z.object({ type: z.enum(["heartbeat", "test_request"]) });

export const RawIndexNotification = z.object({ index_name: z.string(), price: z.number(), timestamp: z.number() });

export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
}
