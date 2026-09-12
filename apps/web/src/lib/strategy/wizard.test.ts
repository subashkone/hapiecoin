// The Strategy Wizard's pure half (ADR-072; HC-TR-177): eligibility, the thesis figures from the expiry curve, the
// ranking and the tags, on the same arbitrage-free ladder the template invariants use.
import { analyze, black76Price } from "@hapiecoin/pricing";
import { describe, expect, it } from "vitest";
import { toPricingLegs } from "@/lib/pricing/legs";
import { type StrategyLeg, addLeg } from "./legs";
import { type ChainStrike, type MaterialiseInput, TEMPLATES, materialiseTemplate } from "./templates";
import { pnlAt } from "./analysis";
import { type WizardCandidate, bandMinPnl, clampMove, eligibleTemplates, fitsView, moveFromTarget, pnlAtExpiry, rankCandidates, returnOnRisk, tagBest, targetFromMove, thesisPnl, thesisPrices } from "./wizard";

const SPOT = 80_000;
const IV = 0.3;
const NOW = Date.UTC(2026, 8, 10, 12, 0, 0);
const EXPIRY = "2026-10-10";
const STRIKES = Array.from({ length: 21 }, (_, i) => 70_000 + i * 1_000);

function ladder(days: number): ChainStrike[] {
  const T = days / 365;
  return STRIKES.map((k) => ({
    strike: String(k),
    call: { mark: black76Price(SPOT, k, T, IV, true).toFixed(2), markIv: IV },
    put: { mark: black76Price(SPOT, k, T, IV, false).toFixed(2), markIv: IV },
  }));
}
const input: MaterialiseInput = { asset: "BTC", expiry: EXPIRY, expiries: [EXPIRY], rows: ladder(30), atm: 10, lots: 10, spot: String(SPOT) };

function candidate(name: string): WizardCandidate {
  const template = TEMPLATES.find((t) => t.name === name)!;
  const r = materialiseTemplate(template, input);
  if (!r.ok) throw new Error(`${name}: ${r.reason}`);
  let legs: StrategyLeg[] = [];
  for (const l of r.legs) {
    const a = addLeg(legs, l, NOW);
    if (!a.ok) throw new Error(`${name}: ${a.reason}`);
    legs = a.legs;
  }
  return { template, legs, result: analyze(toPricingLegs(legs, "0.001"), { spot: SPOT, nowMs: NOW, defaultIv: IV, settlementHourUtc: 12, points: 81 }) };
}
const ALL = eligibleTemplates(TEMPLATES).map((t) => candidate(t.name));

