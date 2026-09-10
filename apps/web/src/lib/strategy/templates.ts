// The strategy templates (HC-TR-037..040; count in TEMPLATE_COUNT) and how they become legs on a real chain: `k`
// is a number of listed strikes away from the ATM row (never a price step, ADR-006), `expiryOffset` picks a later
// listed expiry, `lots` multiplies the chosen lot count. A `future` leg is the asset's perpetual at the live spot,
// exactly as the Builder's Add Futures dialog places it (HC-TR-035; GAPS #74).
import type { Underlying } from "@hapiecoin/schema";
import type { LegKind, LegSide, NewLegInput } from "./legs";

export type TemplateCategory = "Bullish" | "Bearish" | "Neutral" | "Others";
export const TEMPLATE_CATEGORIES: readonly ("All" | TemplateCategory)[] = ["All", "Bullish", "Bearish", "Neutral", "Others"];

export interface TemplateOptionLeg {
  kind: "call" | "put";
  side: LegSide;
  /** Rows away from the ATM strike in the venue list (+ above, − below). */
  k: number;
  lots?: number;
  /** Later listed expiry index (calendars). */
  expiryOffset?: number;
}
/** The perpetual future at the live spot: no strike, expiry PERP. */
export interface TemplateFutureLeg {
  kind: "future";
  side: LegSide;
  lots?: number;
}
export type TemplateLeg = TemplateOptionLeg | TemplateFutureLeg;

/** Badges on the card: the template holds a perpetual, spans two expiries, or has unequal lots. */
export type TemplateTag = "futures" | "calendar" | "ratio";

export interface StrategyTemplate {
  name: string;
  category: TemplateCategory;
  description: string;
  legs: TemplateLeg[];
  tags?: readonly TemplateTag[] | undefined;
}

const t = (name: string, category: TemplateCategory, description: string, legs: TemplateLeg[], tags?: readonly TemplateTag[]): StrategyTemplate => ({ name, category, description, legs, tags });
const C = "call" as const;
const P = "put" as const;
const F = "future" as const;
const B = "buy" as const;
const S = "sell" as const;

