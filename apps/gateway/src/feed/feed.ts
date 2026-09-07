/**
 * MarketFeed: one Delta market-data session shared by every connection.
 *
 * - Keeps the instrument list and the latest schema Quote per symbol (from the REST seed and the socket).
 * - `snapshot(topic)` builds chain rows from the instrument list only (ADR-006) through the schema adapter.
 * - Publishes per-topic QuoteDeltas through the Coalescer (only changed fields, monotonic `seq`).
 * - Reference-counts upstream subscriptions: a chain's option symbols are subscribed on Delta while at
 *   least one client holds the topic and unsubscribed `graceMs` after the last one leaves, so a page
 *   reload does not churn the venue socket.
 * - Spot topics subscribe the underlying's perpetual (`BTCUSD`, ...) whose ticks carry `spot_price`;
 *   spot is also learnt from every option quote (all Delta tickers carry it).
 * - `fut:` topics are accepted by the schema but not served in Phase 1 (`supports()` is false).
 */
import type { ChainRow, QuoteDelta, Quote as SchemaQuote, Topic, Underlying } from "@hapiecoin/schema";
import { ChainSnapshot, UNDERLYINGS, chainTopic, parseTopic } from "@hapiecoin/schema";
import type { MarketDataStatus, Quote as VenueQuote } from "@hapiecoin/venues";
import { toSchemaChainRows, toSchemaQuote } from "@hapiecoin/venues";
import type { Logger } from "../log.js";
import type { PubSub } from "../pubsub/types.js";
import { silentLogger } from "../log.js";
import { Coalescer } from "./coalescer.js";
import { quoteDelta } from "./diff.js";
import type { MarketDataLike } from "./market-data.js";

/** Perpetual symbol whose ticker carries the underlying's spot price (Delta India naming: `<asset>USD`). */
export const SPOT_SYMBOLS: Record<Underlying, string> = { BTC: "BTCUSD", ETH: "ETHUSD", XAUT: "XAUTUSD" };

export interface MarketFeedOptions {
  market: MarketDataLike;
  pubsub: PubSub;
  coalesceMs: number;
  /** Keep upstream subscriptions this long after the last client leaves (default 30 s). */
  graceMs?: number;
  /** Re-load the instrument list this often; 0 disables (default 5 min). */
  refreshMs?: number;
  /** Retry delay after a failed load (default 10 s). */
  retryMs?: number;
  now?: () => number;
  log?: Logger;
}

export interface SpotState {
  p: string;
  ts: number;
}

export interface FeedStatus {
  /** True once the instrument list has loaded. */
  ready: boolean;
  market: MarketDataStatus;
  /** Upcoming expiries per underlying (YYYY-MM-DD, ascending), from the instrument list. */
  expiries: Record<Underlying, string[]>;
  spot: Record<Underlying, string | null>;
  /** Topics with at least one client. */
  topics: number;
  pending: number;
  loadedAt: number | null;
  lastError: string | null;
}

export interface Snapshot {
  seq: number;
  rows: ChainRow[];
}

interface RefEntry {
  count: number;
  grace: ReturnType<typeof setTimeout> | null;
}

function isUnderlying(value: string): value is Underlying {
  return (UNDERLYINGS as readonly string[]).includes(value);
}

