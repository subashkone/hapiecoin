/**
 * The browser-safe entry of the venue port, published as `@hapiecoin/venues/core` (ADR-064): venue ids, market
 * specs, the symbol codec, the settlement calendar, fee defaults, capability flags and the schema bridge, with
 * no client factory and therefore no node:crypto. The web client imports this; the API and the gateway use the
 * full registry from the package root.
 */
import type { Venue as VenueId } from "@hapiecoin/schema";
import { UnknownVenueError, type VenueCore } from "./adapter.js";
import { DELTA_INDIA_CORE } from "./delta-india.js";

export type {
  ExerciseStyle,
  FeeDefaults,
  MarketSpec,
  OptionKind,
  SchemaBridge,
  SymbolCodec,
  VenueCalendar,
  VenueCapabilities,
  VenueCore,
  VenueId,
} from "./adapter.js";
export { UnknownVenueError, VenueCapabilityError, defaultLotSizes, marketOf, ownMarket } from "./adapter.js";
export { InvalidExpiryError, InvalidSymbolError } from "../errors.js";
export { DELTA_INDIA_CORE, DELTA_INDIA_MARKETS, formatDeltaOption, parseDeltaPerpetual } from "./delta-india.js";

export const VENUE_CORES: Readonly<Record<VenueId, VenueCore>> = {
  delta_india: DELTA_INDIA_CORE,
};

/** The venue the apps run against until the `venue` column lands (E20 step 2b). */
export const DEFAULT_VENUE: VenueId = "delta_india";

/** Own keys only: a prototype name ("toString") is an unknown venue, not a function. */
export function getVenueCore(id: string): VenueCore {
  if (!Object.hasOwn(VENUE_CORES, id)) throw new UnknownVenueError(id);
  return (VENUE_CORES as Readonly<Record<string, VenueCore>>)[id]!;
}

export function listVenueCores(): readonly VenueCore[] {
  return Object.values(VENUE_CORES);
}
