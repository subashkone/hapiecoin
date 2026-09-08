// Checkout, coupons, payments and invoices through TanStack Query (Phase 4 item 2, ADR-034), plus the browser
// side of Razorpay's checkout.js (loaded on demand) and the mock checkout the mock server answers with.
import { AvailableCouponList, type BillingInterval, type CancelBody, CheckoutOrder, type ConfirmBody, ConfirmResult, Coupon, type CouponBulkBody, type CouponInput, CouponList, CouponQuote, Invoice, Payment, type PaymentStatus, PaymentsPage } from "@hapiecoin/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api, type ApiClient } from "./client";
import { billingKeys } from "./billing";
import { queryKeys } from "./queries";

const enc = encodeURIComponent;
export const paymentKeys = {
  coupons: (planId: string, interval: BillingInterval) => ["coupons", planId, interval] as const,
  payments: (status: string, page: number) => ["payments", status, page] as const,
  paymentsAll: ["payments"] as const,
  invoice: (id: string) => ["invoice", id] as const,
  adminCoupons: ["admin", "coupons"] as const,
};

export function paymentFetchers(client: ApiClient = api) {
  return {
    coupons: (planId: string, interval: BillingInterval) => client.get(`/v1/coupons?planId=${enc(planId)}&interval=${interval}`, AvailableCouponList),
    quote: (code: string, planId: string, interval: BillingInterval) => client.post("/v1/coupons/quote", { code, planId, interval }, CouponQuote),
    checkout: (planId: string, interval: BillingInterval, couponCode?: string) => client.post("/v1/checkout", { planId, interval, ...(couponCode ? { couponCode } : {}) }, CheckoutOrder),
    confirm: (body: ConfirmBody) => client.post("/v1/checkout/confirm", body, ConfirmResult),
    cancel: (body: CancelBody) => client.post("/v1/checkout/cancel", body, Payment),
    payments: (status: string, page: number) => client.get(`/v1/payments?status=${enc(status)}&page=${page}`, PaymentsPage),
    invoice: (id: string) => client.get(`/v1/payments/${enc(id)}/invoice`, Invoice),
    adminCoupons: () => client.get("/v1/admin/coupons", CouponList),
    createCoupon: (body: CouponInput) => client.post("/v1/admin/coupons", body, Coupon),
    replaceCoupon: (id: string, body: CouponInput) => client.put(`/v1/admin/coupons/${enc(id)}`, body, Coupon),
    switchCoupon: (id: string, active: boolean) => client.patch(`/v1/admin/coupons/${enc(id)}`, { active }, Coupon),
    deleteCoupon: (id: string) => client.delete(`/v1/admin/coupons/${enc(id)}`),
    bulkCoupons: (body: CouponBulkBody) => client.post("/v1/admin/coupons/bulk", body, z.object({ updated: z.number().int() })),
  };
}
const f = paymentFetchers();

