/**
 * Plans, subscription view and admin masters (Phase 4 item 1, ADR-030).
 *
 *   GET   /v1/plans                       active plans for the comparison grid (HC-AC-011..015)
 *   GET   /v1/subscription                current plan, entitlements with usage, plans, menu items (HC-AC-003..010)
 *   POST  /v1/subscription/activate       ₹0 totals only (HC-AC-023); paid checkout arrives with Razorpay (item 2) → 402
 *   admin GET/POST/PATCH /v1/admin/plans, POST /v1/admin/plans/bulk                  (HC-AD-004..019, 110..112)
 *   admin GET/POST/PATCH /v1/admin/menu-items, POST /v1/admin/menu-items/bulk        (HC-AD-020..028, 113, 114)
 *   admin GET /v1/admin/users, PATCH /v1/admin/users/{id}, POST /v1/admin/users/bulk (HC-AD-042..051, 117)
 */
import { ActivateBody, AdminUserPatch, AdminUserRow, AdminUsersPage, BulkActiveBody, INTERVAL_MONTHS, Id, MenuItem, MenuItemInput, MenuItemList, Plan, PlanInput, PlanList, SubscriptionView, priceBreakdown } from "@hapiecoin/schema";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { auditFrom } from "../audit.js";
import { menuItems, plans, subscriptions, userSettings, users } from "../db/schema.js";
import { activeSubscription, entitlementsFor, toPlan } from "../entitlements.js";
import { type AppEnv, currentUser } from "../security/context.js";
import { errors } from "../security/errors.js";
import { requireAdmin, requireUser } from "../security/guards.js";
import { planState } from "./plan.js";
import { DEFAULT_SETTINGS } from "./settings.js";
import { type AppDeps, cookieAuth, errorResponses, jsonContent, newId } from "./shared.js";

const IdParam = z.object({ id: Id });
type MenuRow = typeof menuItems.$inferSelect;
type UserRow = typeof users.$inferSelect;