export const TEMPLATES: readonly StrategyTemplate[] = [
  t("Buy Call", "Bullish", "Buy a call. Unlimited upside, limited risk to premium paid.", [{ kind: C, side: B, k: 0 }]),
  t("Sell Put", "Bullish", "Bullish strategy earning premium. Profit if price stays above strike.", [{ kind: P, side: S, k: 0 }]),
  t("Bull Call Spread", "Bullish", "Buy ATM call, sell OTM call. Limited risk and reward.", [{ kind: C, side: B, k: 0 }, { kind: C, side: S, k: 2 }]),
  t("Bull Put Spread", "Bullish", "Sell ATM put, buy OTM put. Credit spread strategy.", [{ kind: P, side: S, k: 0 }, { kind: P, side: B, k: -2 }]),
  t("Long Synthetic Future", "Bullish", "Buy call and sell put at same strike. Mimics long futures position.", [{ kind: C, side: B, k: 0 }, { kind: P, side: S, k: 0 }]),
  t("Long Perp", "Bullish", "Buy the perpetual. Gains one for one as price rises, loses the same way as it falls.", [{ kind: F, side: B }], ["futures"]),
  t("Covered Call", "Bullish", "Long perpetual plus a sold OTM call. Premium income; gain capped at the call strike.", [{ kind: F, side: B }, { kind: C, side: S, k: 2 }], ["futures"]),
  t("Protective Put", "Bullish", "Long perpetual plus a bought OTM put. Loss stopped below the put; upside open.", [{ kind: F, side: B }, { kind: P, side: B, k: -2 }], ["futures"]),
  t("Collar", "Bullish", "Long perpetual, bought OTM put, sold OTM call. Loss floored, gain capped, little net premium.", [{ kind: F, side: B }, { kind: P, side: B, k: -2 }, { kind: C, side: S, k: 2 }], ["futures"]),
  t("Call Back Spread 1x2", "Bullish", "Sell 1 ATM call, buy 2 OTM calls. Small risk between the strikes; open gain on a big rise.", [{ kind: C, side: S, k: 0 }, { kind: C, side: B, k: 2, lots: 2 }], ["ratio"]),
  t("Diagonal Call", "Bullish", "Sell a near-term OTM call, buy a longer-term ATM call. Time decay income with room to rise.", [{ kind: C, side: S, k: 2, expiryOffset: 0 }, { kind: C, side: B, k: 0, expiryOffset: 1 }], ["calendar"]),
  t("Risk Reversal", "Bullish", "Sell an OTM put to pay for an OTM call. Bullish; exposed below the put strike.", [{ kind: P, side: S, k: -2 }, { kind: C, side: B, k: 2 }]),
  t("Buy Put", "Bearish", "Buy a put. Profits from a fall, risk limited to premium paid.", [{ kind: P, side: B, k: 0 }]),
  t("Sell Call", "Bearish", "Bearish strategy earning premium. Profit if price stays below strike.", [{ kind: C, side: S, k: 0 }]),
  t("Bear Put Spread", "Bearish", "Buy ATM put, sell OTM put. Limited risk debit spread.", [{ kind: P, side: B, k: 0 }, { kind: P, side: S, k: -2 }]),
  t("Bear Call Spread", "Bearish", "Sell ATM call, buy OTM call. Credit spread strategy.", [{ kind: C, side: S, k: 0 }, { kind: C, side: B, k: 2 }]),
  t("Short Synthetic Future", "Bearish", "Sell call and buy put at same strike. Mimics short futures position.", [{ kind: C, side: S, k: 0 }, { kind: P, side: B, k: 0 }]),
  t("Short Perp", "Bearish", "Sell the perpetual. Gains one for one as price falls, loses the same way as it rises.", [{ kind: F, side: S }], ["futures"]),
  t("Covered Put", "Bearish", "Short perpetual plus a sold OTM put. Premium income; gain capped at the put strike.", [{ kind: F, side: S }, { kind: P, side: S, k: -2 }], ["futures"]),
  t("Put Back Spread 1x2", "Bearish", "Sell 1 ATM put, buy 2 OTM puts. Small risk between the strikes; large gain on a sharp fall.", [{ kind: P, side: S, k: 0 }, { kind: P, side: B, k: -2, lots: 2 }], ["ratio"]),
  t("Diagonal Put", "Bearish", "Sell a near-term OTM put, buy a longer-term ATM put. Time decay income with room to fall.", [{ kind: P, side: S, k: -2, expiryOffset: 0 }, { kind: P, side: B, k: 0, expiryOffset: 1 }], ["calendar"]),
  t("Long Straddle", "Neutral", "Buy call and put at same strike. Profit from big move in either direction.", [{ kind: C, side: B, k: 0 }, { kind: P, side: B, k: 0 }]),
  t("Short Straddle", "Neutral", "Sell call and put at same strike. Profit from low volatility.", [{ kind: C, side: S, k: 0 }, { kind: P, side: S, k: 0 }]),
  t("Long Strangle", "Neutral", "Buy OTM call and put. Cheaper than straddle, needs bigger move.", [{ kind: C, side: B, k: 2 }, { kind: P, side: B, k: -2 }]),
  t("Short Strangle", "Neutral", "Sell OTM call and put. Profit if price stays in range.", [{ kind: C, side: S, k: 2 }, { kind: P, side: S, k: -2 }]),
  t("Iron Condor", "Neutral", "Sell call spread and put spread. Profits from range-bound movement.", [{ kind: P, side: B, k: -4 }, { kind: P, side: S, k: -2 }, { kind: C, side: S, k: 2 }, { kind: C, side: B, k: 4 }]),
  t("Reverse Iron Condor", "Neutral", "Buy call spread and put spread. Profits from large moves in either direction.", [{ kind: P, side: S, k: -4 }, { kind: P, side: B, k: -2 }, { kind: C, side: B, k: 2 }, { kind: C, side: S, k: 4 }]),
  t("Iron Butterfly", "Neutral", "Sell ATM straddle, buy OTM strangle. Limited risk neutral strategy.", [{ kind: P, side: B, k: -3 }, { kind: P, side: S, k: 0 }, { kind: C, side: S, k: 0 }, { kind: C, side: B, k: 3 }]),
  t("Reverse Iron Butterfly", "Neutral", "Buy ATM straddle, sell OTM strangle. Profits from big moves.", [{ kind: P, side: S, k: -3 }, { kind: P, side: B, k: 0 }, { kind: C, side: B, k: 0 }, { kind: C, side: S, k: 3 }]),
  t("Long Call Butterfly", "Neutral", "Buy 1 ITM call, sell 2 ATM calls, buy 1 OTM call. Max profit at ATM.", [{ kind: C, side: B, k: -2 }, { kind: C, side: S, k: 0, lots: 2 }, { kind: C, side: B, k: 2 }]),
  t("Long Put Butterfly", "Neutral", "Buy 1 ITM put, sell 2 ATM puts, buy 1 OTM put. Max profit at ATM.", [{ kind: P, side: B, k: 2 }, { kind: P, side: S, k: 0, lots: 2 }, { kind: P, side: B, k: -2 }]),
  t("Long Call Condor", "Neutral", "Buy ITM call, sell 2 different ATM calls, buy OTM call. Wider profit zone than butterfly.", [{ kind: C, side: B, k: -3 }, { kind: C, side: S, k: -1 }, { kind: C, side: S, k: 1 }, { kind: C, side: B, k: 3 }]),
  t("Long Calendar with Calls", "Neutral", "Sell near-term call, buy longer-term call at same strike. Profits from time decay.", [{ kind: C, side: S, k: 0, expiryOffset: 0 }, { kind: C, side: B, k: 0, expiryOffset: 1 }], ["calendar"]),
  t("Long Calendar with Puts", "Neutral", "Sell near-term put, buy longer-term put at same strike. Profits from time decay.", [{ kind: P, side: S, k: 0, expiryOffset: 0 }, { kind: P, side: B, k: 0, expiryOffset: 1 }], ["calendar"]),
  t("Long Gut", "Neutral", "Buy ITM call and ITM put. High cost but profits from large moves.", [{ kind: C, side: B, k: -2 }, { kind: P, side: B, k: 2 }]),
  t("Strip", "Neutral", "Buy 1 ATM call and 2 ATM puts. Profits more from downside move.", [{ kind: C, side: B, k: 0 }, { kind: P, side: B, k: 0, lots: 2 }]),
  t("Strap", "Neutral", "Buy 2 ATM calls and 1 ATM put. Profits more from upside move.", [{ kind: C, side: B, k: 0, lots: 2 }, { kind: P, side: B, k: 0 }]),
  t("Synthetic Straddle", "Neutral", "Long perpetual plus 2 bought ATM puts. Behaves like a long straddle: profits from a big move either way.", [{ kind: F, side: B }, { kind: P, side: B, k: 0, lots: 2 }], ["futures"]),
  t("Broken-Wing Put Butterfly", "Neutral", "Put butterfly with the far wing set wider. Credit or small debit; the risk sits on the downside.", [{ kind: P, side: B, k: 0 }, { kind: P, side: S, k: -2, lots: 2 }, { kind: P, side: B, k: -5 }]),
  t("Broken-Wing Call Butterfly", "Neutral", "Call butterfly with the far wing set wider. Credit or small debit; the risk sits on the upside.", [{ kind: C, side: B, k: 0 }, { kind: C, side: S, k: 2, lots: 2 }, { kind: C, side: B, k: 5 }]),
  t("Double Diagonal", "Neutral", "Sell a near-term strangle, buy a wider longer-term strangle. Range income with defined risk.", [{ kind: P, side: S, k: -2, expiryOffset: 0 }, { kind: P, side: B, k: -4, expiryOffset: 1 }, { kind: C, side: S, k: 2, expiryOffset: 0 }, { kind: C, side: B, k: 4, expiryOffset: 1 }], ["calendar"]),
  t("Calendar Strangle", "Neutral", "Sell a near-term strangle, buy the same strikes at a later expiry. Time decay while price stays in range.", [{ kind: P, side: S, k: -2, expiryOffset: 0 }, { kind: P, side: B, k: -2, expiryOffset: 1 }, { kind: C, side: S, k: 2, expiryOffset: 0 }, { kind: C, side: B, k: 2, expiryOffset: 1 }], ["calendar"]),
  t("Jade Lizard", "Others", "Sell put spread + sell OTM call. No upside risk with premium collection.", [{ kind: P, side: B, k: -4 }, { kind: P, side: S, k: -2 }, { kind: C, side: S, k: 2 }]),
  t("Reverse Jade Lizard", "Others", "Sell call spread + sell OTM put. No downside risk with premium collection.", [{ kind: C, side: B, k: 4 }, { kind: C, side: S, k: 2 }, { kind: P, side: S, k: -2 }]),
  t("Call Ratio Spread 1x2", "Others", "Buy 1 ATM call, sell 2 OTM calls. Profit on a modest rise; open risk above the sold strike.", [{ kind: C, side: B, k: 0 }, { kind: C, side: S, k: 2, lots: 2 }], ["ratio"]),
  t("Put Ratio Spread 1x2", "Others", "Buy 1 ATM put, sell 2 OTM puts. Profit on a modest fall; open risk below the sold strike.", [{ kind: P, side: B, k: 0 }, { kind: P, side: S, k: -2, lots: 2 }], ["ratio"]),
  t("Short Call Ladder", "Others", "Sell an ATM call, buy two higher calls. Limited loss between the strikes; open gain on a big rise.", [{ kind: C, side: S, k: 0 }, { kind: C, side: B, k: 2 }, { kind: C, side: B, k: 4 }]),
  t("Short Put Ladder", "Others", "Sell an ATM put, buy two lower puts. Limited loss between the strikes; large gain on a big fall.", [{ kind: P, side: S, k: 0 }, { kind: P, side: B, k: -2 }, { kind: P, side: B, k: -4 }]),
];

