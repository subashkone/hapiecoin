/**
 * The venue the client works against (ADR-064). One seam: E20 step 2b replaces the constant with the
 * strategy's `venue` column, and every symbol, lot default, settlement hour and topic follows.
 */
import { DEFAULT_VENUE, type VenueCore, getVenueCore } from "@hapiecoin/venues/core";

export const CURRENT_VENUE = DEFAULT_VENUE;

export function currentVenue(): VenueCore {
  return getVenueCore(CURRENT_VENUE);
}
