// Per-template textbook invariants (ADR-060; GAPS #75): every template in the catalogue is materialised on a synthetic
// ladder whose marks come from Black-76 (so the quotes are arbitrage-free), run through the same path the Builder uses
// (materialise → addLeg → toPricingLegs → analyze) and checked against the shape a textbook gives it: whether the
// maximum profit and loss are bounded, how many break-evens the expiry payoff has, and the outlook the payoff expresses.
// A calendar-family template is valued at its nearest expiry with the later legs keeping time value, exactly as the
// Templates tab and the payoff pane do (ADR-059 addendum, nearestExpiryValuationMs).
// Rows marked "any" are structures whose sign at ±6 % depends on the exact premiums (back and ratio spreads,
// broken wings, lizards, diagonals); their bounds still catch a flipped side (a sold back spread turns unbounded loss
// into unbounded profit) and a wrong lot ratio (a 1x1 loses its unbounded side). Calendar-family rows assert bounded
// profit and loss with two break-evens around the hump, and that near legs are sold and far legs bought (a reversed
// calendar has a bounded loss where the hump was and no profit near spot).
import { analyze, black76Price } from "@hapiecoin/pricing";
import { describe, expect, it } from "vitest";
import { toPricingLegs } from "@/lib/pricing/legs";
import { type StrategyLeg, addLeg } from "./legs";
import { type ChainStrike, type MaterialiseInput, TEMPLATES, materialiseTemplate } from "./templates";
import { nearestExpiryValuationMs } from "./analysis";
import { type Outlook, classifyOutlook } from "./useTemplateStats";

const SPOT = 80_000;
const IV = 0.3;
const NOW = Date.UTC(2026, 8, 10, 12, 0, 0);
const EXPIRIES = ["2026-10-10", "2026-11-09"] as const; // 30 and 60 days, settling 12:00 UTC
const STRIKES = Array.from({ length: 21 }, (_, i) => 70_000 + i * 1_000);
const ATM = 10;

function ladder(days: number): ChainStrike[] {
  const T = days / 365;
  return STRIKES.map((k) => ({
    strike: String(k),
    call: { mark: black76Price(SPOT, k, T, IV, true).toFixed(2), markIv: IV },
    put: { mark: black76Price(SPOT, k, T, IV, false).toFixed(2), markIv: IV },
  }));
}

const input: MaterialiseInput = {
  asset: "BTC",
  expiry: EXPIRIES[0],
  expiries: [...EXPIRIES],
  rows: ladder(30),
  atm: ATM,
  rowsByExpiry: { [EXPIRIES[1]]: { rows: ladder(60), atm: ATM } },
  lots: 1,
  spot: String(SPOT),
};

type Bound = "finite" | "unbounded";
interface Shape {
  maxProfit: Bound;
  maxLoss: Bound;
  breakevens: number | "any";
  outlook: Outlook | null | "any";
}
const F: Bound = "finite";
const U: Bound = "unbounded";

