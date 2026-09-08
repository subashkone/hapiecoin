// Checkout and payments (Phase 4 item 2, ADR-034): the API owns every amount. An order is created from the
// catalogue price after plan and coupon discounts, a pending payment row is written, and the subscription changes
// only when Razorpay's signature (checkout) or the webhook signature says the money moved. Settlement is idempotent
// by Razorpay payment id, so a confirm and a webhook for the same payment agree.
import { type BillingInterval, type CheckoutOrder, type Invoice, INTERVAL_MONTHS, type Payment, type PaymentsPage, type PaymentsQuery, type PriceBreakdown, breakdownFor, invoiceNumber, toPaise } from "@hapiecoin/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { type CouponRow, redeemCoupon, resolveCoupon } from "./coupons.js";
import { payments, plans, subscriptions, users } from "./db/schema.js";
import { activeSubscription } from "./entitlements.js";
import { recordReferralCommission } from "./referrals.js";
import type { AppDeps } from "./routes/shared.js";
import { newId } from "./routes/shared.js";
import { errors } from "./security/errors.js";

type PaymentRow = typeof payments.$inferSelect;
type PlanRow = typeof plans.$inferSelect;
type UserRow = typeof users.$inferSelect;
export const PAYMENTS_PAGE_SIZE = 5;

export function toPayment(p: PaymentRow): Payment {
  return {
    id: p.id,
    at: (p.paidAt ?? p.createdAt).toISOString(),
    planId: p.planId,
    planName: p.planName,
    interval: p.interval,
    listInr: p.listInr,
    planDiscountInr: p.planDiscountInr,
    couponCode: p.couponCode,
    couponDiscountInr: p.couponDiscountInr,
    taxInr: p.taxInr,
    amountInr: p.amountInr,
    method: p.method,
    status: p.status,
    orderId: p.orderId,
    razorpayPaymentId: p.razorpayPaymentId,
    failureReason: p.failureReason,
    invoiceNo: p.invoiceNo,
  };
}

/** Plan, price and coupon resolution shared by quote, checkout and ₹0 activation. */
export async function priceFor(deps: AppDeps, userId: string, planId: string, interval: BillingInterval, couponCode: string | undefined, now: Date): Promise<{ plan: PlanRow; coupon: CouponRow | null; breakdown: PriceBreakdown }> {
  const [plan] = await deps.db.select().from(plans).where(and(eq(plans.id, planId), eq(plans.active, true))).limit(1);
  if (!plan) throw errors.notFound("Plan");
  let coupon: CouponRow | null = null;
  if (couponCode) {
    const r = await resolveCoupon(deps, couponCode, userId, plan, interval, now);
    if (r.reason) throw errors.badRequest(`Coupon ${couponCode.toUpperCase()}: ${r.reason.replace(/_/g, " ")}`);
    coupon = r.row;
  }
  return { plan, coupon, breakdown: breakdownFor(plan.intervals[interval], coupon) };
}

async function nextInvoiceNo(deps: AppDeps, now: Date): Promise<string> {
  const year = now.getUTCFullYear();
  const [r] = await deps.db.select({ n: sql<number>`count(*)` }).from(payments).where(sql`${payments.invoiceNo} like ${`INV-${year}-%`}`);
  return invoiceNumber(year, Number(r?.n ?? 0) + 1);
}

/**
 * Turn a pending payment into a paid one and give the user the plan: cancel the active subscription, insert the new
 * one (paidInr = amount), redeem the coupon, record the referrer's commission, number the invoice. Idempotent: a
 * payment already paid returns as is.
 */
export async function settlePaid(deps: AppDeps, p: PaymentRow, detail: { razorpayPaymentId: string | null; method: string | null }, now: Date): Promise<PaymentRow> {
  if (p.status === "paid") return p;
  const [plan] = p.planId ? await deps.db.select().from(plans).where(eq(plans.id, p.planId)).limit(1) : [];
  const pricing = plan?.intervals[p.interval];
  await deps.db.update(subscriptions).set({ status: "cancelled", updatedAt: now }).where(and(eq(subscriptions.userId, p.userId), eq(subscriptions.status, "active")));
  const [sub] = await deps.db
    .insert(subscriptions)
    .values({ id: newId("sub"), userId: p.userId, planName: p.planName, planId: p.planId, interval: p.interval, priceInr: p.listInr, paidInr: p.amountInr, currency: "INR", status: "active", startsAt: now, expiresAt: Number(p.listInr) === 0 ? null : new Date(now.getTime() + INTERVAL_MONTHS[p.interval] * 30 * 86_400_000), featureLimits: pricing?.limits ?? {}, createdAt: now, updatedAt: now })
    .returning();
  if (p.couponId) await redeemCoupon(deps, p.couponId, now);
  if (sub) await recordReferralCommission(deps, sub, now);
  const invoiceNo = await nextInvoiceNo(deps, now);
  const [row] = await deps.db
    .update(payments)
    .set({ status: "paid", paidAt: now, method: detail.method ?? p.method, razorpayPaymentId: detail.razorpayPaymentId ?? p.razorpayPaymentId, invoiceNo, subscriptionId: sub?.id ?? null, failureReason: null, updatedAt: now })
    .where(eq(payments.id, p.id))
    .returning();
  return row ?? p;
}

