import { describe, expect, it } from "vitest";
import { USD, convert, fmtMoney, fmtMoneyCompact } from "./money";

const INR = { currency: "INR" as const, rate: "83.5" };

describe("HC-WS-031 / HC-TR-091 money formatting in USD and INR", () => {
  it("formats USD with grouping, sign and digits", () => {
    expect(fmtMoney(1234.5)).toBe("$1,234.50");
    expect(fmtMoney(-94.378)).toBe("−$94.38");
    expect(fmtMoney(1234.5, USD, { signed: true })).toBe("+$1,234.50");
    expect(fmtMoney(0, USD, { signed: true })).toBe("$0.00");
    expect(fmtMoney("807.5", USD, { digits: 1 })).toBe("$807.5");
    expect(fmtMoney(undefined)).toBe("—");
    expect(fmtMoney("abc")).toBe("—");
    expect(fmtMoney(Number.POSITIVE_INFINITY)).toBe("Unlimited");
    expect(fmtMoney(Number.NEGATIVE_INFINITY, USD, { unlimited: "∞" })).toBe("∞");
  });
  it("converts to INR at the stored rate with Indian grouping", () => {
    expect(convert(10, INR)).toBeCloseTo(835, 9);
    expect(fmtMoney(1234, INR)).toBe("₹1,03,039.00");
    expect(fmtMoney(-1, INR, { digits: 0 })).toBe("−₹84");
    expect(convert(10, { currency: "INR", rate: "0" })).toBe(10);
    expect(convert(10, { currency: "INR", rate: "x" })).toBe(10);
  });
  it("compact money", () => {
    expect(fmtMoneyCompact(94.38)).toBe("$94");
    expect(fmtMoneyCompact(4.66)).toBe("$4.66");
    expect(fmtMoneyCompact(1234)).toBe("$1.2K");
    expect(fmtMoneyCompact(-2_500_000)).toBe("−$2.50M");
    expect(fmtMoneyCompact(2000, INR)).toBe("₹1.7L");
    expect(fmtMoneyCompact(undefined)).toBe("—");
    expect(fmtMoneyCompact(Number.NaN)).toBe("—");
  });
});
