import { describe, expect, it } from "vitest";
import {
  DAYS_PER_YEAR,
  DEFAULT_SETTLEMENT_HOUR_UTC,
  MS_PER_DAY,
  MS_PER_YEAR,
  daysToExpiry,
  expiryMs,
  yearFraction,
} from "./time.js";

// The fixture snapshot instant: 2026-09-04T17:41:25.911Z (delta-tickers.json timestamp in µs / 1000).
const NOW = 1788543685911.107;

describe("[PRICING] expiry settlement instant", () => {
  it("[PRICING] a bare date settles at 12:00 UTC (Delta BTC/ETH options)", () => {
    expect(expiryMs("2026-09-25")).toBe(Date.UTC(2026, 8, 25, 12));
    expect(DEFAULT_SETTLEMENT_HOUR_UTC).toBe(12);
  });

  it("[PRICING] the settlement hour can be overridden (XAUT settles at 16:00 UTC)", () => {
    expect(expiryMs("2026-09-11", 16)).toBe(Date.UTC(2026, 8, 11, 16));
  });

  it("[PRICING] an ISO datetime such as Delta settlement_time is taken verbatim", () => {
    expect(expiryMs("2026-09-11T16:00:00Z")).toBe(Date.UTC(2026, 8, 11, 16));
    expect(expiryMs("2026-09-11T16:00:00Z", 12)).toBe(Date.UTC(2026, 8, 11, 16));
    expect(expiryMs("2026-09-11T16:00:00.500+05:30")).toBe(Date.UTC(2026, 8, 11, 10, 30, 0, 500));
  });

  it("[PRICING] rejects impossible dates and unparseable strings", () => {
    expect(() => expiryMs("2026-02-30")).toThrow(RangeError);
    expect(() => expiryMs("2026-13-01")).toThrow(RangeError);
    expect(() => expiryMs("2026-00-10")).toThrow(RangeError);
    expect(() => expiryMs("next friday")).toThrow(/Invalid expiry/);
    expect(() => expiryMs("")).toThrow(RangeError);
  });
});

describe("[PRICING] time to expiry", () => {
  it("[PRICING] yearFraction and daysToExpiry agree on a 365-day year", () => {
    const T = yearFraction(NOW, "2026-09-25");
    const days = daysToExpiry(NOW, "2026-09-25");
    expect(days).toBeCloseTo((Date.UTC(2026, 8, 25, 12) - NOW) / MS_PER_DAY, 9);
    expect(T).toBeCloseTo(days / DAYS_PER_YEAR, 12);
    expect(T).toBeCloseTo(0.05688, 4);
    expect(MS_PER_YEAR).toBe(365 * 86_400_000);
  });

  it("[PRICING] is negative once the option has settled", () => {
    expect(yearFraction(NOW, "2026-09-04")).toBeLessThan(0);
    expect(daysToExpiry(NOW, "2026-09-04", 12)).toBeLessThan(0);
    expect(daysToExpiry(NOW, "2026-09-04", 18)).toBeGreaterThan(0);
  });
});
