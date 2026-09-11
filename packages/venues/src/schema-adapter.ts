/**
 * Bridge from the venue-native shapes in this package to the shared `@hapiecoin/schema` contracts.
 *
 * Differences handled here (the venue types stay as they are; the schema is the system contract):
 *   venue literal      "delta"                 -> "delta_india"
 *   expiryCode+Date    "250926" + "2026-09-25" -> expiry "2026-09-25"
 *   contractValue      -> contractSize          tickSize unchanged
 *   venueTs            -> ts                    bidSize/askSize -> bidQty/askQty
 *   oi (underlying units) / oiContracts         -> oi in contracts (schema unit); "0" when the venue sent none
 *   nullable fields    -> omitted optionals (schema uses `.optional()`, never null)
 *   spot null          -> the caller's fallback (latest spot of the chain), otherwise SchemaAdapterError
 *
 * The functions construct objects that satisfy `Instrument.parse`, `Quote.parse`, `ChainRow.parse` and
 * `ChainSnapshot.parse`; they do not run the parsers themselves (quotes are a hot path). The tests parse
 * every fixture-derived object through the schemas to prove the contract.
 */
import type {
  ChainRow as SchemaChainRow,
  ChainSnapshot as SchemaChainSnapshot,
  Greeks as SchemaGreeks,
  Instrument as SchemaInstrument,
  InstrumentKind as SchemaInstrumentKind,
  Quote as SchemaQuote,
  Underlying as SchemaUnderlying,
  Venue as SchemaVenue,
} from "@hapiecoin/schema";
import type { ChainRow, ChainSnapshot, Instrument, Quote, Venue } from "./types.js";

/** The schema venue id of Delta records; every venue maps through `schemaVenueOf` (ADR-067). */
export const SCHEMA_VENUE: SchemaVenue = "delta_india";

const SCHEMA_VENUES: Readonly<Record<Venue, SchemaVenue>> = { delta: "delta_india", deribit: "deribit" };

/** The shared-schema id of a venue-native record's venue tag. */
export function schemaVenueOf(venue: Venue): SchemaVenue {
  return SCHEMA_VENUES[venue];
}

const SCHEMA_UNDERLYINGS: readonly string[] = ["BTC", "ETH", "XAUT"];
const SCHEMA_CURRENCIES: readonly string[] = ["USD", "INR"];

/** A venue record cannot be expressed in the shared schema (unsupported underlying, kind, currency, missing spot). */
export class SchemaAdapterError extends Error {
  readonly symbol: string;
  readonly reason: string;
  constructor(symbol: string, reason: string) {
    super(`Cannot adapt ${JSON.stringify(symbol)} to @hapiecoin/schema: ${reason}`);
    this.name = "SchemaAdapterError";
    this.symbol = symbol;
    this.reason = reason;
  }
}

/** True when the instrument's underlying and kind are ones the shared schema can represent. */
export function isSchemaInstrument(inst: Instrument): boolean {
  return SCHEMA_UNDERLYINGS.includes(inst.underlying) && inst.kind !== "other";
}

function schemaUnderlying(symbol: string, underlying: string): SchemaUnderlying {
  if (!SCHEMA_UNDERLYINGS.includes(underlying)) {
    throw new SchemaAdapterError(symbol, `underlying ${underlying} is not offered by the product`);
  }
  return underlying as SchemaUnderlying;
}

export function schemaInstrumentId(symbol: string, venue: SchemaVenue = SCHEMA_VENUE): string {
  return `${venue}:${symbol}`;
}

/** Venue Instrument -> schema Instrument. Throws SchemaAdapterError for records the schema cannot hold. */
export function toSchemaInstrument(inst: Instrument): SchemaInstrument {
  if (inst.kind === "other")
    throw new SchemaAdapterError(inst.symbol, "contract kind is not an option or future");
  const kind: SchemaInstrumentKind = inst.kind;
  const underlying = schemaUnderlying(inst.symbol, inst.underlying);
  if (!SCHEMA_CURRENCIES.includes(inst.quoteAsset)) {
    throw new SchemaAdapterError(inst.symbol, `quote asset ${inst.quoteAsset} is not a supported currency`);
  }
  const isOption = kind === "call" || kind === "put";
  if (isOption && inst.strike === null) throw new SchemaAdapterError(inst.symbol, "option without a strike");
  if (kind !== "perpetual" && inst.expiryDate === null) {
    throw new SchemaAdapterError(inst.symbol, "dated contract without an expiry");
  }
  const out: SchemaInstrument = {
    id: schemaInstrumentId(inst.symbol, schemaVenueOf(inst.venue)),
    venue: schemaVenueOf(inst.venue),
    symbol: inst.symbol,
    underlying,
    kind,
    contractSize: inst.contractValue,
    tickSize: inst.tickSize,
    quoteCurrency: inst.quoteAsset as SchemaInstrument["quoteCurrency"],
    venueProductId: inst.id,
    isActive: inst.state === "live",
  };
  if (isOption) out.strike = inst.strike as string;
  if (kind !== "perpetual") out.expiry = inst.expiryDate as string;
  if (inst.settlementTime !== null) out.settlementTime = inst.settlementTime;
  return out;
}

