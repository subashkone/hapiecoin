/**
 * The mandate for live Autopilot (ADR-147; HC-TR-296..298). Behind the session: a trader signs, pauses, resumes and
 * ends their own. A RECORD ONLY: nothing here places or enables an order, and no stored exchange key is opened.
 *
 *   GET  /v1/autopilot/mandates               my mandates, ended ones included (HC-TR-296)
 *   POST /v1/autopilot/mandates               sign one: the typed LIVE word and the authenticator code (HC-TR-296, HC-TR-297)
 *   POST /v1/autopilot/mandates/{id}/pause    no new live entries until resumed (HC-TR-298)
 *   POST /v1/autopilot/mandates/{id}/resume   the authenticator code again; the strategy is checked again (HC-TR-298)
 *   POST /v1/autopilot/mandates/{id}/end      final (HC-TR-298)
 */
import { MANDATE_CONFIRM_MESSAGE, MANDATE_REFUSALS, Mandate, MandateList, MandateSign, isLiveConfirm } from "@hapiecoin/schema";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { auditFrom } from "../audit.js";
import { mandatesOf, signMandate, stepMandate } from "../autopilot-mandate.js";
import { assertIncluded } from "../entitlements.js";
import { type AppEnv, currentUser } from "../security/context.js";
import { errors } from "../security/errors.js";
import { requireUser } from "../security/guards.js";
import { authenticatorOn, requireSecondFactor } from "../security/second-factor.js";
import { type AppDeps, cookieAuth, errorResponses, jsonContent } from "./shared.js";

const IdParam = z.object({ id: z.string().min(1).max(64) });
const BASE = "/v1/autopilot/mandates";
const refusals = { 400: errorResponses[400], 401: errorResponses[401], 403: errorResponses[403], 404: errorResponses[404], 409: errorResponses[409] };

export function registerAutopilotMandateRoutes(app: OpenAPIHono<AppEnv>, deps: AppDeps, now: () => Date = () => new Date()): void {
  const guard = requireUser(deps.sessions);
  const { db } = deps;

  app.openapi(
    createRoute({ method: "get", path: BASE, tags: ["strategies"], summary: "My mandates for live Autopilot, ended ones included (HC-TR-296)", security: cookieAuth, middleware: [guard], responses: { 200: jsonContent(MandateList, "Mandates"), 401: errorResponses[401] } }),
    async (c) => {
      c.header("Cache-Control", "private, no-store");
      return c.json({ items: await mandatesOf(db, currentUser(c).id, now()) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: BASE,
      tags: ["strategies"],
      summary: "Sign a mandate for one approved strategy and one exchange account: a record, nothing is placed (HC-TR-296, HC-TR-297)",
      security: cookieAuth,
      middleware: [guard],
      request: { body: { content: { "application/json": { schema: MandateSign } }, required: true } },
      responses: { 201: jsonContent(Mandate, "The mandate"), ...refusals },
    }),
    async (c) => {
      const user = currentUser(c);
      const body = c.req.valid("json");
      // the same typed word as a live order, with its own sentence: signing places nothing
      if (!isLiveConfirm(body.confirm)) throw errors.badRequest(MANDATE_CONFIRM_MESSAGE);
      // a mandate stands in for the confirmation of every later order: it is signed with the authenticator, never without one
      if (!(await authenticatorOn(deps, user))) throw errors.conflict(MANDATE_REFUSALS.needsAuthenticator);
      await requireSecondFactor(deps, c, user);
      // live trading must be part of the plan; the month's count is the engine's to read at each entry, signing uses none
      await assertIncluded(deps, user.id, "live_trading", now());
      const result = await signMandate(db, user.id, body, now(), (tx, row) =>
        auditFrom(c, tx)({ action: "autopilot.mandate.sign", target: `autopilot_mandate:${row.id}`, after: { strategyId: row.strategyId, accountId: row.accountId, lots: row.lots, maxCapitalUsd: row.maxCapitalUsd, dayLossLimitUsd: row.dayLossLimitUsd, weekLossLimitUsd: row.weekLossLimitUsd, maxOpen: row.maxOpen, statements: row.statements } }),
      );
      if (!result.ok) throw errors.conflict(result.why);
      return c.json(result.mandate, 201);
    },
  );

  for (const step of ["pause", "resume", "end"] as const) {
    app.openapi(
      createRoute({
        method: "post",
        path: `${BASE}/{id}/${step}`,
        tags: ["strategies"],
        summary: step === "pause" ? "Pause my mandate: no new live entries until it is resumed (HC-TR-298)" : step === "resume" ? "Resume my paused mandate, with the authenticator code; the strategy is checked again (HC-TR-298)" : "End my mandate for good (HC-TR-298)",
        security: cookieAuth,
        middleware: [guard],
        request: { params: IdParam },
        responses: { 200: jsonContent(Mandate, "The mandate"), ...refusals },
      }),
      async (c) => {
        const user = currentUser(c);
        const { id } = c.req.valid("param");
        // stopping is never held behind a code: only the step that lets orders go out again asks for it
        if (step === "resume") {
          // an account whose authenticator was switched off since it signed does not resume without one
          if (!(await authenticatorOn(deps, user))) throw errors.conflict(MANDATE_REFUSALS.needsAuthenticator);
          await requireSecondFactor(deps, c, user);
        }
        const result = await stepMandate(db, user.id, id, step, now(), (tx, row) => auditFrom(c, tx)({ action: `autopilot.mandate.${step}`, target: `autopilot_mandate:${row.id}`, after: { state: row.state } }));
        if (!result) throw errors.notFound("Mandate");
        if (!result.ok) throw errors.conflict(result.why);
        return c.json(result.mandate, 200);
      },
    );
  }
}
