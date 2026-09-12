/**
 * Public trader page (ADR-075; HC-SH-127, HC-PB-066): the trader's own settings (handle, on/off, what to show) behind
 * the session, and the page itself at /v1/public/traders/{handle} for anyone, cached a minute, answering 404 alike
 * for an unknown handle and a page that is off. The public shape is the schema's projection: never account ids,
 * balances, positions, products or the Journal comparison.
 */
import { DEFAULT_PUBLIC_PAGE, Handle, PublicPageSettings, PublicTraderPage, publicTraderFrom } from "@hapiecoin/schema";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { and, eq, ne } from "drizzle-orm";
import { auditFrom } from "../audit.js";
import { traderPages, users } from "../db/schema.js";
import { type AppEnv, currentUser } from "../security/context.js";
import { errors } from "../security/errors.js";
import { requireUser } from "../security/guards.js";
import { computeVerified } from "../verified.js";
import { type AppDeps, cookieAuth, errorResponses, jsonContent } from "./shared.js";

type Row = typeof traderPages.$inferSelect;

/** Postgres (and PGlite) unique_violation, wrapped or not: the handle's unique index fired between the pre-check and the write. */
export function isUniqueViolation(e: unknown): boolean {
  for (let cur: unknown = e, depth = 0; cur && typeof cur === "object" && depth < 4; cur = (cur as { cause?: unknown }).cause, depth += 1) {
    if ((cur as { code?: unknown }).code === "23505") return true;
  }
  return false;
}
const toSettings = (row: Row): PublicPageSettings => ({ handle: row.handle, enabled: row.enabled, showDays: row.showDays, showAccounts: row.showAccounts, showMonths: row.showMonths });

const HandleParam = z.object({ handle: z.string().min(1).max(64) });

export function registerPublicPageRoutes(app: OpenAPIHono<AppEnv>, deps: AppDeps): void {
  const guard = requireUser(deps.sessions);

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/public-page",
      tags: ["public-page"],
      summary: "The caller's public page settings; off with no handle until saved (HC-SH-127)",
      security: cookieAuth,
      middleware: [guard],
      responses: { 200: jsonContent(PublicPageSettings, "Public page settings"), 401: errorResponses[401] },
    }),
    async (c) => {
      const me = currentUser(c);
      const [row] = await deps.db.select().from(traderPages).where(eq(traderPages.userId, me.id)).limit(1);
      return c.json(row ? toSettings(row) : DEFAULT_PUBLIC_PAGE, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/v1/public-page",
      tags: ["public-page"],
      summary: "Replace the public page settings: a handle must be chosen before the page is on, and taken handles are refused (HC-SH-127)",
      security: cookieAuth,
      middleware: [guard],
      request: { body: { content: { "application/json": { schema: PublicPageSettings } }, required: true } },
      responses: {
        200: jsonContent(PublicPageSettings, "Saved settings"),
        400: errorResponses[400],
        401: errorResponses[401],
        409: errorResponses[409],
      },
    }),
    async (c) => {
      const me = currentUser(c);
      const next = c.req.valid("json");
      if (next.enabled && next.handle === null) throw errors.badRequest("Choose a handle before turning the page on");
      if (next.handle !== null) {
        const [taken] = await deps.db
          .select({ userId: traderPages.userId })
          .from(traderPages)
          .where(and(eq(traderPages.handle, next.handle), ne(traderPages.userId, me.id)))
          .limit(1);
        if (taken) throw errors.conflict("That handle is taken");
      }
      const [before] = await deps.db.select().from(traderPages).where(eq(traderPages.userId, me.id)).limit(1);
      const updatedAt = new Date();
      let row: Row | undefined;
      try {
        [row] = await deps.db
          .insert(traderPages)
          .values({ userId: me.id, ...next, updatedAt })
          .onConflictDoUpdate({ target: traderPages.userId, set: { ...next, updatedAt } })
          .returning();
      } catch (e) {
        if (isUniqueViolation(e)) throw errors.conflict("That handle is taken"); // claimed between the check and the write
        throw e;
      }
      const saved = row ? toSettings(row) : next;
      await auditFrom(c, deps.db)({ action: "public_page.update", target: `user:${me.id}`, before: before ? toSettings(before) : DEFAULT_PUBLIC_PAGE, after: saved });
      return c.json(saved, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/public/traders/{handle}",
      tags: ["public-page"],
      summary: "A trader's public verified P&L page; 404 when the handle is unknown or the page is off (HC-PB-066)",
      request: { params: HandleParam },
      responses: { 200: jsonContent(PublicTraderPage, "The public page"), 404: errorResponses[404] },
    }),
    async (c) => {
      const parsed = Handle.safeParse(c.req.valid("param").handle);
      if (!parsed.success) throw errors.notFound("Trader");
      const [row] = await deps.db
        .select({ page: traderPages, name: users.name })
        .from(traderPages)
        .innerJoin(users, eq(users.id, traderPages.userId))
        .where(and(eq(traderPages.handle, parsed.data), eq(traderPages.enabled, true)))
        .limit(1);
      if (!row) throw errors.notFound("Trader");
      const verified = await computeVerified(deps, row.page.userId);
      c.header("Cache-Control", "public, max-age=60");
      return c.json(publicTraderFrom(verified, toSettings(row.page), row.name), 200);
    },
  );
}
