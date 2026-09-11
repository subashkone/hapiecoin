/**
 * In-memory MarketDataLike built on the real venues chain builder and the recorded fixtures, so feed
 * tests exercise the real instrument list (ADR-006) without any network.
 */
import { Emitter, buildChain, listExpiries } from "@hapiecoin/venues";
import type {
  ChainSnapshot,
  DeltaMarketDataEvents,
  Expiry,
  Instrument,
  MarketDataStatus,
  Quote,
  SocketState,
} from "@hapiecoin/venues";
import type { MarketDataLike } from "../feed/market-data.js";
import { NOW, fixtureInstruments, fixtureQuotes } from "./fixtures.js";

export class FakeMarketData extends Emitter<DeltaMarketDataEvents> implements MarketDataLike {
  readonly instrumentList: Instrument[];
  readonly seeds: Quote[];
  readonly quotes = new Map<number, Quote>();
  readonly bySymbol = new Map<string, Instrument>();
  readonly watchCalls: string[] = [];
  readonly unwatchCalls: string[] = [];
  readonly symbols = new Set<string>();
  readonly symbolCalls: { op: "sub" | "unsub"; symbols: string[] }[] = [];
  /** `true` rejects load() with an Error; a string rejects with that raw value (non-Error rejection path). */
  failLoad: boolean | string = false;
  loads = 0;
  socket: SocketState = "idle";
  nowMs = NOW;

  constructor(options: { seed?: boolean; instruments?: Instrument[]; quotes?: Quote[] } = {}) {
    super();
    this.instrumentList = options.instruments ?? fixtureInstruments();
    for (const instrument of this.instrumentList) this.bySymbol.set(instrument.symbol, instrument);
    this.seeds = options.seed === false ? [] : (options.quotes ?? fixtureQuotes());
  }

  load(): Promise<{ instruments: number; quotes: number }> {
    this.loads += 1;
    if (this.failLoad === true) return Promise.reject(new Error("rest down"));
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- exercises the feed's non-Error rejection path
    if (this.failLoad !== false) return Promise.reject(this.failLoad);
    for (const seed of this.seeds) this.accept(seed);
    return Promise.resolve({ instruments: this.instrumentList.length, quotes: this.seeds.length });
  }

  start(): void {
    this.socket = "open";
    this.emit("status", this.status());
  }

  stop(): void {
    this.socket = "closed";
  }

  watch(underlying: string, expiry: string): string[] {
    const symbols = this.symbolsFor(underlying, expiry);
    this.watchCalls.push(`${underlying}:${expiry}`);
    for (const symbol of symbols) this.symbols.add(symbol);
    return symbols;
  }

  unwatch(underlying: string, expiry: string): string[] {
    const symbols = this.symbolsFor(underlying, expiry);
    this.unwatchCalls.push(`${underlying}:${expiry}`);
    for (const symbol of symbols) this.symbols.delete(symbol);
    return symbols;
  }

  subscribeSymbols(symbols: readonly string[]): void {
    this.symbolCalls.push({ op: "sub", symbols: [...symbols] });
    for (const symbol of symbols) this.symbols.add(symbol);
  }

  unsubscribeSymbols(symbols: readonly string[]): void {
    this.symbolCalls.push({ op: "unsub", symbols: [...symbols] });
    for (const symbol of symbols) this.symbols.delete(symbol);
  }

  chain(underlying: string, expiry: string): ChainSnapshot {
    return buildChain({
      instruments: this.instrumentList,
      quotes: this.quotes,
      underlying,
      expiry,
      nowMs: this.nowMs,
    });
  }

  expiries(underlying: string): Expiry[] {
    return listExpiries(this.instrumentList, underlying, this.nowMs);
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
      socket: this.socket,
      subscribed: this.symbols.size,
    };
  }

  /** Simulate a socket tick. */
  tick(quote: Quote): void {
    this.accept(quote);
  }

  emitError(error: Error): void {
    this.emit("error", error);
  }

  /** Copy of the REST seed quote for `symbol` with overrides and a venue timestamp `plusMs` after the seed's. */
  later(symbol: string, overrides: Partial<Quote> = {}, plusMs = 1_000): Quote {
    const base = this.seeds.find((q) => q.symbol === symbol);
    if (!base) throw new Error(`no seeded quote for ${symbol}`);
    return { ...base, ...overrides, venueTs: base.venueTs + plusMs, receivedAt: base.receivedAt + plusMs };
  }

  private symbolsFor(underlying: string, expiry: string): string[] {
    return this.instrumentList
      .filter((i) => i.underlying === underlying && (i.expiryDate === expiry || i.expiryCode === expiry))
      .map((i) => i.symbol);
  }

  private accept(quote: Quote): void {
    this.quotes.set(quote.instrumentId, quote);
    this.emit("ticker", quote);
  }
}