describe("HC-TR-177 eligibility and the thesis", () => {
  it("offers only templates with a finite worst case on one expiry", () => {
    const names = eligibleTemplates(TEMPLATES).map((t) => t.name);
    expect(names).toContain("Bull Call Spread");
    expect(names).toContain("Iron Condor");
    expect(names).toContain("Buy Call");
    for (const bad of ["Sell Call", "Short Straddle", "Short Strangle", "Jade Lizard", "Call Ratio Spread 1x2", "Short Perp"]) expect(names, bad).not.toContain(bad);
    for (const cal of ["Diagonal Call", "Long Calendar with Calls", "Double Diagonal", "Calendar Strangle"]) expect(names, cal).not.toContain(cal);
    for (const t of eligibleTemplates(TEMPLATES)) expect(t.risk).toBe("defined");
    expect(names).toHaveLength(TEMPLATES.filter((t) => t.risk === "defined" && !t.tags?.includes("calendar")).length);
  });

  it("reads the move: clamped, to and from a target price, placed by the view", () => {
    expect(clampMove(-3)).toBe(3);
    expect(clampMove(Number.NaN)).toBe(0);
    expect(clampMove(80)).toBe(50);
    expect(targetFromMove(80_000, 3)).toBeCloseTo(82_400, 6);
    expect(moveFromTarget(80_000, 77_600)).toBeCloseTo(-3, 9);
    expect(moveFromTarget(0, 77_600)).toBe(0);
    expect(thesisPrices(80_000, { view: "Bullish", movePct: 3 })).toEqual({ kind: "price", price: 82_400 });
    expect(thesisPrices(80_000, { view: "Bearish", movePct: 3 })).toEqual({ kind: "price", price: 77_600 });
    expect(thesisPrices(80_000, { view: "Neutral", movePct: 2 })).toEqual({ kind: "band", lo: 78_400, hi: 81_600 });
    expect(thesisPrices(80_000, { view: "Volatile", movePct: 5 })).toEqual({ kind: "band", lo: 76_000, hi: 84_000 });
  });

  it("extends the expiry curve as a straight line beyond the engine's range (a buy call keeps rising, one for one per unit)", () => {
    const { result, legs } = candidate("Buy Call");
    const last = result.points[result.points.length - 1]!;
    const qty = legs[0]!.lots * 0.001;
    const far = pnlAtExpiry(result.points, last.price * 1.5);
    expect(far - last.pnlExpiry).toBeCloseTo(last.price * 0.5 * qty, 3);
    const first = result.points[0]!;
    // below the range a long call is worth nothing more: the line is flat at the premium lost
    expect(pnlAtExpiry(result.points, first.price * 0.5)).toBeCloseTo(first.pnlExpiry, 6);
    // inside the range it is the engine's interpolation
    expect(pnlAtExpiry(result.points, SPOT)).toBe(pnlAt(result.points, SPOT));
    expect(pnlAtExpiry(result.points, SPOT * 1.01)).toBe(pnlAt(result.points, SPOT * 1.01));
    expect(pnlAtExpiry([], SPOT)).toBeNaN();
    expect(pnlAtExpiry([first], SPOT)).toBe(first.pnlExpiry);
  });

  it("values the thesis at the target price for a directional view and at the worst point of the band otherwise", () => {
    const spread = candidate("Bull Call Spread");
    expect(thesisPnl(spread.result.points, SPOT, { view: "Bullish", movePct: 3 })).toBeCloseTo(pnlAtExpiry(spread.result.points, 82_400), 9);
    expect(thesisPnl(spread.result.points, SPOT, { view: "Bearish", movePct: 3 })).toBeCloseTo(pnlAtExpiry(spread.result.points, 77_600), 9);
    const condor = candidate("Iron Condor");
    const band = thesisPnl(condor.result.points, SPOT, { view: "Neutral", movePct: 2 });
    expect(band).toBe(bandMinPnl(condor.result.points, 78_400, 81_600));
    expect(band).toBeLessThanOrEqual(pnlAtExpiry(condor.result.points, SPOT));
    expect(band).toBeGreaterThan(0);
    const straddle = candidate("Long Straddle");
    const vol = thesisPnl(straddle.result.points, SPOT, { view: "Volatile", movePct: 8 });
    expect(vol).toBe(Math.min(pnlAtExpiry(straddle.result.points, 73_600), pnlAtExpiry(straddle.result.points, 86_400)));
  });

  it("fits a view off the thesis curve: direction beats the opposite move, neutral holds the band, volatile beats spot", () => {
    const spread = candidate("Bull Call Spread");
    expect(fitsView(spread.result.points, SPOT, { view: "Bullish", movePct: 3 })).toBe(true);
    expect(fitsView(spread.result.points, SPOT, { view: "Bearish", movePct: 3 })).toBe(false);
    expect(fitsView(spread.result.points, SPOT, { view: "Neutral", movePct: 3 })).toBe(false);
    // a bought call needs more than a tiny rise to pay for its premium: at 0.1 % it is not yet bullish
    const call = candidate("Buy Call");
    expect(fitsView(call.result.points, SPOT, { view: "Bullish", movePct: 0.1 })).toBe(false);
    expect(fitsView(call.result.points, SPOT, { view: "Bullish", movePct: 10 })).toBe(true);
    // a bull put spread profits across a small band but most on the rise: bullish at 3 %, and neutral too (both are true)
    const bps = candidate("Bull Put Spread");
    expect(fitsView(bps.result.points, SPOT, { view: "Bullish", movePct: 3 })).toBe(true);
    // a condor profits equally either side: a bet on the range, never on a direction
    const condor = candidate("Iron Condor");
    expect(fitsView(condor.result.points, SPOT, { view: "Bullish", movePct: 1 })).toBe(false);
    expect(fitsView(condor.result.points, SPOT, { view: "Neutral", movePct: 1 })).toBe(true);
    expect(fitsView(condor.result.points, SPOT, { view: "Volatile", movePct: 1 })).toBe(false);
    const straddle = candidate("Long Straddle");
    expect(fitsView(straddle.result.points, SPOT, { view: "Volatile", movePct: 8 })).toBe(true);
    expect(fitsView(straddle.result.points, SPOT, { view: "Neutral", movePct: 1 })).toBe(false);
    expect(fitsView([], SPOT, { view: "Bullish", movePct: 3 })).toBe(false);
    expect(fitsView(spread.result.points, 0, { view: "Bullish", movePct: 3 })).toBe(false);
  });
});