/** True when the Builder's name is just the template it was loaded from ("Iron Butterfly"): not a name the trader gave (ADR-059). */
export function isTemplateName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n !== "" && TEMPLATES.some((t) => t.name.toLowerCase() === n);
}

/** How many templates the gallery holds; tests and copy derive from it instead of a literal. */
export const TEMPLATE_COUNT = TEMPLATES.length;

export function templateByName(name: string): StrategyTemplate | undefined {
  return TEMPLATES.find((x) => x.name === name);
}

/** A strike row as the chain exposes it: strike plus the mark and IV of each side when quoted. */
export interface ChainStrike {
  strike: string;
  call?: { mark: string; markIv?: number | undefined } | undefined;
  put?: { mark: string; markIv?: number | undefined } | undefined;
}

export interface MaterialiseInput {
  asset: Underlying;
  /** Expiry the template is placed on and the listed expiries (ascending) for calendars. */
  expiry: string;
  expiries: readonly string[];
  /** Rows of the chain for `expiry` (ascending strikes) and the ATM index within them. */
  rows: readonly ChainStrike[];
  atm: number;
  /** Rows for later expiries, by expiry (calendars); missing expiries fall back to the base rows. */
  rowsByExpiry?: Readonly<Record<string, { rows: readonly ChainStrike[]; atm: number }>>;
  lots: number;
  /** Live spot as the venue decimal string; a template with a future leg refuses without it. */
  spot?: string | undefined;
}

