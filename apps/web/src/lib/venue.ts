/**
 * The venue the client works against (ADR-064). One seam: E20 step 2b replaces the constant with the
 * strategy's `venue` column, and every symbol, lot default, settlement hour and topic follows.
 */
import { type TradingCalendar, calendarFor } from "@hapiecoin/pricing";
import { DEFAULT_VENUE, type ExerciseStyle, type VenueCore, getVenueCore, ownMarket } from "@hapiecoin/venues/core";

export const CURRENT_VENUE = DEFAULT_VENUE;

export function currentVenue(): VenueCore {
  return getVenueCore(CURRENT_VENUE);
}

/** The pricing calendar of an underlying on the current venue (ADR-066): act/365 at the venue's settlement hour. */
export function venueCalendar(asset: string): TradingCalendar {
  return calendarFor(currentVenue().calendar.settlementHourUtc(asset));
}

/** How the venue's options on `asset` exercise; European when the venue does not list the market. */
export function exerciseStyleOf(asset: string): ExerciseStyle {
  return ownMarket(currentVenue().markets, asset)?.exerciseStyle ?? "european";
}

/** The model caption for an exercise style: the engine prices European options, so American is flagged as an estimate. */
export function exerciseLabel(style: ExerciseStyle): string {
  return style === "american" ? "American exercise (European-model estimate)" : "European exercise";
}
