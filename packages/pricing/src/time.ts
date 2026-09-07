/**
 * Time-to-expiry helpers. Delta Exchange India options settle at a fixed UTC hour on the expiry date:
 * 12:00 UTC for BTC and ETH, 16:00 UTC for XAUT (both verified against `spec/fixtures/delta-products.json`
 * `settlement_time`). Callers that hold the venue's ISO `settlement_time` should pass it verbatim; a bare
 * `YYYY-MM-DD` uses `settlementHourUtc` (default 12).
 */

export const MS_PER_DAY = 86_400_000;
export const DAYS_PER_YEAR = 365;
export const MS_PER_YEAR = MS_PER_DAY * DAYS_PER_YEAR;
export const DEFAULT_SETTLEMENT_HOUR_UTC = 12;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Epoch milliseconds of the settlement instant for an expiry string. Throws on an unparseable or impossible date. */
export function expiryMs(expiry: string, settlementHourUtc = DEFAULT_SETTLEMENT_HOUR_UTC): number {
  const m = DATE_ONLY.exec(expiry);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const ms = Date.UTC(year, month - 1, day, settlementHourUtc);
    const d = new Date(ms);
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
      throw new RangeError(`Invalid expiry date "${expiry}"`);
    }
    return ms;
  }
  const t = Date.parse(expiry);
  if (Number.isNaN(t)) {
    throw new RangeError(`Invalid expiry "${expiry}": expected YYYY-MM-DD or an ISO 8601 datetime`);
  }
  return t;
}

/** Years (365-day) from `nowMs` to settlement. Negative once the option has settled; callers treat T <= 0 as expired. */
export function yearFraction(nowMs: number, expiry: string, settlementHourUtc = DEFAULT_SETTLEMENT_HOUR_UTC): number {
  return (expiryMs(expiry, settlementHourUtc) - nowMs) / MS_PER_YEAR;
}

/** Calendar days (fractional) from `nowMs` to settlement. */
export function daysToExpiry(nowMs: number, expiry: string, settlementHourUtc = DEFAULT_SETTLEMENT_HOUR_UTC): number {
  return (expiryMs(expiry, settlementHourUtc) - nowMs) / MS_PER_DAY;
}
