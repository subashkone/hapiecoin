/**
 * Input types for the pricing engine. Kept local on purpose (no dependency on @hapiecoin/schema) and
 * structurally compatible with the shared Zod leg schema: a leg parsed by the schema package is a valid `Leg`.
 *
 * Units: prices and strikes are in the quote currency per ONE underlying unit (USD per BTC, as Delta quotes
 * `mark_price`); quantities are in underlying units (contracts × contract size, e.g. 10 × 0.001 BTC = 0.01).
 * Every P&L and greek the engine returns is therefore in quote currency for the whole position.
 */

export type OptionKind = "call" | "put";
export type LegKind = OptionKind | "future";
export type Side = "buy" | "sell";

export interface Leg {
  kind: LegKind;
  side: Side;
  /** Strike in quote currency. Ignored for futures. */
  strike: number;
  /**
   * Expiry as `YYYY-MM-DD` (settles at the venue settlement hour on that date, 12:00 UTC by default) or an ISO 8601
   * datetime taken verbatim (Delta's `settlement_time`). Ignored for futures, which are treated as perpetual.
   */
  expiry: string;
  /** Position size in underlying units (contracts × contract size). Always positive; `side` carries the sign. */
  quantity: number;
  /** Entry (or mark) price per one underlying unit. */
  price: number;
  /** Implied volatility as a decimal (0.42 = 42 %). Needed to value the leg before its expiry. */
  iv?: number | undefined;
}

/** One strike of an option chain, as needed by the structure helpers (max pain, PCR, GEX, smile). */
export interface ChainRow {
  strike: number;
  /** Open interest in contracts. */
  callOi?: number | undefined;
  putOi?: number | undefined;
  /** Traded volume in contracts. */
  callVolume?: number | undefined;
  putVolume?: number | undefined;
  /** Mark implied volatility as a decimal. */
  callIv?: number | undefined;
  putIv?: number | undefined;
  /** Per-unit gamma (delta change per 1 USD move), as the venue reports it. */
  callGamma?: number | undefined;
  putGamma?: number | undefined;
}
