/**
 * Verified P&L routes (ADR-073; HC-TR-180): the trader's realised P&L from the venue's own fills, per account and in
 * total, and a Refresh that re-reads the caller's accounts now. Both are read-only against the venue.
 */
import { VerifiedPnl, VerifiedRefreshResult } from "@hapiecoin/schema";
import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { type AppEnv, currentUser } from "../security/context.js";
import { requireUser } from "../security/guards.js";
import { computeVerified, ingestFills } from "../verified.js";
import { type AppDeps, cookieAuth, errorResponses, jsonContent } from "./shared.js";

export function registerVerifiedRoutes(app: OpenAPIHono<AppEnv>, deps: AppDeps): void {
  const guard = requireUser(deps.sessions);

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/verified/pnl",
      tags: ["verified"],
      summary: "Realised P&L from the exchange's fills, per account and in total, with the Journal's own figure beside it (HC-TR-180)",
      security: cookieAuth,
      middleware: [guard],
      responses: { 200: jsonContent(VerifiedPnl, "Verified P&L"), 401: errorResponses[401] },
    }),
    async (c) => c.json(await computeVerified(deps, currentUser(c).id), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/verified/refresh",
      tags: ["verified"],
      summary: "Re-read the caller's accounts' fills from the exchange now (read-only), then answer like the job does (HC-TR-179)",
      security: cookieAuth,
      middleware: [guard],
      responses: { 200: jsonContent(VerifiedRefreshResult, "Read"), 401: errorResponses[401] },
    }),
    async (c) => {
      // a held-down button reads nothing twice within 30 s: the venue's budget is shared with order placement
      const r = await ingestFills(deps, { userId: currentUser(c).id, maxPages: 5, minGapMs: 30_000 });
      return c.json({ accounts: r.accounts, read: r.read, added: r.added, skipped: r.skipped, errors: r.errors }, 200);
    },
  );
}
