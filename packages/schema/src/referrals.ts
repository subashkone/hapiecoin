// Referrals and commissions (Phase 4 item 3, ADR-031). A commission row is written whenever a referred user's
// subscription is recorded (₹0 activations give a "not_paid" row with no amount, so the referrer sees the sign-up);
// the admin settles pending rows per referrer or in bulk. Money is INR decimal strings.
import { z } from "zod";
import { Id } from "./accounts.js";
import { BillingInterval } from "./billing.js";
import { DecimalString, IsoDateTime } from "./primitives.js";

export const CommissionStatus = z.enum(["paid", "pending", "not_paid"]);
export type CommissionStatus = z.infer<typeof CommissionStatus>;
export const COMMISSION_LABELS: Record<CommissionStatus, string> = { paid: "Paid", pending: "Pending", not_paid: "No Purchase" };

/** One referred user as the referrer sees them (HC-AC-050). */
export const ReferralRow = z.strictObject({
  userId: Id,
  name: z.string(),
  email: z.string(),
  joinedAt: IsoDateTime,
  planName: z.string().nullable(),
  interval: BillingInterval.nullable(),
  /** What the referred user paid for the plan, INR. */
  amountInr: DecimalString,
  commissionInr: DecimalString,
  status: CommissionStatus,
  /** Month bucket "YYYY-MM" (UTC) of the commission, for the chart. */
  month: z.string(),
});
export type ReferralRow = z.infer<typeof ReferralRow>;

export const MonthBar = z.strictObject({ month: z.string(), paidInr: DecimalString, pendingInr: DecimalString });
export type MonthBar = z.infer<typeof MonthBar>;

export const ReferralsView = z.strictObject({
  code: z.string(),
  link: z.url(),
  commissionPct: DecimalString,
  stats: z.strictObject({ referrals: z.number().int(), earnedInr: DecimalString, paidInr: DecimalString, pendingInr: DecimalString }),
  rows: z.array(ReferralRow),
  byMonth: z.array(MonthBar),
});
export type ReferralsView = z.infer<typeof ReferralsView>;

/** Admin · Commissions row per referrer (HC-AD-054). */
export const AdminCommissionRow = z.strictObject({
  referrerId: Id,
  name: z.string(),
  email: z.string(),
  referrals: z.number().int(),
  commissionPct: DecimalString,
  totalInr: DecimalString,
  paidInr: DecimalString,
  pendingInr: DecimalString,
  /** paid when nothing is pending and something was paid, pending while any row is pending, not_paid otherwise. */
  status: CommissionStatus,
  lastNote: z.string().nullable(),
});
export type AdminCommissionRow = z.infer<typeof AdminCommissionRow>;

export const AdminCommissionsView = z.strictObject({
  tiles: z.strictObject({ totalInr: DecimalString, paidInr: DecimalString, pendingInr: DecimalString }),
  rows: z.array(AdminCommissionRow),
  byMonth: z.array(MonthBar),
  /** Months that have any commission, newest first, for the month filter. */
  months: z.array(z.string()),
});
export type AdminCommissionsView = z.infer<typeof AdminCommissionsView>;

export const AdminCommissionDetail = z.strictObject({
  referrer: z.strictObject({ id: Id, name: z.string(), email: z.string(), commissionPct: DecimalString }),
  rows: z.array(ReferralRow),
});
export type AdminCommissionDetail = z.infer<typeof AdminCommissionDetail>;

export const MarkPaymentBody = z
  .strictObject({
    status: z.enum(["paid", "not_paid"]),
    note: z.string().trim().max(300).optional(),
    proofUrl: z.url().optional(),
  })
  .refine((b) => b.status === "paid" || (b.note !== undefined && b.note.length > 0), { message: "a reason is required when not paying", path: ["note"] });
export type MarkPaymentBody = z.infer<typeof MarkPaymentBody>;

export const BulkPayBody = z.strictObject({ referrerIds: z.array(Id).max(500).optional() });
export type BulkPayBody = z.infer<typeof BulkPayBody>;
export const BulkPayResult = z.strictObject({ settledRows: z.number().int(), referrers: z.number().int(), amountInr: DecimalString });
export type BulkPayResult = z.infer<typeof BulkPayResult>;

/** Commission on a payment at the referrer's percentage, 2 dp, never negative. */
export function commissionFor(paidInr: string, commissionPct: string): string {
  const paid = Number(paidInr);
  const pct = Number(commissionPct);
  if (!Number.isFinite(paid) || !Number.isFinite(pct) || paid <= 0 || pct <= 0) return "0";
  return (Math.round(paid * pct) / 100).toFixed(2);
}

export function monthKey(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