describe("HC-TR-177 ranking and tags", () => {
  it("keeps the candidates that fit and profit, best return on risk first, then POP, then name", () => {
    const bull = rankCandidates(ALL, SPOT, { view: "Bullish", movePct: 3 });
    expect(bull.length).toBeGreaterThan(2);
    expect(bull.map((c) => c.template.name)).toContain("Bull Call Spread");
    expect(bull.map((c) => c.template.name)).not.toContain("Bear Put Spread");
    for (const c of bull) {
      expect(c.pnlThesis).toBeGreaterThan(0);
      expect(c.template.risk).toBe("defined");
      expect(Number.isFinite(c.result.maxLoss)).toBe(true);
      expect(c.returnOnRisk).toBeCloseTo(c.pnlThesis / Math.abs(c.result.maxLoss), 12);
    }
    for (let i = 1; i < bull.length; i++) expect(bull[i - 1]!.returnOnRisk).toBeGreaterThanOrEqual(bull[i]!.returnOnRisk);
    const bear = rankCandidates(ALL, SPOT, { view: "Bearish", movePct: 3 });
    expect(bear.map((c) => c.template.name)).toContain("Bear Put Spread");
    expect(bear.map((c) => c.template.name)).not.toContain("Bull Call Spread");
    const neutral = rankCandidates(ALL, SPOT, { view: "Neutral", movePct: 2 });
    expect(neutral.map((c) => c.template.name)).toContain("Iron Condor");
    const volatile = rankCandidates(ALL, SPOT, { view: "Volatile", movePct: 8 });
    expect(volatile.map((c) => c.template.name)).toContain("Long Straddle");
    // nothing moves at all: no volatile structure profits at spot, so nothing fits
    expect(rankCandidates(ALL, SPOT, { view: "Volatile", movePct: 0 })).toEqual([]);
    expect(rankCandidates(ALL, 0, { view: "Bullish", movePct: 3 })).toEqual([]);
  });

  it("breaks ties by POP then name, and a structure that cannot lose ranks first", () => {
    expect(returnOnRisk(10, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(returnOnRisk(0, 0)).toBe(0);
    expect(returnOnRisk(50, -100)).toBe(0.5);
    const a = candidate("Bull Call Spread");
    const same = { ...a, result: { ...a.result, pop: a.result.pop - 0.1 }, template: { ...a.template, name: "Aaa Copy" } };
    const same2 = { ...a, result: { ...a.result, pop: a.result.pop - 0.1 }, template: { ...a.template, name: "Zzz Copy" } };
    const ranked = rankCandidates([same2, same, a], SPOT, { view: "Bullish", movePct: 3 });
    expect(ranked.map((c) => c.template.name)).toEqual(["Bull Call Spread", "Aaa Copy", "Zzz Copy"]);
  });

  it("gives each shown card one earned tag, never the same tag twice", () => {
    const shown = rankCandidates(ALL, SPOT, { view: "Bullish", movePct: 3 }).slice(0, 3);
    const tags = tagBest(shown);
    expect(tags.get(shown[0]!.template.name)).toBe("best return on risk");
    expect(new Set(tags.values()).size).toBe(tags.size);
    expect(tags.size).toBe(3);
    const pop = [...tags.entries()].find(([, t]) => t === "highest POP")?.[0];
    const loss = [...tags.entries()].find(([, t]) => t === "smallest max loss")?.[0];
    const rest = shown.slice(1);
    expect(rest.map((c) => c.template.name)).toContain(pop);
    expect(rest.map((c) => c.template.name)).toContain(loss);
    // one card: one tag; two cards: two tags
    expect([...tagBest(shown.slice(0, 1)).values()]).toEqual(["best return on risk"]);
    expect(tagBest(shown.slice(0, 2)).size).toBe(2);
    expect(tagBest([]).size).toBe(0);
    // a card without a POP never earns "highest POP"
    const noPop = shown.map((c) => ({ ...c, pop: null }));
    expect([...tagBest(noPop).values()]).not.toContain("highest POP");
  });
});
