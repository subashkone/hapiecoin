/**
 * Public trader page (ADR-075; HC-SH-127, HC-PB-066, HC-PB-067): a trader chooses a handle and turns a public page on
 * at /t/<handle> showing their verified P&L (ADR-073) net of fees. The projection here is the only shape that leaves
 * the server for a visitor: totals, counts and dates always; days, accounts (label and figure only) and months when
 * the trader opted in; never account ids, balances, positions, products or the Journal comparison.
 */
import { z } from "zod";
import { DecimalString, IsoDateTime } from "./primitives.js";
import { toDecimal } from "./strategies.js";
import { VerifiedDay, type VerifiedPnl } from "./verified.js";

export const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
/** Route words and names a trader must not take (the page lives at /t/<handle>, but these read as HapieCoin's own). */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "admin", "hapiecoin", "api", "auth", "analyse", "analytics", "terminal", "referrals", "subscription", "support", "help", "about",
  "terms", "privacy", "disclaimer", "settings", "login", "signup", "signin", "me", "www", "mail", "root", "system", "official", "delta",
]);

/** Lower-case letters, digits and underscores, 3–20 long; typed in any case. */
export const Handle = z
  .string()
  .trim()
  .toLowerCase()
  .regex(HANDLE_RE, "3–20 letters, digits or underscores")
  .refine((h) => !RESERVED_HANDLES.has(h), "That handle is reserved");
export type Handle = z.infer<typeof Handle>;

export const PublicPageSettings = z.strictObject({
  /** null until chosen; the page cannot be on without one. */
  handle: Handle.nullable(),
  enabled: z.boolean(),
  showDays: z.boolean(),
  showAccounts: z.boolean(),
  showMonths: z.boolean(),
});
export type PublicPageSettings = z.infer<typeof PublicPageSettings>;

export const DEFAULT_PUBLIC_PAGE: PublicPageSettings = { handle: null, enabled: false, showDays: false, showAccounts: false, showMonths: false };

export const PublicTraderAccount = z.strictObject({
  label: z.string(),
  realizedUsd: DecimalString,
  fills: z.number().int().nonnegative(),
  since: IsoDateTime.nullable(),
});
export type PublicTraderAccount = z.infer<typeof PublicTraderAccount>;

export const PublicTraderMonth = z.strictObject({
  /** YYYY-MM, UTC. */
  month: z.string(),
  pnl: DecimalString,
});
export type PublicTraderMonth = z.infer<typeof PublicTraderMonth>;

export const PublicTraderPage = z.strictObject({
  handle: Handle,
  name: z.string(),
  /** Net of commissions, USD. */
  total: z.strictObject({ all: DecimalString, d7: DecimalString, d30: DecimalString }),
  fills: z.number().int().nonnegative(),
  since: IsoDateTime.nullable(),
  lastReadAt: IsoDateTime.nullable(),
  /** Realised per UTC day across every account, net; null when the trader keeps it private. */
  days: z.array(VerifiedDay).nullable(),
  /** Per-account rows (label and figure only); null when private. */
  accounts: z.array(PublicTraderAccount).nullable(),
  /** Realised per month; null when private. */
  months: z.array(PublicTraderMonth).nullable(),
  /** Some product was open before the fills read, older pages are still being read, or an account's last read failed: the figures may be partial. */
  partial: z.boolean(),
});
export type PublicTraderPage = z.infer<typeof PublicTraderPage>;

/** Days across accounts, merged and ordered; each account's days are already net of its commissions. */
export function mergeDays(accounts: readonly { byDay: readonly VerifiedDay[] }[]): VerifiedDay[] {
  const sums = new Map<string, number>();
  for (const a of accounts) for (const d of a.byDay) sums.set(d.day, (sums.get(d.day) ?? 0) + Number(d.pnl));
  return [...sums.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, pnl]) => ({ day, pnl: toDecimal(pnl, 2) }));
}

export function monthsOf(days: readonly VerifiedDay[]): PublicTraderMonth[] {
  const sums = new Map<string, number>();
  for (const d of days) {
    const month = d.day.slice(0, 7);
    sums.set(month, (sums.get(month) ?? 0) + Number(d.pnl));
  }
  return [...sums.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, pnl]) => ({ month, pnl: toDecimal(pnl, 2) }));
}

/** The public projection of a trader's verified figures under their page settings. Throws when the page has no handle. */
export function publicTraderFrom(v: VerifiedPnl, page: PublicPageSettings, name: string): PublicTraderPage {
  if (page.handle === null) throw new Error("a public page needs a handle");
  const days = mergeDays(v.accounts);
  return {
    handle: page.handle,
    name,
    total: { all: v.total.all, d7: v.total.d7, d30: v.total.d30 },
    fills: v.fills,
    since: v.since,
    lastReadAt: v.lastReadAt,
    days: page.showDays ? days : null,
    accounts: page.showAccounts ? v.accounts.map((a) => ({ label: a.label, realizedUsd: a.realizedUsd, fills: a.fills, since: a.since })) : null,
    months: page.showMonths ? monthsOf(days) : null,
    partial: v.accounts.some((a) => a.partialProducts > 0 || a.backfilling || a.error !== null),
  };
}
