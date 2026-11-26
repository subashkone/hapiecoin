// HC-TR-257 (ADR-128): the margin estimated when a trade is entered: every sold option and futures leg under the
// contract's own margin percent, plus the net premium paid; nothing rather than a part figure.
import { describe, expect, it } from "vitest";
import { type MarginInputs, type MarginLeg, type MarginParams, entryMargin, marginEstimateOf } from "./margin.js";

const DAILY: MarginParams = { contractValue: "0.001", initialMarginPct: "0.5", initialMarginScalingFactor: "0.000002", maxLeverageNotional: "200000" };
const MONTHLY: MarginParams = { contractValue: "0.001", initialMarginPct: "5", initialMarginScalingFactor: "0.000002", maxLeverageNotional: "200000" };
const PUT = "P-BTC-60000-241126";
const CALL = "C-BTC-62000-241126";
const WING = "C-BTC-63000-241126";
const FAR = "C-BTC-62000-290127";
const PERP = "BTCUSD";
const inputs = (spot: number | null = 61_000): MarginInputs => ({ spot, params: new Map([[PUT, DAILY], [CALL, DAILY], [WING, DAILY], [FAR, MONTHLY], [PERP, { contractValue: "0.001", initialMarginPct: "0.5", initialMarginScalingFactor: undefined, maxLeverageNotional: undefined }]]) });
const leg = (symbol: string, side: MarginLeg["side"], price: string, over: Partial<MarginLeg> = {}): MarginLeg => ({ kind: symbol.startsWith("P-") ? "put" : symbol.startsWith("C-") ? "call" : "future", side, symbol, lots: 100, price, ...over });
/** One sold option of 100 contracts, far under the 200,000 USD threshold: pct / 100 × spot × 0.001 + mark × 0.001, a contract. */
const short = (pct: number, spot: number, mark: number) => (pct / 100) * spot * 0.001 * 100 + mark * 0.001 * 100;

