/**
 * Deribit session: instruments per currency over REST (one call per underlying, the endpoint allows one per
 * second), quotes seeded from the book summary and kept fresh from `ticker.<name>.100ms`, chains on demand.
 */
import { Emitter } from "../emitter.js";
import { carryOpenInterest } from "../open-interest.js";
import type { MarketDataEvents, MarketDataStatus, VenueMarketData, VenueMarketDataOptions } from "../market-data.js";
import type { ChainSnapshot, Expiry, Instrument, Quote } from "../types.js";
import { buildChain, listExpiries } from "../delta/chain.js";
import { resolveExpiryCode } from "../delta/normalize.js";
import { toDeribitQuote } from "./normalize.js";
import { DeribitRestClient } from "./rest.js";
import { type DeribitTickerInterval, DeribitWsClient } from "./ws.js";

export interface DeribitMarketDataOptions extends VenueMarketDataOptions {
  /** Currencies whose options are loaded (default BTC and ETH). */
  underlyings?: readonly string[] | undefined;
}

const DEFAULT_UNDERLYINGS: readonly string[] = ["BTC", "ETH"];

function intervalOf(channel: string | undefined): DeribitTickerInterval {
  return channel === "agg2" ? "agg2" : "100ms";
}

export class DeribitMarketData extends Emitter<MarketDataEvents> implements VenueMarketData {
  readonly rest: DeribitRestClient;
  readonly ws: DeribitWsClient;
  private readonly now: () => number;
  private readonly underlyings: readonly string[];
  private instrumentList: Instrument[] = [];
  private readonly bySymbol = new Map<string, Instrument>();
  private readonly quotes = new Map<number, Quote>();

  constructor(options: DeribitMarketDataOptions) {
    super();
    this.now = options.now ?? Date.now;
    this.underlyings = options.underlyings ?? DEFAULT_UNDERLYINGS;
    this.rest = new DeribitRestClient({ baseUrl: options.restUrl, fetch: options.fetch, sleep: options.sleep, now: this.now });
    this.ws = new DeribitWsClient({
      url: options.wsUrl,
      interval: intervalOf(options.channel),
      ...(options.WebSocket ? { WebSocket: options.WebSocket } : {}),
      ...(options.backoff ? { backoff: options.backoff } : {}),
      ...(options.heartbeatMs !== undefined ? { heartbeatMs: options.heartbeatMs } : {}),
    });
    this.ws.on("ticker", (raw) => {
      const instrument = this.bySymbol.get(raw.instrument_name);
      // options are quoted in the coin (converted to USD with the index); the perpetual is quoted in USD already
      const quote = instrument ? toDeribitQuote(raw, instrument.id, this.now(), { usdPriced: instrument.kind !== "call" && instrument.kind !== "put" }) : null;
      if (quote) this.accept(quote);
    });
    this.ws.on("error", (error) => this.emit("error", error));
    for (const event of ["open", "close", "reconnect"] as const) {
      this.ws.on(event, () => this.emit("status", this.status()));
    }
  }

  async load(): Promise<{ instruments: number; quotes: number }> {
    const instruments: Instrument[] = [];
    for (const currency of this.underlyings) instruments.push(...(await this.rest.getInstruments(currency)));
    this.instrumentList = instruments;
    const knownPerpetuals = [...this.bySymbol.values()].filter((i) => i.kind === "perpetual");
    this.bySymbol.clear();
    const ids = new Map<string, number>();
    for (const instrument of instruments) {
      this.bySymbol.set(instrument.symbol, instrument);
      ids.set(instrument.symbol, instrument.id);
    }
    // the perpetual is known by symbol only (not listed as an option): its ticker carries the index the gateway serves as spot (ADR-071).
    // Optional: a failed futures listing keeps the option chain (and the spot the option quotes carry); the error is reported, not thrown
    for (const currency of this.underlyings) {
      try {
        for (const future of await this.rest.getInstruments(currency, "future")) if (future.kind === "perpetual") this.bySymbol.set(future.symbol, future);
      } catch (error) {
        // the perpetuals of the previous load stay known, so a subscribed perpetual keeps ticking through a failed refresh
        for (const perpetual of knownPerpetuals) if (perpetual.underlying === currency && !this.bySymbol.has(perpetual.symbol)) this.bySymbol.set(perpetual.symbol, perpetual);
        this.emit("error", error instanceof Error ? error : new Error(String(error)));
      }
    }
    let seeded = 0;
    for (const currency of this.underlyings) {
      const quotes = await this.rest.getBookSummary(currency, ids);
      for (const quote of quotes) this.accept(quote);
      seeded += quotes.length;
    }
    return { instruments: instruments.length, quotes: seeded };
  }

  start(): void {
    this.ws.connect();
  }

  stop(): void {
    this.ws.close();
    this.emit("status", this.status());
  }

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

  subscribeSymbols(symbols: readonly string[]): void {
    this.ws.subscribe(symbols);
  }

  unsubscribeSymbols(symbols: readonly string[]): void {
    this.ws.unsubscribe(symbols);
  }

  chain(underlying: string, expiry: string): ChainSnapshot {
    return buildChain({ instruments: this.instrumentList, quotes: this.quotes, underlying, expiry, nowMs: this.now() });
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
    return { instruments: this.instrumentList.length, quotes: this.quotes.size, socket: this.ws.state, subscribed: this.ws.symbols.length };
  }

  private symbolsFor(underlying: string, expiry: string): string[] {
    const code = resolveExpiryCode(expiry);
    return this.instrumentList.filter((i) => i.underlying === underlying && i.expiryCode === code && (i.kind === "call" || i.kind === "put")).map((i) => i.symbol);
  }

  private accept(quote: Quote): void {
    const current = this.quotes.get(quote.instrumentId);
    if (current && current.venueTs > quote.venueTs) return;
    const next = carryOpenInterest(current, quote); // GAPS #15: a ticker without open_interest keeps the last figure
    this.quotes.set(quote.instrumentId, next);
    this.emit("ticker", next);
  }
}

export function createDeribitMarketData(options: DeribitMarketDataOptions): DeribitMarketData {
  return new DeribitMarketData(options);
}
