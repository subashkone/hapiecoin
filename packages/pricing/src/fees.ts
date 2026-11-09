/**
 * Exchange fee arithmetic (ADR-099; HC-TR-200). The rule itself lives with the venue (`VenueCore.feeRule` in the
 * venues port; Delta Exchange India: an option fill pays 0.01 % of the spot notional capped at 3.5 % of the premium,
 * a futures or perpetual fill 0.05 % of the notional, 18 % GST on every fee, and a contract that settles in the money
 * pays the taker fee again at settlement with its settlement value as the premium; a worthless expiry pays nothing).
 * This module only knows how to apply such a rule. Pure.
 */
import type { LegKind } from "./types.js";

export interface FeeRule {
  /** Option fee per fill as a fraction of the spot notional (0.0001 = 0.01 %). */
  optionPct: number;
  /** Cap on an option fill's fee, as a fraction of the premium (0.035 = 3.5 %). */
  optionCapOfPremium: number;
  /** Futures and perpetual fee per fill as a fraction of the notional (0.0005 = 0.05 % taker). */
  futurePct: number;
  /** Tax on every fee, as a fraction of the fee (0.18 = 18 % GST). */
  gstPct: number;
  /** Whether an option that settles in the money pays the taker fee again at settlement. */
  settlementFee: boolean;
}

/**
 * The fee of one fill, tax included. `notional` is spot × quantity in quote currency; `premium` is price × quantity
 * (ignored for a future). A negative premium (a credit seen from the structure) counts as its size.
 */
export function fillFee(kind: LegKind, notional: number, premium: number, rule: FeeRule): number {
  const base = kind === "future" ? Math.abs(notional) * rule.futurePct : Math.min(Math.abs(notional) * rule.optionPct, Math.abs(premium) * rule.optionCapOfPremium);
  return base * (1 + rule.gstPct);
}

/** The fee an option leg pays when it settles: the taker fee on its settlement value when in the money, nothing when worthless or when the venue charges none. */
export function settlementFee(kind: LegKind, notional: number, settlementValue: number, rule: FeeRule): number {
  if (kind === "future" || !rule.settlementFee || settlementValue <= 0) return 0;
  return fillFee(kind, notional, settlementValue, rule);
}
