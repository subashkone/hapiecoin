// The strategy templates live in the pricing package (ADR-077) so the API's backtest places them exactly as the
// Builder, the Templates tab and the Strategy Wizard do; this module re-exports them typed on the app's Underlying
// and keeps the web-only name guesser.
import type { Underlying } from "@hapiecoin/schema";
import {
  type MaterialiseInput as PricingMaterialiseInput,
  type MaterialiseResult as PricingMaterialiseResult,
  type StrategyTemplate as PricingStrategyTemplate,
  materialiseTemplate as materialiseTemplateGeneric,
} from "@hapiecoin/pricing";
import type { LegKind, LegSide } from "./legs";

export {
  TEMPLATES,
  TEMPLATE_CATEGORIES,
  TEMPLATE_COUNT,
  isTemplateName,
  templateByName,
  type ChainStrike,
  type MaterialisedLeg,
  type StrategyTemplate,
  type TemplateCategory,
  type TemplateFutureLeg,
  type TemplateLeg,
  type TemplateOptionLeg,
  type TemplateRisk,
  type TemplateTag,
} from "@hapiecoin/pricing";

export type MaterialiseInput = PricingMaterialiseInput<Underlying>;
export type MaterialiseResult = PricingMaterialiseResult<Underlying>;
export const materialiseTemplate: (tpl: PricingStrategyTemplate, input: MaterialiseInput) => MaterialiseResult = materialiseTemplateGeneric;

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
