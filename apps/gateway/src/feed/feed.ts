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
import type { ChainRow, QuoteDelta, Quote as SchemaQuote, ServerMessage, Topic, Underlying } from "@hapiecoin/schema";
import { ChainSnapshot, UNDERLYINGS, canonicalTopic, chainTopic, parseTopic } from "@hapiecoin/schema";
import type { MarketDataStatus, Quote as VenueQuote } from "@hapiecoin/venues";
import type { Venue as VenueId } from "@hapiecoin/schema";
import { DEFAULT_VENUE, getVenueCore, ownMarket, toSchemaChainRows, toSchemaQuote } from "@hapiecoin/venues";
import type { Logger } from "../log.js";
import type { PubSub } from "../pubsub/types.js";
import type { SnapshotStore } from "../coordination/snapshots.js";
import { silentLogger } from "../log.js";
import { Coalescer } from "./coalescer.js";
import { quoteDelta } from "./diff.js";
import type { MarketDataLike } from "./market-data.js";

/** The perpetual whose ticker carries `underlying`'s spot on `venue`, from the venue port; null when the venue lists no such market (ADR-071). */
export function spotSymbolFor(venue: VenueId, underlying: Underlying): string | null {
  return ownMarket(getVenueCore(venue).markets, underlying)?.perpetualSymbol ?? null;
}

const spotKey = (venue: VenueId, underlying: Underlying): string => `${venue}:${underlying}`;

