/**
 * The API's venue clients (ADR-070): a trading client for every adapter that trades (the broker's venue picks it), a
 * public REST client, a snapshotter source, a live spot and a rules tick for every venue in API_VENUES. main.ts wires
 * them into `deps` and the background jobs; the test harness gives tests a fake per trading venue.
 */
import type { Underlying, Venue } from "@hapiecoin/schema";
import { DEFAULT_VENUE, type DeltaTradingClient, type FetchLike, VenueCapabilityError, type VenueAdapter, type VenueRest, getVenue, listVenues, tradingClientOf } from "@hapiecoin/venues";
import type { Config } from "./config.js";
import type { MarketSource } from "./iv-snapshot.js";
import type { RulesTick } from "./rules-engine.js";

export interface VenueClients {
  /** The venues whose public market data this API reads (API_VENUES). */
  venues: readonly Venue[];
  /** The trading client of a venue that trades; a data-only or unknown venue throws VenueCapabilityError (the routes refuse earlier with a 409). */
  tradingFor(venue: string): DeltaTradingClient;
  /** The public REST client of an enabled venue; null for a venue this API does not read. */
  restFor(venue: string): VenueRest | null;
  /** One snapshotter source per enabled venue, through that venue's schema bridge (venue-stamped rows, ADR-065). */
  sources: readonly MarketSource[];
  /** The spot of `asset` on `venue` from the public tickers; null without a source or a spot. */
  liveSpot(asset: Underlying, venue: string): Promise<number | null>;
  /** The rules tick for `asset` on `venue`: marks keyed by venue symbol plus the spot; null for a venue this API does not read. */
  tick(asset: Underlying, venue: string): Promise<RulesTick | null>;
}

export interface VenueClientOptions {
  /** Injected transport for tests. */
  fetch?: FetchLike | undefined;
}

export function createVenueClients(config: Pick<Config, "apiVenues" | "venueRestUrls" | "deltaTradingRestUrl" | "nodeEnv">, opts: VenueClientOptions = {}): VenueClients {
  const trading = new Map<string, DeltaTradingClient>();
  for (const adapter of listVenues()) {
    if (adapter.trading === undefined) continue; // data-only (ADR-067): no client, so no order can ever be built for it
    // the default venue keeps its private (testnet-capable) base URL; another trading venue signs against its REST base
    const baseUrl = adapter.id === DEFAULT_VENUE ? config.deltaTradingRestUrl : config.venueRestUrls[adapter.id];
    trading.set(adapter.id, tradingClientOf(adapter, { baseUrl, nodeEnv: config.nodeEnv, ...(opts.fetch ? { fetch: opts.fetch } : {}) }));
  }
  const rest = new Map<string, { adapter: VenueAdapter; rest: VenueRest }>();
  for (const id of config.apiVenues) {
    const adapter = getVenue(id);
    rest.set(id, { adapter, rest: adapter.rest({ baseUrl: config.venueRestUrls[id], ...(opts.fetch ? { fetch: opts.fetch } : {}) }) });
  }
  const sources: MarketSource[] = [...rest.entries()].map(([id, e]) => ({
    venue: id as Venue,
    // the venue shapes cross the schema adapter (GAPS #8); a ticker without a spot carries "0" and is skipped as a spot source
    products: async () => (await e.rest.products()).filter(e.adapter.schema.isSupported).map(e.adapter.schema.instrument),
    tickers: async (u) => (await e.rest.tickers(u)).map((q) => e.adapter.schema.quote(q, "0")),
  }));
  return {
    venues: config.apiVenues,
    tradingFor: (venue) => {
      const client = trading.get(venue);
      if (!client) throw new VenueCapabilityError(venue, "trading client");
      return client;
    },
    restFor: (venue) => rest.get(venue)?.rest ?? null,
    sources,
    liveSpot: async (asset, venue) => {
      const e = rest.get(venue);
      if (!e) return null;
      const q = (await e.rest.tickers(asset)).map((x) => e.adapter.schema.quote(x, "0")).find((x) => Number(x.spot) > 0);
      return q ? Number(q.spot) : null;
    },
    tick: async (asset, venue) => {
      const e = rest.get(venue);
      if (!e) return null;
      // one request per underlying per tick, options and the perpetual together, keyed by venue symbol; spot from the first ticker that carries one
      const quotes = (await e.rest.tickers(asset, { perpetuals: true })).map((q) => e.adapter.schema.quote(q, "0"));
      const spot = quotes.map((q) => Number(q.spot)).find((x) => x > 0) ?? null;
      return { marks: new Map(quotes.map((sq) => [sq.instrumentId.slice(sq.instrumentId.indexOf(":") + 1), Number(sq.mark)])), spot };
    },
  };
}
