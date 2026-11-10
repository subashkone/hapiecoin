/**
 * Playbook records (ADR-101; HC-TR-206): the stored record of every playbook and asset on a venue, computed by the
 * records job over the recorded chain history. Behind the session; 503 while no record exists for the venue yet
 * (the first one lands once a day has been recorded and the job has run); cached five minutes.
 */
import { PlaybookRecords, Venue } from "@hapiecoin/schema";
import { DEFAULT_VENUE } from "@hapiecoin/venues";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { listPlaybookRecords } from "../playbooks.js";
import type { AppEnv } from "../security/context.js";
import { errors } from "../security/errors.js";
import { requireUser } from "../security/guards.js";
import { type AppDeps, cookieAuth, errorResponses, jsonContent } from "./shared.js";

export function registerPlaybookRoutes(app: OpenAPIHono<AppEnv>, deps: AppDeps): void {
  const guard = requireUser(deps.sessions);

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/playbooks",
      tags: ["backtest"],
      summary: "Every playbook's stored record on the venue's recorded chain history, with its status (HC-TR-206)",
      security: cookieAuth,
      middleware: [guard],
      request: { query: z.object({ venue: Venue.optional() }) },
      responses: { 200: jsonContent(PlaybookRecords, "Playbook records"), 401: errorResponses[401], 503: errorResponses[503] },
    }),
    async (c) => {
      const venue = c.req.valid("query").venue ?? DEFAULT_VENUE;
      const records = await listPlaybookRecords(deps.db, venue);
      if (records.length === 0) throw errors.unavailable(`no playbook record exists for ${venue} yet; the first one lands once a day has been recorded and the records job has run`);
      c.header("Cache-Control", "private, max-age=300");
      return c.json({ venue, records }, 200);
    },
  );
}
