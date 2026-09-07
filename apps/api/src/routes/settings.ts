/** Per-user preferences (HC-SH-038..044): currency + conversion rate, P&L basis, lot sizes, theme, density. */
import { UNDERLYINGS, type Underlying, UserSettings } from "@hapiecoin/schema";
import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { auditFrom } from "../audit.js";
import { userSettings } from "../db/schema.js";
import { type AppEnv, currentUser } from "../security/context.js";
import { requireUser } from "../security/guards.js";
import { type AppDeps, cookieAuth, errorResponses, jsonContent } from "./shared.js";

/** Defaults shown before a user ever saves (HC-SH-038: rate 83.5; lot sizes BTC 0.001, ETH 0.01, XAUT 0.001). */
export const DEFAULT_SETTINGS: UserSettings = {
  currency: "USD",
  conversionRate: "83.5",
  pnlBasis: "mark",
  lotSizes: { BTC: "0.001", ETH: "0.01", XAUT: "0.001" },
  theme: "dark",
  density: "comfortable",
};

type Row = typeof userSettings.$inferSelect;

/** Rows are trusted, but a lot size for a newly added underlying falls back to the default so the shape stays complete. */
export function toSettings(row: Row): UserSettings {
  const lotSizes = {} as Record<Underlying, string>;
  for (const u of UNDERLYINGS) lotSizes[u] = row.lotSizes[u] ?? DEFAULT_SETTINGS.lotSizes[u];
  return {
    currency: row.currency,
    conversionRate: row.conversionRate,
    pnlBasis: row.pnlBasis,
    lotSizes,
    theme: row.theme,
    density: row.density,
  };
}

export function registerSettingsRoutes(app: OpenAPIHono<AppEnv>, deps: AppDeps): void {
  const guard = requireUser(deps.sessions);

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/settings",
      tags: ["settings"],
      summary: "Current preferences, defaults when never saved (HC-SH-038, HC-SH-041, HC-SH-043)",
      security: cookieAuth,
      middleware: [guard],
      responses: { 200: jsonContent(UserSettings, "Settings"), 401: errorResponses[401] },
    }),
    async (c) => {
      const me = currentUser(c);
      const [row] = await deps.db.select().from(userSettings).where(eq(userSettings.userId, me.id)).limit(1);
      return c.json(row ? toSettings(row) : DEFAULT_SETTINGS, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/v1/settings",
      tags: ["settings"],
      summary: "Replace preferences (HC-SH-040, HC-SH-042, HC-SH-044)",
      security: cookieAuth,
      middleware: [guard],
      request: { body: { content: { "application/json": { schema: UserSettings } }, required: true } },
      responses: {
        200: jsonContent(UserSettings, "Saved settings"),
        400: errorResponses[400],
        401: errorResponses[401],
      },
    }),
    async (c) => {
      const me = currentUser(c);
      const next = c.req.valid("json");
      const [before] = await deps.db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, me.id))
        .limit(1);
      const values = { userId: me.id, ...next, updatedAt: new Date() };
      const [row] = await deps.db
        .insert(userSettings)
        .values(values)
        .onConflictDoUpdate({ target: userSettings.userId, set: { ...next, updatedAt: values.updatedAt } })
        .returning();
      const saved = row ? toSettings(row) : next;
      await auditFrom(
        c,
        deps.db,
      )({
        action: "settings.update",
        target: `user:${me.id}`,
        before: before ? toSettings(before) : DEFAULT_SETTINGS,
        after: saved,
      });
      return c.json(saved, 200);
    },
  );
}