export interface MarketFeedOptions {
  /** The default venue's session (the flat `expiries` and `spot` in the status come from it). */
  market: MarketDataLike;
  /** ADR-067: sessions of the other enabled venues, keyed by schema venue id. */
  markets?: Partial<Record<VenueId, MarketDataLike>> | undefined;
  pubsub: PubSub;
  coalesceMs: number;
  /** Keep upstream subscriptions this long after the last client leaves (default 30 s). */
  graceMs?: number;
  /** Re-load the instrument list this often; 0 disables (default 5 min). */
  refreshMs?: number;
  /** Retry delay after a failed load (default 10 s). */
  retryMs?: number;
  /** ADR-062: when set, the leader writes each held chain's rows + seq and every spot here for follower gateways. */
  store?: SnapshotStore | undefined;
  /** Minimum interval between two snapshot writes of a changing topic (default 2 s; followers wait 2.5 s for a first one). */
  snapshotWriteMs?: number;
  /** Every held chain is rewritten at least this often even without ticks, so the store entry never expires under a follower (default 20 s). */
  snapshotKeepaliveMs?: number;
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
  /** ADR-067 / ADR-071: every enabled venue's socket status, live expiries and spot per underlying. */
  venues: Record<string, { market: MarketDataStatus; expiries: Record<Underlying, string[]>; spot: Record<Underlying, string | null> }>;
  /** Set by the role wrapper (ADR-062); a bare MarketFeed is the leader. */
  role?: "leader" | "follower";
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
  /** Every session, the default venue's first (ADR-067). */
  private readonly sessions = new Map<VenueId, MarketDataLike>();
  private readonly loadedVenues = new Set<VenueId>();
  private readonly pubsub: PubSub;
  private readonly coalescer: Coalescer;
  private readonly graceMs: number;
  private readonly refreshMs: number;
  private readonly retryMs: number;
  private readonly now: () => number;
  private readonly log: Logger;
  private readonly lastQuote = new Map<string, SchemaQuote>();
  /** Spot per `${venue}:${underlying}` (ADR-071). */
  private readonly spots = new Map<string, SpotState>();
  private readonly refs = new Map<Topic, RefEntry>();
  /** Topics other gateways hold (ADR-062); watched upstream like local ones, never counted as local holders. */
  private readonly remote = new Set<Topic>();
  private readonly store: SnapshotStore | null;
  private readonly snapshotWriteMs: number;
  private readonly snapshotKeepaliveMs: number;
  private readonly dirty = new Set<Topic>();
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private upstream = false;
  private readonly offListeners: (() => void)[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private loadedAt: number | null = null;
  /** Venues whose last load failed: retried after `retryMs` on their own, the healthy ones keep the refresh cadence (ADR-067). */
  private readonly failedVenues = new Set<VenueId>();
  private nextRefreshAt = 0;
  private lastError: string | null = null;
  private running = false;

  constructor(options: MarketFeedOptions) {
    this.market = options.market;
    this.sessions.set(DEFAULT_VENUE, options.market);
    for (const [venue, session] of Object.entries(options.markets ?? {}) as [VenueId, MarketDataLike][]) if (venue !== DEFAULT_VENUE) this.sessions.set(venue, session);
    this.pubsub = options.pubsub;
    this.graceMs = options.graceMs ?? 30_000;
    this.refreshMs = options.refreshMs ?? 300_000;
    this.retryMs = options.retryMs ?? 10_000;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? silentLogger;
    this.store = options.store ?? null;
    this.snapshotWriteMs = options.snapshotWriteMs ?? 2_000;
    this.snapshotKeepaliveMs = options.snapshotKeepaliveMs ?? 20_000;
    this.coalescer = new Coalescer({
      intervalMs: options.coalesceMs,
      emit: (topic, message) => {
        this.pubsub.publish(topic, message);
        this.afterEmit(topic, message);
      },
    });
  }

  /** Load instruments (retrying in the background on failure), then open the venue socket. Never rejects. */
  async start(): Promise<void> {
    await this.startFollower();
    this.promote();
  }

  /** ADR-062: load and keep refreshing the instrument list, but open no socket and watch nothing (a follower gateway). */
  async startFollower(): Promise<void> {
    if (this.running) return;
    this.running = true;
    // the venue listeners run in every mode: REST seeds and (as leader) socket ticks keep the quote and spot caches
    for (const [venue, session] of this.sessions) {
      this.offListeners.push(session.on("ticker", (quote) => this.onTicker(venue, session, quote)));
      this.offListeners.push(session.on("error", (error) => this.log.warn("venue error", { venue, error })));
      this.offListeners.push(session.on("status", (status) => this.log.info("venue socket", { venue, ...status })));
    }
    await this.load();
  }

  /** ADR-062: become the feed: listen to the venue, open the socket, watch every held topic. */
  promote(): void {
    if (this.upstream) return;
    this.upstream = true;
    for (const session of this.sessions.values()) session.start();
    this.rewatchHeld();
    if (this.store !== null && this.keepaliveTimer === null) this.keepaliveTimer = setInterval(() => this.keepalive(), this.snapshotKeepaliveMs);
    // the spots learnt from the REST seeds go to the store at once, so followers have one before the first tick
    if (this.store !== null)
      for (const [key, spot] of this.spots) {
        const [venue, underlying] = key.split(":") as [VenueId, Underlying];
        this.store.putSpot(venue, underlying, { p: spot.p, ts: spot.ts }).catch((error: unknown) => this.log.warn("spot store write failed", { error: toError(error) }));
      }
  }

  /** ADR-062: stop being the feed: drop every upstream subscription and close the socket; holders are kept. */
  demote(): void {
    if (!this.upstream) return;
    for (const [topic, entry] of this.refs) {
      if (entry.grace !== null) {
        clearTimeout(entry.grace);
        this.refs.delete(topic);
      }
      this.unwatch(topic);
    }
    for (const topic of this.remote) this.unwatch(topic);
    this.remote.clear();
    this.upstream = false;
    if (this.keepaliveTimer !== null) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    if (this.writeTimer !== null) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    this.dirty.clear();
    this.coalescer.close();
    for (const session of this.sessions.values()) session.stop();
  }

  /** True while this feed owns the venue socket. */
  isUpstream(): boolean {
    return this.upstream;
  }

  stop(): void {
    this.demote();
    this.running = false;
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    for (const entry of this.refs.values()) if (entry.grace !== null) clearTimeout(entry.grace);
    this.refs.clear();
    for (const off of this.offListeners) off();
    this.offListeners.length = 0;
  }

  status(): FeedStatus {
    const spotsOf = (venue: VenueId): Record<Underlying, string | null> => {
      const spot = {} as Record<Underlying, string | null>;
      for (const underlying of UNDERLYINGS) spot[underlying] = this.spots.get(spotKey(venue, underlying))?.p ?? null;
      return spot;
    };
    const venues: FeedStatus["venues"] = {};
    for (const [venue, session] of this.sessions) venues[venue] = { market: session.status(), expiries: this.liveExpiries(venue, session), spot: spotsOf(venue) };
    return {
      ready: this.loadedAt !== null,
      market: this.market.status(),
      expiries: this.liveExpiries(DEFAULT_VENUE, this.market),
      spot: spotsOf(DEFAULT_VENUE),
      venues,
      topics: this.refs.size,
      pending: this.coalescer.pending(),
      loadedAt: this.loadedAt,
      lastError: this.lastError,
    };
  }

  private liveExpiries(venue: VenueId, session: MarketDataLike): Record<Underlying, string[]> {
    const out = {} as Record<Underlying, string[]>;
    for (const underlying of UNDERLYINGS) {
      out[underlying] = this.loadedVenues.has(venue)
        ? session
            .expiries(underlying)
            .filter((e) => e.dte > 0)
            .map((e) => e.date)
        : [];
    }
    return out;
  }

  /** The session of a topic's venue; null when this gateway does not open that venue. */
  private session(venue: VenueId): MarketDataLike | null {
    return this.sessions.get(venue) ?? null;
  }

  /** True for topics this feed can serve: chain topics of an enabled venue and spot topics of an underlying that venue lists (`fut:` comes with the futures ticker in Phase 2). */
  supports(topic: Topic): boolean {
    const parsed = parseTopic(topic);
    if (parsed === null || parsed.kind === "fut" || this.session(parsed.venue) === null) return false;
    return parsed.kind === "chain" || spotSymbolFor(parsed.venue, parsed.underlying) !== null;
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
    const session = this.session(parsed.venue);
    if (session === null) return null;
    let chain;
    try {
      chain = session.chain(parsed.underlying, parsed.expiry);
    } catch (error) {
      this.log.debug("snapshot unavailable", { topic, error: error as Error });
      return null;
    }
    const spot = chain.spot ?? this.spots.get(spotKey(parsed.venue, parsed.underlying))?.p ?? null; // the same venue's index only (ADR-071)
    const validated = ChainSnapshot.safeParse({
      venue: parsed.venue,
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

  /** The last spot of `underlying` on `venue` (the default venue when omitted). */
  spot(underlying: Underlying, venue: string = DEFAULT_VENUE): SpotState | null {
    return this.spots.get(spotKey(venue as VenueId, underlying)) ?? null;
  }

  /** A client subscribed: on the first holder start the upstream subscription (cancelling any grace timer). */
  acquire(raw: Topic): void {
    const topic = canonicalTopic(raw); // ADR-071: the bare spot spelling and the venue form are one hold
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
    if (this.remote.has(topic)) this.markDirty(topic); // another gateway already had it watched
    else this.watch(topic);
  }

  /** A client left: when the last holder leaves, keep the upstream subscription for `graceMs`, then drop it. */
  release(raw: Topic): void {
    const topic = canonicalTopic(raw);
    const entry = this.refs.get(topic);
    if (!entry) return;
    entry.count -= 1;
    if (entry.count > 0) return;
    entry.grace = setTimeout(() => {
      this.refs.delete(topic);
      if (!this.remote.has(topic)) this.unwatch(topic);
    }, this.graceMs);
  }

  /** Holder count for a topic (tests and metrics). */
  holders(raw: Topic): number {
    return this.refs.get(canonicalTopic(raw))?.count ?? 0;
  }

  /**
   * ADR-062: the union of topics other gateways' clients hold, read from the registry by the leader. Newly seen
   * topics are watched upstream (and a first snapshot written for the followers); topics gone from the registry are
   * dropped unless a local client still holds them.
   */
  setRemoteTopics(rawTopics: ReadonlySet<Topic>): void {
    const topics = new Set([...rawTopics].map(canonicalTopic)); // remote holds arrive in either spelling (ADR-071)
    for (const topic of topics) {
      if (this.remote.has(topic)) continue;
      this.remote.add(topic);
      if (!this.refs.has(topic)) this.watch(topic);
      else this.markDirty(topic);
    }
    for (const topic of [...this.remote]) {
      if (topics.has(topic)) continue;
      this.remote.delete(topic);
      if (!this.refs.has(topic)) this.unwatch(topic);
    }
  }

  private heldAnywhere(topic: Topic): boolean {
    return this.refs.has(topic) || this.remote.has(topic);
  }

  /** After every flushed frame: keep the shared snapshot store current for follower gateways (ADR-062). */
  private afterEmit(topic: Topic, message: ServerMessage): void {
    if (this.store === null) return;
    if (message.t === "q") this.markDirty(topic);
    else if (message.t === "spot") {
      this.store.putSpot(message.v ?? DEFAULT_VENUE, message.s, { p: message.p, ts: this.now() }).catch((error: unknown) => this.log.warn("spot store write failed", { error: toError(error) }));
    }
  }

  private markDirty(topic: Topic): void {
    if (this.store === null || !this.upstream) return;
    this.dirty.add(topic);
    if (this.writeTimer !== null) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.writeDirty();
    }, this.snapshotWriteMs);
  }

  private writeDirty(): void {
    const topics = [...this.dirty];
    this.dirty.clear();
    for (const topic of topics) {
      if (!this.heldAnywhere(topic)) continue;
      const snapshot = this.snapshot(topic);
      if (snapshot !== null) this.writeSnapshot(topic, snapshot);
    }
  }

  private watch(topic: Topic): void {
    if (!this.upstream) return; // a follower holds topics in the registry only; the leader watches them
    const parsed = parseTopic(topic);
    if (parsed === null || parsed.kind === "fut") return;
    if (parsed.kind === "chain") {
      const session = this.session(parsed.venue);
      if (session === null) return;
      session.watch(parsed.underlying, parsed.expiry);
      this.announce(topic);
    } else this.spotSession(parsed.venue, parsed.underlying, "sub");
  }

  /** Subscribe or drop the venue's perpetual for a spot topic; nothing when the venue is not open here or lists no such market. */
  private spotSession(venue: VenueId, underlying: Underlying, op: "sub" | "unsub"): void {
    const session = this.session(venue);
    const symbol = spotSymbolFor(venue, underlying);
    if (session === null || symbol === null) return;
    if (op === "sub") session.subscribeSymbols([symbol]);
    else session.unsubscribeSymbols([symbol]);
  }

  /**
   * A chain (re)watched by this leader gets a snapshot frame on the fan-out with the seq its deltas will continue
   * from (ADR-062): after a takeover the new leader's seq starts again, and a client that kept the old leader's seq
   * would otherwise ignore every frame below it; the snapshot resets every subscriber on every gateway. The store
   * is refreshed too so a follower's first frame matches.
   */
  private announce(topic: Topic): void {
    const snapshot = this.snapshot(topic);
    if (snapshot === null) return;
    this.pubsub.publish(topic, { t: "snap", topic, seq: snapshot.seq, rows: snapshot.rows });
    this.writeSnapshot(topic, snapshot); // at once: a follower may be waiting for it
  }

  /** Rewrite every held chain so its store entry outlives quiet spells (a follower must never fall back to stale REST rows). */
  private keepalive(): void {
    for (const topic of new Set([...this.refs.keys(), ...this.remote])) {
      const parsed = parseTopic(topic);
      if (parsed === null || parsed.kind !== "chain") continue;
      const snapshot = this.snapshot(topic);
      if (snapshot !== null) this.writeSnapshot(topic, snapshot);
    }
  }

  private writeSnapshot(topic: Topic, snapshot: Snapshot): void {
    if (this.store === null) return;
    this.store.putSnapshot(topic, { seq: snapshot.seq, rows: snapshot.rows, ts: this.now() }).catch((error: unknown) => this.log.warn("snapshot store write failed", { topic, error: toError(error) }));
  }

  private unwatch(topic: Topic): void {
    if (!this.upstream) return;
    const parsed = parseTopic(topic);
    if (parsed === null || parsed.kind === "fut") return;
    if (parsed.kind === "chain") this.session(parsed.venue)?.unwatch(parsed.underlying, parsed.expiry);
    else this.spotSession(parsed.venue, parsed.underlying, "unsub");
  }

  /**
   * Every session loads in turn; the feed is ready once the default venue has loaded. A failed venue is retried after
   * `retryMs` on its own (a Deribit outage never reloads Delta 30 times an hour); the full pass runs on the refresh cadence (ADR-067).
   */
  private async load(): Promise<void> {
    const full = this.failedVenues.size === 0 || this.now() >= this.nextRefreshAt;
    if (full) this.nextRefreshAt = this.now() + this.refreshMs;
    for (const [venue, session] of this.sessions) {
      if (!full && !this.failedVenues.has(venue)) continue;
      try {
        const loaded = await session.load();
        this.loadedVenues.add(venue);
        this.failedVenues.delete(venue);
        if (venue === DEFAULT_VENUE) {
          this.loadedAt = this.now();
          this.lastError = null;
        }
        this.log.info("instruments loaded", { venue, ...loaded });
      } catch (error) {
        this.failedVenues.add(venue);
        this.lastError = error instanceof Error ? error.message : String(error);
        this.log.error("instrument load failed", { venue, error: error as Error });
      }
    }
    if (this.loadedAt !== null) this.rewatchHeld();
    this.scheduleLoad(this.failedVenues.size > 0 ? this.retryMs : this.refreshMs);
  }

  /**
   * A refreshed instrument list can hold strikes listed since the last load. Re-watching every held chain
   * topic subscribes just those (the venue socket sends only symbols it is not already subscribed to), so
   * the new rows get quotes instead of sitting empty until the last client leaves (GAPS #28).
   */
  private rewatchHeld(): void {
    if (!this.upstream) return;
    for (const topic of new Set([...this.refs.keys(), ...this.remote])) {
      const parsed = parseTopic(topic);
      if (parsed === null || parsed.kind === "fut") continue;
      if (parsed.kind === "chain") {
        const session = this.session(parsed.venue);
        if (session === null) continue;
        session.watch(parsed.underlying, parsed.expiry);
        this.announce(topic);
      } else this.spotSession(parsed.venue, parsed.underlying, "sub");
    }
  }

  private scheduleLoad(delayMs: number): void {
    if (!this.running || delayMs <= 0) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.load();
    }, delayMs);
  }

