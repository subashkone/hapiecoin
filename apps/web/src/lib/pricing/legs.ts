// Bridge from strategy legs (lots, decimal strings) to the pricing engine's legs (underlying units, numbers).
// The engine works per one underlying unit (USD per BTC, as Delta quotes mark_price), so a position's
// quantity is lots × lot size. Numbers here feed maths only; money shown to the trader is formatted once
// at the edge (typescript rule 3).
import type { Leg as PricingLeg } from "@hapiecoin/pricing";
import type { StrategyLeg } from "@/lib/strategy/legs";
import { currentVenueId } from "@/lib/venue";
import { getVenueCore } from "@hapiecoin/venues/core";

/** The hour (UTC) the venue settles `asset` options at (ADR-066: from the venue port; Delta 12:00, XAUT 16:00). */
export function settlementHourUtc(asset: string, venue: string = currentVenueId()): number {
  return getVenueCore(venue).calendar.settlementHourUtc(asset);
}

export interface LegPriceSource {
  /** Live mark per underlying unit for an option leg, or undefined to keep the stored price. */
  mark?: ((leg: StrategyLeg) => string | undefined) | undefined;
  /** Live IV for an option leg, or undefined to keep the stored IV. */
  iv?: ((leg: StrategyLeg) => number | undefined) | undefined;
  /**
   * Spot for future legs (price per unit), used in LIVE price mode only, that is when `mark` is given: a future has no
   * mark of its own here (GAPS #14), so the index stands in for it. Without `mark` a future keeps its stored price like
   * an option does, because a HELD future must be priced from its entry: replacing the entry with today's spot made
   * every held future worth exactly nothing at spot and shifted the whole payoff by what it had earned or lost (ADR-095).
   */
  spot?: string | undefined;
}

export function toPricingLegs(legs: readonly StrategyLeg[], lotSize: string | undefined, source: LegPriceSource = {}): PricingLeg[] {
  const size = Number(lotSize);
  if (!Number.isFinite(size) || size <= 0) return [];
  const out: PricingLeg[] = [];
  for (const l of legs) {
    if (l.status !== "open" || l.enabled === false) continue;
    const price = l.kind === "future" ? Number((source.mark ? source.spot : undefined) ?? l.price) : Number(source.mark?.(l) ?? l.price);
    const iv = l.kind === "future" ? undefined : (source.iv?.(l) ?? l.iv);
    if (!Number.isFinite(price)) continue;
    out.push({
      kind: l.kind,
      side: l.side,
      strike: l.kind === "future" ? 0 : Number(l.strike),
      expiry: l.kind === "future" ? "" : l.expiry,
      quantity: l.lots * size,
      price,
      iv,
    });
  }
  return out;
}
