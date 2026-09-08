// INR display for plan prices (ADR-030): Indian digit grouping, no decimals unless the value has them.
import { BILLING_INTERVALS, type BillingInterval, INTERVAL_MONTHS, type IntervalPricing, type Plan } from "@hapiecoin/schema";

const inr0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmtInr(value: string | number | null | undefined, opts: { decimals?: boolean } = {}): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return opts.decimals || !Number.isInteger(n) ? inr2.format(n) : inr0.format(n);
}

export const INTERVAL_LABELS: Record<BillingInterval, string> = { monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" };
export { BILLING_INTERVALS };

/** The price a trader pays for the interval (discount when set), and the % off the list price. */
export function effectivePrice(p: IntervalPricing): { pay: number; list: number; offPct: number } {
  const list = Number(p.priceInr);
  const pay = p.discountPriceInr === null ? list : Number(p.discountPriceInr);
  const offPct = list > 0 && pay < list ? Math.round(((list - pay) / list) * 100) : 0;
  return { pay, list, offPct };
}

/** "≈ ₹833 / month" for a non-monthly interval. */
export function perMonth(p: IntervalPricing, interval: BillingInterval): string {
  const { pay } = effectivePrice(p);
  return `≈ ${fmtInr(Math.round(pay / INTERVAL_MONTHS[interval]))} / month`;
}

/** Limit text the reference uses (HC-AC-006): "∞ Unlimited", "25 / month", "Not included". */
export function limitText(limit: number | null, included: boolean): string {
  if (!included) return "Not included";
  if (limit === null) return "∞ Unlimited";
  return `${limit} / month`;
}

/** Cheapest paid plan above the current one, for the Upgrade button and the diff panel default. */
export function nextPlan(plans: readonly Plan[], currentId: string | null): Plan | undefined {
  const sorted = [...plans].sort((a, b) => a.sortOrder - b.sortOrder);
  const i = sorted.findIndex((p) => p.id === currentId);
  return sorted[i + 1];
}
