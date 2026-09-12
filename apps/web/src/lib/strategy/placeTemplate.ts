// A template placed on the venue ladder and made ready for the pricing worker: materialise → addLeg → toPricingLegs,
// the one path the Builder, the Templates tab (`useTemplateStats`) and the Strategy Wizard (`useWizardCandidates`)
// share, so a rule about placement lands once (ADR-072).
import type { Leg as PricingLeg } from "@hapiecoin/pricing";
import { toPricingLegs } from "@/lib/pricing/legs";
import { type StrategyLeg, addLeg as addLegPure } from "./legs";
import { type MaterialiseInput, type StrategyTemplate, materialiseTemplate } from "./templates";

export interface PlacedTemplate {
  legs: StrategyLeg[];
  priced: PricingLeg[];
}

/** Null when the template does not fit the ladder (`materialiseTemplate` refuses), exceeds the leg limit or prices to nothing. */
export function placeTemplate(tpl: StrategyTemplate, mat: MaterialiseInput, lotSize: string | undefined): PlacedTemplate | null {
  const r = materialiseTemplate(tpl, mat);
  if (!r.ok) return null;
  let legs: StrategyLeg[] = [];
  for (const l of r.legs) {
    const a = addLegPure(legs, l);
    if (!a.ok) return null;
    legs = a.legs;
  }
  const priced = toPricingLegs(legs, lotSize);
  return priced.length === 0 ? null : { legs, priced };
}