function ivOrOmit(value: number | null): number | undefined {
  // The schema's IV is non-negative; Delta publishes a negative mark IV on perpetuals, which has no meaning here.
  return value !== null && value >= 0 ? value : undefined;
}

/**
 * Venue Quote -> schema Quote. `fallbackSpot` fills `spot` when the venue frame carried none (compact
 * frames without `sp`); with neither available the quote cannot satisfy the schema and this throws.
 */
export function toSchemaQuote(q: Quote, fallbackSpot?: string | null): SchemaQuote {
  const spot = q.spot ?? fallbackSpot ?? null;
  if (spot === null) throw new SchemaAdapterError(q.symbol, "quote without a spot price and no fallback");
  const out: SchemaQuote = {
    instrumentId: schemaInstrumentId(q.symbol, schemaVenueOf(q.venue)),
    ts: q.venueTs,
    mark: q.mark,
    oi: q.oiContracts ?? "0",
    spot,
  };
  if (q.bid !== null) out.bid = q.bid;
  if (q.ask !== null) out.ask = q.ask;
  const markIv = ivOrOmit(q.markIv);
  if (markIv !== undefined) out.markIv = markIv;
  const bidIv = ivOrOmit(q.bidIv);
  if (bidIv !== undefined) out.bidIv = bidIv;
  const askIv = ivOrOmit(q.askIv);
  if (askIv !== undefined) out.askIv = askIv;
  if (q.volume !== null) out.volume24h = q.volume;
  if (q.bidSize !== null) out.bidQty = q.bidSize;
  if (q.askSize !== null) out.askQty = q.askSize;
  if (q.greeks !== null) {
    const greeks: SchemaGreeks = {
      delta: q.greeks.delta,
      gamma: q.greeks.gamma,
      theta: q.greeks.theta,
      vega: q.greeks.vega,
      rho: q.greeks.rho,
    };
    out.greeks = greeks;
  }
  return out;
}

/** Latest spot carried by any quote in the rows (by venue timestamp), or null. */
export function latestSpot(rows: readonly ChainRow[]): string | null {
  let spot: string | null = null;
  let ts = -1;
  for (const row of rows) {
    for (const side of [row.call, row.put]) {
      const quote = side?.quote;
      if (quote && quote.spot !== null && quote.venueTs > ts) {
        spot = quote.spot;
        ts = quote.venueTs;
      }
    }
  }
  return spot;
}

/**
 * Venue chain rows -> schema ChainRows (strikes untouched: they come from the instrument list, ADR-006).
 * Sides without a quote are omitted. Quotes without a spot use the chain's latest spot, then `fallbackSpot`.
 */
export function toSchemaChainRows(rows: readonly ChainRow[], fallbackSpot?: string | null): SchemaChainRow[] {
  const spot = latestSpot(rows) ?? fallbackSpot ?? null;
  return rows.map((row) => {
    const out: SchemaChainRow = { strike: row.strike };
    if (row.call?.quote) out.call = toSchemaQuote(row.call.quote, spot);
    if (row.put?.quote) out.put = toSchemaQuote(row.put.quote, spot);
    return out;
  });
}

/** Venue ChainSnapshot -> schema ChainSnapshot (throws when no spot is known at all). */
export function toSchemaChainSnapshot(
  chain: ChainSnapshot,
  fallbackSpot?: string | null,
): SchemaChainSnapshot {
  const spot = chain.spot ?? fallbackSpot ?? null;
  if (spot === null)
    throw new SchemaAdapterError(chain.underlying, "chain without a spot price and no fallback");
  return {
    venue: schemaVenueOf(chain.venue),
    underlying: schemaUnderlying(chain.underlying, chain.underlying),
    expiry: chain.expiry.date,
    ts: chain.asOf,
    spot,
    rows: toSchemaChainRows(chain.rows, spot),
  };
}
