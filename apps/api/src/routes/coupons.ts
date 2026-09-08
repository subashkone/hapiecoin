/**
 * Admin · Coupon Code Master (Phase 4 item 2, ADR-034; HC-AD-029..041, 115, 116).
 *
 *   GET    /v1/admin/coupons          every coupon, newest first
 *   POST   /v1/admin/coupons          create (409 on a duplicate code)
 *   PUT    /v1/admin/coupons/{id}     replace every field (the dialog always submits the whole form)
 *   PATCH  /v1/admin/coupons/{id}     { active } switch
 *   DELETE /v1/admin/coupons/{id}
 *   POST   /v1/admin/coupons/bulk     activate / deactivate / delete many
 */
import { Coupon, CouponBulkBody, CouponInput, CouponList, Id } from "@hapiecoin/schema";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { auditFrom } from "../audit.js";
import { bulkCoupons, createCoupon, deleteCoupon, listCoupons, setCouponActive, updateCoupon } from "../coupons.js";
import type { AppEnv } from "../security/context.js";
import { errors } from "../security/errors.js";
import { requireAdmin } from "../security/guards.js";
import { type AppDeps, cookieAuth, errorResponses, jsonContent } from "./shared.js";

const IdParam = z.object({ id: Id });

export function registerCouponRoutes(app: OpenAPIHono<AppEnv>, deps: AppDeps, now: () => Date = () => new Date()): void {
  const db = deps.db;
  const admin = requireAdmin(deps.sessions);

  app.openapi(
    createRoute({ method: "get", path: "/v1/admin/coupons", tags: ["admin"], summary: "Every coupon (HC-AD-030)", security: cookieAuth, middleware: admin, responses: { 200: jsonContent(CouponList, "Coupons"), 401: errorResponses[401], 403: errorResponses[403] } }),
    async (c) => c.json({ items: await listCoupons(deps) }, 200),
  );

  app.openapi(
    createRoute({ method: "post", path: "/v1/admin/coupons", tags: ["admin"], summary: "Create a coupon (HC-AD-035..041)", security: cookieAuth, middleware: admin, request: { body: { content: { "application/json": { schema: CouponInput } }, required: true } }, responses: { 201: jsonContent(Coupon, "Created"), 400: errorResponses[400], 401: errorResponses[401], 403: errorResponses[403], 409: errorResponses[409] } }),
    async (c) => {
      const body = c.req.valid("json");
      const coupon = await createCoupon(deps, body, now());
      await auditFrom(c, db)({ action: "admin.coupon.create", target: `coupon:${coupon.id}`, after: body });
      return c.json(coupon, 201);
    },
  );

  app.openapi(
    createRoute({ method: "put", path: "/v1/admin/coupons/{id}", tags: ["admin"], summary: "Replace a coupon (HC-AD-032)", security: cookieAuth, middleware: admin, request: { params: IdParam, body: { content: { "application/json": { schema: CouponInput } }, required: true } }, responses: { 200: jsonContent(Coupon, "Updated"), 400: errorResponses[400], 401: errorResponses[401], 403: errorResponses[403], 404: errorResponses[404], 409: errorResponses[409] } }),
    async (c) => {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const coupon = await updateCoupon(deps, id, body, now());
      if (!coupon) throw errors.notFound("Coupon");
      await auditFrom(c, db)({ action: "admin.coupon.update", target: `coupon:${id}`, after: body });
      return c.json(coupon, 200);
    },
  );

  app.openapi(
    createRoute({ method: "patch", path: "/v1/admin/coupons/{id}", tags: ["admin"], summary: "Switch a coupon on or off (HC-AD-031)", security: cookieAuth, middleware: admin, request: { params: IdParam, body: { content: { "application/json": { schema: z.strictObject({ active: z.boolean() }) } }, required: true } }, responses: { 200: jsonContent(Coupon, "Updated"), 401: errorResponses[401], 403: errorResponses[403], 404: errorResponses[404] } }),
    async (c) => {
      const { id } = c.req.valid("param");
      const coupon = await setCouponActive(deps, id, c.req.valid("json").active, now());
      if (!coupon) throw errors.notFound("Coupon");
      await auditFrom(c, db)({ action: "admin.coupon.update", target: `coupon:${id}`, after: { active: coupon.active } });
      return c.json(coupon, 200);
    },
  );

  app.openapi(
    createRoute({ method: "delete", path: "/v1/admin/coupons/{id}", tags: ["admin"], summary: "Delete a coupon (HC-AD-033)", security: cookieAuth, middleware: admin, request: { params: IdParam }, responses: { 200: jsonContent(z.object({ deleted: z.literal(true) }), "Deleted"), 401: errorResponses[401], 403: errorResponses[403], 404: errorResponses[404] } }),
    async (c) => {
      const { id } = c.req.valid("param");
      if (!(await deleteCoupon(deps, id))) throw errors.notFound("Coupon");
      await auditFrom(c, db)({ action: "admin.coupon.delete", target: `coupon:${id}` });
      return c.json({ deleted: true as const }, 200);
    },
  );

  app.openapi(
    createRoute({ method: "post", path: "/v1/admin/coupons/bulk", tags: ["admin"], summary: "Bulk activate / deactivate / delete (HC-AD-116)", security: cookieAuth, middleware: admin, request: { body: { content: { "application/json": { schema: CouponBulkBody } }, required: true } }, responses: { 200: jsonContent(z.object({ updated: z.number().int() }), "Count"), 401: errorResponses[401], 403: errorResponses[403] } }),
    async (c) => {
      const body = c.req.valid("json");
      const updated = await bulkCoupons(deps, body, now());
      await auditFrom(c, db)({ action: "admin.coupon.bulk", target: "coupons", after: { ids: body.ids, action: body.action, updated } });
      return c.json({ updated }, 200);
    },
  );
}
