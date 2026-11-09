// Fee rules (ADR-099; HC-TR-200): the Delta India rule charges the smaller of the notional fee and the premium cap,
// GST on top, the taker rate on a future, and the taker fee again only on an in-the-money settlement.
import { describe, expect, it } from "vitest";
import { type FeeRule, fillFee, settlementFee } from "./fees.js";

/** Delta Exchange India's rule as the venues port carries it (VenueCore.feeRule); copied here because the pricing package has no dependencies. */
export const DELTA_RULE: FeeRule = { optionPct: 0.0001, optionCapOfPremium: 0.035, futurePct: 0.0005, gstPct: 0.18, settlementFee: true };
const R = DELTA_RULE;

describe("HC-TR-200 fee rule", () => {
  it("an option leg's fee is the smaller of notional × 0.01 % and premium × 3.5 %, plus 18 % GST", () => {
    // 0.1 BTC at 80 000 spot: notional 8 000 → 0.80 before tax; a 7 dollar premium caps it at 0.245
    expect(fillFee("call", 8_000, 0.7, R)).toBeCloseTo(0.7 * 0.035 * 1.18, 10);
    // a 430 dollar premium (4 300 per BTC × 0.1): the cap is 15.05, so the notional fee of 0.80 applies
    expect(fillFee("put", 8_000, 430, R)).toBeCloseTo(0.8 * 1.18, 10);
    // the cap sits exactly where premium × 3.5 % equals notional × 0.01 %: 0.01 / 3.5 of the notional
    expect(fillFee("call", 8_000, 8_000 * (0.0001 / 0.035), R)).toBeCloseTo(0.8 * 1.18, 10);
    // a credit leg is charged on the size of its premium
    expect(fillFee("put", 8_000, -0.7, R)).toBeCloseTo(fillFee("put", 8_000, 0.7, R), 12);
  });

  it("a future pays the taker rate on the notional with GST and ignores the premium", () => {
    expect(fillFee("future", 8_000, 0, R)).toBeCloseTo(8_000 * 0.0005 * 1.18, 10);
    expect(fillFee("future", 8_000, 999, R)).toBeCloseTo(fillFee("future", 8_000, 0, R), 12);
  });

  it("settlement charges the taker fee on an in-the-money leg's settlement value and nothing on a worthless one or a future", () => {
    expect(settlementFee("call", 8_000, 120, R)).toBeCloseTo(fillFee("call", 8_000, 120, R), 12);
    expect(settlementFee("call", 8_000, 0, R)).toBe(0);
    expect(settlementFee("future", 8_000, 500, R)).toBe(0);
    expect(settlementFee("put", 8_000, 120, { ...R, settlementFee: false })).toBe(0);
  });
});
