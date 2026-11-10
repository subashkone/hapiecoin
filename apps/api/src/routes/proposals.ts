/**
 * Playbook proposals (ADR-102; HC-TR-208): a day's proposals on a venue with the caller's marks, and the mark itself
 * (taken once opened in the Builder as paper, dismissed to hide). Behind the session. An empty day is an empty list,
 * not an error: no plan entering is the common honest state. Nothing here places anything.
 */
import { IsoDate, Proposal, ProposalMarkBody, Proposals, Venue } from "@hapiecoin/schema";
import { DEFAULT_VENUE } from "@hapiecoin/venues";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { dayOf } from "../chain-eod.js";
import { latestProposalDay, listProposals, markProposal } from "../proposals.js";
import { type AppEnv, currentUser } from "../security/context.js";
import { errors } from "../security/errors.js";
import { requireUser } from "../security/guards.js";
import { type AppDeps, cookieAuth, errorResponses, jsonContent } from "./shared.js";

export function registerProposalRoutes(app: OpenAPIHono<AppEnv>, deps: AppDeps): void {
  const guard = requireUser(deps.sessions);

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/proposals",
      tags: ["backtest"],
      summary: "A day's playbook proposals on a venue with the caller's marks; the latest recorded chain's day by default (HC-TR-208)",
      security: cookieAuth,
      middleware: [guard],
      request: { query: z.object({ venue: Venue.optional(), day: IsoDate.optional() }) },
      responses: { 200: jsonContent(Proposals, "Proposals"), 401: errorResponses[401] },
    }),
    async (c) => {
      const me = currentUser(c);
      const q = c.req.valid("query");
      const venue = q.venue ?? DEFAULT_VENUE;
      // the latest recorded chain is yesterday's until the 12:00 UTC write, so "today" is the newest proposal day, not the calendar day
      const day = q.day ?? (await latestProposalDay(deps.db, venue)) ?? dayOf(new Date());
      const items = await listProposals(deps.db, me.id, venue, day);
      c.header("Cache-Control", "private, no-store");
      return c.json({ venue, day, items }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/proposals/{id}/mark",
      tags: ["backtest"],
      summary: "Mark a proposal taken (opened in the Builder as paper) or dismissed; the caller's mark only (HC-TR-208)",
      security: cookieAuth,
      middleware: [guard],
      request: { params: z.object({ id: z.string().regex(/^\d+$/) }), body: jsonContent(ProposalMarkBody, "The mark") },
      responses: { 200: jsonContent(Proposal, "The proposal with the caller's mark"), 401: errorResponses[401], 404: errorResponses[404] },
    }),
    async (c) => {
      const me = currentUser(c);
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const out = await markProposal(deps.db, me.id, Number(id), body.status);
      if (!out) throw errors.notFound("Proposal");
      return c.json(out, 200);
    },
  );
}
