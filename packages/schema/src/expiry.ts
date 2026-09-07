import { z } from "zod";
import type { IsoDate } from "./primitives.js";

/** Month abbreviations in expiry-code order (index 0 = January). */
export const EXPIRY_MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

/**
 * Human-readable expiry code as shown in the UI and in share links: DDMMMYY, e.g. "25SEP26".
 * The pattern checks the shape; `expiryCodeToDate` additionally rejects impossible dates such as "31FEB26".
 */
export const EXPIRY_CODE_RE = /^(0[1-9]|[12][0-9]|3[01])(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)([0-9]{2})$/;

export const ExpiryCode = z
  .string()
  .regex(EXPIRY_CODE_RE, 'expected an expiry code such as "25SEP26"')
  .refine((code) => isRealDate(code), { message: "expiry code is not a real calendar date" });
export type ExpiryCode = z.infer<typeof ExpiryCode>;

/** "25SEP26" -> "2026-09-25". Throws RangeError for malformed codes or impossible dates. */
export function expiryCodeToDate(code: string): IsoDate {
  const m = EXPIRY_CODE_RE.exec(code);
  if (!m) throw new RangeError(`invalid expiry code: ${JSON.stringify(code)}`);
  const day = Number(m[1]);
  const month = EXPIRY_MONTHS.indexOf(m[2] as (typeof EXPIRY_MONTHS)[number]) + 1;
  const year = 2000 + Number(m[3]);
  if (!isValidCalendarDate(year, month, day)) {
    throw new RangeError(`expiry code is not a real calendar date: ${JSON.stringify(code)}`);
  }
  return `${String(year)}-${pad2(month)}-${pad2(day)}`;
}

/** "2026-09-25" -> "25SEP26". Throws RangeError for malformed input, impossible dates or years outside 2000–2099. */
export function dateToExpiryCode(date: string): ExpiryCode {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(date);
  if (!m) throw new RangeError(`invalid ISO date: ${JSON.stringify(date)}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!isValidCalendarDate(year, month, day)) {
    throw new RangeError(`not a real calendar date: ${JSON.stringify(date)}`);
  }
  if (year < 2000 || year > 2099) {
    throw new RangeError(`expiry codes carry a two-digit year; ${String(year)} is out of range`);
  }
  const mon = EXPIRY_MONTHS[month - 1] as (typeof EXPIRY_MONTHS)[number];
  return `${pad2(day)}${mon}${pad2(year - 2000)}`;
}

function isRealDate(code: string): boolean {
  try {
    expiryCodeToDate(code);
    return true;
  } catch {
    return false;
  }
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

function daysInMonth(year: number, month: number): number {
  // Month is 1-based; day 0 of the next month is the last day of this month (UTC, no DST surprises).
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