describe("HC-TR-257 the margin estimated at entry", () => {
  it("HC-TR-257 a sold strangle is the two sold options under their contract's percent, the spot and their marks", () => {
    const est = marginEstimateOf([leg(PUT, "sell", "400"), leg(CALL, "sell", "420")], "0.001", inputs());
    expect(Number(est)).toBeCloseTo(short(0.5, 61_000, 400) + short(0.5, 61_000, 420), 2);
    expect(est).toBe("143");
    // the same strikes a month out are margined at ten times the percent
    expect(Number(marginEstimateOf([leg(FAR, "sell", "4400")], "0.001", inputs()))).toBeCloseTo(short(5, 61_000, 4400), 2);
  });

  it("HC-TR-295 the percent grows per USD of the position above the venue's threshold, and a factor with no threshold gives no figure", () => {
    // 5,000 contracts at spot 61,000 are 305,000 USD, 105,000 over: 0.5 + 0.000002 x 105,000 = 0.71 % of 305,000 = 2,165.50, plus the mark (400 x 5)
    expect(marginEstimateOf([leg(PUT, "sell", "400", { lots: 5_000 })], "0.001", inputs())).toBe("4165.5");
    // each leg is its own position: two legs under the threshold each add nothing, whatever they sum to
    expect(marginEstimateOf([leg(PUT, "sell", "400", { lots: 3_000 }), leg(CALL, "sell", "420", { lots: 3_000 })], "0.001", inputs())).toBe("4290");
    const noThreshold: MarginInputs = { spot: 61_000, params: new Map([[PUT, { contractValue: "0.001", initialMarginPct: "0.5", initialMarginScalingFactor: "0.000002", maxLeverageNotional: undefined }]]) };
    expect(marginEstimateOf([leg(PUT, "sell", "400")], "0.001", noThreshold)).toBeNull();
  });

  it("HC-TR-257 a bought option adds no margin; a net premium paid is added, a net premium collected is not taken off", () => {
    // sold 62 000 at 420, bought 63 000 at 200: a credit, so the sold leg's margin alone (no relief for the wing)
    expect(Number(marginEstimateOf([leg(CALL, "sell", "420"), leg(WING, "buy", "200")], "0.001", inputs()))).toBeCloseTo(short(0.5, 61_000, 420), 2);
    // sold at 100, bought at 400: 30 dollars of premium paid on 0.1 BTC, on top of the sold leg's margin
    expect(Number(marginEstimateOf([leg(CALL, "sell", "100"), leg(WING, "buy", "400")], "0.001", inputs()))).toBeCloseTo(short(0.5, 61_000, 100) + 30, 2);
  });

  it("HC-TR-257 nothing sold and no future: no margin figure (its capital is the premium, read from the legs)", () => {
    expect(marginEstimateOf([leg(CALL, "buy", "420")], "0.001", inputs())).toBeNull();
    expect(marginEstimateOf([], "0.001", inputs())).toBeNull();
  });

  it("HC-TR-257 a futures leg, long or short, is margined on its own price", () => {
    const est = marginEstimateOf([leg(PERP, "buy", "61000")], "0.001", inputs(null)); // a future needs no spot
    expect(Number(est)).toBeCloseTo((0.5 / 100) * 61_000 * 0.001 * 100, 2);
    expect(marginEstimateOf([leg(PERP, "sell", "61000")], "0.001", inputs(null))).toBe(est);
  });

  it("HC-TR-257 no part figure: a sold leg the venue lists no parameters for, no spot, a size that is not whole contracts, or no source at all gives nothing", () => {
    expect(marginEstimateOf([leg(PUT, "sell", "400"), leg("C-BTC-99000-241126", "sell", "5")], "0.001", inputs())).toBeNull();
    expect(marginEstimateOf([leg(PUT, "sell", "400")], "0.001", inputs(null))).toBeNull();
    expect(marginEstimateOf([leg(PUT, "sell", "400", { lots: 1 })], "0.0005", inputs())).toBeNull(); // half a contract
    expect(marginEstimateOf([leg(PUT, "sell", "400")], "0", inputs())).toBeNull();
    expect(marginEstimateOf([leg(PUT, "sell", "not a price")], "0.001", inputs())).toBeNull();
    expect(marginEstimateOf([leg(PUT, "sell", "400")], "0.001", null)).toBeNull();
    const noPct: MarginInputs = { spot: 61_000, params: new Map([[PUT, { contractValue: "0.001", initialMarginPct: undefined, initialMarginScalingFactor: undefined, maxLeverageNotional: undefined }]]) };
    expect(marginEstimateOf([leg(PUT, "sell", "400")], "0.001", noPct)).toBeNull();
  });

  it("HC-TR-257 at entry the source is read once, a given spot replaces the source's, and a source that fails or is absent leaves the trade without a figure", async () => {
    let reads = 0;
    const source = () => {
      reads += 1;
      return Promise.resolve(inputs(50_000));
    };
    const legs = [leg(PUT, "sell", "400")];
    expect(Number(await entryMargin(source, "BTC", "delta_india", legs, "0.001"))).toBeCloseTo(short(0.5, 50_000, 400), 2);
    expect(Number(await entryMargin(source, "BTC", "delta_india", legs, "0.001", 61_000))).toBeCloseTo(short(0.5, 61_000, 400), 2);
    expect(reads).toBe(2);
    // nothing margined: the venue is not asked
    expect(await entryMargin(source, "BTC", "delta_india", [leg(CALL, "buy", "420")], "0.001")).toBeNull();
    expect(reads).toBe(2);
    expect(await entryMargin(() => Promise.reject(new Error("venue down")), "BTC", "delta_india", legs, "0.001")).toBeNull();
    expect(await entryMargin(() => Promise.resolve(null), "BTC", "deribit", legs, "0.001", 61_000)).toBeNull();
    expect(await entryMargin(undefined, "BTC", "delta_india", legs, "0.001")).toBeNull();
  });

  it("HC-TR-257 a caller's spot is handed to the source, so it reads no ticker; a venue slower than the deadline leaves the trade without a figure and does not hold it up", async () => {
    const seen: (number | undefined)[] = [];
    const source = (_a: string, _v: string, spot?: number) => {
      seen.push(spot);
      return Promise.resolve(inputs(null)); // no spot of its own
    };
    const legs = [leg(PUT, "sell", "400")];
    expect(Number(await entryMargin(source, "BTC", "delta_india", legs, "0.001", 61_000))).toBeCloseTo(short(0.5, 61_000, 400), 2);
    expect(await entryMargin(source, "BTC", "delta_india", legs, "0.001")).toBeNull(); // no spot from anywhere
    expect(seen).toEqual([61_000, undefined]);
    const slow = () => new Promise<MarginInputs>((resolve) => setTimeout(() => resolve(inputs()), 400));
    const started = Date.now();
    expect(await entryMargin(slow, "BTC", "delta_india", legs, "0.001", undefined, 30)).toBeNull();
    expect(Date.now() - started).toBeLessThan(300);
    expect(Number(await entryMargin(slow, "BTC", "delta_india", legs, "0.001", undefined, 2_000))).toBeGreaterThan(0); // within the deadline it is used
  });
});
