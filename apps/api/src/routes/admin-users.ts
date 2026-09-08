/**
 * Admin · User Management (Phase 4 item 4a, ADR-032; docs/design/admin.md).
 *
 *   GET  /v1/admin/users/{id}        drawer detail: row, subscriptions, plan defaults, referrals, audit history (HC-AD-101..107)
 *   POST /v1/admin/users/{id}/plan   comped plan change (HC-AD-104)
 *   POST /v1/admin/users/bulk-plan   comped plan change for many (HC-AD-100)
 *   POST /v1/admin/users/invite      create a user and email a sign-in invitation (HC-AD-108)
 *
 * The list, PATCH and bulk activate routes stay in billing.ts (they arrived with item 1) and share admin-users.ts.
 */
import { AdminUserDetail, AdminUserRow, BulkPlanBody, BulkPlanResult, Id, InviteUserBody, SetPlanBody } from "@hapiecoin/schema";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { eq, inArray } from "drizzle-orm";
import { adminRow, inviteUser, setPlan, userDetail } from "../admin-users.js";
import { auditFrom } from "../audit.js";
import { plans, users } from "../db/schema.js";
import { type AppEnv, currentUser } from "../security/context.js";
import { errors } from "../security/errors.js";
import { requireAdmin } from "../security/guards.js";
import { type AppDeps, cookieAuth, errorResponses, jsonContent } from "./shared.js";

const IdParam = z.object({ id: Id });

export function registerAdminUserRoutes(app: OpenAPIHono<AppEnv>, deps: AppDeps, now: () => Date = () => new Date()): void {
  const db = deps.db;
  const admin = requireAdmin(deps.sessions);

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/admin/users/{id}",
      tags: ["admin"],
      summary: "User detail for the admin drawer (HC-AD-101..107)",
      security: cookieAuth,
      middleware: admin,
      request: { params: IdParam },
      responses: { 200: jsonContent(AdminUserDetail, "Detail"), 401: errorResponses[401], 403: errorResponses[403], 404: errorResponses[404] },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const detail = await userDetail(deps, id, now());
      if (!detail) throw errors.notFound("User");
      return c.json(detail, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/admin/users/{id}/plan",
      tags: ["admin"],
      summary: "Put a user on a plan without payment (HC-AD-104)",
      security: cookieAuth,
      middleware: admin,
      request: { params: IdParam, body: { content: { "application/json": { schema: SetPlanBody } }, required: true } },
      responses: { 200: jsonContent(AdminUserRow, "Updated row"), 400: errorResponses[400], 401: errorResponses[401], 403: errorResponses[403], 404: errorResponses[404] },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const at = now();
      const [u] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      if (!u) throw errors.notFound("User");
      const before = await adminRow(deps, u, at);
      const r = await setPlan(deps, id, body.planId, body.interval, at);
      const after = await adminRow(deps, u, at);
      await auditFrom(c, db)({ action: "admin.user.set_plan", target: `user:${id}`, before: { planName: before.planName, interval: before.interval }, after: { planName: r.planName, interval: body.interval, paidInr: "0", subscriptionId: r.subscriptionId } });
      return c.json(after, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/admin/users/bulk-plan",
      tags: ["admin"],
      summary: "Put many users on a plan without payment (HC-AD-100)",
      security: cookieAuth,
      middleware: admin,
      request: { body: { content: { "application/json": { schema: BulkPlanBody } }, required: true } },
      responses: { 200: jsonContent(BulkPlanResult, "Count"), 400: errorResponses[400], 401: errorResponses[401], 403: errorResponses[403], 404: errorResponses[404] },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const at = now();
      const [plan] = await db.select({ name: plans.name, active: plans.active }).from(plans).where(eq(plans.id, body.planId)).limit(1);
      if (!plan || !plan.active) throw errors.notFound("Plan");
      const rows = await db.select({ id: users.id }).from(users).where(inArray(users.id, body.ids));
      for (const r of rows) await setPlan(deps, r.id, body.planId, body.interval, at);
      const planName = rows.length ? plan.name : "";
      await auditFrom(c, db)({ action: "admin.user.bulk_plan", target: "users", after: { ids: rows.map((r) => r.id), planId: body.planId, interval: body.interval, paidInr: "0" } });
      return c.json({ updated: rows.length, planName }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/admin/users/invite",
      tags: ["admin"],
      summary: "Create a user and email a sign-in invitation (HC-AD-108)",
      security: cookieAuth,
      middleware: admin,
      request: { body: { content: { "application/json": { schema: InviteUserBody } }, required: true } },
      responses: { 201: jsonContent(AdminUserRow, "Invited"), 400: errorResponses[400], 401: errorResponses[401], 403: errorResponses[403], 404: errorResponses[404], 409: errorResponses[409] },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const me = currentUser(c);
      const at = now();
      const row = await inviteUser(deps, body, me.name, at);
      await auditFrom(c, db)({ action: "admin.user.invite", target: `user:${row.id}`, after: { email: row.email, name: row.name, planId: body.planId ?? null, interval: body.interval ?? null } });
      return c.json(await adminRow(deps, row, at), 201);
    },
  );
}
