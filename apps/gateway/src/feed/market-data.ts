/**
 * The slice of `@hapiecoin/venues`' DeltaMarketData the feed depends on, as an interface so tests inject
 * a fake. `createMarketData` wraps the real `createDeltaMarketData`.
 */
import type {
  ChainSnapshot as VenueChainSnapshot,
  DeltaMarketDataEvents,
  DeltaMarketDataOptions,
  Expiry,
  Instrument as VenueInstrument,
  Listener,
  MarketDataStatus,
  Quote as VenueQuote,
} from "@hapiecoin/venues";
import { createDeltaMarketData } from "@hapiecoin/venues";

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
}

/** Real Delta market data. `overrides` lets tests inject `fetch` and `WebSocket` fakes. */
export function createMarketData(
  config: MarketDataConfig,
  overrides: Pick<DeltaMarketDataOptions, "fetch" | "WebSocket" | "now"> = {},
): MarketDataLike {
  const md = createDeltaMarketData({
    restUrl: config.DELTA_REST_URL,
    wsUrl: config.DELTA_WS_URL,
    channel: config.DELTA_WS_CHANNEL,
    ...overrides,
  });
  return {
    load: () => md.load(),
    start: () => {
      md.start();
    },
    stop: () => {
      md.stop();
    },
    watch: (underlying, expiry) => md.watch(underlying, expiry),
    unwatch: (underlying, expiry) => md.unwatch(underlying, expiry),
    subscribeSymbols: (symbols) => {
      md.ws.subscribe(symbols);
    },
    unsubscribeSymbols: (symbols) => {
      md.ws.unsubscribe(symbols);
    },
    chain: (underlying, expiry) => md.chain(underlying, expiry),
    expiries: (underlying) => md.expiries(underlying),
    instrument: (symbol) => md.instrument(symbol),
    quote: (symbol) => md.quote(symbol),
    status: () => md.status(),
    on: (event, listener) => md.on(event, listener),
  };
}
