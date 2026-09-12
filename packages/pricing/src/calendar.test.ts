import { describe, expect, it } from "vitest";
import { ACT_365, calendarFor, daysToExpiryOf, settlementMsOf, yearFractionOf } from "./calendar.js";
import { DEFAULT_SETTLEMENT_HOUR_UTC, MS_PER_DAY, daysToExpiry, expiryMs, yearFraction } from "./time.js";

const NOW = Date.UTC(2026, 8, 7, 6, 0, 0);

describe("HC-SH-121 [PRICING] trading calendar", () => {
  it("ACT_365 is the engine's default: 365 days, 12:00 UTC, frozen", () => {
    expect(ACT_365).toEqual({ daysPerYear: 365, settlementHourUtc: DEFAULT_SETTLEMENT_HOUR_UTC });
    expect(Object.isFrozen(ACT_365)).toBe(true);
    expect(calendarFor(12)).toBe(ACT_365);
    expect(calendarFor(16)).toEqual({ daysPerYear: 365, settlementHourUtc: 16 });
  });

  it("calendarFor refuses a non-integer or out-of-range hour", () => {
    for (const bad of [-1, 24, 12.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => calendarFor(bad)).toThrow(RangeError);
  });

  it("is bit-identical to the act/365 helpers callers used before, at 12:00 and 16:00", () => {
    for (const [cal, hour] of [
      [ACT_365, 12],
      [calendarFor(16), 16],
    ] as const) {
      for (const expiry of ["2026-09-25", "2026-12-31", "2026-09-25T12:00:00.000Z"]) {
        expect(settlementMsOf(cal, expiry)).toBe(expiryMs(expiry, hour));
        expect(yearFractionOf(cal, NOW, expiry)).toBe(yearFraction(NOW, expiry, hour));
        expect(daysToExpiryOf(cal, NOW, expiry)).toBe(daysToExpiry(NOW, expiry, hour));
      }
    }
    expect(yearFractionOf(ACT_365, NOW + 365 * MS_PER_DAY, "2026-09-07")).toBeLessThan(0); // settled a year ago
  });

  it("a different day count only changes the year fraction, never the settlement instant", () => {
    const act360 = { daysPerYear: 360, settlementHourUtc: 12 };
    expect(settlementMsOf(act360, "2026-09-25")).toBe(settlementMsOf(ACT_365, "2026-09-25"));
    expect(daysToExpiryOf(act360, NOW, "2026-09-25")).toBe(daysToExpiryOf(ACT_365, NOW, "2026-09-25"));
    expect(yearFractionOf(act360, NOW, "2026-09-25")).toBeCloseTo(yearFractionOf(ACT_365, NOW, "2026-09-25") * (365 / 360), 12);
  });
});
