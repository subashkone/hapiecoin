// Checkout, payments, invoices and the buyer's coupon routes (Phase 4 item 2, ADR-034) against the fake Razorpay.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { AvailableCouponList, CheckoutOrder, ConfirmResult, Coupon, CouponQuote, Invoice, Payment, PaymentsPage, SubscriptionView } from "@hapiecoin/schema";
import { coupons, payments } from "../db/schema.js";
import { SEED } from "../db/seed.js";
import { createTestApp, type TestApp } from "../test-support/harness.js";

let t: TestApp;
let admin: string;
let buyer: string;
let buyerId: string;
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;

beforeAll(async () => {
  t = await createTestApp();
  admin = await t.adminCookie();
  buyer = (await t.signUp("buyer@hapiecoin.test", { plan: "free", name: "Bea Buyer", mobile: "9000000077" })).cookie;
  buyerId = ((await (await t.request("/v1/me", { cookie: buyer })).json()) as { id: string }).id;
  await t.request("/v1/admin/coupons", { cookie: admin, json: { code: "basic20", description: "20% off", discountType: "percent", discountValue: "20", planIds: [SEED.plans.basic, SEED.plans.pro], intervals: ["monthly", "yearly"] } });
  await t.request("/v1/admin/coupons", { cookie: admin, json: { code: "PRO500", description: "₹500 off Pro yearly", discountType: "fixed", discountValue: "500", minOrderInr: "5000", planIds: [SEED.plans.pro], intervals: ["yearly"], maxUses: 1 } });
  await t.request("/v1/admin/coupons", { cookie: admin, json: { code: "VIP25", description: "members", discountType: "percent", discountValue: "25", scope: "community", planIds: [SEED.plans.pro], assignedUserIds: ["usr_someone_else"] } });
  await t.request("/v1/admin/coupons", { cookie: admin, json: { code: "OLD", description: "expired", discountType: "percent", discountValue: "50", planIds: [SEED.plans.pro], endsAt: "2020-01-01T00:00:00.000Z" } });
  await t.request("/v1/admin/coupons", { cookie: admin, json: { code: "FULL", description: "everything free", discountType: "percent", discountValue: "100", planIds: [SEED.plans.basic], intervals: ["monthly"] } });
});
afterAll(() => t.close());

describe("HC-AC-017..021 buyer coupons", () => {
  it("lists public and assigned coupons with reasons, quotes a code with the breakdown, explains refusals", async () => {
    const list = await json<AvailableCouponList>(await t.request(`/v1/coupons?planId=${SEED.plans.pro}&interval=monthly`, { cookie: buyer }));
    const by = Object.fromEntries(list.items.map((c) => [c.code, c.reason]));
    expect(by).toEqual({ BASIC20: null, PRO500: "wrong_interval", OLD: "expired", FULL: "wrong_plan" }); // VIP25 is not assigned to the buyer, so not listed
    expect(list.breakdown.total).toBe("1001.82");
    const q = await json<CouponQuote>(await t.request("/v1/coupons/quote", { cookie: buyer, json: { code: "basic20", planId: SEED.plans.pro, interval: "monthly" } }));
    expect(q.coupon.reason).toBeNull();
    expect(q.breakdown).toMatchObject({ couponDiscount: "169.80", total: "801.46" });
    expect((await json<CouponQuote>(await t.request("/v1/coupons/quote", { cookie: buyer, json: { code: "NOPE", planId: SEED.plans.pro, interval: "monthly" } }))).coupon.reason).toBe("unknown");
    expect((await json<CouponQuote>(await t.request("/v1/coupons/quote", { cookie: buyer, json: { code: "VIP25", planId: SEED.plans.pro, interval: "monthly" } }))).coupon.reason).toBe("not_assigned");
    expect((await json<CouponQuote>(await t.request("/v1/coupons/quote", { cookie: buyer, json: { code: "PRO500", planId: SEED.plans.pro, interval: "yearly" } }))).coupon.reason).toBeNull(); // 8999 list > 5000 minimum
    expect((await json<CouponQuote>(await t.request("/v1/coupons/quote", { cookie: buyer, json: { code: "PRO500", planId: SEED.plans.pro, interval: "monthly" } }))).coupon.reason).toBe("wrong_interval");
    expect((await t.request(`/v1/coupons?planId=pln_nope&interval=monthly`, { cookie: buyer })).status).toBe(404);
  });
});

