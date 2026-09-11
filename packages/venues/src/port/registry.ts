/** Venues by schema id (ADR-063). Adding a venue means one entry here, plus its id in `VENUES` in `@hapiecoin/schema`. */
import type { Venue as VenueId } from "@hapiecoin/schema";
import { UnknownVenueError, type VenueAdapter } from "./adapter.js";
import { DELTA_INDIA } from "./delta-india.js";

export const VENUE_REGISTRY: Readonly<Record<VenueId, VenueAdapter>> = {
  delta_india: DELTA_INDIA,
};

/** The venue the apps run against until the `venue` column lands (E20 step 2). */
export const DEFAULT_VENUE: VenueId = "delta_india";

/** Own keys only: a prototype name ("toString") is an unknown venue, not a function. */
export function getVenue(id: string): VenueAdapter {
  if (!Object.hasOwn(VENUE_REGISTRY, id)) throw new UnknownVenueError(id);
  return (VENUE_REGISTRY as Readonly<Record<string, VenueAdapter>>)[id]!;
}

export function listVenues(): readonly VenueAdapter[] {
  return Object.values(VENUE_REGISTRY);
}
