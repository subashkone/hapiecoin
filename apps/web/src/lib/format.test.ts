import { describe, expect, it } from "vitest";
import {
  daysToExpiry,
  fmtChange,
  fmtDate,
  fmtDelta,
  fmtExpiry,
  fmtGamma,
  fmtIv,
  fmtOi,
  fmtPct,
  fmtPrice,
  fmtQty,
  fmtStrike,
  fmtTheta,
  fmtUsd,
  fmtVega,
} from "./format";

describe("[FORMAT] display formatters", () => {
  it("HC-WS-021 formats Γ 6 dp, Θ and ν 1 dp, quantities compact and the 24 h change signed", () => {
    expect(fmtGamma(0.00012345)).toBe("0.000123");
    expect(fmtGamma(undefined)).toBe("—");
    expect(fmtTheta(-12.34)).toBe("-12.3");
    expect(fmtTheta(Number.NaN)).toBe("—");
    expect(fmtVega(45.678)).toBe("45.7");
    expect(fmtVega(undefined)).toBe("—");
    expect(fmtQty("1234")).toBe("1.2K");
    expect(fmtQty(undefined)).toBe("—");
    expect(fmtChange(1.234)).toEqual({ text: "+1.23%", dir: "up" });
    expect(fmtChange(-0.5)).toEqual({ text: "-0.50%", dir: "down" });
    expect(fmtChange(0)).toEqual({ text: "0.00%", dir: "flat" });
    expect(fmtChange(undefined)).toEqual({ text: "—", dir: "flat" });
  });
  it("HC-SH-004 fmtPrice groups and picks digits by magnitude", () => {
    expect(fmtPrice("79521.5")).toBe("79,521.5");
    expect(fmtPrice("3.14159")).toBe("3.14");
    expect(fmtPrice(1234.5, 2)).toBe("1,234.50");
    expect(fmtPrice(undefined)).toBe("—");
    expect(fmtPrice("")).toBe("—");
    expect(fmtPrice("abc")).toBe("—");
  });
  it("HC-SH-005 fmtPct signs positives and handles undefined", () => {
    expect(fmtPct(1.234)).toBe("+1.23%");
    expect(fmtPct(-0.5)).toBe("-0.50%");
    expect(fmtPct(0)).toBe("0.00%");
    expect(fmtPct(undefined)).toBe("—");
    expect(fmtPct(Number.NaN)).toBe("—");
  });
  it("[FORMAT] fmtIv / fmtDelta / fmtOi", () => {
    expect(fmtIv(0.42)).toBe("42.0%");
    expect(fmtIv(0.4256)).toBe("42.6%");
    expect(fmtIv(undefined)).toBe("—");
    expect(fmtDelta(0.5234)).toBe("0.52");
    expect(fmtDelta(undefined)).toBe("—");
    expect(fmtOi("10276")).toBe("10.3K");
    expect(fmtOi("1500000")).toBe("1.50M");
    expect(fmtOi("42")).toBe("42");
    expect(fmtOi(undefined)).toBe("—");
    expect(fmtOi("x")).toBe("—");
  });
  it("[FORMAT] fmtStrike / fmtUsd", () => {
    expect(fmtStrike("79500")).toBe("79,500");
    expect(fmtStrike("bad")).toBe("bad");
    expect(fmtUsd("1000")).toBe("$1,000.00");
    expect(fmtUsd(12.5)).toBe("$12.50");
    expect(fmtUsd(undefined)).toBe("—");
    expect(fmtUsd("nope")).toBe("—");
  });
  it("[FORMAT] fmtExpiry / daysToExpiry / fmtDate", () => {
    expect(fmtExpiry("2026-09-25")).toBe("25 Sep");
    expect(fmtExpiry("2026-09-25", true)).toBe("25 Sep 2026");
    expect(fmtExpiry("25SEP26")).toBe("25SEP26");
    expect(daysToExpiry("2026-09-25", new Date("2026-09-07T10:00:00Z"))).toBe(18);
    expect(daysToExpiry("2026-09-01", new Date("2026-09-07T10:00:00Z"))).toBe(0);
    expect(daysToExpiry("garbage")).toBe(0);
    expect(fmtDate("2026-12-31T00:00:00Z")).toBe("31 Dec 2026");
    expect(fmtDate(undefined)).toBe("—");
    expect(fmtDate("not a date")).toBe("—");
  });
});
