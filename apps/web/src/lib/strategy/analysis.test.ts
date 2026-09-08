import { analyze } from "@hapiecoin/pricing";
import { describe, expect, it } from "vitest";
import { cleanStep, ladderPrices, ladderRows, marginEstimate, pnlAt, popGrade, premiumPerUnit, rrGrade, rrText, whereExtreme, winZone } from "./analysis";

const NOW = Date.UTC(2026, 8, 7, 6, 0, 0);
const spread = analyze(
  [
    { kind: "call", side: "buy", strike: 80_000, expiry: "2026-09-25", quantity: 0.01, price: 800, iv: 0.3 },
    { kind: "call", side: "sell", strike: 82_000, expiry: "2026-09-25", quantity: 0.01, price: 300, iv: 0.3 },
  ],
  { spot: 79_500, nowMs: NOW },
);
const longCall = analyze([{ kind: "call", side: "buy", strike: 80_000, expiry: "2026-09-25", quantity: 0.01, price: 800, iv: 0.3 }], { spot: 79_500, nowMs: NOW });
const shortCall = analyze([{ kind: "call", side: "sell", strike: 80_000, expiry: "2026-09-25", quantity: 0.01, price: 800, iv: 0.3 }], { spot: 79_500, nowMs: NOW });
const fmt = (p: number) => p.toLocaleString("en-US", { maximumFractionDigits: 0 });

describe("HC-WS-054 / HC-WS-055 grades", () => {
  it("grades POP and R:R the way the mock does", () => {
    expect(popGrade(0.7)).toEqual({ text: "✓ high", tone: "profit" });
    expect(popGrade(0.45)).toEqual({ text: "moderate", tone: "warning" });
    expect(popGrade(0.1)).toEqual({ text: "low", tone: "loss" });
    expect(popGrade(Number.NaN).text).toBe("calculating");
    expect(rrGrade(2.5, 1, -1).text).toBe("✓ favorable");
    expect(rrGrade(1.2, 1, -1).text).toBe("balanced");
    expect(rrGrade(0.4, 1, -1).text).toBe("high risk");
    expect(rrGrade(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, -5).text).toBe("unlimited reward");
    expect(rrGrade(0, 5, Number.NEGATIVE_INFINITY).text).toBe("unlimited exposure");
    expect(rrText(1.15, 1, -1)).toBe("1 : 1.15");
    expect(rrText(longCall.rewardRisk, longCall.maxProfit, longCall.maxLoss)).toBe("1 : ∞");
    expect(rrText(shortCall.rewardRisk, shortCall.maxProfit, shortCall.maxLoss)).toBe("∞ : 1");
    expect(rrText(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY)).toBe("N/A");
  });
});

describe("HC-WS-053 / HC-WS-056 break-evens, win zone and extremes", () => {
  it("interpolates P&L and names the win zone", () => {
    expect(spread.breakevens).toHaveLength(1);
    const be = spread.breakevens[0]!;
    expect(Math.abs(pnlAt(spread.points, be))).toBeLessThan(1);
    expect(pnlAt(spread.points, 90_000)).toBeCloseTo(spread.maxProfit, 0);
    expect(pnlAt(spread.points, 1)).toBeCloseTo(spread.maxLoss, 0);
    expect(pnlAt([], 1)).toBeNaN();
    expect(winZone(spread, fmt)).toBe(`> ${fmt(be)}`);
    expect(winZone(shortCall, fmt)).toMatch(/^< /);
    const straddle = analyze(
      [
        { kind: "call", side: "buy", strike: 80_000, expiry: "2026-09-25", quantity: 0.01, price: 800, iv: 0.3 },
        { kind: "put", side: "buy", strike: 80_000, expiry: "2026-09-25", quantity: 0.01, price: 900, iv: 0.3 },
      ],
      { spot: 79_500, nowMs: NOW },
    );
    expect(winZone(straddle, fmt)).toMatch(/^< .* or > /);
    const condorish = analyze(
      [
        { kind: "call", side: "sell", strike: 80_000, expiry: "2026-09-25", quantity: 0.01, price: 800, iv: 0.3 },
        { kind: "put", side: "sell", strike: 80_000, expiry: "2026-09-25", quantity: 0.01, price: 900, iv: 0.3 },
      ],
      { spot: 79_500, nowMs: NOW },
    );
    expect(winZone(condorish, fmt)).toMatch(/^[\d,]+ – [\d,]+$/);
  });
  it("finds where the extremes are reached", () => {
    const mp = whereExtreme(spread.points, spread.maxProfit);
    expect(mp?.side).toBe("above");
    expect(Math.abs((mp?.price ?? 0) - 82_000)).toBeLessThan(500); // first sample at or after the short strike
    const ml = whereExtreme(spread.points, spread.maxLoss);
    expect(ml?.side).toBe("below");
    expect(whereExtreme(spread.points, Number.POSITIVE_INFINITY)).toBeNull();
    expect(whereExtreme([], 1)).toBeNull();
  });
});

describe("HC-WS-052 / HC-WS-057 margin estimate and per-unit premium", () => {
  it("uses the worst defined loss and refuses unbounded exposure", () => {
    expect(marginEstimate(spread)).toBeCloseTo(-spread.maxLoss, 6);
    expect(marginEstimate(shortCall)).toBeNull();
    expect(premiumPerUnit(-5, [10, 20], "0.001")).toBeCloseTo(-500, 6);
    expect(premiumPerUnit(-5, [10], undefined)).toBeNull();
    expect(premiumPerUnit(-5, [], "0.001")).toBeNull();
  });
});

describe("HC-WS-062 ladder", () => {
  it("builds clean steps, a ±20% ladder and rows with statuses", () => {
    expect(cleanStep(198)).toBe(200);
    expect(cleanStep(0.9)).toBe(1);
    expect(cleanStep(11)).toBe(10);
    expect(cleanStep(41)).toBe(50);
    expect(cleanStep(80)).toBe(100);
    expect(cleanStep(0)).toBe(1);
    const prices = ladderPrices(79_500);
    expect(prices[0]).toBeGreaterThanOrEqual(79_500 * 0.8);
    expect(prices[prices.length - 1]).toBeLessThanOrEqual(79_500 * 1.2);
    expect(prices.every((p) => p % 200 === 0)).toBe(true);
    expect(ladderPrices(0)).toEqual([]);
    const rows = ladderRows(spread, 79_500, ladderPrices(79_500, 1_000));
    expect(rows.some((r) => r.status === "spot" && r.price === 79_500)).toBe(true);
    expect(rows.some((r) => r.status === "breakeven")).toBe(true);
    expect(rows.filter((r) => r.status === "profit").every((r) => r.atExpiry > 0)).toBe(true);
    expect(rows.filter((r) => r.status === "loss").every((r) => r.atExpiry < 0)).toBe(true);
    for (let i = 1; i < rows.length; i += 1) expect(rows[i]!.price).toBeGreaterThan(rows[i - 1]!.price);
  });
});
