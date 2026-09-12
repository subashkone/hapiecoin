/**
 * The market-data session every venue exposes (ADR-067): instruments loaded over REST, quotes seeded over REST
 * and kept fresh from the venue socket, chains built on demand from the instrument list (ADR-006). The gateway
 * holds one per venue; the port's `marketData` factory returns one.
 */
import type { Listener } from "./emitter.js";
import type { ChainSnapshot, Expiry, Instrument, Quote } from "./types.js";
import type { BackoffOptions, SocketState, WebSocketCtor } from "./ws/reconnecting.js";
import type { FetchLike } from "./http.js";

export interface MarketDataStatus {
  instruments: number;
  quotes: number;
  socket: SocketState;
  subscribed: number;
}

export interface MarketDataEvents extends Record<string, unknown> {
  /** Every normalised quote (REST seed and socket ticks). */
  ticker: Quote;
  /** Socket lifecycle changes. */
  status: MarketDataStatus;
  error: Error;
}

/** Options every venue session accepts; a venue may read more (Delta's `channel`, Deribit's `interval`). */
export interface VenueMarketDataOptions {
  restUrl: string;
  wsUrl: string;
  fetch?: FetchLike | undefined;
  WebSocket?: WebSocketCtor | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  backoff?: Partial<BackoffOptions> | undefined;
  heartbeatMs?: number | undefined;
  now?: (() => number) | undefined;
  /** Venue-specific socket channel or aggregation ("v2/ticker" | "ticker" on Delta, "100ms" | "agg2" on Deribit). */
  channel?: string | undefined;
}

export interface VenueMarketData {
  /** Load the instrument list and seed quotes over REST; safe to call again to refresh. */
  load(): Promise<{ instruments: number; quotes: number }>;
  start(): void;
  stop(): void;
  /** Subscribe every option of one underlying/expiry ("YYYY-MM-DD" accepted); returns the symbols. */
  watch(underlying: string, expiry: string): string[];
  unwatch(underlying: string, expiry: string): string[];
  /** Raw venue symbols outside the option list (a perpetual for spot). */
  subscribeSymbols(symbols: readonly string[]): void;
  unsubscribeSymbols(symbols: readonly string[]): void;
  chain(underlying: string, expiry: string): ChainSnapshot;
  expiries(underlying: string): Expiry[];
  instruments(): readonly Instrument[];
  instrument(symbol: string): Instrument | undefined;
  quote(symbol: string): Quote | undefined;
  status(): MarketDataStatus;
  on<K extends keyof MarketDataEvents>(event: K, listener: Listener<MarketDataEvents[K]>): () => void;
}