export type MaterialiseResult = { ok: true; legs: NewLegInput[] } | { ok: false; reason: "no-chain" | "out-of-range" | "no-quote" | "no-spot" };

/**
 * Turn a template into concrete legs on the venue list: strike = rows[atm + k].strike (clamped never; a
 * template that reaches past the listed ladder is refused so the trader is not given a made-up strike). A
 * future leg needs only the spot.
 */
export function materialiseTemplate(tpl: StrategyTemplate, input: MaterialiseInput): MaterialiseResult {
  const legs: NewLegInput[] = [];
  for (const l of tpl.legs) {
    if (l.kind === "future") {
      if (input.spot === undefined || !(Number(input.spot) > 0)) return { ok: false, reason: "no-spot" };
      legs.push({ asset: input.asset, kind: "future", side: l.side, strike: "", expiry: "PERP", lots: input.lots * (l.lots ?? 1), price: input.spot, iv: undefined });
      continue;
    }
    if (input.rows.length === 0 || input.atm < 0) return { ok: false, reason: "no-chain" };
    const ei = input.expiries.indexOf(input.expiry);
    const expiry = l.expiryOffset ? (input.expiries[Math.min(Math.max(ei, 0) + l.expiryOffset, input.expiries.length - 1)] ?? input.expiry) : input.expiry;
    const source = expiry === input.expiry ? { rows: input.rows, atm: input.atm } : (input.rowsByExpiry?.[expiry] ?? { rows: input.rows, atm: input.atm });
    const idx = source.atm + l.k;
    const row = source.rows[idx];
    if (!row) return { ok: false, reason: "out-of-range" };
    const q = l.kind === "call" ? row.call : row.put;
    if (!q) return { ok: false, reason: "no-quote" };
    legs.push({ asset: input.asset, kind: l.kind, side: l.side, strike: row.strike, expiry, lots: input.lots * (l.lots ?? 1), price: q.mark, iv: q.markIv });
  }
  return { ok: true, legs };
}

/** Rough name for a hand-built strategy (HC-TR-044 "template" column for drafts). */
export function guessTemplateName(legs: readonly { kind: LegKind; side: LegSide; strike: string; expiry?: string | undefined }[]): string {
  if (legs.length === 0) return "Empty";
  if (legs.length === 1) {
    const l = legs[0]!;
    if (l.kind === "future") return "Futures";
    return `${l.side === "buy" ? "Buy" : "Sell"} ${l.kind === "call" ? "Call" : "Put"}`;
  }
  if (legs.length === 2) {
    const [a, b] = legs as [typeof legs[number], typeof legs[number]];
    if (a.kind === b.kind && a.side !== b.side) {
      const kind = a.kind === "call" ? "Call" : "Put";
      if (a.expiry && b.expiry && a.expiry !== b.expiry) return Number(a.strike) === Number(b.strike) ? `${kind} Calendar` : `${kind} Diagonal`;
      return `${kind} Spread`;
    }
    if (a.kind !== b.kind && a.side === b.side && Number(a.strike) === Number(b.strike)) return a.side === "buy" ? "Long Straddle" : "Short Straddle";
    if (a.kind !== b.kind && a.side === b.side) return a.side === "buy" ? "Long Strangle" : "Short Strangle";
  }
  if (legs.length === 4) return "Condor / Butterfly";
  return "Custom";
}
