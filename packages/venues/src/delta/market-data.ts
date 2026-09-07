/**
 * Façade: instruments from REST, quotes seeded from REST and kept fresh from the WebSocket,
 * chains built on demand from the instrument list (ADR-006).
 */
import { Emitter } from "../emitter.js";
import type { ChainSnapshot, Expiry, Instrument, Quote } from "../types.js";
import type { WebSocketCtor, BackoffOptions } from "../ws/reconnecting.js";
import { buildChain, listExpiries } from "./chain.js";
import { resolveExpiryCode } from "./normalize.js";
import type { DeltaContractType, FetchLike } from "./rest.js";
import { DeltaRestClient } from "./rest.js";
import type { DeltaTickerChannel } from "./ws.js";
import { DeltaWsClient } from "./ws.js";

export interface DeltaMarketDataOptions {
  /** e.g. "https://api.india.delta.exchange". */
  restUrl: string;
  /** e.g. "wss://socket.india.delta.exchange". */
  wsUrl: string;
  channel?: DeltaTickerChannel;
  fetch?: FetchLike;
  WebSocket?: WebSocketCtor;
  sleep?: (ms: number) => Promise<void>;
  backoff?: Partial<BackoffOptions>;
  heartbeatMs?: number;
  now?: () => number;
  /** Contract types loaded by `load()` (default: call and put options). */
  contractTypes?: readonly DeltaContractType[];
}

export interface MarketDataStatus {
  instruments: number;
  quotes: number;
  socket: DeltaWsClient["state"];
  subscribed: number;
}

export interface DeltaMarketDataEvents extends Record<string, unknown> {
  /** Every normalised quote (REST seed and WS ticks). */
  ticker: Quote;
  /** Socket lifecycle changes. */
  status: MarketDataStatus;
  error: Error;
}

const DEFAULT_CONTRACT_TYPES: readonly DeltaContractType[] = ["call_options", "put_options"];

export class DeltaMarketData extends Emitter<DeltaMarketDataEvents> {
  readonly rest: DeltaRestClient;
  readonly ws: DeltaWsClient;
  private readonly now: () => number;
  private readonly contractTypes: readonly DeltaContractType[];
  private instrumentList: Instrument[] = [];
  private readonly bySymbol = new Map<string, Instrument>();
  private readonly quotes = new Map<number, Quote>();

  constructor(options: DeltaMarketDataOptions) {
    super();
    this.now = options.now ?? Date.now;
    this.contractTypes = options.contractTypes ?? DEFAULT_CONTRACT_TYPES;
    this.rest = new DeltaRestClient({
      baseUrl: options.restUrl,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.sleep ? { sleep: options.sleep } : {}),
      now: this.now,
    });
    this.ws = new DeltaWsClient({
      url: options.wsUrl,
      ...(options.channel ? { channel: options.channel } : {}),
      ...(options.WebSocket ? { WebSocket: options.WebSocket } : {}),
      ...(options.backoff ? { backoff: options.backoff } : {}),
      ...(options.heartbeatMs !== undefined ? { heartbeatMs: options.heartbeatMs } : {}),
      now: this.now,
    });
    this.ws.on("ticker", (quote) => this.accept(quote));
    this.ws.on("error", (error) => this.emit("error", error));
    for (const event of ["open", "close", "reconnect"] as const) {
      this.ws.on(event, () => this.emit("status", this.status()));
    }
  }

  /** Load the instrument list and seed quotes from REST tickers. Safe to call again to refresh. */
  async load(): Promise<{ instruments: number; quotes: number }> {
    const instruments = await this.rest.getProducts({ contractTypes: this.contractTypes, states: ["live"] });
    this.instrumentList = instruments;
    this.bySymbol.clear();
    for (const instrument of instruments) this.bySymbol.set(instrument.symbol, instrument);
    const seeded = await this.rest.getTickers({ contractTypes: this.contractTypes });
    for (const quote of seeded) this.accept(quote);
    return { instruments: instruments.length, quotes: seeded.length };
  }

  /** Connect the WebSocket (subscriptions made with `watch` are sent on open). */
  start(): void {
    this.ws.connect();
  }

  /** Close the WebSocket for good; cached instruments and quotes stay readable. */
  stop(): void {
    this.ws.close();
    this.emit("status", this.status());
  }

  /** Subscribe every option of one underlying/expiry; returns the symbols subscribed. */
  watch(underlying: string, expiry: string): string[] {
    const symbols = this.symbolsFor(underlying, expiry);
    this.ws.subscribe(symbols);
    return symbols;
  }

  unwatch(underlying: string, expiry: string): string[] {
    const symbols = this.symbolsFor(underlying, expiry);
    this.ws.unsubscribe(symbols);
    return symbols;
  }

  /** Chain for the underlying/expiry from the latest quotes (throws UnknownExpiryError when unknown). */
  chain(underlying: string, expiry: string): ChainSnapshot {
    return buildChain({
      instruments: this.instrumentList,
      quotes: this.quotes,
      underlying,
      expiry,
      nowMs: this.now(),
    });
  }

  expiries(underlying: string): Expiry[] {
    return listExpiries(this.instrumentList, underlying, this.now());
  }

  instruments(): readonly Instrument[] {
    return this.instrumentList;
  }

  instrument(symbol: string): Instrument | undefined {
    return this.bySymbol.get(symbol);
  }

  quote(symbol: string): Quote | undefined {
    const instrument = this.bySymbol.get(symbol);
    return instrument ? this.quotes.get(instrument.id) : undefined;
  }

  status(): MarketDataStatus {
    return {
      instruments: this.instrumentList.length,
      quotes: this.quotes.size,
      socket: this.ws.state,
      subscribed: this.ws.symbols.length,
    };
  }

  private symbolsFor(underlying: string, expiry: string): string[] {
    const code = resolveExpiryCode(expiry);
    return this.instrumentList
      .filter((i) => i.underlying === underlying && i.expiryCode === code && (i.kind === "call" || i.kind === "put"))
      .map((i) => i.symbol);
  }

  private accept(quote: Quote): void {
    const current = this.quotes.get(quote.instrumentId);
    if (current && current.venueTs > quote.venueTs) return; // keep the newer quote
    this.quotes.set(quote.instrumentId, quote);
    this.emit("ticker", quote);
  }
}

export function createDeltaMarketData(options: DeltaMarketDataOptions): DeltaMarketData {
  return new DeltaMarketData(options);
}
