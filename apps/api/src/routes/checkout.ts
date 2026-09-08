/**
 * Checkout, coupons for buyers, payments and invoices (Phase 4 item 2, ADR-034).
 *
 *   GET  /v1/coupons?planId&interval       coupons the buyer may use, each with a reason when it does not apply (HC-AC-020)
 *   POST /v1/coupons/quote                 breakdown with one coupon applied (HC-AC-017, 018, 021)
 *   POST /v1/checkout                      Razorpay order + pending payment (HC-AC-022); 503 without keys
 *   POST /v1/checkout/confirm              checkout.js handler payload → verify signature → settle (HC-AC-025)
 *   POST /v1/checkout/cancel               the buyer closed the checkout (HC-AC-026)
 *   POST /v1/billing/webhook               Razorpay webhook, raw body HMAC (ADR-034)
 *   GET  /v1/payments?status&page          payment history, 5 per page, with status counts (HC-AC-031, 035, 060)
 *   GET  /v1/payments/{id}/invoice         the tax invoice of a paid payment (HC-AC-062)
 */
import { AvailableCouponList, CancelBody, CheckoutBody, CheckoutOrder, ConfirmBody, ConfirmResult, CouponQuote, Id, Invoice, Payment, PaymentsPage, PaymentsQuery, BillingInterval } from "@hapiecoin/schema";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { auditFrom } from "../audit.js";
import { cancelCheckout, confirmCheckout, handleWebhook, invoiceFor, listPayments, priceFor, startCheckout } from "../checkout.js";
import { availableCoupons, resolveCoupon, toAvailable } from "../coupons.js";
import { plans, users } from "../db/schema.js";
import { type AppEnv, currentUser } from "../security/context.js";
import { errors } from "../security/errors.js";
import { requireUser } from "../security/guards.js";
import { type AppDeps, cookieAuth, errorResponses, jsonContent } from "./shared.js";

const IdParam = z.object({ id: Id });
const CouponsQuery = z.object({ planId: Id, interval: BillingInterval });