describe("HC-AC-022..026 checkout with the fake Razorpay", () => {
  it("creates an order and a pending payment, refuses a bad signature, settles a good one once, cancels", async () => {
    const res = await t.request("/v1/checkout", { cookie: buyer, json: { planId: SEED.plans.pro, interval: "monthly", couponCode: "basic20" } });
    expect(res.status).toBe(201);
    const order = await json<CheckoutOrder>(res);
    expect(order).toMatchObject({ mode: "razorpay", keyId: "rzp_test_fake", amountPaise: 80146, currency: "INR", description: "Subscription · Pro · monthly", prefill: { name: "Bea Buyer", email: "buyer@hapiecoin.test", contact: "9000000077" } });
    expect(t.razorpay.orders.at(-1)).toMatchObject({ id: order.orderId, amountPaise: 80146, notes: { userId: buyerId, planId: SEED.plans.pro } });
    let page = await json<PaymentsPage>(await t.request("/v1/payments", { cookie: buyer }));
    expect(page.items[0]).toMatchObject({ status: "pending", amountInr: "801.46", couponCode: "BASIC20", orderId: order.orderId, invoiceNo: null });
    // wrong signature → 400 and still pending
    expect((await t.request("/v1/checkout/confirm", { cookie: buyer, json: { razorpay_order_id: order.orderId, razorpay_payment_id: "pay_X1", razorpay_signature: "deadbeef" } })).status).toBe(400);
    expect((await t.request("/v1/checkout/confirm", { cookie: buyer, json: { razorpay_order_id: "order_nope", razorpay_payment_id: "pay_X1", razorpay_signature: "x" } })).status).toBe(404);
    // right signature → paid, plan active, coupon redeemed, invoice numbered
    t.razorpay.payments.set("pay_X1", { id: "pay_X1", order_id: order.orderId, amount: 80146, status: "captured", method: "upi", error_description: null });
    const ok = await json<ConfirmResult>(await t.request("/v1/checkout/confirm", { cookie: buyer, json: { razorpay_order_id: order.orderId, razorpay_payment_id: "pay_X1", razorpay_signature: t.razorpay.sign(order.orderId, "pay_X1") } }));
    expect(ok.activated).toBe(true);
    expect(ok.payment).toMatchObject({ status: "paid", method: "upi", razorpayPaymentId: "pay_X1", invoiceNo: "INV-2026-0001" });
    const view = await json<SubscriptionView>(await t.request("/v1/subscription", { cookie: buyer }));
    expect(view.current).toMatchObject({ planName: "Pro", interval: "monthly", paidInr: "801.46" });
    expect(view.current?.expiresAt).not.toBeNull();
    const [cpn] = await t.db.select().from(coupons).where(eq(coupons.code, "BASIC20")).limit(1);
    expect(cpn?.usedCount).toBe(1);
    // a second confirm of the same payment is a no-op
    const again = await json<ConfirmResult>(await t.request("/v1/checkout/confirm", { cookie: buyer, json: { razorpay_order_id: order.orderId, razorpay_payment_id: "pay_X1", razorpay_signature: t.razorpay.sign(order.orderId, "pay_X1") } }));
    expect(again.activated).toBe(false);
    expect((await t.db.select().from(payments).where(eq(payments.userId, buyerId))).filter((p) => p.status === "paid")).toHaveLength(1);
    // the same plan again is a conflict; a ₹0 total must use Activate; the per-user limit now refuses BASIC20 on the next order
    expect((await t.request("/v1/checkout", { cookie: buyer, json: { planId: SEED.plans.pro, interval: "monthly" } })).status).toBe(409);
    expect((await t.request("/v1/checkout", { cookie: buyer, json: { planId: SEED.plans.basic, interval: "monthly", couponCode: "FULL" } })).status).toBe(400);
    expect((await json<CouponQuote>(await t.request("/v1/coupons/quote", { cookie: buyer, json: { code: "BASIC20", planId: SEED.plans.basic, interval: "monthly" } }))).coupon.reason).toBe("per_user_limit");
    // cancel a fresh order
    const o2 = await json<CheckoutOrder>(await t.request("/v1/checkout", { cookie: buyer, json: { planId: SEED.plans.elite, interval: "yearly" } }));
    const cancelled = await json<Payment>(await t.request("/v1/checkout/cancel", { cookie: buyer, json: { orderId: o2.orderId } }));
    expect(cancelled).toMatchObject({ status: "failed", failureReason: "Cancelled by the user" });
    expect((await t.request("/v1/checkout/cancel", { cookie: buyer, json: { orderId: "order_nope" } })).status).toBe(404);
    page = await json<PaymentsPage>(await t.request("/v1/payments?status=failed", { cookie: buyer }));
    expect(page.counts).toEqual({ all: 2, paid: 1, pending: 0, failed: 1 });
    expect(page.items).toHaveLength(1);
  });

  it("a ₹0 total (100 % coupon) activates through /v1/subscription/activate and leaves a paid ₹0 payment with an invoice", async () => {
    const view = await json<SubscriptionView>(await t.request("/v1/subscription/activate", { cookie: buyer, json: { planId: SEED.plans.basic, interval: "monthly", couponCode: "FULL" } }));
    expect(view.current).toMatchObject({ planName: "Basic", paidInr: "0" });
    const page = await json<PaymentsPage>(await t.request("/v1/payments", { cookie: buyer }));
    expect(page.items[0]).toMatchObject({ status: "paid", amountInr: "0.00", couponCode: "FULL", method: "coupon", listInr: "499.00", invoiceNo: "INV-2026-0002" });
    expect((await t.request("/v1/subscription/activate", { cookie: buyer, json: { planId: SEED.plans.pro, interval: "monthly" } })).status).toBe(402);
    expect((await t.request("/v1/subscription/activate", { cookie: buyer, json: { planId: SEED.plans.pro, interval: "monthly", couponCode: "OLD" } })).status).toBe(400);
  });
});

