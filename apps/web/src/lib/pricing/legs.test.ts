// Strategy legs → pricing legs (HC-TR-196, ADR-095): the price basis of a future leg.
import { payoffAtExpiry } from "@hapiecoin/pricing";
import { describe, expect, it } from "vitest";
import type { StrategyLeg } from "@/lib/strategy/legs";
import { toPricingLegs } from "./legs";

const leg = (over: Partial<StrategyLeg> & Pick<StrategyLeg, "id" | "kind" | "side" | "price">): StrategyLeg => ({ asset: "BTC", strike: "", expiry: "PERP", lots: 100, iv: undefined, symbol: "BTCUSD", status: "open", createdAt: 0, ...over });
const FUT = leg({ id: "f", kind: "future", side: "buy", price: "78000" }); // opened at 78,000
const CALL = leg({ id: "c", kind: "call", side: "sell", strike: "92000", expiry: "2026-11-27", price: "1600", iv: 0.4, symbol: "C-BTC-92000-271126" });

describe("HC-TR-196 a future leg is priced from its entry unless the prices are live", () => {
  it("HC-TR-196 a held future keeps its entry: with spot at 80,000 a long opened at 78,000 has earned 2,000 per unit, not nothing", () => {
    const [f] = toPricingLegs([FUT], "0.001", { spot: "80000" });
    expect(f!.price).toBe(78_000);
    expect(f!.quantity).toBeCloseTo(0.1, 12); // 100 lots × 0.001
    expect(payoffAtExpiry([f!], 80_000)).toBeCloseTo((80_000 - 78_000) * 0.1, 9); // $200, the leg table's figure
    expect(payoffAtExpiry([f!], 78_000)).toBeCloseTo(0, 9); // flat at its own entry, not at today's spot
  });

  it("HC-TR-196 in live price mode (a mark source is given) the index stands in for the future's mark, as it does for the Builder and the portfolio greeks", () => {
    const [f, c] = toPricingLegs([FUT, CALL], "0.001", { mark: () => "1450", spot: "80000" });
    expect(f!.price).toBe(80_000);
    expect(c!.price).toBe(1_450);
    // live mode without a spot yet: the stored price, never NaN
    expect(toPricingLegs([FUT], "0.001", { mark: () => undefined })[0]!.price).toBe(78_000);
  });

  it("HC-TR-196 an option keeps its stored price without a mark source, exactly as before", () => {
    expect(toPricingLegs([CALL], "0.001", { spot: "80000" })[0]!.price).toBe(1_600);
    expect(toPricingLegs([CALL], "0.001")[0]!.price).toBe(1_600);
  });
});
