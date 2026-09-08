/** Plan banner state (HC-SH-014): free / active / expiring soon (≤ 7 days) / expired. */
import { PlanState } from "@hapiecoin/schema";
import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { desc, eq, sql } from "drizzle-orm";
import { subscriptions } from "../db/schema.js";
import { type AppEnv, currentUser } from "../security/context.js";
import { requireUser } from "../security/guards.js";
import { type AppDeps, cookieAuth, errorResponses, jsonContent } from "./shared.js";

export const EXPIRING_SOON_DAYS = 7;

export { PlanState };

type Row = typeof subscriptions.$inferSelect;

export function planState(row: Pick<Row, "status" | "planName" | "expiresAt"> | undefined, now: Date): PlanState {
  if (!row) return { state: "free" };
  if (row.status !== "active")
    return { state: "expired", planName: row.planName, expiresAt: row.expiresAt?.toISOString() ?? null };
  if (row.expiresAt === null) return { state: "active", planName: row.planName, expiresAt: null };
  const msLeft = row.expiresAt.getTime() - now.getTime();
  const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
  if (msLeft <= 0)
    return { state: "expired", planName: row.planName, expiresAt: row.expiresAt.toISOString(), daysLeft: 0 };
  return {
    state: daysLeft <= EXPIRING_SOON_DAYS ? "expiring_soon" : "active",
    planName: row.planName,
    expiresAt: row.expiresAt.toISOString(),
    daysLeft,
  };
}

export function registerPlanRoutes(
  app: OpenAPIHono<AppEnv>,
  deps: AppDeps,
  now: () => Date = () => new Date(),
): void {
  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/plan",
      tags: ["plan"],
      summary: "Plan banner state (HC-SH-014)",
      security: cookieAuth,
      middleware: [requireUser(deps.sessions)],
      responses: { 200: jsonContent(PlanState, "Plan"), 401: errorResponses[401] },
    }),
    async (c) => {
      const me = currentUser(c);
      const [row] = await deps.db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.userId, me.id))
        // GAPS #30: Postgres sorts NULL first in DESC, so a cancelled lifetime row used to shadow an active one.
        .orderBy(sql`case when ${subscriptions.status} = 'active' then 0 else 1 end`, sql`${subscriptions.expiresAt} desc nulls last`, desc(subscriptions.createdAt))
        .limit(1);
      return c.json(planState(row, now()), 200);
    },
  );
}
