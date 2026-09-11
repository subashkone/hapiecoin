/**
 * The venue port (ADR-060 decision 2, ADR-063). Everything the apps need from a market comes through a
 * `VenueAdapter` found in the registry, not through Delta-specific imports: the contract specs, the symbol
 * codec, the settlement calendar, the fee defaults, the capability flags, the schema bridge and the client
 * factories. Step 1 wraps today's Delta India code without changing a single value; a second venue
 * (Deribit, data-only) implements the same port later.
 */
import type {
  ChainRow as SchemaChainRow,
  ChainSnapshot as SchemaChainSnapshot,
  Instrument as SchemaInstrument,
  Quote as SchemaQuote,
  Underlying,
  Venue as VenueId,
} from "@hapiecoin/schema";
import { UNDERLYINGS } from "@hapiecoin/schema";
import type { DeltaMarketData, DeltaMarketDataOptions } from "../delta/market-data.js";
import type { ParsedOptionSymbol } from "../delta/normalize.js";
import type { DeltaRestClient, DeltaRestClientOptions } from "../delta/rest.js";
import type { DeltaTradingClient, DeltaTradingClientOptions } from "../delta/trading.js";
import type { ChainRow, ChainSnapshot, Instrument, Quote } from "../types.js";

export type { VenueId };

export type ExerciseStyle = "european" | "american";
export type OptionKind = "call" | "put";

/** How one underlying trades on a venue. Decimal strings, as everywhere in the schema. */
export interface MarketSpec {
  underlying: Underlying;
  /** Currency the contracts are quoted in ("USD"). */
  quoteCcy: string;
  /** Currency profits settle in ("USD"). */
  settleCcy: string;
  /** Underlying units per contract ("0.001" BTC). */
  multiplier: string;
  /** Default underlying units per lot before a user changes it in settings (one contract today). */
  lotSize: string;
  /** Minimum price increment ("0.1"). */
  tickSize: string;
  exerciseStyle: ExerciseStyle;
  /** Hour (UTC) options settle on their expiry date. */
  settlementHourUtc: number;
  /** Timezone the venue's expiry calendar is written in. */
  timezone: "UTC";
  /** True when the contract is denominated in the underlying (BTC-settled inverse contracts). */
  isInverse: boolean;
  /** Symbol of the perpetual future on the same underlying ("BTCUSD"). */
  perpetualSymbol: string;
}

export interface SymbolCodec {
  isOption: (symbol: string) => boolean;
  /** Throws `InvalidSymbolError` for anything that is not an option symbol of this venue. */
  parseOption: (symbol: string) => ParsedOptionSymbol;
  /** "call", "BTC", "79400", "2026-09-07" -> "C-BTC-79400-070926". */
  formatOption: (kind: OptionKind, underlying: string, strike: string, expiryDate: string) => string;
  /** "BTC" -> "BTCUSD". */
  perpetual: (underlying: string) => string;
}

export interface VenueCalendar {
  /** Settlement hour (UTC) for an underlying; the venue default for an unknown one. */
  settlementHourUtc: (underlying: string) => number;
  /** Settlement instant for a venue expiry code: "250926", "BTC" -> "2026-09-25T12:00:00.000Z". */
  expirySettlementIso: (expiryCode: string, underlying: string) => string;
}

/** Percentages as decimal strings, the shape of the `brokers` table. */
export interface FeeDefaults {
  /** Fee per side as a percentage of the notional. */
  feePct: string;
  /** Tax on the fee, as a percentage of it. */
  gstPct: string;
  /** Option fees are capped at this percentage of the premium. */
  feeCapPct: string;
  /** What the fee percentage applies to. */
  basis: "spot-notional";
}