/** Textbook shape per template: maxProfit / maxLoss bounded?, break-evens at expiry, outlook from the payoff at ±6 %. */
const SHAPES: Record<string, Shape> = {
  // Bullish
  "Buy Call": { maxProfit: U, maxLoss: F, breakevens: 1, outlook: "Bullish" },
  "Sell Put": { maxProfit: F, maxLoss: F, breakevens: 1, outlook: "Bullish" },
  "Bull Call Spread": { maxProfit: F, maxLoss: F, breakevens: 1, outlook: "Bullish" },
  "Bull Put Spread": { maxProfit: F, maxLoss: F, breakevens: 1, outlook: "Bullish" },
  "Long Synthetic Future": { maxProfit: U, maxLoss: F, breakevens: 1, outlook: "Bullish" },
  "Long Perp": { maxProfit: U, maxLoss: F, breakevens: 1, outlook: "Bullish" },
  "Covered Call": { maxProfit: F, maxLoss: F, breakevens: 1, outlook: "Bullish" },
  "Protective Put": { maxProfit: U, maxLoss: F, breakevens: 1, outlook: "Bullish" },
  Collar: { maxProfit: F, maxLoss: F, breakevens: 1, outlook: "Bullish" },
  "Call Back Spread 1x2": { maxProfit: U, maxLoss: F, breakevens: 1, outlook: "any" },
  "Diagonal Call": { maxProfit: F, maxLoss: F, breakevens: "any", outlook: "any" },
  "Risk Reversal": { maxProfit: U, maxLoss: F, breakevens: 1, outlook: "Bullish" },
  // Bearish
  "Buy Put": { maxProfit: F, maxLoss: F, breakevens: 1, outlook: "Bearish" },
  "Sell Call": { maxProfit: F, maxLoss: U, breakevens: 1, outlook: "Bearish" },
  "Bear Put Spread": { maxProfit: F, maxLoss: F, breakevens: 1, outlook: "Bearish" },
  "Bear Call Spread": { maxProfit: F, maxLoss: F, breakevens: 1, outlook: "Bearish" },
  "Short Synthetic Future": { maxProfit: F, maxLoss: U, breakevens: 1, outlook: "Bearish" },
  "Short Perp": { maxProfit: F, maxLoss: U, breakevens: 1, outlook: "Bearish" },
  "Covered Put": { maxProfit: F, maxLoss: U, breakevens: 1, outlook: "Bearish" },
  "Put Back Spread 1x2": { maxProfit: F, maxLoss: F, breakevens: 1, outlook: "any" },
  "Diagonal Put": { maxProfit: F, maxLoss: F, breakevens: "any", outlook: "any" },
  // Neutral
  "Long Straddle": { maxProfit: U, maxLoss: F, breakevens: 2, outlook: "any" },
  "Short Straddle": { maxProfit: F, maxLoss: U, breakevens: 2, outlook: "Neutral" },
  "Long Strangle": { maxProfit: U, maxLoss: F, breakevens: 2, outlook: "any" },
  "Short Strangle": { maxProfit: F, maxLoss: U, breakevens: 2, outlook: "Neutral" },
  "Iron Condor": { maxProfit: F, maxLoss: F, breakevens: 2, outlook: "Neutral" },
  "Reverse Iron Condor": { maxProfit: F, maxLoss: F, breakevens: 2, outlook: "Volatile" },
  "Iron Butterfly": { maxProfit: F, maxLoss: F, breakevens: 2, outlook: "Neutral" },
  "Reverse Iron Butterfly": { maxProfit: F, maxLoss: F, breakevens: 2, outlook: "Volatile" },
  "Long Call Butterfly": { maxProfit: F, maxLoss: F, breakevens: 2, outlook: "Neutral" },
  "Long Put Butterfly": { maxProfit: F, maxLoss: F, breakevens: 2, outlook: "Neutral" },
  "Long Call Condor": { maxProfit: F, maxLoss: F, breakevens: 2, outlook: "Neutral" },
  "Long Calendar with Calls": { maxProfit: F, maxLoss: F, breakevens: 2, outlook: "any" },
  "Long Calendar with Puts": { maxProfit: F, maxLoss: F, breakevens: 2, outlook: "any" },
  "Long Gut": { maxProfit: U, maxLoss: F, breakevens: 2, outlook: "any" },
  Strip: { maxProfit: U, maxLoss: F, breakevens: 2, outlook: "Bearish" },
  Strap: { maxProfit: U, maxLoss: F, breakevens: 2, outlook: "Bullish" },
  "Synthetic Straddle": { maxProfit: U, maxLoss: F, breakevens: 2, outlook: "any" },
  "Broken-Wing Put Butterfly": { maxProfit: F, maxLoss: F, breakevens: "any", outlook: "any" },
  "Broken-Wing Call Butterfly": { maxProfit: F, maxLoss: F, breakevens: "any", outlook: "any" },
  "Double Diagonal": { maxProfit: F, maxLoss: F, breakevens: 2, outlook: "any" },
  "Calendar Strangle": { maxProfit: F, maxLoss: F, breakevens: 2, outlook: "any" },
  // Others
  "Jade Lizard": { maxProfit: F, maxLoss: U, breakevens: 1, outlook: "any" },
  "Reverse Jade Lizard": { maxProfit: F, maxLoss: F, breakevens: 1, outlook: "any" },
  "Call Ratio Spread 1x2": { maxProfit: F, maxLoss: U, breakevens: 1, outlook: "any" },
  "Put Ratio Spread 1x2": { maxProfit: F, maxLoss: F, breakevens: 1, outlook: "any" },
  "Short Call Ladder": { maxProfit: U, maxLoss: F, breakevens: 1, outlook: "any" },
  "Short Put Ladder": { maxProfit: F, maxLoss: F, breakevens: 1, outlook: "any" },
};

function build(name: string) {
  const tpl = TEMPLATES.find((t) => t.name === name)!;
  const r = materialiseTemplate(tpl, input);
  if (!r.ok) throw new Error(`${name}: ${r.reason}`);
  let legs: StrategyLeg[] = [];
  for (const l of r.legs) {
    const a = addLeg(legs, l, NOW);
    if (!a.ok) throw new Error(`${name}: ${a.reason}`);
    legs = a.legs;
  }
  const priced = toPricingLegs(legs, "0.001");
  const valuationMs = nearestExpiryValuationMs(legs, 12, NOW);
  return analyze(priced, { spot: SPOT, nowMs: NOW, defaultIv: IV, settlementHourUtc: 12, points: 161, ...(valuationMs !== undefined ? { valuationMs } : {}) });
}

describe("ADR-060 every template has its textbook shape on an arbitrage-free ladder", () => {
  it("has a shape row for every template and no row for a template that does not exist", () => {
    expect(Object.keys(SHAPES).sort()).toEqual(TEMPLATES.map((t) => t.name).sort());
  });

  it.each(TEMPLATES.map((t) => [t.name] as const))("%s", (name) => {
    const want = SHAPES[name]!;
    const res = build(name);
    expect(Number.isFinite(res.maxProfit) ? "finite" : "unbounded", "max profit").toBe(want.maxProfit);
    expect(Number.isFinite(res.maxLoss) ? "finite" : "unbounded", "max loss").toBe(want.maxLoss);
    expect(res.maxLoss, "every structure can lose").toBeLessThan(0);
    const tpl = TEMPLATES.find((t) => t.name === name)!;
    if (tpl.tags?.includes("calendar")) {
      expect(res.maxProfit, "a long calendar profits somewhere near its strikes").toBeGreaterThan(0);
      for (const l of tpl.legs) if (l.kind !== "future") expect(l.side, `${name}: near legs sold, far legs bought`).toBe((l.expiryOffset ?? 0) > 0 ? "buy" : "sell");
    }
    if (want.breakevens !== "any") expect(res.breakevens, "break-evens").toHaveLength(want.breakevens);
    for (const be of res.breakevens) expect(Math.abs(be - SPOT) / SPOT, "break-evens sit within 20 % of spot").toBeLessThan(0.2);
    if (want.outlook !== "any") expect(classifyOutlook(res.points, SPOT), "outlook at ±6 %").toBe(want.outlook);
  });
});
