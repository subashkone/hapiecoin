// Alert evaluation helpers (ADR-052; HC-SH-095, 096): readings → current value, condition / now / fired copy, due alerts.
import type { Alert } from "@hapiecoin/schema";
import { describe, expect, it } from "vitest";
import { EMPTY_READINGS, conditionText, currentValue, decimalOf, dueAlerts, firedText, nowText } from "./engine";

const base: Alert = { id: "alr_1", kind: "price", asset: "BTC", venue: "delta_india", strategyId: null, strategyName: null, op: ">=", value: "82000", channels: ["push"], state: "armed", lastValue: null, triggeredAt: null, createdAt: "2026-09-10T00:00:00.000Z", updatedAt: "2026-09-10T00:00:00.000Z" };
const iv: Alert = { ...base, id: "alr_2", kind: "iv", op: "<=", value: "30", channels: ["email"] };
const pnl: Alert = { ...base, id: "alr_3", kind: "pnl", strategyId: "strat_1", strategyName: "Bull Call Spread", op: ">=", value: "20", channels: ["push", "email"] };
const readings = { spot: { "delta_india:BTC": 79506.5, "deribit:BTC": 79400 }, atmIv: { "delta_india:BTC": 0.424 }, pnl: { strat_1: -0.64 } }; // readings per venue and asset (ADR-071)

describe("currentValue", () => {
  it("reads the price, the IV in % and the strategy P&L; null when unknown", () => {
    expect(currentValue(base, readings)).toBe(79506.5);
    expect(currentValue({ ...base, venue: "deribit" }, readings)).toBe(79400); // HC-SH-126: a Deribit price alert reads Deribit's index
    expect(currentValue({ ...base, venue: "deribit", asset: "ETH" }, readings)).toBeNull();
    expect(currentValue(iv, readings)).toBeCloseTo(42.4, 9);
    expect(currentValue(pnl, readings)).toBe(-0.64);
    expect(currentValue(base, EMPTY_READINGS)).toBeNull();
    expect(currentValue({ ...iv, asset: "ETH" }, readings)).toBeNull();
    expect(currentValue({ ...pnl, strategyId: null }, readings)).toBeNull();
  });
});

describe("copy", () => {
  it("condition, now and fired lines per kind", () => {
    expect(conditionText(base)).toBe("BTC ≥ 82,000.0");
    expect(conditionText(iv)).toBe("BTC ATM IV ≤ 30.0%");
    expect(conditionText(pnl)).toBe("Bull Call Spread · P&L ≥ +$20.00");
    expect(conditionText({ ...pnl, strategyName: null, value: "-15.5" })).toBe("BTC · P&L ≥ −$15.50");
    expect(nowText(base, 79506.5)).toBe("Price · now 79,506.5");
    expect(nowText(iv, 42.4)).toBe("ATM IV · now 42.4%");
    expect(nowText(pnl, -0.64)).toBe("Strategy P&L · now −$0.64");
    expect(nowText(pnl, null)).toBe("Strategy P&L · now —");
    expect(firedText(base)).toEqual({ title: "Alert triggered", description: "BTC crossed 82,000.0 · Sent via push" });
    expect(firedText(pnl).description).toBe("Bull Call Spread P&L crossed +$20.00 · Sent via push, email");
    expect(firedText(iv).description).toBe("BTC ATM IV crossed 30.0% · Sent via email");
  });
});

describe("dueAlerts", () => {
  it("returns the armed alerts the readings meet, with the reading", () => {
    expect(dueAlerts([base, iv, pnl], readings)).toEqual([]);
    const hot = { spot: { "delta_india:BTC": 82000 }, atmIv: { "delta_india:BTC": 0.29 }, pnl: { strat_1: 25 } };
    expect(dueAlerts([base, iv, pnl], hot).map((d) => [d.alert.id, d.current])).toEqual([
      ["alr_1", 82000],
      ["alr_2", 29],
      ["alr_3", 25],
    ]);
    // paused and triggered alerts never fire; unknown readings never fire
    expect(dueAlerts([{ ...base, state: "paused" }, { ...iv, state: "triggered" }], hot)).toEqual([]);
    expect(dueAlerts([base], EMPTY_READINGS)).toEqual([]);
  });
  it("decimalOf trims to the API's decimal string", () => {
    expect(decimalOf(82010.5)).toBe("82010.5");
    expect(decimalOf(-0.64)).toBe("-0.64");
    expect(decimalOf(100)).toBe("100");
    expect(decimalOf(42.39999)).toBe("42.4");
  });
});
