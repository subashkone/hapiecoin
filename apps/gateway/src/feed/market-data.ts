/**
 * The slice of a venue session the feed depends on, as an interface so tests inject a fake (ADR-067: every venue's
 * session implements it; `createMarketData` asks the port for the real one of a venue).
 */
import type { Venue as VenueId } from "@hapiecoin/schema";
import type {
  ChainSnapshot as VenueChainSnapshot,
  DeltaMarketDataEvents,
  Expiry,
  Instrument as VenueInstrument,
  Listener,
  MarketDataStatus,
  Quote as VenueQuote,
  VenueMarketDataOptions,
} from "@hapiecoin/venues";
import { DEFAULT_VENUE, getVenue } from "@hapiecoin/venues";

export interface MarketDataLike {
  /** Load the instrument list and seed quotes over REST; safe to call again to refresh. */
  load(): Promise<{ instruments: number; quotes: number }>;
  start(): void;
  stop(): void;
  /** Subscribe every option of one underlying/expiry ("YYYY-MM-DD" accepted). */
  watch(underlying: string, expiry: string): string[];
  unwatch(underlying: string, expiry: string): string[];
  /** Raw venue symbols outside the option list (perpetuals for spot). */
  subscribeSymbols(symbols: readonly string[]): void;
  unsubscribeSymbols(symbols: readonly string[]): void;
  chain(underlying: string, expiry: string): VenueChainSnapshot;
  expiries(underlying: string): Expiry[];
  instrument(symbol: string): VenueInstrument | undefined;
  quote(symbol: string): VenueQuote | undefined;
  status(): MarketDataStatus;
  on<K extends keyof DeltaMarketDataEvents>(
    event: K,
    listener: Listener<DeltaMarketDataEvents[K]>,
  ): () => void;
}

export interface MarketDataConfig {
  DELTA_REST_URL: string;
  DELTA_WS_URL: string;
  DELTA_WS_CHANNEL: "v2/ticker" | "ticker";
  DERIBIT_REST_URL: string;
  DERIBIT_WS_URL: string;
  DERIBIT_WS_INTERVAL: "100ms" | "agg2";
}

/** The endpoints a venue's session dials, from the gateway config. */
export function marketDataUrls(config: MarketDataConfig, venue: VenueId): { restUrl: string; wsUrl: string; channel: string } {
  return venue === "deribit"
    ? { restUrl: config.DERIBIT_REST_URL, wsUrl: config.DERIBIT_WS_URL, channel: config.DERIBIT_WS_INTERVAL }
    : { restUrl: config.DELTA_REST_URL, wsUrl: config.DELTA_WS_URL, channel: config.DELTA_WS_CHANNEL };
}

/** The real session of `venue`. `overrides` lets tests inject `fetch` and `WebSocket` fakes. */
export function createMarketData(
  config: MarketDataConfig,
  venue: VenueId = DEFAULT_VENUE,
  overrides: Pick<VenueMarketDataOptions, "fetch" | "WebSocket" | "now"> = {},
): MarketDataLike {
  return getVenue(venue).marketData({ ...marketDataUrls(config, venue), ...overrides });
}
