/**
 * Autopilot (ADR-108; HC-TR-216, HC-TR-218): the trader's switch, the playbooks switched on with their exit style,
 * and the log of what Autopilot did. Behind the session. Paper only: nothing here places anything on a venue.
 */
import { AutopilotSettings, AutopilotView } from "@hapiecoin/schema";
import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { auditFrom } from "../audit.js";
import { autopilotSettingsOf, autopilotView, saveAutopilotSettings } from "../autopilot.js";
import { type AppEnv, currentUser } from "../security/context.js";
import { errors } from "../security/errors.js";
import { requireUser } from "../security/guards.js";
import { type AppDeps, cookieAuth, errorResponses, jsonContent } from "./shared.js";

export function registerAutopilotRoutes(app: OpenAPIHono<AppEnv>, deps: AppDeps, now: () => Date = () => new Date()): void {
  const guard = requireUser(deps.sessions);

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/autopilot",
      tags: ["strategies"],
      summary: "My Autopilot settings and its newest log lines (HC-TR-216, HC-TR-218)",
      security: cookieAuth,
      middleware: [guard],
      responses: { 200: jsonContent(AutopilotView, "Autopilot"), 401: errorResponses[401] },
    }),
    async (c) => {
      c.header("Cache-Control", "private, no-store");
      return c.json(await autopilotView(deps.db, currentUser(c).id), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/v1/autopilot",
      tags: ["strategies"],
      summary: "Switch Autopilot on or off and choose the playbooks it may enter on paper (HC-TR-216)",
      security: cookieAuth,
      middleware: [guard],
      request: { body: { content: { "application/json": { schema: AutopilotSettings } }, required: true } },
      responses: { 200: jsonContent(AutopilotView, "Autopilot"), 400: errorResponses[400], 401: errorResponses[401] },
    }),
    async (c) => {
      const me = currentUser(c);
      const body = c.req.valid("json");
      const before = await autopilotSettingsOf(deps.db, me.id);
      const saved = await saveAutopilotSettings(deps.db, me.id, body, now());
      if (!saved.ok) throw errors.badRequest(`${saved.unknown} is not a playbook Autopilot can trade`);
      await auditFrom(c, deps.db)({ action: "autopilot.settings", target: `user:${me.id}`, before, after: body });
      return c.json(await autopilotView(deps.db, me.id), 200);
    },
  );
}
