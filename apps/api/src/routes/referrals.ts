/**
 * Referrals (Phase 4 item 3, ADR-031).
 *   GET  /v1/referrals                              the trader's link, code, stats, rows, chart (HC-AC-037..055)
 *   GET  /v1/admin/commissions?q=&month=             tiles, rows per referrer, chart, months (HC-AD-052..055, 118)
 *   GET  /v1/admin/commissions/{id}                  one referrer's referrals (HC-AD-056)
 *   POST /v1/admin/commissions/{id}/mark             Paid / Not Paid with reason and proof (HC-AD-057)
 *   POST /v1/admin/commissions/bulk-pay              settle every pending row, or the ticked referrers (HC-AD-058, 119)
 */
import { AdminCommissionDetail, AdminCommissionsView, BulkPayBody, BulkPayResult, Id, MarkPaymentBody, ReferralsView } from "@hapiecoin/schema";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { auditFrom } from "../audit.js";
import { adminCommissionDetail, adminCommissions, bulkPay, markPayment, referralsView } from "../referrals.js";
import { type AppEnv, currentUser } from "../security/context.js";
import { errors } from "../security/errors.js";
import { requireAdmin, requireUser } from "../security/guards.js";
import { type AppDeps, cookieAuth, errorResponses, jsonContent } from "./shared.js";

const IdParam = z.object({ id: Id });
const MarkResult = z.object({ rows: z.number().int(), amountInr: z.string() });

export function registerReferralRoutes(app: OpenAPIHono<AppEnv>, deps: AppDeps, now: () => Date = () => new Date()): void {
  const guard = requireUser(deps.sessions);
  const admin = requireAdmin(deps.sessions);

  app.openapi(
    createRoute({ method: "get", path: "/v1/referrals", tags: ["referrals"], summary: "My Referrals (HC-AC-037..055)", security: cookieAuth, middleware: [guard], responses: { 200: jsonContent(ReferralsView, "Referrals"), 401: errorResponses[401] } }),
    async (c) => c.json(await referralsView(deps, currentUser(c).id), 200),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/admin/commissions",
      tags: ["admin"],
      summary: "Commissions per referrer (HC-AD-052..055)",
      security: cookieAuth,
      middleware: admin,
      request: { query: z.object({ q: z.string().trim().max(80).default(""), month: z.string().regex(/^\d{4}-\d{2}$/).optional() }) },
      responses: { 200: jsonContent(AdminCommissionsView, "Commissions"), 401: errorResponses[401], 403: errorResponses[403] },
    }),
    async (c) => {
      const q = c.req.valid("query");
      return c.json(await adminCommissions(deps, q.q, q.month ?? null), 200);
    },
  );

  app.openapi(
    createRoute({ method: "get", path: "/v1/admin/commissions/{id}", tags: ["admin"], summary: "A referrer's referrals (HC-AD-056)", security: cookieAuth, middleware: admin, request: { params: IdParam }, responses: { 200: jsonContent(AdminCommissionDetail, "Detail"), 401: errorResponses[401], 403: errorResponses[403], 404: errorResponses[404] } }),
    async (c) => {
      const d = await adminCommissionDetail(deps, c.req.valid("param").id);
      if (!d) throw errors.notFound("Referrer");
      return c.json(d, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/admin/commissions/{id}/mark",
      tags: ["admin"],
      summary: "Mark a referrer's pending commissions Paid or Not Paid (HC-AD-057)",
      security: cookieAuth,
      middleware: admin,
      request: { params: IdParam, body: { content: { "application/json": { schema: MarkPaymentBody } }, required: true } },
      responses: { 200: jsonContent(MarkResult, "Marked"), 400: errorResponses[400], 401: errorResponses[401], 403: errorResponses[403], 404: errorResponses[404], 409: errorResponses[409] },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      if (!(await adminCommissionDetail(deps, id))) throw errors.notFound("Referrer");
      const r = await markPayment(deps, id, body.status, body.note, body.proofUrl, now());
      if (r.rows === 0) throw errors.conflict("Nothing is pending for this referrer");
      await auditFrom(c, deps.db)({ action: "admin.commission.mark", target: `user:${id}`, after: { ...r, status: body.status, note: body.note ?? null, proofUrl: body.proofUrl ?? null } });
      return c.json(r, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/admin/commissions/bulk-pay",
      tags: ["admin"],
      summary: "Settle every pending commission, or the ticked referrers (HC-AD-058, HC-AD-119)",
      security: cookieAuth,
      middleware: admin,
      request: { body: { content: { "application/json": { schema: BulkPayBody } }, required: true } },
      responses: { 200: jsonContent(BulkPayResult, "Settled"), 401: errorResponses[401], 403: errorResponses[403] },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const r = await bulkPay(deps, body.referrerIds, now());
      await auditFrom(c, deps.db)({ action: "admin.commission.bulk_pay", target: "commissions", after: { ...r, referrerIds: body.referrerIds ?? "all" } });
      return c.json(r, 200);
    },
  );
}