describe("HC-AC-062 invoice and ADR-034 webhook", () => {
  it("renders the invoice from the stored row; the webhook settles or fails by signature, idempotently", async () => {
    const page = await json<PaymentsPage>(await t.request("/v1/payments?status=paid", { cookie: buyer }));
    const paid = page.items.find((p) => p.invoiceNo === "INV-2026-0001")!;
    const inv = await json<Invoice>(await t.request(`/v1/payments/${paid.id}/invoice`, { cookie: buyer }));
    expect(inv).toMatchObject({ no: "INV-2026-0001", billedTo: { name: "Bea Buyer", email: "buyer@hapiecoin.test", mobile: "9000000077" }, lines: { description: "Pro plan · monthly", listInr: "999.00", planDiscountInr: "150.00", couponCode: "BASIC20", couponDiscountInr: "169.80", taxableInr: "679.20", cgstInr: "61.13", sgstInr: "61.13", totalInr: "801.46" }, payment: { method: "upi", razorpayPaymentId: "pay_X1" } });
    expect(inv.seller.name).toBe("HapieCoin");
    const failed = (await json<PaymentsPage>(await t.request("/v1/payments?status=failed", { cookie: buyer }))).items[0]!;
    expect((await t.request(`/v1/payments/${failed.id}/invoice`, { cookie: buyer })).status).toBe(404);
    expect((await t.request(`/v1/payments/${paid.id}/invoice`, { cookie: admin })).status).toBe(404); // someone else's payment
    // webhook: a new order settled by payment.captured, then a stray payment.failed cannot undo it
    const o3 = await json<CheckoutOrder>(await t.request("/v1/checkout", { cookie: buyer, json: { planId: SEED.plans.elite, interval: "quarterly" } }));
    const captured = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_W1", order_id: o3.orderId, method: "card", amount: o3.amountPaise } } } });
    expect((await t.request("/v1/billing/webhook", { method: "POST", headers: { "content-type": "application/json", "x-razorpay-signature": "bad" }, json: JSON.parse(captured) as unknown, origin: null })).status).toBe(403);
    const res = await t.request("/v1/billing/webhook", { method: "POST", headers: { "content-type": "application/json", "x-razorpay-signature": t.razorpay.signWebhook(captured) }, json: JSON.parse(captured) as unknown, origin: null });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, handled: true, event: "payment.captured" });
    const after = (await json<PaymentsPage>(await t.request("/v1/payments?status=paid", { cookie: buyer }))).items[0]!;
    expect(after).toMatchObject({ orderId: o3.orderId, status: "paid", method: "card", razorpayPaymentId: "pay_W1", invoiceNo: "INV-2026-0003" });
    const failedEv = JSON.stringify({ event: "payment.failed", payload: { payment: { entity: { id: "pay_W1", order_id: o3.orderId, error_description: "late" } } } });
    await t.request("/v1/billing/webhook", { method: "POST", headers: { "content-type": "application/json", "x-razorpay-signature": t.razorpay.signWebhook(failedEv) }, json: JSON.parse(failedEv) as unknown, origin: null });
    expect((await json<PaymentsPage>(await t.request("/v1/payments?status=paid", { cookie: buyer }))).items[0]?.status).toBe("paid");
    // a failed event on a pending order marks it failed; unknown orders and events are acknowledged and ignored
    const o4 = await json<CheckoutOrder>(await t.request("/v1/checkout", { cookie: buyer, json: { planId: SEED.plans.pro, interval: "yearly" } }));
    const failEv = JSON.stringify({ event: "payment.failed", payload: { payment: { entity: { id: "pay_F1", order_id: o4.orderId, method: "netbanking", error_description: "Bank declined" } } } });
    await t.request("/v1/billing/webhook", { method: "POST", headers: { "content-type": "application/json", "x-razorpay-signature": t.razorpay.signWebhook(failEv) }, json: JSON.parse(failEv) as unknown, origin: null });
    expect((await json<PaymentsPage>(await t.request("/v1/payments?status=failed", { cookie: buyer }))).items[0]).toMatchObject({ orderId: o4.orderId, failureReason: "Bank declined", method: "netbanking" });
    const stray = JSON.stringify({ event: "order.paid", payload: { payment: { entity: { id: "pay_Z", order_id: "order_nope" } } } });
    expect(await (await t.request("/v1/billing/webhook", { method: "POST", headers: { "content-type": "application/json", "x-razorpay-signature": t.razorpay.signWebhook(stray) }, json: JSON.parse(stray) as unknown, origin: null })).json()).toMatchObject({ handled: false, event: "order.paid" });
  });
});

