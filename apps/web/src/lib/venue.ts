/**
 * The venue the client works against (ADR-064, ADR-069). The workspace store owns the choice (`UiState.venue`) and
 * binds it here at load, so the symbol codec, the settlement hour, the calendar and every create body follow the
 * header's venue chip. The store depends on this module (through the legs helpers), never the reverse.
 */
import { type TradingCalendar, calendarFor } from "@hapiecoin/pricing";
import { type Underlying, VENUES } from "@hapiecoin/schema";
import { DEFAULT_VENUE, type ExerciseStyle, type VenueCore, type VenueId, defaultLotSizes, getVenueCore, ownMarket } from "@hapiecoin/venues/core";

let readVenue: () => VenueId = () => DEFAULT_VENUE;

/** The store registers its `venue` reader once at load; tests may bind their own. */
export function bindVenueSource(read: () => VenueId): void {
  readVenue = read;
}

/** The selected venue id (the default until the store binds). */
export function currentVenueId(): VenueId {
  return readVenue();
}

export function currentVenue(): VenueCore {
  return getVenueCore(readVenue());
}

/** The pricing calendar of an underlying on `venue` (ADR-066): act/365 at the venue's settlement hour. */
export function venueCalendar(asset: string, venue: string = readVenue()): TradingCalendar {
  return calendarFor(getVenueCore(venue).calendar.settlementHourUtc(asset));
}

/** How the venue's options on `asset` exercise; European when the venue does not list the market. */
export function exerciseStyleOf(asset: string, venue: string = readVenue()): ExerciseStyle {
  return ownMarket(getVenueCore(venue).markets, asset)?.exerciseStyle ?? "european";
}

/** The model caption for an exercise style: the engine prices European options, so American is flagged as an estimate. */
export function exerciseLabel(style: ExerciseStyle): string {
  return style === "american" ? "American exercise (European-model estimate)" : "European exercise";
}

/**
 * Units per lot for `asset` on `venue`: the trader's own lot sizes (Settings, kept per asset for the default venue)
 * on the default venue, the venue's listed lot size elsewhere (ADR-069; 4c moves the setting itself per venue).
 * Undefined only while the settings of the default venue are still loading, as before.
 */
export function lotSizeFor(venue: string, asset: Underlying, settings: { lotSizes: Record<Underlying, string> } | undefined): string | undefined {
  return venue === DEFAULT_VENUE ? settings?.lotSizes[asset] : defaultLotSizes(getVenueCore(venue))[asset];
}

/** The venue's perpetual for `asset` ("BTCUSD" on Delta India, "BTC-PERPETUAL" on Deribit); null when the venue lists no such market (ADR-071). */
export function perpetualSymbolOf(asset: string, venue: string = readVenue()): string | null {
  return ownMarket(getVenueCore(venue).markets, asset)?.perpetualSymbol ?? null;
}

/** `venue` when it lists `asset`, else null: the spot subscription of a pair the venue does not trade is skipped (Deribit has no XAUT). */
export function listedVenue(venue: VenueId, asset: string): VenueId | null {
  return ownMarket(getVenueCore(venue).markets, asset) === undefined ? null : venue;
}

/**
 * The venues the static per-venue hook tables enumerate (`usePaperBook`, `AlertEngine`: one `useSpot` / `useLegQuotes` per venue and
 * asset, hook counts must be static). `satisfies` pins the tuple: when `VENUES` grows this line stops compiling and those tables get their row.
 */
export const HOOK_VENUES = VENUES satisfies readonly ["delta_india", "deribit"];

/** True when the venue serves data only: chains, analysis and paper trading, no API keys, no live orders (ADR-067). */
export function dataOnly(venue: string): boolean {
  return !getVenueCore(venue).capabilities.liveTrading;
}

/** The plain sentence the UI shows wherever a live path is refused on a data-only venue (mirrors the API's 409). */
export function dataOnlyNote(venue: string): string {
  return `${getVenueCore(venue).label} is data-only on HapieCoin: chains, analysis and paper trading. API keys and live orders are not available.`;
}