  private onTicker(venue: VenueId, session: MarketDataLike, quote: VenueQuote): void {
    const instrument = session.instrument(quote.symbol);
    const underlying = instrument?.underlying ?? underlyingForSpotSymbol(venue, quote.symbol);
    if (underlying === null || !isUnderlying(underlying)) return;
    // every quote carries its venue's index: the spot of that venue (ADR-071), never another's
    this.updateSpot(venue, underlying, quote);
    if (
      !instrument ||
      (instrument.kind !== "call" && instrument.kind !== "put") ||
      instrument.expiryDate === null
    )
      return;

    const topic = chainTopic(venue, underlying, instrument.expiryDate);
    let next: SchemaQuote;
    try {
      next = toSchemaQuote(quote, this.spots.get(spotKey(venue, underlying))?.p ?? null);
    } catch (error) {
      this.log.debug("quote skipped", { symbol: quote.symbol, error: error as Error });
      return;
    }
    const key = `${venue}:${quote.symbol}`;
    const delta: QuoteDelta | null = quoteDelta(this.lastQuote.get(key), next);
    this.lastQuote.set(key, next);
    if (!this.upstream || delta === null || !this.heldAnywhere(topic)) return; // a follower only caches
    this.coalescer.addQuote(topic, delta);
  }

  private updateSpot(venue: VenueId, underlying: Underlying, quote: VenueQuote): void {
    if (quote.spot === null) return;
    const key = spotKey(venue, underlying);
    const current = this.spots.get(key);
    if (current && current.ts > quote.venueTs) return;
    if (current && current.p === quote.spot) {
      current.ts = quote.venueTs;
      return;
    }
    this.spots.set(key, { p: quote.spot, ts: quote.venueTs });
    if (this.upstream) this.coalescer.setSpot(venue, underlying, { p: quote.spot });
  }
}

/** The underlying whose perpetual `symbol` is on `venue` (the port's codec), or null. */
function underlyingForSpotSymbol(venue: VenueId, symbol: string): string | null {
  return getVenueCore(venue).symbols.parsePerpetual(symbol);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