describe("coupon reasons and checkout edge cases", () => {
  it("not started, exhausted, community assigned, below minimum, wrong plan; fetchPayment failure still settles; bad webhook JSON", async () => {
    const soon = await json<Coupon>(await t.request("/v1/admin/coupons", { cookie: admin, json: { code: "SOON", discountType: "percent", discountValue: "5", planIds: [SEED.plans.pro], startsAt: "2099-01-01T00:00:00.000Z" } }));
    expect((await json<CouponQuote>(await t.request("/v1/coupons/quote", { cookie: buyer, json: { code: "SOON", planId: SEED.plans.pro, interval: "monthly" } }))).coupon.reason).toBe("not_started");
    const used = await json<Coupon>(await t.request("/v1/admin/coupons", { cookie: admin, json: { code: "USEDUP", discountType: "percent", discountValue: "5", planIds: [SEED.plans.pro], maxUses: 1 } }));
    await t.db.update(coupons).set({ usedCount: 1 }).where(eq(coupons.id, used.id));
    expect((await json<CouponQuote>(await t.request("/v1/coupons/quote", { cookie: buyer, json: { code: "USEDUP", planId: SEED.plans.pro, interval: "monthly" } }))).coupon.reason).toBe("exhausted");
    await t.request("/v1/admin/coupons", { cookie: admin, json: { code: "MINE", discountType: "fixed", discountValue: "50", scope: "community", planIds: [SEED.plans.pro], assignedUserIds: [buyerId] } });
    const mine = await json<AvailableCouponList>(await t.request(`/v1/coupons?planId=${SEED.plans.pro}&interval=monthly`, { cookie: buyer }));
    expect(mine.items.find((c) => c.code === "MINE")).toMatchObject({ scope: "community", reason: null });
    await t.request("/v1/admin/coupons", { cookie: admin, json: { code: "BIGONLY", discountType: "percent", discountValue: "5", minOrderInr: "100000", planIds: [SEED.plans.pro] } });
    expect((await json<CouponQuote>(await t.request("/v1/coupons/quote", { cookie: buyer, json: { code: "BIGONLY", planId: SEED.plans.pro, interval: "monthly" } }))).coupon.reason).toBe("below_minimum");
    await t.request(`/v1/admin/coupons/${soon.id}`, { cookie: admin, method: "PATCH", json: { active: false } });
    expect((await json<CouponQuote>(await t.request("/v1/coupons/quote", { cookie: buyer, json: { code: "SOON", planId: SEED.plans.pro, interval: "monthly" } }))).coupon.reason).toBe("inactive");
    // a Razorpay lookup failure after a valid signature still settles (the method stays unknown)
    const o = await json<CheckoutOrder>(await t.request("/v1/checkout", { cookie: buyer, json: { planId: SEED.plans.basic, interval: "yearly" } }));
    const original = t.razorpay.fetchPayment.bind(t.razorpay);
    t.razorpay.fetchPayment = () => Promise.reject(new Error("razorpay down"));
    const settled = await json<ConfirmResult>(await t.request("/v1/checkout/confirm", { cookie: buyer, json: { razorpay_order_id: o.orderId, razorpay_payment_id: "pay_M1", razorpay_signature: t.razorpay.sign(o.orderId, "pay_M1") } }));
    t.razorpay.fetchPayment = original;
    expect(settled.payment).toMatchObject({ status: "paid", method: null });
    // webhook: signed but not JSON → 400; a stranger's cancel is 404
    expect((await t.request("/v1/billing/webhook", { method: "POST", headers: { "content-type": "text/plain", "x-razorpay-signature": t.razorpay.signWebhook("not json") }, origin: null, body: "not json" })).status).toBe(400);
    expect((await t.request("/v1/checkout/cancel", { cookie: admin, json: { orderId: o.orderId } })).status).toBe(404);
    const already = await json<Payment>(await t.request("/v1/checkout/cancel", { cookie: buyer, json: { orderId: o.orderId } }));
    expect(already.status).toBe("paid"); // cancelling a settled order changes nothing
  });
});