export function registerBillingRoutes(app: OpenAPIHono<AppEnv>, deps: AppDeps, now: () => Date = () => new Date()): void {
  const db = deps.db;
  const guard = requireUser(deps.sessions);
  const admin = requireAdmin(deps.sessions);

  const activePlans = () => db.select().from(plans).where(eq(plans.active, true)).orderBy(asc(plans.sortOrder), asc(plans.name));
  const linkedCounts = async (): Promise<Map<string, number>> => {
    const all = await db.select({ ids: plans.menuItemIds }).from(plans);
    const m = new Map<string, number>();
    for (const p of all) for (const id of p.ids) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  };
  const toMenuItem = (r: MenuRow, linked: Map<string, number>): MenuItem => ({ id: r.id, displayName: r.displayName, category: r.category, priceInr: r.priceInr, active: r.active, linkedPlans: linked.get(r.id) ?? 0, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() });

  async function subscriptionView(userId: string): Promise<SubscriptionView> {
    const at = now();
    const { effective, entitlements } = await entitlementsFor(deps, userId, at);
    const sub = effective.subscription;
    const [u] = await db.select({ active: users.active }).from(users).where(eq(users.id, userId)).limit(1);
    const menu = effective.plan && effective.plan.menuItemIds.length ? await db.select({ name: menuItems.displayName }).from(menuItems).where(and(inArray(menuItems.id, effective.plan.menuItemIds), eq(menuItems.active, true))).orderBy(asc(menuItems.displayName)) : [];
    return {
      plan: planState(sub, at),
      current: sub ? { id: sub.id, planId: sub.planId, planName: sub.planName, interval: sub.interval, status: sub.status, startsAt: sub.startsAt.toISOString(), expiresAt: sub.expiresAt?.toISOString() ?? null, priceInr: sub.priceInr, paidInr: sub.paidInr, currency: sub.currency } : null,
      effectivePlan: effective.plan ? toPlan(effective.plan) : null,
      entitlements,
      plans: (await activePlans()).map(toPlan),
      menuItems: menu.map((m) => m.name),
      accountActive: u?.active ?? true,
    };
  }

  app.openapi(
    createRoute({ method: "get", path: "/v1/plans", tags: ["billing"], summary: "Active plans (HC-AC-011)", security: cookieAuth, middleware: [guard], responses: { 200: jsonContent(PlanList, "Plans"), 401: errorResponses[401] } }),
    async (c) => c.json({ items: (await activePlans()).map(toPlan) }, 200),
  );

  app.openapi(
    createRoute({ method: "get", path: "/v1/subscription", tags: ["billing"], summary: "My Subscription view (HC-AC-003..010)", security: cookieAuth, middleware: [guard], responses: { 200: jsonContent(SubscriptionView, "Subscription"), 401: errorResponses[401] } }),
    async (c) => c.json(await subscriptionView(currentUser(c).id), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/subscription/activate",
      tags: ["billing"],
      summary: "Activate a ₹0 plan (HC-AC-023); paid plans answer 402 until Razorpay checkout (item 2)",
      security: cookieAuth,
      middleware: [guard],
      request: { body: { content: { "application/json": { schema: ActivateBody } }, required: true } },
      responses: { 200: jsonContent(SubscriptionView, "Activated"), 401: errorResponses[401], 402: errorResponses[402], 403: errorResponses[403], 404: errorResponses[404], 409: errorResponses[409] },
    }),
    async (c) => {
      const me = currentUser(c);
      const body = c.req.valid("json");
      const [u] = await db.select({ active: users.active }).from(users).where(eq(users.id, me.id)).limit(1);
      if (u && !u.active) throw errors.forbidden("Your account has been deactivated. Contact support.");
      const [plan] = await db.select().from(plans).where(and(eq(plans.id, body.planId), eq(plans.active, true))).limit(1);
      if (!plan) throw errors.notFound("Plan");
      const pricing = plan.intervals[body.interval];
      const total = priceBreakdown(pricing).total;
      if (total > 0) throw errors.paymentRequired(`${plan.name} · ${body.interval} costs ₹${total.toFixed(2)}; checkout arrives with Razorpay in the next release`);
      const at = now();
      const current = await activeSubscription(deps, me.id, at);
      if (current?.planId === plan.id && current.interval === body.interval) throw errors.conflict(`You are already on ${plan.name} · ${body.interval}`);
      await db.update(subscriptions).set({ status: "cancelled", updatedAt: at }).where(and(eq(subscriptions.userId, me.id), eq(subscriptions.status, "active")));
      const expiresAt = total === 0 && Number(pricing.priceInr) === 0 ? null : new Date(at.getTime() + INTERVAL_MONTHS[body.interval] * 30 * 86_400_000);
      await db.insert(subscriptions).values({ id: newId("sub"), userId: me.id, planName: plan.name, planId: plan.id, interval: body.interval, priceInr: pricing.priceInr, paidInr: "0", currency: "INR", status: "active", startsAt: at, expiresAt, featureLimits: pricing.limits });
      const view = await subscriptionView(me.id);
      await auditFrom(c, db)({ action: "subscription.activate", target: `user:${me.id}`, before: current ? { planName: current.planName, interval: current.interval } : null, after: { planName: plan.name, interval: body.interval, paidInr: "0" } });
      return c.json(view, 200);
    },
  );

  // ---------------------------------------------------------------- admin · plans
  app.openapi(
    createRoute({ method: "get", path: "/v1/admin/plans", tags: ["admin"], summary: "All plans (HC-AD-006)", security: cookieAuth, middleware: admin, responses: { 200: jsonContent(PlanList, "Plans"), 401: errorResponses[401], 403: errorResponses[403] } }),
    async (c) => c.json({ items: (await db.select().from(plans).orderBy(asc(plans.sortOrder), asc(plans.name))).map(toPlan) }, 200),
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/admin/plans",
      tags: ["admin"],
      summary: "Create a plan (HC-AD-010..019)",
      security: cookieAuth,
      middleware: admin,
      request: { body: { content: { "application/json": { schema: PlanInput } }, required: true } },
      responses: { 201: jsonContent(Plan, "Created"), 400: errorResponses[400], 401: errorResponses[401], 403: errorResponses[403], 409: errorResponses[409] },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const [dup] = await db.select({ id: plans.id }).from(plans).where(ilike(plans.name, body.name)).limit(1);
      if (dup) throw errors.conflict(`A plan named ${body.name} already exists`);
      const [row] = await db.insert(plans).values({ id: newId("pln"), ...body }).returning();
      if (!row) throw new Error("insert returned no row");
      await auditFrom(c, db)({ action: "admin.plan.create", target: `plan:${row.id}`, after: body });
      return c.json(toPlan(row), 201);
    },
  );
  app.openapi(
    createRoute({
      method: "patch",
      path: "/v1/admin/plans/{id}",
      tags: ["admin"],
      summary: "Update a plan (HC-AD-008)",
      security: cookieAuth,
      middleware: admin,
      request: { params: IdParam, body: { content: { "application/json": { schema: PlanInput } }, required: true } },
      responses: { 200: jsonContent(Plan, "Updated"), 400: errorResponses[400], 401: errorResponses[401], 403: errorResponses[403], 404: errorResponses[404], 409: errorResponses[409] },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const [before] = await db.select().from(plans).where(eq(plans.id, id)).limit(1);
      if (!before) throw errors.notFound("Plan");
      const [dup] = await db.select({ id: plans.id }).from(plans).where(and(ilike(plans.name, body.name), sql`${plans.id} <> ${id}`)).limit(1);
      if (dup) throw errors.conflict(`A plan named ${body.name} already exists`);
      const [row] = await db.update(plans).set({ ...body, updatedAt: now() }).where(eq(plans.id, id)).returning();
      if (!row) throw errors.notFound("Plan");
      await auditFrom(c, db)({ action: "admin.plan.update", target: `plan:${id}`, before: toPlan(before), after: toPlan(row) });
      return c.json(toPlan(row), 200);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/admin/plans/bulk",
      tags: ["admin"],
      summary: "Bulk activate / deactivate plans (HC-AD-111)",
      security: cookieAuth,
      middleware: admin,
      request: { body: { content: { "application/json": { schema: BulkActiveBody } }, required: true } },
      responses: { 200: jsonContent(PlanList, "Updated plans"), 401: errorResponses[401], 403: errorResponses[403] },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const rows = await db.update(plans).set({ active: body.active, updatedAt: now() }).where(inArray(plans.id, body.ids)).returning();
      await auditFrom(c, db)({ action: "admin.plan.bulk", target: "plans", after: { ids: rows.map((r) => r.id), active: body.active } });
      return c.json({ items: rows.map(toPlan) }, 200);
    },
  );

  // ---------------------------------------------------------------- admin · menu items
  app.openapi(
    createRoute({ method: "get", path: "/v1/admin/menu-items", tags: ["admin"], summary: "Menu pricing master (HC-AD-022)", security: cookieAuth, middleware: admin, responses: { 200: jsonContent(MenuItemList, "Menu items"), 401: errorResponses[401], 403: errorResponses[403] } }),
    async (c) => {
      const linked = await linkedCounts();
      const rows = await db.select().from(menuItems).orderBy(asc(menuItems.category), asc(menuItems.displayName));
      return c.json({ items: rows.map((r) => toMenuItem(r, linked)) }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/admin/menu-items",
      tags: ["admin"],
      summary: "Create a menu item (HC-AD-026..028)",
      security: cookieAuth,
      middleware: admin,
      request: { body: { content: { "application/json": { schema: MenuItemInput } }, required: true } },
      responses: { 201: jsonContent(MenuItem, "Created"), 400: errorResponses[400], 401: errorResponses[401], 403: errorResponses[403] },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const [row] = await db.insert(menuItems).values({ id: newId("mnu"), ...body }).returning();
      if (!row) throw new Error("insert returned no row");
      await auditFrom(c, db)({ action: "admin.menu_item.create", target: `menu_item:${row.id}`, after: body });
      return c.json(toMenuItem(row, new Map()), 201);
    },
  );
  app.openapi(
    createRoute({
      method: "patch",
      path: "/v1/admin/menu-items/{id}",
      tags: ["admin"],
      summary: "Update a menu item (HC-AD-024)",
      security: cookieAuth,
      middleware: admin,
      request: { params: IdParam, body: { content: { "application/json": { schema: MenuItemInput } }, required: true } },
      responses: { 200: jsonContent(MenuItem, "Updated"), 400: errorResponses[400], 401: errorResponses[401], 403: errorResponses[403], 404: errorResponses[404] },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const [row] = await db.update(menuItems).set({ ...body, updatedAt: now() }).where(eq(menuItems.id, id)).returning();
      if (!row) throw errors.notFound("Menu item");
      await auditFrom(c, db)({ action: "admin.menu_item.update", target: `menu_item:${id}`, after: body });
      return c.json(toMenuItem(row, await linkedCounts()), 200);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/admin/menu-items/bulk",
      tags: ["admin"],
      summary: "Bulk activate / deactivate menu items (HC-AD-114)",
      security: cookieAuth,
      middleware: admin,
      request: { body: { content: { "application/json": { schema: BulkActiveBody } }, required: true } },
      responses: { 200: jsonContent(MenuItemList, "Updated items"), 401: errorResponses[401], 403: errorResponses[403] },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const rows = await db.update(menuItems).set({ active: body.active, updatedAt: now() }).where(inArray(menuItems.id, body.ids)).returning();
      await auditFrom(c, db)({ action: "admin.menu_item.bulk", target: "menu_items", after: { ids: rows.map((r) => r.id), active: body.active } });
      const linked = await linkedCounts();
      return c.json({ items: rows.map((r) => toMenuItem(r, linked)) }, 200);
    },
  );

  // ---------------------------------------------------------------- admin · user subscriptions
  async function adminRow(u: UserRow, at: Date): Promise<AdminUserRow> {
    const sub = await activeSubscription(deps, u.id, at);
    const [ref] = await db.select({ n: sql<number>`count(*)` }).from(users).where(eq(users.referredBy, u.referralCode));
    const [settings] = await db.select({ lotSizes: userSettings.lotSizes }).from(userSettings).where(eq(userSettings.userId, u.id)).limit(1);
    const validityDays = sub && sub.expiresAt ? Math.max(1, Math.round((sub.expiresAt.getTime() - sub.startsAt.getTime()) / 86_400_000)) : null;
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      active: u.active,
      planName: sub?.planName ?? null,
      planId: sub?.planId ?? null,
      interval: sub?.interval ?? null,
      startsAt: sub?.startsAt.toISOString() ?? null,
      expiresAt: sub?.expiresAt?.toISOString() ?? null,
      validityDays,
      referrals: Number(ref?.n ?? 0),
      commissionPct: u.commissionPct,
      limitOverrides: u.limitOverrides,
      lotSizes: settings ? settings.lotSizes : null,
      createdAt: u.createdAt.toISOString(),
    };
  }
  const UsersQuery = z.object({ q: z.string().trim().max(80).optional(), status: z.enum(["all", "active", "expired", "free", "deactivated"]).default("all"), page: z.coerce.number().int().min(1).default(1) });
  const PAGE_SIZE = 10;

  app.openapi(
    createRoute({ method: "get", path: "/v1/admin/users", tags: ["admin"], summary: "User subscriptions (HC-AD-043..051)", security: cookieAuth, middleware: admin, request: { query: UsersQuery }, responses: { 200: jsonContent(AdminUsersPage, "Users"), 401: errorResponses[401], 403: errorResponses[403] } }),
    async (c) => {
      const q = c.req.valid("query");
      const at = now();
      const where = q.q ? or(ilike(users.email, `%${q.q}%`), ilike(users.name, `%${q.q}%`)) : undefined;
      const all = await db.select().from(users).where(where).orderBy(desc(users.createdAt), asc(users.id));
      const rows: AdminUserRow[] = [];
      for (const u of all) rows.push(await adminRow(u, at));
      const filtered = rows.filter((r) => {
        if (q.status === "all") return true;
        if (q.status === "deactivated") return !r.active;
        if (q.status === "free") return r.planName === null;
        if (q.status === "active") return r.planName !== null && (r.expiresAt === null || new Date(r.expiresAt).getTime() > at.getTime());
        return r.planName !== null && r.expiresAt !== null && new Date(r.expiresAt).getTime() <= at.getTime();
      });
      const start = (q.page - 1) * PAGE_SIZE;
      return c.json({ items: filtered.slice(start, start + PAGE_SIZE), total: filtered.length, page: q.page, pageSize: PAGE_SIZE }, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "patch",
      path: "/v1/admin/users/{id}",
      tags: ["admin"],
      summary: "Validity, account toggle, limit overrides, lot sizes (HC-AD-046..049)",
      security: cookieAuth,
      middleware: admin,
      request: { params: IdParam, body: { content: { "application/json": { schema: AdminUserPatch } }, required: true } },
      responses: { 200: jsonContent(AdminUserRow, "Updated"), 400: errorResponses[400], 401: errorResponses[401], 403: errorResponses[403], 404: errorResponses[404], 409: errorResponses[409] },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const at = now();
      const [u] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      if (!u) throw errors.notFound("User");
      const before = await adminRow(u, at);
      if (body.validityDays !== undefined) {
        const sub = await activeSubscription(deps, id, at);
        if (!sub) throw errors.conflict("This user has no active subscription to extend");
        await db.update(subscriptions).set({ expiresAt: new Date(sub.startsAt.getTime() + body.validityDays * 86_400_000), updatedAt: at }).where(eq(subscriptions.id, sub.id));
      }
      const patch: Partial<typeof users.$inferInsert> = {};
      if (body.active !== undefined) patch.active = body.active;
      if (body.commissionPct !== undefined) patch.commissionPct = body.commissionPct;
      if (body.limitOverrides !== undefined) patch.limitOverrides = body.limitOverrides;
      if (Object.keys(patch).length) await db.update(users).set({ ...patch, updatedAt: at }).where(eq(users.id, id));
      if (body.lotSizes !== undefined) {
        const [row] = await db.select({ lotSizes: userSettings.lotSizes }).from(userSettings).where(eq(userSettings.userId, id)).limit(1);
        const lotSizes = { ...DEFAULT_SETTINGS.lotSizes, ...(row?.lotSizes ?? {}), ...body.lotSizes };
        await db.insert(userSettings).values({ userId: id, lotSizes, updatedAt: at }).onConflictDoUpdate({ target: userSettings.userId, set: { lotSizes, updatedAt: at } });
      }
      const [fresh] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      const after = await adminRow(fresh ?? u, at);
      await auditFrom(c, db)({ action: "admin.user.update", target: `user:${id}`, before, after: { ...after, patch: body } });
      return c.json(after, 200);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/admin/users/bulk",
      tags: ["admin"],
      summary: "Bulk activate / deactivate accounts (HC-AD-117)",
      security: cookieAuth,
      middleware: admin,
      request: { body: { content: { "application/json": { schema: BulkActiveBody } }, required: true } },
      responses: { 200: jsonContent(z.object({ updated: z.number().int() }), "Count"), 401: errorResponses[401], 403: errorResponses[403] },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const me = currentUser(c);
      const ids = body.ids.filter((id) => id !== me.id); // an admin never switches off their own session's account in bulk
      const rows = ids.length ? await db.update(users).set({ active: body.active, updatedAt: now() }).where(inArray(users.id, ids)).returning({ id: users.id }) : [];
      await auditFrom(c, db)({ action: "admin.user.bulk", target: "users", after: { ids: rows.map((r) => r.id), active: body.active } });
      return c.json({ updated: rows.length }, 200);
    },
  );
}
