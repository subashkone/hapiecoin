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

/** One filled leg of a trade as the fee estimate reads it (HC-TR-253). Prices per unit of the underlying. */
export interface FeeLeg {
  kind: LegKind;
  /** The option's strike per unit (ignored for a future). */
  strike: number;
  /** Units of the underlying: lots × units per lot. */
  quantity: number;
  /** The entry fill price, or null when the leg was never filled. */
  entryPrice: number | null;
  /** The exit price, or null while the leg is open. */
  exitPrice: number | null;
  /** True when the leg ran to its expiry: it pays the settlement fee (nothing when worthless), not a fill fee. */
  settled: boolean;
}

export interface TradeFees {
  /** Fees and tax on the entry fills. */
  entry: number;
  /** Fees and tax on the exits made so far: fills, and in-the-money settlements. */
  exit: number;
  total: number;
}

/**
 * The fees of a whole trade from its stored legs (HC-TR-253): each entry fill, each exit fill, and the settlement fee
 * of a leg that expired in the money. An ESTIMATE: the rule's notional is the spot at the fill, which a stored leg does
 * not carry, so an option's STRIKE stands in for it (the error is the option's distance from the money, as a share of
 * the fee, and none where the premium cap applies). Two notionals are exact: a future's is its own fill price, and an
 * option that settled in the money gives its spot away (strike plus its value for a call, strike less it for a put). Pure.
 */
export function tradeFees(legs: readonly FeeLeg[], rule: FeeRule): TradeFees {
  let entry = 0;
  let exit = 0;
  for (const l of legs) {
    if (l.entryPrice === null) continue;
    const ref = (price: number) => (l.kind === "future" ? price : l.strike) * l.quantity;
    entry += fillFee(l.kind, ref(l.entryPrice), l.entryPrice * l.quantity, rule);
    if (l.exitPrice === null) continue;
    if (!l.settled) exit += fillFee(l.kind, ref(l.exitPrice), l.exitPrice * l.quantity, rule);
    else {
      const settleSpot = l.kind === "call" ? l.strike + l.exitPrice : l.kind === "put" ? Math.max(0, l.strike - l.exitPrice) : l.exitPrice;
      exit += settlementFee(l.kind, settleSpot * l.quantity, l.exitPrice * l.quantity, rule);
    }
  }
  return { entry, exit, total: entry + exit };
}