export async function failPayment(deps: AppDeps, p: PaymentRow, reason: string, detail: { razorpayPaymentId?: string | null; method?: string | null }, now: Date): Promise<PaymentRow> {
  if (p.status === "paid") return p; // money already moved; a late failure event cannot undo a settlement
  const [row] = await deps.db
    .update(payments)
    .set({ status: "failed", failureReason: reason.slice(0, 200), ...(detail.razorpayPaymentId ? { razorpayPaymentId: detail.razorpayPaymentId } : {}), ...(detail.method ? { method: detail.method } : {}), updatedAt: now })
    .where(eq(payments.id, p.id))
    .returning();
  return row ?? p;
}

/** Create the Razorpay order and the pending payment row (HC-AC-022). Totals of ₹0 must go through activation. */
export async function startCheckout(deps: AppDeps, user: UserRow, planId: string, interval: BillingInterval, couponCode: string | undefined, now: Date): Promise<CheckoutOrder> {
  if (!deps.razorpay) throw errors.unavailable("Checkout is not configured on this server");
  const { plan, coupon, breakdown } = await priceFor(deps, user.id, planId, interval, couponCode, now);
  if (Number(breakdown.total) <= 0) throw errors.badRequest("This order costs ₹0; use Activate");
  const current = await activeSubscription(deps, user.id, now);
  if (current?.planId === plan.id && current.interval === interval) throw errors.conflict(`You are already on ${plan.name} · ${interval}`);
  const paymentId = newId("pay");
  const amountPaise = toPaise(breakdown.total);
  const order = await deps.razorpay.createOrder({ amountPaise, currency: "INR", receipt: paymentId.slice(0, 40), notes: { userId: user.id, planId: plan.id, interval } });
  await deps.db.insert(payments).values({ id: paymentId, userId: user.id, planId: plan.id, planName: plan.name, interval, listInr: breakdown.list, planDiscountInr: breakdown.planDiscount, couponId: coupon?.id ?? null, couponCode: coupon?.code ?? null, couponDiscountInr: breakdown.couponDiscount, taxInr: breakdown.tax, amountInr: breakdown.total, status: "pending", orderId: order.id, createdAt: now, updatedAt: now });
  return { mode: "razorpay", paymentId, orderId: order.id, keyId: deps.razorpay.keyId, amountPaise, currency: "INR", name: "HapieCoin", description: `Subscription · ${plan.name} · ${interval}`, prefill: { name: user.name, email: user.email, ...(user.mobile ? { contact: user.mobile } : {}) }, breakdown };
}

/** The checkout.js handler's payload: verify, look the payment up, settle (HC-AC-025). */
export async function confirmCheckout(deps: AppDeps, userId: string, body: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }, now: Date): Promise<{ payment: Payment; activated: boolean }> {
  if (!deps.razorpay) throw errors.unavailable("Checkout is not configured on this server");
  const [p] = await deps.db.select().from(payments).where(and(eq(payments.orderId, body.razorpay_order_id), eq(payments.userId, userId))).limit(1);
  if (!p) throw errors.notFound("Payment");
  if (!deps.razorpay.verifyCheckout(body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature)) throw errors.badRequest("Payment signature does not match; contact support if you were charged");
  if (p.status === "paid") return { payment: toPayment(p), activated: false };
  const detail = await deps.razorpay.fetchPayment(body.razorpay_payment_id).catch(() => null);
  const settled = await settlePaid(deps, p, { razorpayPaymentId: body.razorpay_payment_id, method: detail?.method ?? null }, now);
  return { payment: toPayment(settled), activated: true };
}

/** The buyer closed the checkout (HC-AC-026): the pending row becomes failed so history tells the truth. */
export async function cancelCheckout(deps: AppDeps, userId: string, orderId: string, reason: string | undefined, now: Date): Promise<Payment | null> {
  const [p] = await deps.db.select().from(payments).where(and(eq(payments.orderId, orderId), eq(payments.userId, userId))).limit(1);
  if (!p) return null;
  if (p.status !== "pending") return toPayment(p);
  return toPayment(await failPayment(deps, p, reason ?? "Cancelled by the user", {}, now));
}

