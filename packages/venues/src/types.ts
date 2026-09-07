/**
 * Normalised market-data shapes emitted by @hapiecoin/venues.
 *
 * These are plain TypeScript types on purpose: `@hapiecoin/schema` is built in parallel and owns the
 * shared Zod schemas. Field names here are meant to be unified with that package by a one-line
 * `import type` swap, so keep them stable.
 *
 * Money and quantities are decimal strings ("79521.5", "0.001"); implied volatilities are decimal
 * fractions (0.42 = 42 %); greeks are plain numbers (pure math inputs); timestamps are epoch ms.
 */

export type Venue = "delta";

export type InstrumentKind = "call" | "put" | "future" | "perpetual" | "other";

export interface Instrument {
  venue: Venue;
  /** Venue product id (Delta `id` / ticker `product_id`). */
  id: number;
  /** Venue symbol, e.g. "C-BTC-80000-250926", "BTCUSD". */
  symbol: string;
  kind: InstrumentKind;
  /** Underlying asset symbol: "BTC" | "ETH" | "XAUT" | ... */
  underlying: string;
  /** Quoting asset symbol (Delta India: "USD"). */
  quoteAsset: string;
  /** Settling asset symbol (Delta India: "USD"). */
  settlingAsset: string;
  /** Strike as a canonical decimal string; null for futures/perpetuals. */
  strike: string | null;
  /** Venue expiry code "DDMMYY" (e.g. "250926"); null for perpetuals. */
  expiryCode: string | null;
  /** Expiry date "YYYY-MM-DD"; null for perpetuals. */
  expiryDate: string | null;
  /** Settlement instant (ISO 8601, from the product's `settlement_time`); null for perpetuals. */
  settlementTime: string | null;
  /** Contract size in underlying units per contract ("0.001" BTC, "0.01" ETH, "0.001" XAUT). */
  contractValue: string;
  /** Minimum price increment ("0.1", "0.01"). */
  tickSize: string;
  /** Venue lifecycle state ("live", "expired", ...). */
  state: string;
  /** Venue trading status ("operational", "disrupted_cancel_only", ...); null when absent. */
  tradingStatus: string | null;
}

export interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
}

export interface Quote {
  venue: Venue;
  symbol: string;
  /** Venue product id; joins to `Instrument.id`. */
  instrumentId: number;
  /** Mark price (decimal string). */
  mark: string;
  bid: string | null;
  ask: string | null;
  bidSize: string | null;
  askSize: string | null;
  /** Mark implied volatility as a decimal fraction (0.42 = 42 %); null for non-options. */
  markIv: number | null;
  bidIv: number | null;
  askIv: number | null;
  /** Greeks per contract as numbers; null when the venue sends none (futures) or an incomplete set. */
  greeks: Greeks | null;
  /** Open interest in underlying units (decimal string, e.g. "18.947" BTC); null when unknown. */
  oi: string | null;
  /** Open interest in contracts (decimal string); null when unknown. */
  oiContracts: string | null;
  /** 24 h volume in underlying units (decimal string); null when unknown. */
  volume: string | null;
  /** Underlying spot/index price at the time of the quote (decimal string); null when absent. */
  spot: string | null;
  /** Venue timestamp in epoch ms. */
  venueTs: number;
  /** Local receive time in epoch ms. */
  receivedAt: number;
}

export interface Expiry {
  /** Venue code "DDMMYY", e.g. "250926". */
  code: string;
  /** Human label "25SEP26" (2-digit year, uppercase month). */
  label: string;
  /** "YYYY-MM-DD". */
  date: string;
  /** Settlement instant ISO 8601 (BTC/ETH settle 12:00 UTC; XAUT 16:00 UTC per the venue list). */
  settlementTime: string;
  /** Fractional days to settlement (may be negative once settled). */
  dte: number;
  /** Whole days to expiry for display ("21d"): ceil(dte), floored at 0. */
  daysToExpiry: number;
}

export interface ChainSide {
  instrument: Instrument;
  quote: Quote | null;
}

export interface ChainRow {
  /** Strike as a canonical decimal string. */
  strike: string;
  call: ChainSide | null;
  put: ChainSide | null;
}

export interface ChainSnapshot {
  venue: Venue;
  underlying: string;
  expiry: Expiry;
  /** Latest spot seen on any quote of this expiry; null until a quote arrives. */
  spot: string | null;
  /** Ascending, unique strikes; taken only from the instrument list (ADR-006). */
  strikes: string[];
  rows: ChainRow[];
  /** Snapshot time (epoch ms). */
  asOf: number;
  /** Number of option instruments in this expiry that have a quote. */
  quoted: number;
  /** Number of option instruments in this expiry. */
  total: number;
}

export interface Candle {
  /** Candle open time, epoch seconds (as the venue reports). */
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

export interface SpotTick {
  source: "binance";
  /** Underlying as HapieCoin names it ("BTC", "ETH"). */
  underlying: string;
  /** Venue pair symbol ("BTCUSDT"). */
  symbol: string;
  /** Last price (decimal string). */
  price: string;
  /** 24 h change in percent, from the rolling-window open. */
  change24hPct: number;
  /** Venue event time, epoch ms. */
  ts: number;
}