describe("more branches", () => {
  it("webhook fallbacks, cancel with a reason, duplicate plan ids, update refusals, a paid order of a retired plan", async () => {
    const o = await json<CheckoutOrder>(await t.request("/v1/checkout", { cookie: buyer, json: { planId: SEED.plans.elite, interval: "monthly" } }));
    const withReason = await json<Payment>(await t.request("/v1/checkout/cancel", { cookie: buyer, json: { orderId: o.orderId, reason: "changed my mind" } }));
    expect(withReason.failureReason).toBe("changed my mind");
    const o2 = await json<CheckoutOrder>(await t.request("/v1/checkout", { cookie: buyer, json: { planId: SEED.plans.elite, interval: "monthly" } }));
    const bare = JSON.stringify({ event: "payment.failed", payload: { payment: { entity: { id: "pay_B1", order_id: o2.orderId } } } });
    await t.request("/v1/billing/webhook", { headers: { "content-type": "application/json", "x-razorpay-signature": t.razorpay.signWebhook(bare) }, origin: null, body: bare });
    expect((await json<PaymentsPage>(await t.request("/v1/payments?status=failed", { cookie: buyer }))).items[0]).toMatchObject({ orderId: o2.orderId, failureReason: "Payment failed", method: null });
    const o3 = await json<CheckoutOrder>(await t.request("/v1/checkout", { cookie: buyer, json: { planId: SEED.plans.elite, interval: "monthly" } }));
    const captured = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_C1", order_id: o3.orderId } } } });
    await t.request("/v1/billing/webhook", { headers: { "content-type": "application/json", "x-razorpay-signature": t.razorpay.signWebhook(captured) }, origin: null, body: captured });
    expect((await json<PaymentsPage>(await t.request("/v1/payments?status=paid", { cookie: buyer }))).items[0]).toMatchObject({ orderId: o3.orderId, method: null });
    const noEntity = JSON.stringify({ event: "payment.captured", payload: {} });
    expect(await (await t.request("/v1/billing/webhook", { headers: { "content-type": "application/json", "x-razorpay-signature": t.razorpay.signWebhook(noEntity) }, origin: null, body: noEntity })).json()).toMatchObject({ handled: false });
    // an event without a name is acknowledged; a buyer without a mobile gets no contact prefill; a deactivated account is refused
    const nameless = JSON.stringify({ payload: { payment: { entity: { id: "pay_N", order_id: "order_nope" } } } });
    expect(await (await t.request("/v1/billing/webhook", { headers: { "content-type": "application/json", "x-razorpay-signature": t.razorpay.signWebhook(nameless) }, origin: null, body: nameless })).json()).toMatchObject({ handled: false, event: "unknown" });
    const adminOrder = await json<CheckoutOrder>(await t.request("/v1/checkout", { cookie: admin, json: { planId: SEED.plans.pro, interval: "quarterly" } }));
    expect(adminOrder.prefill).not.toHaveProperty("contact");
    const off = (await t.signUp("off-chk@hapiecoin.test", { plan: "free" })).cookie;
    const offId = ((await (await t.request("/v1/me", { cookie: off })).json()) as { id: string }).id;
    await t.request(`/v1/admin/users/${offId}`, { cookie: admin, method: "PATCH", json: { active: false } });
    expect((await t.request("/v1/checkout", { cookie: off, json: { planId: SEED.plans.pro, interval: "monthly" } })).status).toBe(403);
    // admin: duplicate plan ids in the scope are a 400, updating to an unknown plan is a 400
    expect((await t.request("/v1/admin/coupons", { cookie: admin, json: { code: "DUPPLAN", discountType: "percent", discountValue: "5", planIds: [SEED.plans.pro, SEED.plans.pro, "pln_nope"] } })).status).toBe(400);
    const list = await json<{ items: Coupon[] }>(await t.request("/v1/admin/coupons", { cookie: admin }));
    const any = list.items[0]!;
    expect((await t.request(`/v1/admin/coupons/${any.id}`, { cookie: admin, method: "PUT", json: { code: any.code, discountType: "percent", discountValue: "5", planIds: ["pln_nope"] } })).status).toBe(400);
    // a retired plan: the pending order still settles with empty limits
    const o4 = await json<CheckoutOrder>(await t.request("/v1/checkout", { cookie: buyer, json: { planId: SEED.plans.basic, interval: "quarterly" } }));
    await t.request(`/v1/admin/plans/${SEED.plans.basic}`, { cookie: admin, method: "PATCH", json: { active: false } });
    const settled = await json<ConfirmResult>(await t.request("/v1/checkout/confirm", { cookie: buyer, json: { razorpay_order_id: o4.orderId, razorpay_payment_id: "pay_R1", razorpay_signature: t.razorpay.sign(o4.orderId, "pay_R1") } }));
    expect(settled.payment.status).toBe("paid");
    await t.request(`/v1/admin/plans/${SEED.plans.basic}`, { cookie: admin, method: "PATCH", json: { active: true } });
  });
});

