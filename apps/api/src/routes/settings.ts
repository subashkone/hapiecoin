/** Per-user preferences (HC-SH-038..044, HC-TR-183): currency + conversion rate, P&L basis, lot sizes, theme, density, the Mindful pause. */
import { requireSecondFactor } from "../security/second-factor.js";
import { DEFAULT_MINDFUL, MindfulSettings, UNDERLYINGS, type Underlying, UserSettings } from "@hapiecoin/schema";
import { DEFAULT_VENUE, defaultLotSizes, getVenue } from "@hapiecoin/venues";
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
  lotSizes: defaultLotSizes(getVenue(DEFAULT_VENUE)), // ADR-063: the venue's contract sizes
  theme: "dark",
  density: "comfortable",
  mindful: DEFAULT_MINDFUL, // ADR-074: on, any loss, 30 s
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
    // a row from before the column, or one hand-edited out of shape, reads as the default
    mindful: MindfulSettings.safeParse(row.mindful).success ? row.mindful : DEFAULT_MINDFUL,
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
        403: errorResponses[403],
        429: errorResponses[429],
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
      // ADR-086: the safety knobs (the Mindful pause, the lot sizes) ask an account with the authenticator on for its code; theme, density, currency and P&L basis never do
      if (safetyKnobsChanged(before ? toSettings(before) : DEFAULT_SETTINGS, next)) await requireSecondFactor(deps, c, me);
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

/** Key-order-free comparison of the settings that change what a live order can do (ADR-086). */
function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));
}

/** True when `next` changes the Mindful pause or the lot sizes against `current`. */
export function safetyKnobsChanged(current: UserSettings, next: UserSettings): boolean {
  return stable(current.mindful) !== stable(next.mindful) || stable(current.lotSizes) !== stable(next.lotSizes);
}
