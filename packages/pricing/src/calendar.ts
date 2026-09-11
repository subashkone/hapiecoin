/**
 * The trading calendar the engine measures time with (ADR-066). Plain data, so it crosses the pricing worker's
 * postMessage boundary: a day count and the UTC hour a `YYYY-MM-DD` expiry settles at. Today every venue is
 * act/365 with a fixed settlement hour; a venue with holidays or a business-day count adds fields here and the
 * three helpers below learn to read them, while every caller keeps passing a calendar.
 */
import { DAYS_PER_YEAR, DEFAULT_SETTLEMENT_HOUR_UTC, MS_PER_DAY, expiryMs } from "./time.js";

export interface TradingCalendar {
  /** Days a year is worth in the year fraction (365 = act/365). */
  readonly daysPerYear: number;
  /** Hour (UTC) a bare `YYYY-MM-DD` expiry settles at; an ISO datetime expiry is taken verbatim. */
  readonly settlementHourUtc: number;
}

/** act/365 settling at 12:00 UTC: the engine's default and Delta India's BTC / ETH calendar. */
export const ACT_365: TradingCalendar = Object.freeze({ daysPerYear: DAYS_PER_YEAR, settlementHourUtc: DEFAULT_SETTLEMENT_HOUR_UTC });

/** act/365 settling at `settlementHourUtc`; throws for a non-finite hour or one outside 0..23. */
export function calendarFor(settlementHourUtc: number): TradingCalendar {
  if (!Number.isInteger(settlementHourUtc) || settlementHourUtc < 0 || settlementHourUtc > 23) {
    throw new RangeError(`settlementHourUtc must be an integer hour 0..23, got ${settlementHourUtc}`);
  }
  return settlementHourUtc === ACT_365.settlementHourUtc ? ACT_365 : { daysPerYear: DAYS_PER_YEAR, settlementHourUtc };
}

/** Epoch milliseconds of the settlement instant of `expiry` on this calendar. */
export function settlementMsOf(calendar: TradingCalendar, expiry: string): number {
  return expiryMs(expiry, calendar.settlementHourUtc);
}

/** Years from `nowMs` to settlement on this calendar; negative once settled. Bit-identical to `yearFraction` on act/365. */
export function yearFractionOf(calendar: TradingCalendar, nowMs: number, expiry: string): number {
  return (settlementMsOf(calendar, expiry) - nowMs) / (MS_PER_DAY * calendar.daysPerYear);
}

/** Fractional calendar days from `nowMs` to settlement on this calendar. */
export function daysToExpiryOf(calendar: TradingCalendar, nowMs: number, expiry: string): number {
  return (settlementMsOf(calendar, expiry) - nowMs) / MS_PER_DAY;
}