export function registerCheckoutRoutes(app: OpenAPIHono<AppEnv>, deps: AppDeps, now: () => Date = () => new Date()): void {
  const db = deps.db;
  const guard = requireUser(deps.sessions);

  app.openapi(
    createRoute({ method: "get", path: "/v1/coupons", tags: ["billing"], summary: "Coupons available to me for a plan and interval (HC-AC-020)", security: cookieAuth, middleware: [guard], request: { query: CouponsQuery }, responses: { 200: jsonContent(AvailableCouponList, "Coupons"), 401: errorResponses[401], 404: errorResponses[404] } }),
    async (c) => {
      const q = c.req.valid("query");
      const [plan] = await db.select().from(plans).where(eq(plans.id, q.planId)).limit(1);
      if (!plan || !plan.active) throw errors.notFound("Plan");
      return c.json(await availableCoupons(deps, currentUser(c).id, plan, q.interval, now()), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/coupons/quote",
      tags: ["billing"],
      summary: "Apply a coupon code to a plan and interval (HC-AC-017, 018, 021)",
      security: cookieAuth,
      middleware: [guard],
      request: { body: { content: { "application/json": { schema: z.object({ code: z.string().trim().min(1).max(24), planId: Id, interval: BillingInterval }) } }, required: true } },
      responses: { 200: jsonContent(CouponQuote, "Quote"), 400: errorResponses[400], 401: errorResponses[401], 404: errorResponses[404] },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const [plan] = await db.select().from(plans).where(eq(plans.id, body.planId)).limit(1);
      if (!plan || !plan.active) throw errors.notFound("Plan");
      const r = await resolveCoupon(deps, body.code, currentUser(c).id, plan, body.interval, now());
      if (r.reason) {
        const coupon = r.row ? toAvailable(r.row, r.reason) : { code: body.code.toUpperCase(), description: "", discountType: "percent" as const, discountValue: "0", minOrderInr: "0", endsAt: null, scope: "public" as const, reason: r.reason };
        return c.json({ coupon, breakdown: (await priceFor(deps, currentUser(c).id, plan.id, body.interval, undefined, now())).breakdown }, 200);
      }
      const { breakdown } = await priceFor(deps, currentUser(c).id, plan.id, body.interval, r.row.code, now());
      return c.json({ coupon: toAvailable(r.row, null), breakdown }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/checkout",
      tags: ["billing"],
      summary: "Create a Razorpay order for a plan (HC-AC-022)",
      security: cookieAuth,
      middleware: [guard],
      request: { body: { content: { "application/json": { schema: CheckoutBody } }, required: true } },
      responses: { 201: jsonContent(CheckoutOrder, "Order"), 400: errorResponses[400], 401: errorResponses[401], 403: errorResponses[403], 404: errorResponses[404], 409: errorResponses[409], 503: errorResponses[503] },
    }),
    async (c) => {
      const me = currentUser(c);
      const body = c.req.valid("json");
      const [u] = await db.select().from(users).where(eq(users.id, me.id)).limit(1);
      if (!u) throw errors.unauthenticated();
      if (!u.active) throw errors.forbidden("Your account has been deactivated. Contact support.");
      const order = await startCheckout(deps, u, body.planId, body.interval, body.couponCode, now());
      await auditFrom(c, db)({ action: "checkout.start", target: `user:${me.id}`, after: { paymentId: order.paymentId, orderId: order.orderId, planId: body.planId, interval: body.interval, couponCode: body.couponCode ?? null, total: order.breakdown.total } });
      return c.json(order, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/checkout/confirm",
      tags: ["billing"],
      summary: "Confirm a Razorpay payment from the checkout handler (HC-AC-025)",
      security: cookieAuth,
      middleware: [guard],
      request: { body: { content: { "application/json": { schema: ConfirmBody } }, required: true } },
      responses: { 200: jsonContent(ConfirmResult, "Settled"), 400: errorResponses[400], 401: errorResponses[401], 404: errorResponses[404], 503: errorResponses[503] },
    }),
    async (c) => {
      const me = currentUser(c);
      const body = c.req.valid("json");
      const r = await confirmCheckout(deps, me.id, body, now());
      await auditFrom(c, db)({ action: "checkout.confirm", target: `user:${me.id}`, after: { paymentId: r.payment.id, razorpayPaymentId: body.razorpay_payment_id, activated: r.activated, status: r.payment.status } });
      return c.json(r, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/checkout/cancel",
      tags: ["billing"],
      summary: "The buyer closed the checkout (HC-AC-026)",
      security: cookieAuth,
      middleware: [guard],
      request: { body: { content: { "application/json": { schema: CancelBody } }, required: true } },
      responses: { 200: jsonContent(Payment, "Payment"), 401: errorResponses[401], 404: errorResponses[404] },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const p = await cancelCheckout(deps, currentUser(c).id, body.orderId, body.reason, now());
      if (!p) throw errors.notFound("Payment");
      return c.json(p, 200);
    },
  );

  // Razorpay posts here with no session and no Origin; the signature over the raw body is the only credential.
  app.post("/v1/billing/webhook", async (c) => {
    const raw = await c.req.text();
    const r = await handleWebhook(deps, raw, c.req.header("x-razorpay-signature"), now());
    return c.json({ ok: true, ...r }, 200);
  });

  app.openapi(
    createRoute({ method: "get", path: "/v1/payments", tags: ["billing"], summary: "My payment history (HC-AC-031, 035, 060)", security: cookieAuth, middleware: [guard], request: { query: PaymentsQuery }, responses: { 200: jsonContent(PaymentsPage, "Payments"), 401: errorResponses[401] } }),
    async (c) => c.json(await listPayments(deps, currentUser(c).id, c.req.valid("query")), 200),
  );

  app.openapi(
    createRoute({ method: "get", path: "/v1/payments/{id}/invoice", tags: ["billing"], summary: "Tax invoice of a paid payment (HC-AC-062)", security: cookieAuth, middleware: [guard], request: { params: IdParam }, responses: { 200: jsonContent(Invoice, "Invoice"), 401: errorResponses[401], 404: errorResponses[404] } }),
    async (c) => {
      const inv = await invoiceFor(deps, currentUser(c).id, c.req.valid("param").id);
      if (!inv) throw errors.notFound("Invoice");
      return c.json(inv, 200);
    },
  );
}