interface WebhookEvent {
  event?: string;
  payload?: { payment?: { entity?: { id?: string; order_id?: string | null; method?: string | null; error_description?: string | null } } };
}
/** payment.captured settles, payment.failed fails, everything else is acknowledged and ignored (ADR-034). */
export async function handleWebhook(deps: AppDeps, rawBody: string, signature: string | undefined, now: Date): Promise<{ handled: boolean; event: string }> {
  if (!deps.razorpay) throw errors.unavailable("Checkout is not configured on this server");
  if (!deps.razorpay.verifyWebhook(rawBody, signature)) throw errors.forbidden("Webhook signature does not match");
  let ev: WebhookEvent;
  try {
    ev = JSON.parse(rawBody) as WebhookEvent;
  } catch {
    throw errors.badRequest("Webhook body is not JSON");
  }
  const event = ev.event ?? "unknown";
  const entity = ev.payload?.payment?.entity;
  if (!entity?.order_id || !entity.id) return { handled: false, event };
  const [p] = await deps.db.select().from(payments).where(eq(payments.orderId, entity.order_id)).limit(1);
  if (!p) return { handled: false, event };
  if (event === "payment.captured") {
    await settlePaid(deps, p, { razorpayPaymentId: entity.id, method: entity.method ?? null }, now);
    return { handled: true, event };
  }
  if (event === "payment.failed") {
    await failPayment(deps, p, entity.error_description ?? "Payment failed", { razorpayPaymentId: entity.id, method: entity.method ?? null }, now);
    return { handled: true, event };
  }
  return { handled: false, event };
}

/** A ₹0 order (Free plan, or a coupon covering everything) recorded as a paid ₹0 payment so history shows it. */
export async function recordFreePayment(deps: AppDeps, userId: string, plan: PlanRow, interval: BillingInterval, coupon: CouponRow | null, breakdown: PriceBreakdown, subscriptionId: string, now: Date): Promise<Payment> {
  const invoiceNo = Number(breakdown.list) > 0 ? await nextInvoiceNo(deps, now) : null;
  const [row] = await deps.db
    .insert(payments)
    .values({ id: newId("pay"), userId, planId: plan.id, planName: plan.name, interval, listInr: breakdown.list, planDiscountInr: breakdown.planDiscount, couponId: coupon?.id ?? null, couponCode: coupon?.code ?? null, couponDiscountInr: breakdown.couponDiscount, taxInr: breakdown.tax, amountInr: breakdown.total, status: "paid", method: coupon ? "coupon" : "free", invoiceNo, subscriptionId, paidAt: now, createdAt: now, updatedAt: now })
    .returning();
  if (coupon) await redeemCoupon(deps, coupon.id, now);
  if (!row) throw new Error("payment insert returned no row");
  return toPayment(row);
}

export async function listPayments(deps: AppDeps, userId: string, q: PaymentsQuery): Promise<PaymentsPage> {
  const all = await deps.db.select().from(payments).where(eq(payments.userId, userId)).orderBy(desc(payments.createdAt));
  const counts = { all: all.length, paid: all.filter((p) => p.status === "paid").length, pending: all.filter((p) => p.status === "pending").length, failed: all.filter((p) => p.status === "failed").length };
  const rows = q.status === "all" ? all : all.filter((p) => p.status === q.status);
  const start = (q.page - 1) * PAYMENTS_PAGE_SIZE;
  return { items: rows.slice(start, start + PAYMENTS_PAGE_SIZE).map(toPayment), total: rows.length, page: q.page, pageSize: PAYMENTS_PAGE_SIZE, counts };
}

/** The tax invoice from the stored row (HC-AC-062): GST split into CGST and SGST halves. */
export async function invoiceFor(deps: AppDeps, userId: string, paymentId: string): Promise<Invoice | null> {
  const [p] = await deps.db.select().from(payments).where(and(eq(payments.id, paymentId), eq(payments.userId, userId))).limit(1);
  if (!p || p.status !== "paid" || !p.invoiceNo || !p.paidAt) return null;
  const [u] = await deps.db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return null;
  const [sub] = p.subscriptionId ? await deps.db.select().from(subscriptions).where(eq(subscriptions.id, p.subscriptionId)).limit(1) : [];
  const half = (Math.round(Number(p.taxInr) * 100) / 2 / 100).toFixed(2);
  const cgst = half;
  const sgst = (Math.round((Number(p.taxInr) - Number(half)) * 100) / 100).toFixed(2);
  const taxable = (Math.round((Number(p.amountInr) - Number(p.taxInr)) * 100) / 100).toFixed(2);
  return {
    no: p.invoiceNo,
    issuedAt: p.paidAt.toISOString(),
    seller: deps.config.invoiceSeller,
    billedTo: { name: u.name, email: u.email, mobile: u.mobile },
    period: { from: (sub?.startsAt ?? p.paidAt).toISOString(), to: sub?.expiresAt?.toISOString() ?? null },
    lines: { description: `${p.planName} plan · ${p.interval}`, listInr: p.listInr, planDiscountInr: p.planDiscountInr, couponCode: p.couponCode, couponDiscountInr: p.couponDiscountInr, taxableInr: taxable, cgstInr: cgst, sgstInr: sgst, totalInr: p.amountInr },
    payment: { method: p.method, razorpayPaymentId: p.razorpayPaymentId, paidAt: p.paidAt.toISOString() },
  };
}