export interface VenueCapabilities {
  options: boolean;
  perpetuals: boolean;
  /** The adapter has a `trading` factory and the venue accepts orders from us. */
  liveTrading: boolean;
  /** Tickers carry greeks and mark IV, so the client need not compute them. */
  greeksFromVenue: boolean;
  /** Open interest is present on the compact ticker channel (Delta omits it, GAPS #9). */
  oiInCompactTicker: boolean;
  /** Where spot comes from when the venue has no usable spot tick. */
  spotFallback: "binance" | null;
}

/** Venue records -> `@hapiecoin/schema` records (throws `SchemaAdapterError` for what the schema cannot hold). */
export interface SchemaBridge {
  isSupported: (inst: Instrument) => boolean;
  instrumentId: (symbol: string) => string;
  instrument: (inst: Instrument) => SchemaInstrument;
  quote: (q: Quote, fallbackSpot?: string | null) => SchemaQuote;
  chainRows: (rows: readonly ChainRow[], fallbackSpot?: string | null) => SchemaChainRow[];
  chainSnapshot: (chain: ChainSnapshot, fallbackSpot?: string | null) => SchemaChainSnapshot;
}

export interface VenueAdapter {
  readonly id: VenueId;
  readonly label: string;
  readonly underlyings: readonly Underlying[];
  readonly markets: Readonly<Partial<Record<Underlying, MarketSpec>>>;
  readonly symbols: SymbolCodec;
  readonly calendar: VenueCalendar;
  readonly fees: FeeDefaults;
  readonly capabilities: VenueCapabilities;
  readonly schema: SchemaBridge;
  /** Public REST client (products, tickers, candles). */
  readonly rest: (options: DeltaRestClientOptions) => DeltaRestClient;
  /** Instruments over REST, quotes over the socket, chains on demand. Step 1 types the factories with the Delta classes; step 4 narrows them to venue-agnostic slices (the gateway's `MarketDataLike` is one). */
  readonly marketData: (options: DeltaMarketDataOptions) => DeltaMarketData;
  /** Signed private client; absent on a data-only venue. */
  readonly trading?: (options: DeltaTradingClientOptions) => DeltaTradingClient;
}

export class UnknownVenueError extends Error {
  readonly venue: string;
  constructor(venue: string) {
    super(`Unknown venue ${JSON.stringify(venue)}`);
    this.name = "UnknownVenueError";
    this.venue = venue;
  }
}

export class VenueCapabilityError extends Error {
  readonly venue: string;
  readonly capability: string;
  constructor(venue: string, capability: string) {
    super(`Venue ${venue} has no ${capability}`);
    this.name = "VenueCapabilityError";
    this.venue = venue;
    this.capability = capability;
  }
}

/** The spec of one underlying on a venue; throws when the venue does not list it. */
export function marketOf(adapter: VenueAdapter, underlying: string): MarketSpec {
  const spec = ownMarket(adapter.markets, underlying);
  if (spec === undefined) throw new VenueCapabilityError(adapter.id, `market ${underlying}`);
  return spec;
}

/** The venue's spec for `underlying` when it lists one (own keys only, so "constructor" is not a market). */
export function ownMarket(markets: VenueAdapter["markets"], underlying: string): MarketSpec | undefined {
  return Object.hasOwn(markets, underlying) ? (markets as Readonly<Record<string, MarketSpec>>)[underlying] : undefined;
}

/** The venue's trading client; throws on a data-only venue. */
export function tradingClientOf(adapter: VenueAdapter, options: DeltaTradingClientOptions): DeltaTradingClient {
  if (adapter.trading === undefined) throw new VenueCapabilityError(adapter.id, "trading client");
  return adapter.trading(options);
}

/** Default lot size per schema underlying: the venue's lot where it lists the market, "1" elsewhere (the value the routes fell back to before the port). */
export function defaultLotSizes(adapter: VenueAdapter): Record<Underlying, string> {
  const out = {} as Record<Underlying, string>;
  for (const u of UNDERLYINGS) out[u] = adapter.markets[u]?.lotSize ?? "1";
  return out;
}
