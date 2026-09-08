// Checkout, coupons, payments and invoices (Phase 4 item 2, ADR-034; docs/design/billing.md "Checkout"). Money is
// INR decimal strings in JSON and integer paise towards Razorpay; the API owns every amount.
import { z } from "zod";
import { Id, Mobile } from "./accounts.js";
import { BILLING_INTERVALS, BillingInterval, GST_PCT, type IntervalPricing } from "./billing.js";
import { DecimalString, IsoDateTime } from "./primitives.js";

// ---------------------------------------------------------------------------------------------- coupons
export const CouponScope = z.enum(["public", "community"]);
export type CouponScope = z.infer<typeof CouponScope>;
export const COUPON_SCOPE_LABELS: Record<CouponScope, string> = { public: "Public", community: "Community" };
export const DiscountType = z.enum(["percent", "fixed"]);
export type DiscountType = z.infer<typeof DiscountType>;
export const CouponCode = z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,24}$/, "3–24 letters, digits, _ or -");

export const Coupon = z.strictObject({
  id: Id,
  code: z.string(),
  description: z.string(),
  discountType: DiscountType,
  /** Percent (0–100) or INR amount. */
  discountValue: DecimalString,
  minOrderInr: DecimalString,
  /** Null = unlimited. */
  maxUses: z.number().int().nullable(),
  usedCount: z.number().int(),
  perUserLimit: z.number().int(),
  startsAt: IsoDateTime.nullable(),
  endsAt: IsoDateTime.nullable(),
  scope: CouponScope,
  planIds: z.array(Id),
  intervals: z.array(BillingInterval),
  /** Community coupons: the users who may use it. */
  assignedUserIds: z.array(Id),
  active: z.boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Coupon = z.infer<typeof Coupon>;
export const CouponList = z.strictObject({ items: z.array(Coupon) });
export type CouponList = z.infer<typeof CouponList>;

const couponWindow = (c: { startsAt: string | null; endsAt: string | null }) => !c.startsAt || !c.endsAt || new Date(c.endsAt).getTime() > new Date(c.startsAt).getTime();
const couponValue = (c: { discountType: DiscountType; discountValue: string }) => (c.discountType === "percent" ? Number(c.discountValue) > 0 && Number(c.discountValue) <= 100 : Number(c.discountValue) > 0);
/** POST / PATCH /v1/admin/coupons (HC-AD-035..041). */
export const CouponInput = z
  .strictObject({
    code: CouponCode,
    description: z.string().trim().max(200).default(""),
    discountType: DiscountType,
    discountValue: DecimalString,
    minOrderInr: DecimalString.default("0"),
    maxUses: z.number().int().min(1).nullable().default(null),
    perUserLimit: z.number().int().min(1).default(1),
    startsAt: IsoDateTime.nullable().default(null),
    endsAt: IsoDateTime.nullable().default(null),
    scope: CouponScope.default("public"),
    planIds: z.array(Id).min(1, "pick at least one plan"),
    intervals: z.array(BillingInterval).min(1, "pick at least one interval").default([...BILLING_INTERVALS]),
    assignedUserIds: z.array(Id).max(5000).default([]),
    active: z.boolean().default(true),
  })
  .refine(couponWindow, { message: "end must be after start", path: ["endsAt"] })
  .refine(couponValue, { message: "percent must be 1–100, fixed must be above 0", path: ["discountValue"] });
export type CouponInput = z.infer<typeof CouponInput>;
export const CouponBulkBody = z.strictObject({ ids: z.array(Id).min(1).max(500), action: z.enum(["activate", "deactivate", "delete"]) });
export type CouponBulkBody = z.infer<typeof CouponBulkBody>;

/** Why a coupon does not apply (HC-AC-018); null = applies. */
export const CouponReason = z.enum(["unknown", "inactive", "not_started", "expired", "exhausted", "not_assigned", "wrong_plan", "wrong_interval", "below_minimum", "per_user_limit"]);
export type CouponReason = z.infer<typeof CouponReason>;
export const COUPON_REASON_TEXT: Record<CouponReason, string> = {
  unknown: "Invalid coupon",
  inactive: "This coupon is no longer active",
  not_started: "This coupon is not valid yet",
  expired: "This coupon has expired",
  exhausted: "This coupon has been fully used",
  not_assigned: "This coupon is for invited members only",
  wrong_plan: "This coupon does not apply to this plan",
  wrong_interval: "This coupon does not apply to this billing interval",
  below_minimum: "Order is below this coupon's minimum",
  per_user_limit: "You have already used this coupon",
};

export const PriceBreakdown = z.strictObject({
  list: DecimalString,
  planDiscount: DecimalString,
  couponDiscount: DecimalString,
  subtotal: DecimalString,
  tax: DecimalString,
  total: DecimalString,
});
export type PriceBreakdown = z.infer<typeof PriceBreakdown>;

/** A coupon as the buyer sees it in the Subscribe dialog (HC-AC-020). */
export const AvailableCoupon = z.strictObject({
  code: z.string(),
  description: z.string(),
  discountType: DiscountType,
  discountValue: DecimalString,
  minOrderInr: DecimalString,
  endsAt: IsoDateTime.nullable(),
  scope: CouponScope,
  /** Null when it applies to the plan and interval asked for. */
  reason: CouponReason.nullable(),
});
export type AvailableCoupon = z.infer<typeof AvailableCoupon>;
export const CouponQuoteBody = z.strictObject({ code: CouponCode, planId: Id, interval: BillingInterval });
export type CouponQuoteBody = z.infer<typeof CouponQuoteBody>;
export const CouponQuote = z.strictObject({ coupon: AvailableCoupon, breakdown: PriceBreakdown });
export type CouponQuote = z.infer<typeof CouponQuote>;
export const AvailableCouponList = z.strictObject({ items: z.array(AvailableCoupon), breakdown: PriceBreakdown });
export type AvailableCouponList = z.infer<typeof AvailableCouponList>;

// ---------------------------------------------------------------------------------------------- checkout
export const CheckoutBody = z.strictObject({ planId: Id, interval: BillingInterval, couponCode: CouponCode.optional() });
export type CheckoutBody = z.infer<typeof CheckoutBody>;
/** What the client needs to open the Razorpay checkout (HC-AC-022); amounts to display come from `breakdown`. */
export const CheckoutOrder = z.strictObject({
  /** "razorpay" opens checkout.js; "mock" (web mock server only) opens the in-app mock checkout. */
  mode: z.enum(["razorpay", "mock"]),
  paymentId: Id,
  orderId: z.string(),
  keyId: z.string(),
  amountPaise: z.number().int(),
  currency: z.literal("INR"),
  name: z.string(),
  description: z.string(),
  prefill: z.strictObject({ name: z.string(), email: z.string(), contact: z.string().optional() }),
  breakdown: PriceBreakdown,
});
export type CheckoutOrder = z.infer<typeof CheckoutOrder>;
export const ConfirmBody = z.strictObject({ razorpay_order_id: z.string().min(1), razorpay_payment_id: z.string().min(1), razorpay_signature: z.string().min(1) });
export type ConfirmBody = z.infer<typeof ConfirmBody>;
export const CancelBody = z.strictObject({ orderId: z.string().min(1), reason: z.string().max(200).optional() });
export type CancelBody = z.infer<typeof CancelBody>;

// ---------------------------------------------------------------------------------------------- payments
export const PaymentStatus = z.enum(["paid", "pending", "failed"]);
export type PaymentStatus = z.infer<typeof PaymentStatus>;
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = { paid: "Paid", pending: "Pending", failed: "Failed" };
export const Payment = z.strictObject({
  id: Id,
  at: IsoDateTime,
  planId: Id.nullable(),
  planName: z.string(),
  interval: BillingInterval,
  listInr: DecimalString,
  planDiscountInr: DecimalString,
  couponCode: z.string().nullable(),
  couponDiscountInr: DecimalString,
  taxInr: DecimalString,
  amountInr: DecimalString,
  /** Razorpay method (upi, card, netbanking, wallet, …) once known. */
  method: z.string().nullable(),
  status: PaymentStatus,
  orderId: z.string().nullable(),
  razorpayPaymentId: z.string().nullable(),
  failureReason: z.string().nullable(),
  invoiceNo: z.string().nullable(),
});
export type Payment = z.infer<typeof Payment>;
export const PaymentsPage = z.strictObject({ items: z.array(Payment), total: z.number().int(), page: z.number().int(), pageSize: z.number().int(), counts: z.strictObject({ all: z.number().int(), paid: z.number().int(), pending: z.number().int(), failed: z.number().int() }) });
export type PaymentsPage = z.infer<typeof PaymentsPage>;
export const PaymentsQuery = z.object({ status: z.enum(["all", "paid", "pending", "failed"]).default("all"), page: z.coerce.number().int().min(1).default(1) });
export type PaymentsQuery = z.infer<typeof PaymentsQuery>;
/** Checkout outcome (confirm): the payment row plus the refreshed subscription view is fetched separately. */
export const ConfirmResult = z.strictObject({ payment: Payment, activated: z.boolean() });
export type ConfirmResult = z.infer<typeof ConfirmResult>;

/** Tax invoice (HC-AC-062) rendered from the stored payment, never from today's prices. */
export const Invoice = z.strictObject({
  no: z.string(),
  issuedAt: IsoDateTime,
  seller: z.strictObject({ name: z.string(), address: z.string(), gstin: z.string(), email: z.string() }),
  billedTo: z.strictObject({ name: z.string(), email: z.string(), mobile: Mobile.nullable() }),
  period: z.strictObject({ from: IsoDateTime, to: IsoDateTime.nullable() }),
  lines: z.strictObject({ description: z.string(), listInr: DecimalString, planDiscountInr: DecimalString, couponCode: z.string().nullable(), couponDiscountInr: DecimalString, taxableInr: DecimalString, cgstInr: DecimalString, sgstInr: DecimalString, totalInr: DecimalString }),
  payment: z.strictObject({ method: z.string().nullable(), razorpayPaymentId: z.string().nullable(), paidAt: IsoDateTime }),
});
export type Invoice = z.infer<typeof Invoice>;

// ---------------------------------------------------------------------------------------------- money helpers
const r2 = (n: number) => Math.round(n * 100) / 100;
const s2 = (n: number) => r2(n).toFixed(2);

/** Coupon amount on an already plan-discounted price; fixed coupons never exceed the price. */
export function couponDiscountInr(discounted: number, coupon: { discountType: DiscountType; discountValue: string } | null): number {
  if (!coupon) return 0;
  const v = Number(coupon.discountValue);
  if (coupon.discountType === "percent") return r2(discounted * (v / 100));
  return r2(Math.min(discounted, v));
}

/** The full breakdown (HC-AC-021) as decimal strings; the same maths as billing.priceBreakdown plus fixed coupons. */
export function breakdownFor(p: IntervalPricing, coupon: { discountType: DiscountType; discountValue: string } | null = null): PriceBreakdown {
  const list = Number(p.priceInr);
  const pay = p.discountPriceInr === null ? list : Number(p.discountPriceInr);
  const planDiscount = r2(Math.max(0, list - pay));
  const discounted = r2(list - planDiscount);
  const couponDiscount = couponDiscountInr(discounted, coupon);
  const subtotal = r2(Math.max(0, discounted - couponDiscount));
  const tax = r2(subtotal * (GST_PCT / 100));
  return { list: s2(list), planDiscount: s2(planDiscount), couponDiscount: s2(couponDiscount), subtotal: s2(subtotal), tax: s2(tax), total: s2(subtotal + tax) };
}
export const toPaise = (inr: string): number => Math.round(Number(inr) * 100);
export const invoiceNumber = (year: number, seq: number): string => `INV-${year}-${String(seq).padStart(4, "0")}`;
