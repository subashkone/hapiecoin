// INR formatting and plan helpers (ADR-030).
import type { Plan } from "@hapiecoin/schema";
import { describe, expect, it } from "vitest";
import { effectivePrice, fmtInr, limitText, nextPlan, perMonth } from "./format";

const pricing = { priceInr: "999", discountPriceInr: "849", limits: { paper_trading: 0 } };
const plan = (id: string, sortOrder: number): Plan => ({ id, name: id, description: "", features: [], intervals: { monthly: pricing, quarterly: pricing, yearly: pricing }, menuItemIds: [], active: true, sortOrder, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" });

describe("[BILLING] format", () => {
  it("fmtInr uses Indian grouping, drops decimals for whole rupees and shows them otherwise", () => {
    expect(fmtInr(129999)).toBe("₹1,29,999");
    expect(fmtInr("849.5")).toBe("₹849.50");
    expect(fmtInr(0, { decimals: true })).toBe("₹0.00");
    expect(fmtInr(null)).toBe("—");
    expect(fmtInr("abc")).toBe("—");
  });
  it("effectivePrice and perMonth follow the discount", () => {
    expect(effectivePrice(pricing)).toEqual({ pay: 849, list: 999, offPct: 15 });
    expect(effectivePrice({ ...pricing, discountPriceInr: null })).toEqual({ pay: 999, list: 999, offPct: 0 });
    expect(perMonth(pricing, "quarterly")).toBe("≈ ₹283 / month");
  });
  it("limitText matches the reference wording", () => {
    expect(limitText(null, true)).toBe("∞ Unlimited");
    expect(limitText(25, true)).toBe("25 / month");
    expect(limitText(0, false)).toBe("Not included");
  });
  it("nextPlan is the next by sort order, undefined at the top", () => {
    const plans = [plan("c", 30), plan("a", 0), plan("b", 10)];
    expect(nextPlan(plans, "a")?.id).toBe("b");
    expect(nextPlan(plans, "c")).toBeUndefined();
    expect(nextPlan(plans, null)?.id).toBe("a");
  });
});