describe("HC-AD-029..041, 115, 116 admin coupons", () => {
  it("creates with validation, refuses duplicates and unknown plans, replaces, switches, bulk-acts and deletes; RBAC", async () => {
    const list = await json<{ items: Coupon[] }>(await t.request("/v1/admin/coupons", { cookie: admin }));
    expect(list.items.map((c) => c.code).slice(-5)).toEqual(["FULL", "OLD", "VIP25", "PRO500", "BASIC20"]); // newest first; the edge-case suite added four more
    expect((await t.request("/v1/admin/coupons", { cookie: admin, json: { code: "BASIC20", discountType: "percent", discountValue: "5", planIds: [SEED.plans.basic] } })).status).toBe(409);
    expect((await t.request("/v1/admin/coupons", { cookie: admin, json: { code: "GHOST", discountType: "percent", discountValue: "5", planIds: ["pln_nope"] } })).status).toBe(400);
    expect((await t.request("/v1/admin/coupons", { cookie: admin, json: { code: "x", discountType: "percent", discountValue: "5", planIds: [SEED.plans.basic] } })).status).toBe(400);
    const old = list.items.find((c) => c.code === "OLD")!;
    const put = await json<Coupon>(await t.request(`/v1/admin/coupons/${old.id}`, { cookie: admin, method: "PUT", json: { code: "OLD", description: "revived", discountType: "fixed", discountValue: "100", planIds: [SEED.plans.pro], intervals: ["monthly"], endsAt: null } }));
    expect(put).toMatchObject({ description: "revived", discountType: "fixed", endsAt: null });
    expect((await t.request(`/v1/admin/coupons/${old.id}`, { cookie: admin, method: "PUT", json: { code: "BASIC20", discountType: "fixed", discountValue: "100", planIds: [SEED.plans.pro] } })).status).toBe(409);
    expect((await json<Coupon>(await t.request(`/v1/admin/coupons/${old.id}`, { cookie: admin, method: "PATCH", json: { active: false } }))).active).toBe(false);
    expect((await t.request("/v1/admin/coupons/cpn_nope", { cookie: admin, method: "PATCH", json: { active: false } })).status).toBe(404);
    expect((await t.request("/v1/admin/coupons/cpn_nope", { cookie: admin, method: "PUT", json: { code: "ZZZ", discountType: "fixed", discountValue: "1", planIds: [SEED.plans.pro] } })).status).toBe(404);
    const vip = list.items.find((c) => c.code === "VIP25")!;
    expect(await json<{ updated: number }>(await t.request("/v1/admin/coupons/bulk", { cookie: admin, json: { ids: [old.id, vip.id], action: "activate" } }))).toEqual({ updated: 2 });
    expect(await json<{ updated: number }>(await t.request("/v1/admin/coupons/bulk", { cookie: admin, json: { ids: [vip.id], action: "delete" } }))).toEqual({ updated: 1 });
    expect(await json<{ deleted: true }>(await t.request(`/v1/admin/coupons/${old.id}`, { cookie: admin, method: "DELETE" }))).toEqual({ deleted: true });
    expect((await t.request(`/v1/admin/coupons/${old.id}`, { cookie: admin, method: "DELETE" })).status).toBe(404);
    expect((await t.request("/v1/admin/coupons", { cookie: buyer })).status).toBe(403);
    expect((await json<{ items: Coupon[] }>(await t.request("/v1/admin/coupons", { cookie: admin }))).items).toHaveLength(list.items.length - 2);
  });
});
