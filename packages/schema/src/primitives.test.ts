import { describe, expect, it } from "vitest";
import {
  Currency,
  DecimalString,
  IsoDate,
  IsoDateTime,
  PnlBasis,
  Role,
  Timestamp,
  Underlying,
  Venue,
  compareDecimal,
  isNonNegativeDecimal,
  isPositiveDecimal,
} from "./primitives.js";

describe("[SCHEMA] DecimalString", () => {
  it.each(["0", "0.001", "79521.5", "-12.5", "-0", "100000", "0.100000000000000000", "1.0140"])(
    "accepts %s",
    (v) => {
      expect(DecimalString.safeParse(v).success).toBe(true);
    },
  );
  it.each(["", " 1", "1 ", ".5", "1.", "007", "1e5", "1,000", "abc", "--1", "+1", "0x10", "NaN"])(
    "rejects %s",
    (v) => {
      expect(DecimalString.safeParse(v).success).toBe(false);
    },
  );
  it("rejects non-strings", () => {
    expect(DecimalString.safeParse(1.5).success).toBe(false);
    expect(DecimalString.safeParse(null).success).toBe(false);
  });
});

describe("[SCHEMA] IsoDate / IsoDateTime / Timestamp", () => {
  it("IsoDate accepts YYYY-MM-DD and rejects other shapes and impossible dates", () => {
    expect(IsoDate.safeParse("2026-09-25").success).toBe(true);
    expect(IsoDate.safeParse("2026-9-25").success).toBe(false);
    expect(IsoDate.safeParse("25SEP26").success).toBe(false);
    expect(IsoDate.safeParse("2026-02-30").success).toBe(false);
    expect(IsoDate.safeParse("2026-09-25T00:00:00Z").success).toBe(false);
  });
  it("IsoDateTime accepts Z and offsets, rejects dates without time", () => {
    expect(IsoDateTime.safeParse("2026-09-11T16:00:00Z").success).toBe(true);
    expect(IsoDateTime.safeParse("2026-09-11T16:00:00.123Z").success).toBe(true);
    expect(IsoDateTime.safeParse("2026-09-11T21:30:00+05:30").success).toBe(true);
    expect(IsoDateTime.safeParse("2026-09-11").success).toBe(false);
    expect(IsoDateTime.safeParse("2026-09-11 16:00:00").success).toBe(false);
  });
  it("Timestamp is a non-negative integer of milliseconds", () => {
    expect(Timestamp.safeParse(1788543685911).success).toBe(true);
    expect(Timestamp.safeParse(0).success).toBe(true);
    expect(Timestamp.safeParse(-1).success).toBe(false);
    expect(Timestamp.safeParse(1.5).success).toBe(false);
    expect(Timestamp.safeParse("1788543685911").success).toBe(false);
    expect(Timestamp.safeParse(Number.NaN).success).toBe(false);
  });
});

describe("[SCHEMA] enums", () => {
  it("Venue accepts delta_india only", () => {
    expect(Venue.parse("delta_india")).toBe("delta_india");
    expect(Venue.safeParse("binance").success).toBe(false);
    expect(Venue.options).toEqual(["delta_india", "deribit"]);
  });
  it("Underlying accepts BTC, ETH, XAUT", () => {
    expect(Underlying.options).toEqual(["BTC", "ETH", "XAUT"]);
    expect(Underlying.safeParse("SOL").success).toBe(false);
    expect(Underlying.safeParse("btc").success).toBe(false);
  });
  it("Currency, PnlBasis and Role", () => {
    expect(Currency.options).toEqual(["USD", "INR"]);
    expect(Currency.safeParse("EUR").success).toBe(false);
    expect(PnlBasis.options).toEqual(["mark", "bid_ask"]);
    expect(PnlBasis.safeParse("last").success).toBe(false);
    expect(Role.options).toEqual(["user", "admin"]);
    expect(Role.safeParse("root").success).toBe(false);
  });
});

describe("[SCHEMA] compareDecimal", () => {
  it.each<[string, string, -1 | 0 | 1]>([
    ["0", "0", 0],
    ["-0", "0", 0],
    ["0", "-0.00", 0],
    ["1", "1.0", 0],
    ["1.50", "1.5", 0],
    ["2", "10", -1],
    ["10", "2", 1],
    ["19", "20", -1],
    ["20", "19", 1],
    ["1.25", "1.3", -1],
    ["1.3", "1.25", 1],
    ["-1", "1", -1],
    ["1", "-1", 1],
    ["-2", "-10", 1],
    ["-10", "-2", -1],
    ["-1.5", "-1.25", -1],
    ["79521.5", "79521.5", 0],
    ["0.001", "0.0010", 0],
    ["0.0009", "0.001", -1],
  ])("compareDecimal(%s, %s) = %i", (a, b, expected) => {
    expect(compareDecimal(a, b)).toBe(expected);
  });
  it("throws on malformed input instead of guessing", () => {
    expect(() => compareDecimal("1e5", "1")).toThrow(RangeError);
    expect(() => compareDecimal("1", "")).toThrow(RangeError);
  });
  it("isPositiveDecimal / isNonNegativeDecimal", () => {
    expect(isPositiveDecimal("0.001")).toBe(true);
    expect(isPositiveDecimal("0")).toBe(false);
    expect(isPositiveDecimal("-0.5")).toBe(false);
    expect(isNonNegativeDecimal("0")).toBe(true);
    expect(isNonNegativeDecimal("0.00")).toBe(true);
    expect(isNonNegativeDecimal("-0.01")).toBe(false);
  });
  it("helpers return false (never throw) on malformed input so refinements after a failed regex stay safe", () => {
    expect(isPositiveDecimal("ten")).toBe(false);
    expect(isPositiveDecimal("")).toBe(false);
    expect(isNonNegativeDecimal("1e5")).toBe(false);
  });
});
