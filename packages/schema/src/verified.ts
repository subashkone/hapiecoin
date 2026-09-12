/**
 * Verified P&L (ADR-073; HC-TR-179..181): realised P&L computed from the exchange's own fills, whether or not
 * HapieCoin placed the orders, so the figure does not depend on HapieCoin's bookkeeping. The arithmetic here is pure
 * and shared by the API and the web test mock.
 */
import { z } from "zod";
import { Id } from "./accounts.js";
import { DecimalString, IsoDateTime } from "./primitives.js";

export const VerifiedDay = z.strictObject({
  /** UTC calendar day, YYYY-MM-DD. */
  day: z.string(),
  /** Realised on that day, USD, commissions taken off. */
  pnl: DecimalString,
});
export type VerifiedDay = z.infer<typeof VerifiedDay>;

export const VerifiedAccount = z.strictObject({
  accountId: Id,
  label: z.string(),
  fills: z.number().int().nonnegative(),
  lastReadAt: IsoDateTime.nullable(),
  /** The newest fill read; null before the first read. */
  lastFillAt: IsoDateTime.nullable(),
  /** The oldest fill read: the figures cover trades from here on. */
  since: IsoDateTime.nullable(),
  realizedUsd: DecimalString,
  commissionUsd: DecimalString,
  byDay: z.array(VerifiedDay),
  /** Fills left out of the arithmetic: no contract value stored for the product, or an empty size. */
  skipped: z.number().int().nonnegative(),
  /** Products whose net position on the venue is not what the fills held add up to: opened before the read, or beyond the venue's history; their figures are partial. */
  partialProducts: z.number().int().nonnegative(),
  /** Older pages are still being read in (a busy account's first read stopped on its page cap). */
  backfilling: z.boolean(),
  /** What went wrong on the last read, if anything. */
  error: z.string().nullable(),
});
export type VerifiedAccount = z.infer<typeof VerifiedAccount>;

export const VerifiedPnl = z.strictObject({
  accounts: z.array(VerifiedAccount),
  /** `all` is net of commissions; `gross` is before them (the Journal's basis). */
  total: z.strictObject({ all: DecimalString, gross: DecimalString, d7: DecimalString, d30: DecimalString, commission: DecimalString }),
  fills: z.number().int().nonnegative(),
  lastReadAt: IsoDateTime.nullable(),
  since: IsoDateTime.nullable(),
  /** The Journal's own realised figure over live strategies closed since `since`: gross, as HapieCoin books it. */
  journalRealizedUsd: DecimalString,
  /** verified gross − journal, USD. */
  difference: DecimalString,
});
export type VerifiedPnl = z.infer<typeof VerifiedPnl>;

export const VerifiedRefreshResult = z.strictObject({
  accounts: z.number().int().nonnegative(),
  read: z.number().int().nonnegative(),
  added: z.number().int().nonnegative(),
  /** Accounts read too recently to read again this time. */
  skipped: z.number().int().nonnegative(),
  errors: z.array(z.string()),
});
export type VerifiedRefreshResult = z.infer<typeof VerifiedRefreshResult>;

/** A fill as the arithmetic needs it. */
export interface FillLike {
  productId: number;
  symbol: string | null;
  side: "buy" | "sell";
  /** Contracts. */
  size: number;
  price: string;
  commission: string;
  filledAt: string;
  /** The product's contract value as stored with the fill, when known. */
  contractValue?: string | null | undefined;
}

export interface VerifiedTotals {
  realizedUsd: number;
  commissionUsd: number;
  byDay: VerifiedDay[];
  /** Fills left out: no contract value, or an empty size. */
  skipped: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const dayOf = (iso: string) => iso.slice(0, 10);

/**
 * Average-cost realised P&L per product over the fills in time order: a fill that adds to (or opens) a position
 * moves the average entry; a fill that reduces it realises (price − average) × contracts closed × contract value,
 * signed for shorts; a fill that flips the side closes the old position and opens the rest at its price.
 * Commissions come off on the day of their fill. Fills whose product has no known contract value are skipped and
 * counted, never guessed. The book starts empty at the oldest fill given: a position opened before it is the
 * caller's to detect (the API compares with the venue's positions and names such products as partial).
 */
export function verifiedFromFills(fills: readonly FillLike[], contractValueOf: (productId: number, symbol: string | null, stored: string | null | undefined) => string | null): VerifiedTotals {
  const sorted = [...fills].sort((a, b) => a.filledAt.localeCompare(b.filledAt));
  const book = new Map<number, { pos: number; avg: number }>();
  const days = new Map<string, number>();
  let realized = 0;
  let commission = 0;
  let skipped = 0;
  const add = (day: string, amount: number) => days.set(day, (days.get(day) ?? 0) + amount);
  for (const f of sorted) {
    const cv = contractValueOf(f.productId, f.symbol, f.contractValue);
    if (cv === null || !(Number(cv) > 0) || !(f.size > 0)) {
      skipped += 1;
      continue;
    }
    const price = Number(f.price);
    const fee = Number(f.commission) || 0;
    const q = f.side === "buy" ? f.size : -f.size;
    const day = dayOf(f.filledAt);
    const e = book.get(f.productId) ?? { pos: 0, avg: 0 };
    if (e.pos === 0 || Math.sign(e.pos) === Math.sign(q)) {
      e.avg = (e.avg * Math.abs(e.pos) + price * Math.abs(q)) / (Math.abs(e.pos) + Math.abs(q));
      e.pos += q;
    } else {
      const closed = Math.min(Math.abs(q), Math.abs(e.pos));
      const gain = (price - e.avg) * closed * Number(cv) * (e.pos > 0 ? 1 : -1);
      realized += gain;
      add(day, gain);
      const left = Math.abs(q) - closed;
      e.pos += q;
      if (left > 0) e.avg = price; // flipped: what is left opened at this fill's price
      else if (e.pos === 0) e.avg = 0;
    }
    book.set(f.productId, e);
    if (fee) {
      commission += fee;
      add(day, -fee);
    }
  }
  const byDay = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, pnl]) => ({ day, pnl: String(round2(pnl)) }));
  return { realizedUsd: round2(realized - commission), commissionUsd: round2(commission), byDay, skipped };
}

/** Sum of the day figures on or after `fromDay` (YYYY-MM-DD), rounded to cents. */
export function sumSince(byDay: readonly VerifiedDay[], fromDay: string): number {
  return round2(byDay.filter((d) => d.day >= fromDay).reduce((s, d) => s + Number(d.pnl), 0));
}

/** YYYY-MM-DD of the UTC day `daysBack` days before `nowMs`. */
export function dayBack(nowMs: number, daysBack: number): string {
  return new Date(nowMs - daysBack * 86_400_000).toISOString().slice(0, 10);
}
