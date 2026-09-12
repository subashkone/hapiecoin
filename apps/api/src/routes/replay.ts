/**
 * Replay routes (ADR-079; HC-WS-113): the expiries with a recorded chain, the instants one was recorded at, and the
 * ladder at an instant. Behind the session, cached a minute; 503 while nothing is recorded for the underlying, 404 for
 * an instant nothing was recorded at. Read-only over the snapshot tables.
 */
import { IsoDate, IsoDateTime, ReplayChain, ReplayExpiries, ReplaySteps, Underlying, Venue } from "@hapiecoin/schema";
import { DEFAULT_VENUE } from "@hapiecoin/venues";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { replayChain, replayExpiries, replaySteps } from "../replay.js";
import type { AppEnv } from "../security/context.js";
import { errors } from "../security/errors.js";
import { requireUser } from "../security/guards.js";
import { type AppDeps, cookieAuth, errorResponses, jsonContent } from "./shared.js";

const AssetQuery = z.object({ asset: Underlying, venue: Venue.optional() });
const StepsQuery = AssetQuery.extend({ expiry: IsoDate });
const ChainQuery = StepsQuery.extend({ at: IsoDateTime });

export function registerReplayRoutes(app: OpenAPIHono<AppEnv>, deps: AppDeps, now: () => number = Date.now): void {
  const guard = requireUser(deps.sessions);

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/replay/expiries",
      tags: ["replay"],
      summary: "Expiries with a recorded chain for the underlying (HC-WS-113)",
      security: cookieAuth,
      middleware: [guard],
      request: { query: AssetQuery },
      responses: { 200: jsonContent(ReplayExpiries, "Recorded expiries"), 400: errorResponses[400], 401: errorResponses[401], 503: errorResponses[503] },
    }),
    async (c) => {
      const q = c.req.valid("query");
      const out = await replayExpiries(deps.db, q.venue ?? DEFAULT_VENUE, q.asset);
      if (out.expiries.length === 0) throw errors.unavailable(`no recorded chain for ${q.asset} on ${out.venue} yet`);
      c.header("Cache-Control", "private, max-age=60");
      return c.json(out, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/replay/steps",
      tags: ["replay"],
      summary: "The instants an expiry's chain was recorded at: daily over the end-of-day history, every five minutes over the last week (HC-WS-113)",
      security: cookieAuth,
      middleware: [guard],
      request: { query: StepsQuery },
      responses: { 200: jsonContent(ReplaySteps, "Recorded instants"), 400: errorResponses[400], 401: errorResponses[401], 503: errorResponses[503] },
    }),
    async (c) => {
      const q = c.req.valid("query");
      const out = await replaySteps(deps.db, q.venue ?? DEFAULT_VENUE, q.asset, q.expiry, now);
      if (out.daily.length === 0 && out.fine.length === 0) throw errors.unavailable(`no recorded chain for ${q.asset} ${q.expiry} on ${out.venue}`);
      c.header("Cache-Control", "private, max-age=60");
      return c.json(out, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/replay/chain",
      tags: ["replay"],
      summary: "The expiry's ladder as recorded at one instant (HC-WS-113)",
      security: cookieAuth,
      middleware: [guard],
      request: { query: ChainQuery },
      responses: { 200: jsonContent(ReplayChain, "The ladder then"), 400: errorResponses[400], 401: errorResponses[401], 404: errorResponses[404] },
    }),
    async (c) => {
      const q = c.req.valid("query");
      const out = await replayChain(deps.db, q.venue ?? DEFAULT_VENUE, q.asset, q.expiry, new Date(q.at));
      if (!out) throw errors.notFound("Recorded chain at that instant");
      c.header("Cache-Control", "private, max-age=300");
      return c.json(out, 200);
    },
  );
}
