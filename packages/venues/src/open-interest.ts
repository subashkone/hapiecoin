import type { Quote } from "./types.js";

/**
 * GAPS #15 (ADR-085): a newer frame without open interest keeps the pair the venue last sent (Delta's compact ticker
 * omits its oi cell on some ticks), so a later snapshot shows the last known figure and the schema shows none only when
 * none was ever sent. Both figures move together, so underlying units and contracts never come from different frames.
 */
export function carryOpenInterest(current: Quote | undefined, quote: Quote): Quote {
  if (!current || quote.oiContracts !== null || current.oiContracts === null) return quote;
  return { ...quote, oi: current.oi, oiContracts: current.oiContracts };
}
