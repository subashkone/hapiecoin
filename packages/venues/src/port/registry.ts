/** Venues by schema id (ADR-063), with their client factories. Adding a venue means one entry here, one in `VENUE_CORES` (core.ts) and its id in `VENUES` in `@hapiecoin/schema`. */
import type { Venue as VenueId } from "@hapiecoin/schema";
import { UnknownVenueError, type VenueAdapter } from "./adapter.js";
import { DEFAULT_VENUE } from "./core.js";
import { DELTA_INDIA } from "./delta-india-clients.js";
import { DERIBIT } from "./deribit-clients.js";

export { DEFAULT_VENUE };

export const VENUE_REGISTRY: Readonly<Record<VenueId, VenueAdapter>> = {
  delta_india: DELTA_INDIA,
  deribit: DERIBIT,
};

/** Own keys only: a prototype name ("toString") is an unknown venue, not a function. */
export function getVenue(id: string): VenueAdapter {
  if (!Object.hasOwn(VENUE_REGISTRY, id)) throw new UnknownVenueError(id);
  return (VENUE_REGISTRY as Readonly<Record<string, VenueAdapter>>)[id]!;
}

export function listVenues(): readonly VenueAdapter[] {
  return Object.values(VENUE_REGISTRY);
}