export function useAvailableCoupons(planId: string | null, interval: BillingInterval) {
  return useQuery({ queryKey: paymentKeys.coupons(planId ?? "", interval), queryFn: () => f.coupons(planId ?? "", interval), enabled: planId !== null, staleTime: 30_000 });
}
export function useCouponQuote() {
  return useMutation({ mutationFn: ({ code, planId, interval }: { code: string; planId: string; interval: BillingInterval }) => f.quote(code, planId, interval) });
}
export function usePayments(status: PaymentStatus | "all", page: number) {
  return useQuery({ queryKey: paymentKeys.payments(status, page), queryFn: () => f.payments(status, page), staleTime: 10_000, placeholderData: (prev) => prev });
}
export function useInvoice(id: string | null) {
  return useQuery({ queryKey: paymentKeys.invoice(id ?? ""), queryFn: () => f.invoice(id ?? ""), enabled: id !== null, staleTime: 5 * 60_000 });
}
function useBillingMutation<TVars, TResult>(run: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: paymentKeys.paymentsAll });
      void qc.invalidateQueries({ queryKey: billingKeys.subscription });
      void qc.invalidateQueries({ queryKey: queryKeys.plan });
      void qc.invalidateQueries({ queryKey: billingKeys.adminUsersAll });
    },
  });
}
export function useStartCheckout() {
  return useBillingMutation(({ planId, interval, couponCode }: { planId: string; interval: BillingInterval; couponCode?: string }) => f.checkout(planId, interval, couponCode));
}
export function useConfirmCheckout() {
  return useBillingMutation((body: ConfirmBody) => f.confirm(body));
}
export function useCancelCheckout() {
  return useBillingMutation((body: CancelBody) => f.cancel(body));
}
export function useAdminCoupons() {
  return useQuery({ queryKey: paymentKeys.adminCoupons, queryFn: async () => (await f.adminCoupons()).items, staleTime: 10_000 });
}
function useCouponMutation<TVars, TResult>(run: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: run, onSuccess: () => void qc.invalidateQueries({ queryKey: paymentKeys.adminCoupons }) });
}
export function useCreateCoupon() {
  return useCouponMutation((body: CouponInput) => f.createCoupon(body));
}
export function useReplaceCoupon() {
  return useCouponMutation(({ id, body }: { id: string; body: CouponInput }) => f.replaceCoupon(id, body));
}
export function useSwitchCoupon() {
  return useCouponMutation(({ id, active }: { id: string; active: boolean }) => f.switchCoupon(id, active));
}
export function useDeleteCoupon() {
  return useCouponMutation((id: string) => f.deleteCoupon(id));
}
export function useBulkCoupons() {
  return useCouponMutation((body: CouponBulkBody) => f.bulkCoupons(body));
}

// ------------------------------------------------------------------------------------ Razorpay checkout.js
export interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}
interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description: string;
  prefill: { name: string; email: string; contact?: string | undefined };
  theme?: { color: string };
  handler: (r: RazorpaySuccess) => void;
  modal?: { ondismiss?: () => void };
}
interface RazorpayInstance {
  open(): void;
  on(event: "payment.failed", cb: (e: { error?: { description?: string; reason?: string } }) => void): void;
}
type RazorpayCtor = new (options: RazorpayOptions) => RazorpayInstance;
export const CHECKOUT_JS = "https://checkout.razorpay.com/v1/checkout.js";

/** Load checkout.js once; rejects when the script cannot load (HC-AC-029). */
export function loadCheckoutJs(doc: Document = document): Promise<RazorpayCtor> {
  const w = window as unknown as { Razorpay?: RazorpayCtor };
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  return new Promise((resolve, reject) => {
    const existing = doc.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_JS}"]`);
    const script = existing ?? doc.createElement("script");
    const done = () => (w.Razorpay ? resolve(w.Razorpay) : reject(new Error("Failed to load Razorpay SDK")));
    script.addEventListener("load", done, { once: true });
    script.addEventListener("error", () => reject(new Error("Failed to load Razorpay SDK")), { once: true });
    if (!existing) {
      script.src = CHECKOUT_JS;
      script.async = true;
      doc.head.appendChild(script);
    }
  });
}

/** Open Razorpay for an order; resolves with the handler payload, rejects on dismiss ("dismissed") or failure. */
export async function openRazorpay(order: CheckoutOrder, accent = "#f5a524"): Promise<RazorpaySuccess> {
  const Razorpay = await loadCheckoutJs();
  return new Promise((resolve, reject) => {
    const rz = new Razorpay({
      key: order.keyId,
      amount: order.amountPaise,
      currency: order.currency,
      order_id: order.orderId,
      name: order.name,
      description: order.description,
      prefill: order.prefill,
      theme: { color: accent },
      handler: (r) => resolve(r),
      modal: { ondismiss: () => reject(new Error("dismissed")) },
    });
    rz.on("payment.failed", (e) => reject(new Error(e.error?.description ?? e.error?.reason ?? "Payment failed")));
    rz.open();
  });
}
