import { z } from "zod";
import {
  Currency,
  DecimalString,
  IsoDate,
  IsoDateTime,
  Timestamp,
  Underlying,
  VENUES,
  Venue,
  compareDecimal,
} from "./primitives.js";

export const InstrumentKind = z.enum(["call", "put", "future", "perpetual"]);
export type InstrumentKind = z.infer<typeof InstrumentKind>;

/** Venue symbol as listed by the exchange, e.g. "C-BTC-80000-250926" or "BTCUSD". */
export const VENUE_SYMBOL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const VenueSymbol = z.string().regex(VENUE_SYMBOL_RE, "expected a venue symbol such as C-BTC-80000-250926");
export type VenueSymbol = z.infer<typeof VenueSymbol>;

/** Instrument identity across the system: `${venue}:${symbol}`, e.g. "delta_india:C-BTC-80000-250926". */
export const INSTRUMENT_ID_RE = new RegExp(`^(?:${VENUES.join("|")}):[A-Za-z0-9][A-Za-z0-9._-]*$`);
export const InstrumentId = z.string().regex(INSTRUMENT_ID_RE, "expected an instrument id such as delta_india:BTCUSD");
export type InstrumentId = z.infer<typeof InstrumentId>;

export function makeInstrumentId(venue: Venue, symbol: string): InstrumentId {
  return `${venue}:${symbol}`;
}

const InstrumentShape = z.object({
  id: InstrumentId,
  venue: Venue,
  symbol: VenueSymbol,
  underlying: Underlying,
  kind: InstrumentKind,
  /** Present for calls and puts only. */
  strike: DecimalString.optional(),
  /** Expiry date (YYYY-MM-DD); present for calls, puts and dated futures, absent for perpetuals. */
  expiry: IsoDate.optional(),
  /** Exact settlement instant from the venue when known. */
  settlementTime: IsoDateTime.optional(),
  /** Units of underlying per contract, e.g. "0.001" BTC. */
  contractSize: DecimalString,
  tickSize: DecimalString,
  quoteCurrency: Currency,
  venueProductId: z.number().int(),
  isActive: z.boolean(),
});

/** One tradable contract as the rest of the system sees it. Strikes come from here, never from a step (ADR-006). */
export const Instrument = InstrumentShape.superRefine((inst, ctx) => {
  if (inst.id !== makeInstrumentId(inst.venue, inst.symbol)) {
    ctx.addIssue({ code: "custom", path: ["id"], message: "id must equal `${venue}:${symbol}`" });
  }
  const isOption = inst.kind === "call" || inst.kind === "put";
  if (isOption && inst.strike === undefined) {
    ctx.addIssue({ code: "custom", path: ["strike"], message: "options must carry a strike" });
  }
  if (!isOption && inst.strike !== undefined) {
    ctx.addIssue({ code: "custom", path: ["strike"], message: "only options carry a strike" });
  }
  if (inst.kind !== "perpetual" && inst.expiry === undefined) {
    ctx.addIssue({ code: "custom", path: ["expiry"], message: "dated instruments must carry an expiry" });
  }
  if (inst.kind === "perpetual" && inst.expiry !== undefined) {
    ctx.addIssue({ code: "custom", path: ["expiry"], message: "perpetuals have no expiry" });
  }
});
export type Instrument = z.infer<typeof Instrument>;

/** Option greeks as plain numbers (pure math only; never stored as money). */
export const Greeks = z.object({
  delta: z.number().finite(),
  gamma: z.number().finite(),
  theta: z.number().finite(),
  vega: z.number().finite(),
  rho: z.number().finite().optional(),
});
export type Greeks = z.infer<typeof Greeks>;

/** Implied volatility as a decimal fraction (0.42 = 42 %). */
const Iv = z.number().finite().nonnegative();

/** Latest known market state of one instrument. Prices and sizes are decimal strings; IV and greeks are numbers. */
export const Quote = z.object({
  instrumentId: InstrumentId,
  ts: Timestamp,
  mark: DecimalString,
  bid: DecimalString.optional(),
  ask: DecimalString.optional(),
  last: DecimalString.optional(),
  markIv: Iv.optional(),
  bidIv: Iv.optional(),
  askIv: Iv.optional(),
  /** Open interest in contracts (venue units). */
  oi: DecimalString,
  volume24h: DecimalString.optional(),
  bidQty: DecimalString.optional(),
  askQty: DecimalString.optional(),
  /** Underlying spot at the time of the quote. */
  spot: DecimalString,
  greeks: Greeks.optional(),
  change24hPct: z.number().finite().optional(),
});
export type Quote = z.infer<typeof Quote>;

/** One strike of the chain: the call and the put side by side (either may be missing). */
export const ChainRow = z.object({
  strike: DecimalString,
  call: Quote.optional(),
  put: Quote.optional(),
});
export type ChainRow = z.infer<typeof ChainRow>;

/** Adds an issue unless rows are strictly ascending by strike (which also guarantees uniqueness). */
export function refineChainRows(rows: readonly { strike: string }[], ctx: z.RefinementCtx, basePath: PropertyKey[] = []) {
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1] as { strike: string };
    const curr = rows[i] as { strike: string };
    const order = compareDecimal(prev.strike, curr.strike);
    if (order === 0) {
      ctx.addIssue({ code: "custom", path: [...basePath, i, "strike"], message: `duplicate strike ${curr.strike}` });
    } else if (order === 1) {
      ctx.addIssue({
        code: "custom",
        path: [...basePath, i, "strike"],
        message: `rows must be sorted ascending by strike (${curr.strike} after ${prev.strike})`,
      });
    }
  }
}

/** Full chain for one underlying and expiry. Rows are sorted ascending by strike and unique. */
export const ChainSnapshot = z
  .object({
    venue: Venue,
    underlying: Underlying,
    expiry: IsoDate,
    ts: Timestamp,
    spot: DecimalString,
    rows: z.array(ChainRow),
  })
  .superRefine((snap, ctx) => {
    refineChainRows(snap.rows, ctx, ["rows"]);
  });
export type ChainSnapshot = z.infer<typeof ChainSnapshot>;