export class MarketFeed {
  private readonly market: MarketDataLike;
  private readonly pubsub: PubSub;
  private readonly coalescer: Coalescer;
  private readonly graceMs: number;
  private readonly refreshMs: number;
  private readonly retryMs: number;
  private readonly now: () => number;
  private readonly log: Logger;
  private readonly lastQuote = new Map<string, SchemaQuote>();
  private readonly spots = new Map<Underlying, SpotState>();
  private readonly refs = new Map<Topic, RefEntry>();
  private readonly offListeners: (() => void)[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private loadedAt: number | null = null;
  private lastError: string | null = null;
  private running = false;

  constructor(options: MarketFeedOptions) {
    this.market = options.market;
    this.pubsub = options.pubsub;
    this.graceMs = options.graceMs ?? 30_000;
    this.refreshMs = options.refreshMs ?? 300_000;
    this.retryMs = options.retryMs ?? 10_000;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? silentLogger;
    this.coalescer = new Coalescer({
      intervalMs: options.coalesceMs,
      emit: (topic, message) => this.pubsub.publish(topic, message),
    });
  }

  /** Load instruments (retrying in the background on failure), then open the venue socket. Never rejects. */
  async start(): Promise<void> {
    this.running = true;
    this.offListeners.push(this.market.on("ticker", (quote) => this.onTicker(quote)));
    this.offListeners.push(this.market.on("error", (error) => this.log.warn("venue error", { error })));
    this.offListeners.push(
      this.market.on("status", (status) => this.log.info("venue socket", { ...status })),
    );
    await this.load();
    this.market.start();
  }

  stop(): void {
    this.running = false;
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    for (const [topic, entry] of this.refs) {
      if (entry.grace !== null) clearTimeout(entry.grace);
      this.unwatch(topic);
    }
    this.refs.clear();
    for (const off of this.offListeners) off();
    this.offListeners.length = 0;
    this.coalescer.close();
    this.market.stop();
  }

  status(): FeedStatus {
    const expiries = {} as Record<Underlying, string[]>;
    const spot = {} as Record<Underlying, string | null>;
    for (const underlying of UNDERLYINGS) {
      expiries[underlying] =
        this.loadedAt === null
          ? []
          : this.market
              .expiries(underlying)
              .filter((e) => e.dte > 0)
              .map((e) => e.date);
      spot[underlying] = this.spots.get(underlying)?.p ?? null;
    }
    return {
      ready: this.loadedAt !== null,
      market: this.market.status(),
      expiries,
      spot,
      topics: this.refs.size,
      pending: this.coalescer.pending(),
      loadedAt: this.loadedAt,
      lastError: this.lastError,
    };
  }

  /** True for topics this feed can serve (chain and spot; `fut:` comes with the futures ticker in Phase 2). */
  supports(topic: Topic): boolean {
    const parsed = parseTopic(topic);
    return parsed !== null && parsed.kind !== "fut";
  }

  /** Last flushed sequence number for a topic. */
  seq(topic: Topic): number {
    return this.coalescer.seq(topic);
  }

  /**
   * Chain rows for a chain topic (strikes from the instrument list), or null when the expiry is unknown.
   * The snapshot is validated with `ChainSnapshot.parse` before it leaves the gateway (ADR-014); a chain
   * that fails validation is logged and withheld rather than sent half-formed.
   */
  snapshot(topic: Topic): Snapshot | null {
    const parsed = parseTopic(topic);
    if (parsed === null || parsed.kind !== "chain") return null;
    let chain;
    try {
      chain = this.market.chain(parsed.underlying, parsed.expiry);
    } catch (error) {
      this.log.debug("snapshot unavailable", { topic, error: error as Error });
      return null;
    }
    const spot = chain.spot ?? this.spots.get(parsed.underlying)?.p ?? null;
    const validated = ChainSnapshot.safeParse({
      venue: "delta_india",
      underlying: parsed.underlying,
      expiry: parsed.expiry,
      ts: this.now(),
      spot: spot ?? "0",
      rows:
        spot === null
          ? chain.rows.map((row) => ({ strike: row.strike }))
          : toSchemaChainRows(chain.rows, spot),
    });
    if (!validated.success) {
      this.log.error("snapshot failed schema validation", {
        topic,
        issues: validated.error.issues.slice(0, 3),
      });
      return null;
    }
    return { seq: this.coalescer.seq(topic), rows: validated.data.rows };
  }

  spot(underlying: Underlying): SpotState | null {
    return this.spots.get(underlying) ?? null;
  }

  /** A client subscribed: on the first holder start the upstream subscription (cancelling any grace timer). */
  acquire(topic: Topic): void {
    const entry = this.refs.get(topic);
    if (entry) {
      entry.count += 1;
      if (entry.grace !== null) {
        clearTimeout(entry.grace);
        entry.grace = null;
      }
      return;
    }
    this.refs.set(topic, { count: 1, grace: null });
    this.watch(topic);
  }

  /** A client left: when the last holder leaves, keep the upstream subscription for `graceMs`, then drop it. */
  release(topic: Topic): void {
    const entry = this.refs.get(topic);
    if (!entry) return;
    entry.count -= 1;
    if (entry.count > 0) return;
    entry.grace = setTimeout(() => {
      this.refs.delete(topic);
      this.unwatch(topic);
    }, this.graceMs);
  }

  /** Holder count for a topic (tests and metrics). */
  holders(topic: Topic): number {
    return this.refs.get(topic)?.count ?? 0;
  }

  private watch(topic: Topic): void {
    const parsed = parseTopic(topic);
    if (parsed === null || parsed.kind === "fut") return;
    if (parsed.kind === "chain") this.market.watch(parsed.underlying, parsed.expiry);
    else this.market.subscribeSymbols([SPOT_SYMBOLS[parsed.underlying]]);
  }

  private unwatch(topic: Topic): void {
    const parsed = parseTopic(topic);
    if (parsed === null || parsed.kind === "fut") return;
    if (parsed.kind === "chain") this.market.unwatch(parsed.underlying, parsed.expiry);
    else this.market.unsubscribeSymbols([SPOT_SYMBOLS[parsed.underlying]]);
  }

  private async load(): Promise<void> {
    try {
      const loaded = await this.market.load();
      this.loadedAt = this.now();
      this.lastError = null;
      this.log.info("instruments loaded", { ...loaded });
      this.rewatchHeldChains();
      this.scheduleLoad(this.refreshMs);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.log.error("instrument load failed", { error: error as Error });
      this.scheduleLoad(this.retryMs);
    }
  }

  /**
   * A refreshed instrument list can hold strikes listed since the last load. Re-watching every held chain
   * topic subscribes just those (the venue socket sends only symbols it is not already subscribed to), so
   * the new rows get quotes instead of sitting empty until the last client leaves (GAPS #28).
   */
  private rewatchHeldChains(): void {
    for (const topic of this.refs.keys()) {
      const parsed = parseTopic(topic);
      if (parsed !== null && parsed.kind === "chain") this.market.watch(parsed.underlying, parsed.expiry);
    }
  }

  private scheduleLoad(delayMs: number): void {
    if (!this.running || delayMs <= 0) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.load();
    }, delayMs);
  }

  private onTicker(quote: VenueQuote): void {
    const instrument = this.market.instrument(quote.symbol);
    const underlying = instrument?.underlying ?? underlyingForSpotSymbol(quote.symbol);
    if (underlying === null || !isUnderlying(underlying)) return;
    this.updateSpot(underlying, quote);
    if (
      !instrument ||
      (instrument.kind !== "call" && instrument.kind !== "put") ||
      instrument.expiryDate === null
    )
      return;

    const topic = chainTopic("delta_india", underlying, instrument.expiryDate);
    let next: SchemaQuote;
    try {
      next = toSchemaQuote(quote, this.spots.get(underlying)?.p ?? null);
    } catch (error) {
      this.log.debug("quote skipped", { symbol: quote.symbol, error: error as Error });
      return;
    }
    const delta: QuoteDelta | null = quoteDelta(this.lastQuote.get(quote.symbol), next);
    this.lastQuote.set(quote.symbol, next);
    if (delta === null || !this.refs.has(topic)) return;
    this.coalescer.addQuote(topic, delta);
  }

  private updateSpot(underlying: Underlying, quote: VenueQuote): void {
    if (quote.spot === null) return;
    const current = this.spots.get(underlying);
    if (current && current.ts > quote.venueTs) return;
    if (current && current.p === quote.spot) {
      current.ts = quote.venueTs;
      return;
    }
    this.spots.set(underlying, { p: quote.spot, ts: quote.venueTs });
    this.coalescer.setSpot(underlying, { p: quote.spot });
  }
}

function underlyingForSpotSymbol(symbol: string): Underlying | null {
  for (const underlying of UNDERLYINGS) {
    if (SPOT_SYMBOLS[underlying] === symbol) return underlying;
  }
  return null;
}
