import { describe, expect, it } from "vitest";
import { DecimalFormatError, canonDecimal, compareDecimal, decimalToNumber, numberToDecimal } from "./decimal.js";

describe("[VENUES] canonDecimal", () => {
  it("[VENUES] strips venue padding and normalises signs", () => {
    expect(canonDecimal("0.100000000000000000")).toBe("0.1");
    expect(canonDecimal("0.001000000000000000")).toBe("0.001");
    expect(canonDecimal("80000")).toBe("80000");
    expect(canonDecimal("1.0140")).toBe("1.014");
    expect(canonDecimal("-23.86507888")).toBe("-23.86507888");
    expect(canonDecimal("+5.50")).toBe("5.5");
    expect(canonDecimal("007")).toBe("7");
    expect(canonDecimal("0.000")).toBe("0");
    expect(canonDecimal("-0.0")).toBe("0");
    expect(canonDecimal(" 12 ")).toBe("12");
  });

  it("[VENUES] expands exponent notation without floating point", () => {
    expect(canonDecimal("1e-8")).toBe("0.00000001");
    expect(canonDecimal("1.5e3")).toBe("1500");
    expect(canonDecimal("1.2345e2")).toBe("123.45");
    expect(canonDecimal("1.5E+2")).toBe("150");
    expect(canonDecimal("-2.5e-1")).toBe("-0.25");
    expect(canonDecimal("12e0")).toBe("12");
  });

  it("[VENUES] rejects non-decimal input with a typed error", () => {
    expect(() => canonDecimal("abc")).toThrow(DecimalFormatError);
    expect(() => canonDecimal("1.2.3")).toThrow(DecimalFormatError);
    expect(() => canonDecimal("")).toThrow(DecimalFormatError);
    try {
      canonDecimal("nope");
    } catch (error) {
      expect(error).toBeInstanceOf(DecimalFormatError);
      expect((error as DecimalFormatError).input).toBe("nope");
      expect((error as DecimalFormatError).name).toBe("DecimalFormatError");
    }
  });
});

describe("[VENUES] numberToDecimal", () => {
  it("[VENUES] removes binary float noise from venue numbers", () => {
    expect(numberToDecimal(0.9570000000000001)).toBe("0.957");
    expect(numberToDecimal(5.228999999999997)).toBe("5.229");
    expect(numberToDecimal(79521)).toBe("79521");
    expect(numberToDecimal(0)).toBe("0");
    expect(numberToDecimal(-1.5)).toBe("-1.5");
    expect(numberToDecimal(1e21)).toBe("1000000000000000000000");
    expect(numberToDecimal(1e-7)).toBe("0.0000001");
  });

  it("[VENUES] refuses NaN and Infinity", () => {
    expect(() => numberToDecimal(Number.NaN)).toThrow(DecimalFormatError);
    expect(() => numberToDecimal(Number.POSITIVE_INFINITY)).toThrow(DecimalFormatError);
  });
});

describe("[VENUES] decimalToNumber / compareDecimal", () => {
  it("[VENUES] parses for math and returns null for missing or invalid", () => {
    expect(decimalToNumber("1.5")).toBe(1.5);
    expect(decimalToNumber(null)).toBeNull();
    expect(decimalToNumber(undefined)).toBeNull();
    expect(decimalToNumber("x")).toBeNull();
  });

  it("[VENUES] compares numerically, not lexically", () => {
    expect(compareDecimal("9000", "10000")).toBe(-1);
    expect(compareDecimal("10000", "9000")).toBe(1);
    expect(compareDecimal("80000", "80000.0")).toBe(0);
  });
});
