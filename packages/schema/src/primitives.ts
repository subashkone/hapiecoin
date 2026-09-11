import { z } from "zod";

/**
 * Decimal number written as a string, e.g. "0.001", "79521.5", "-12.5".
 * Money and quantities cross package boundaries in this form so no float rounding leaks into storage.
 * Accepts an optional leading "-", an integer part without leading zeros (except a lone "0") and an
 * optional fraction. Rejects exponents, blanks, ".5", "1." and "007".
 */
export const DECIMAL_STRING_RE = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

export const DecimalString = z
  .string()
  .regex(DECIMAL_STRING_RE, 'expected a decimal string such as "0.001" or "-12.5"');
export type DecimalString = z.infer<typeof DecimalString>;

/** Calendar date in ISO form, YYYY-MM-DD (UTC, no time part). */
export const IsoDate = z.iso.date();
export type IsoDate = z.infer<typeof IsoDate>;

/** ISO-8601 date-time with a "Z" or numeric offset, e.g. "2026-09-25T12:00:00Z". */
export const IsoDateTime = z.iso.datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTime>;

/** Milliseconds since the Unix epoch, as produced by `Date.now()`. */
export const Timestamp = z.number().int().nonnegative();
export type Timestamp = z.infer<typeof Timestamp>;

/** Trading venues. Only Delta Exchange India today; add new venues here and every venue-keyed schema follows. */
export const VENUES = ["delta_india", "deribit"] as const;
export const Venue = z.enum(VENUES);
export type Venue = z.infer<typeof Venue>;

/** Underlyings offered by the product (ADR-006: strikes per underlying come from the venue list). */
export const UNDERLYINGS = ["BTC", "ETH", "XAUT"] as const;
export const Underlying = z.enum(UNDERLYINGS);
export type Underlying = z.infer<typeof Underlying>;

/** Display currencies. Venue quotes are USD; INR is a display conversion (UserSettings.conversionRate). */
export const Currency = z.enum(["USD", "INR"]);
export type Currency = z.infer<typeof Currency>;

/** Which price a P&L figure is based on: the venue mark, or the bid/ask you would actually trade at. */
export const PnlBasis = z.enum(["mark", "bid_ask"]);
export type PnlBasis = z.infer<typeof PnlBasis>;

export const Role = z.enum(["user", "admin"]);
export type Role = z.infer<typeof Role>;

/**
 * Compare two decimal strings numerically without converting to floating point.
 * Returns -1, 0 or 1. Both inputs must already satisfy `DECIMAL_STRING_RE`.
 */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const pa = splitDecimal(a);
  const pb = splitDecimal(b);
  if (pa.negative !== pb.negative) {
    // "-0" and "0" (and "-0.00") are equal.
    if (pa.isZero && pb.isZero) return 0;
    return pa.negative ? -1 : 1;
  }
  const magnitude = compareMagnitude(pa, pb);
  return pa.negative ? (-magnitude as -1 | 0 | 1) : magnitude;
}

/** True when the string is a decimal strictly greater than zero; false for malformed input (safe inside refinements). */
export function isPositiveDecimal(value: string): boolean {
  return DECIMAL_STRING_RE.test(value) && compareDecimal(value, "0") === 1;
}

/** True when the string is a decimal that is zero or greater; false for malformed input (safe inside refinements). */
export function isNonNegativeDecimal(value: string): boolean {
  return DECIMAL_STRING_RE.test(value) && compareDecimal(value, "0") >= 0;
}

interface DecimalParts {
  negative: boolean;
  int: string;
  frac: string;
  isZero: boolean;
}

function splitDecimal(value: string): DecimalParts {
  if (!DECIMAL_STRING_RE.test(value)) {
    throw new RangeError(`not a decimal string: ${JSON.stringify(value)}`);
  }
  const negative = value.startsWith("-");
  const body = negative ? value.slice(1) : value;
  const dot = body.indexOf(".");
  const int = dot === -1 ? body : body.slice(0, dot);
  const frac = dot === -1 ? "" : body.slice(dot + 1).replace(/0+$/, "");
  return { negative, int, frac, isZero: int === "0" && frac === "" };
}

function compareMagnitude(a: DecimalParts, b: DecimalParts): -1 | 0 | 1 {
  if (a.int.length !== b.int.length) return a.int.length < b.int.length ? -1 : 1;
  if (a.int !== b.int) return a.int < b.int ? -1 : 1;
  const width = Math.max(a.frac.length, b.frac.length);
  const fa = a.frac.padEnd(width, "0");
  const fb = b.frac.padEnd(width, "0");
  if (fa === fb) return 0;
  return fa < fb ? -1 : 1;
}
