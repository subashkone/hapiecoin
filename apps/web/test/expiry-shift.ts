// The recorded expiries, moved to the present (GAPS #114). The chain fixture was recorded on 3 Sep 2026 and the fake
// gateway serves it as of RECORDED_TODAY; the web drops expired expiries by the REAL clock, so from 25 Sep 2026 the
// browser tests lost their expiries one by one. Served under dates shifted by whole days so that RECORDED_TODAY lands
// on `shiftTo` (the e2e servers pass yesterday, so every served expiry is strictly in the future whatever the time of
// day), the recorded ladders keep their strikes and marks while the calendar no longer matters. Quotes are matched by
// strike, never by symbol, so the recorded symbols inside the rows can stay as they are.
import type { Underlying } from "@hapiecoin/schema";

export const RECORDED_TODAY = "2026-09-07";
const DAY = 86_400_000;

/** Whole days from `fromIso` to `toIso` (negative when `toIso` is earlier). */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY);
}

/** `iso` moved by `days` whole days. */
export function shiftIso(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

export interface ShiftedExpiries {
  /** What the gateway serves, per underlying, ascending. */
  served: Record<Underlying, string[]>;
  /** A served expiry back to the recorded one it stands for. */
  toRecorded: Map<string, string>;
  days: number;
}

/** The recorded expiries served as of `shiftTo` (RECORDED_TODAY lands on it); `shiftTo` undefined serves them as recorded. */
export function shiftExpiries(recorded: Record<Underlying, string[]>, shiftTo: string | undefined): ShiftedExpiries {
  const days = shiftTo === undefined ? 0 : daysBetween(RECORDED_TODAY, shiftTo);
  const served = { BTC: [] as string[], ETH: [] as string[], XAUT: [] as string[] };
  const toRecorded = new Map<string, string>();
  for (const k of Object.keys(recorded) as Underlying[]) {
    for (const e of recorded[k]) {
      const s = shiftIso(e, days);
      served[k].push(s);
      toRecorded.set(s, e);
    }
    served[k].sort();
  }
  return { served, toRecorded, days };
}

/** Yesterday, UTC, as an ISO date: the day RECORDED_TODAY is aligned to, so a served "today" expiry never straddles the settlement hour. */
export function yesterdayIso(now = Date.now()): string {
  return new Date(now - DAY).toISOString().slice(0, 10);
}

/** The recorded expiry a served one stands for, given the day the recorded today was aligned to (the e2e servers use yesterday). */
export function recordedExpiry(served: string, shiftTo: string = yesterdayIso()): string {
  return shiftIso(served, -daysBetween(RECORDED_TODAY, shiftTo));
}
