// Fee rules (ADR-099; HC-TR-200): the Delta India rule charges the smaller of the notional fee and the premium cap,
// GST on top, the taker rate on a future, and the taker fee again only on an in-the-money settlement.
import { describe, expect, it } from "vitest";
import { type FeeLeg, type FeeRule, fillFee, settlementFee, tradeFees } from "./fees.js";

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

describe("HC-TR-253 the fees of a whole trade from its stored legs", () => {
  const leg = (over: Partial<FeeLeg> = {}): FeeLeg => ({ kind: "call", strike: 60_000, quantity: 0.1, entryPrice: 400, exitPrice: null, settled: false, ...over });
  const fill = 6_000 * 0.0001 * 1.18; // 0.1 BTC at a 60 000 strike: 0.60 and GST

  it("HC-TR-253 an open leg has paid its entry; a leg bought back pays again; the strike stands in for the spot", () => {
    expect(tradeFees([leg()], R)).toEqual({ entry: fill, exit: 0, total: fill });
    const closed = tradeFees([leg({ exitPrice: 300 })], R); // 30 dollars of premium: its cap (1.05) is above the notional fee
    expect(closed.entry).toBeCloseTo(fill, 12);
    expect(closed.exit).toBeCloseTo(fill, 12);
    expect(closed.total).toBeCloseTo(2 * fill, 12);
    // a strangle sold and held: two entries
    expect(tradeFees([leg(), leg({ kind: "put", strike: 59_000 })], R).total).toBeCloseTo(fill + 5_900 * 0.0001 * 1.18, 12);
  });

  it("HC-TR-253 a cheap buy-back is capped by its premium: 3.5 % of it, and GST", () => {
    const t = tradeFees([leg({ exitPrice: 5 })], R);
    expect(t.exit).toBeCloseTo(5 * 0.1 * 0.035 * 1.18, 12);
    expect(t.exit).toBeLessThan(fill);
  });

  it("HC-TR-253 a leg that expired worthless pays no exit fee; one that settled in the money pays the settlement fee", () => {
    expect(tradeFees([leg({ exitPrice: 0, settled: true })], R)).toEqual({ entry: fill, exit: 0, total: fill });
    const itm = tradeFees([leg({ exitPrice: 800, settled: true })], R);
    expect(itm.exit).toBeCloseTo(settlementFee("call", 6_080, 80, R), 12); // it settled 800 in the money: the spot was 60 800
    expect(itm.exit).toBeCloseTo(6_080 * 0.0001 * 1.18, 12);
    const put = tradeFees([leg({ kind: "put", exitPrice: 800, settled: true })], R);
    expect(put.exit).toBeCloseTo(5_920 * 0.0001 * 1.18, 12); // a put 800 in the money settled at 59 200
    // a venue that charges nothing at settlement
    expect(tradeFees([leg({ exitPrice: 800, settled: true })], { ...R, settlementFee: false }).exit).toBe(0);
  });

  it("HC-TR-253 a leg never filled pays nothing; a future pays the taker rate on its own fill prices", () => {
    expect(tradeFees([leg({ entryPrice: null })], R)).toEqual({ entry: 0, exit: 0, total: 0 });
    expect(tradeFees([], R)).toEqual({ entry: 0, exit: 0, total: 0 });
    const fut = tradeFees([leg({ kind: "future", strike: 0, entryPrice: 60_000, exitPrice: 61_000 })], R);
    expect(fut.entry).toBeCloseTo(6_000 * 0.0005 * 1.18, 12);
    expect(fut.exit).toBeCloseTo(6_100 * 0.0005 * 1.18, 12);
    // a future that ran to its expiry is not charged a settlement fee by this rule
    expect(tradeFees([leg({ kind: "future", strike: 0, entryPrice: 60_000, exitPrice: 61_000, settled: true })], R).exit).toBe(0);
  });
});
