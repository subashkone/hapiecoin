/**
 * Saved Autopilot strategies (ADR-141, ADR-142; HC-TR-269..276). Admins only. Paper only: nothing here places anything
 * on a venue, and a strategy trades on paper only once it is published.
 *
 *   GET    /v1/admin/autopilot-strategies                  every saved strategy and version (HC-TR-270)
 *   POST   /v1/admin/autopilot-strategies                  a new draft (HC-TR-270)
 *   PATCH  /v1/admin/autopilot-strategies/{id}             name, summary, settings, backtest, audience (HC-TR-270, 272, 274)
 *   POST   /v1/admin/autopilot-strategies/{id}/duplicate   a copy as a new draft (HC-TR-270)
 *   POST   /v1/admin/autopilot-strategies/{id}/publish     to paper (HC-TR-271)
 *   POST   /v1/admin/autopilot-strategies/{id}/retire      no new entries (HC-TR-273)
 *   DELETE /v1/admin/autopilot-strategies/{id}             only one that never traded and is not on paper (HC-TR-273)
 *   GET    /v1/admin/autopilot-strategies/{id}/backtests            its latest runs of the backtest in the app (HC-TR-288)
 *   POST   /v1/admin/autopilot-strategies/{id}/backtests            start a run on its settings as they are (HC-TR-288)
 *   POST   /v1/admin/autopilot-strategies/{id}/backtests/{run}/use  put a run's figures on the strategy (HC-TR-288)
 */
import { SavedBacktestRun, SavedBacktestStart, SavedStrategy, SavedStrategyCreate, SavedStrategyList, SavedStrategyPatch } from "@hapiecoin/schema";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { auditFrom } from "../audit.js";
import { type SavedResult, createSaved, deleteSaved, duplicateSaved, listSaved, publishSaved, retireSaved, savedById, updateSaved } from "../autopilot-saved.js";
import { runsOf, startRun, useRun } from "../saved-backtest-runs.js";
import { type AppEnv, currentUser } from "../security/context.js";
import { errors } from "../security/errors.js";
import { requireAdmin } from "../security/guards.js";
import { type AppDeps, cookieAuth, errorResponses, jsonContent } from "./shared.js";

const IdParam = z.object({ id: z.string().min(1).max(64) });
const BASE = "/v1/admin/autopilot-strategies";
const refusals = { 400: errorResponses[400], 401: errorResponses[401], 403: errorResponses[403], 404: errorResponses[404], 409: errorResponses[409] };

/** A step the rows refuse is a conflict with the strategy's state, said in its own words. */
function settled(result: SavedResult | null): SavedStrategy {
  if (!result) throw errors.notFound("Strategy");
  if (!result.ok) throw result.bad ? errors.badRequest(result.why) : errors.conflict(result.why);
  return result.strategy;
}

export function registerAutopilotSavedRoutes(app: OpenAPIHono<AppEnv>, deps: AppDeps, now: () => Date = () => new Date()): void {
  const db = deps.db;
  const admin = requireAdmin(deps.sessions);

  app.openapi(
    createRoute({ method: "get", path: BASE, tags: ["admin"], summary: "Every saved Autopilot strategy (HC-TR-270)", security: cookieAuth, middleware: admin, responses: { 200: jsonContent(SavedStrategyList, "Strategies"), 401: errorResponses[401], 403: errorResponses[403] } }),
    async (c) => c.json({ items: await listSaved(db) }, 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: BASE,
      tags: ["admin"],
      summary: "Save a new Autopilot strategy as a draft (HC-TR-270)",
      security: cookieAuth,
      middleware: admin,
      request: { body: { content: { "application/json": { schema: SavedStrategyCreate } }, required: true } },
      responses: { 201: jsonContent(SavedStrategy, "Created"), 400: errorResponses[400], 401: errorResponses[401], 403: errorResponses[403] },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const s = await createSaved(db, body, currentUser(c).id, now());
      await auditFrom(c, db)({ action: "admin.autopilot_strategy.create", target: `autopilot_strategy:${s.id}`, after: body });
      return c.json(s, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: `${BASE}/{id}`,
      tags: ["admin"],
      summary: "Change a saved strategy; new settings on one that has traded become its next version (HC-TR-270, HC-TR-272, HC-TR-274)",
      security: cookieAuth,
      middleware: admin,
      request: { params: IdParam, body: { content: { "application/json": { schema: SavedStrategyPatch } }, required: true } },
      responses: { 200: jsonContent(SavedStrategy, "Updated, or the new version"), ...refusals },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const before = await savedById(db, id);
      const s = settled(await updateSaved(db, id, body, currentUser(c).id, now()));
      await auditFrom(c, db)({ action: s.id === id ? "admin.autopilot_strategy.update" : "admin.autopilot_strategy.version", target: `autopilot_strategy:${s.id}`, before, after: body });
      return c.json(s, 200);
    },
  );

  app.openapi(
    createRoute({ method: "post", path: `${BASE}/{id}/duplicate`, tags: ["admin"], summary: "Copy a saved strategy as a new draft (HC-TR-270)", security: cookieAuth, middleware: admin, request: { params: IdParam }, responses: { 201: jsonContent(SavedStrategy, "The copy"), 401: errorResponses[401], 403: errorResponses[403], 404: errorResponses[404] } }),
    async (c) => {
      const { id } = c.req.valid("param");
      const s = await duplicateSaved(db, id, currentUser(c).id, now());
      if (!s) throw errors.notFound("Strategy");
      await auditFrom(c, db)({ action: "admin.autopilot_strategy.duplicate", target: `autopilot_strategy:${s.id}`, after: { from: id } });
      return c.json(s, 201);
    },
  );

  for (const step of ["publish", "retire"] as const)
    app.openapi(
      createRoute({
        method: "post",
        path: `${BASE}/{id}/${step}`,
        tags: ["admin"],
        summary: step === "publish" ? "Publish a saved strategy to paper: Autopilot may trade it (HC-TR-271)" : "Retire a saved strategy: no new entries, open trades keep their exits (HC-TR-273)",
        security: cookieAuth,
        middleware: admin,
        request: { params: IdParam },
        responses: { 200: jsonContent(SavedStrategy, "The strategy"), ...refusals },
      }),
      async (c) => {
        const { id } = c.req.valid("param");
        const s = settled(await (step === "publish" ? publishSaved : retireSaved)(db, id, now()));
        await auditFrom(c, db)({ action: `admin.autopilot_strategy.${step}`, target: `autopilot_strategy:${id}` });
        return c.json(s, 200);
      },
    );

  app.openapi(
    createRoute({ method: "delete", path: `${BASE}/{id}`, tags: ["admin"], summary: "Delete a saved strategy that never traded (HC-TR-273)", security: cookieAuth, middleware: admin, request: { params: IdParam }, responses: { 200: jsonContent(z.object({ deleted: z.literal(true) }), "Deleted"), ...refusals } }),
    async (c) => {
      const { id } = c.req.valid("param");
      const before = await savedById(db, id);
      const gone = await deleteSaved(db, id);
      if (!gone) throw errors.notFound("Strategy");
      if (!gone.ok) throw errors.conflict(gone.why);
      await auditFrom(c, db)({ action: "admin.autopilot_strategy.delete", target: `autopilot_strategy:${id}`, before });
      return c.json({ deleted: true as const }, 200);
    },
  );

  // ---- the backtest in the app (ADR-144) ----
  const RunParam = z.object({ id: z.string().min(1).max(64), run: z.string().min(1).max(64) });
  const found = async (id: string): Promise<SavedStrategy> => {
    const s = await savedById(db, id);
    if (!s) throw errors.notFound("Strategy");
    return s;
  };

  app.openapi(
    createRoute({ method: "get", path: `${BASE}/{id}/backtests`, tags: ["admin"], summary: "The latest runs of the backtest in the app on a saved strategy (HC-TR-288)", security: cookieAuth, middleware: admin, request: { params: IdParam }, responses: { 200: jsonContent(z.object({ items: z.array(SavedBacktestRun) }), "Runs, newest first"), 401: errorResponses[401], 403: errorResponses[403], 404: errorResponses[404] } }),
    async (c) => c.json({ items: await runsOf(db, await found(c.req.valid("param").id), now().getTime()) }, 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: `${BASE}/{id}/backtests`,
      tags: ["admin"],
      summary: "Start a backtest of a saved strategy on its settings as they are: public prices are read, nothing is placed (HC-TR-288)",
      security: cookieAuth,
      middleware: admin,
      request: { params: IdParam, body: { content: { "application/json": { schema: SavedBacktestStart } }, required: true } },
      responses: { 202: jsonContent(SavedBacktestRun, "The run as it starts"), ...refusals, 503: errorResponses[503] },
    }),
    async (c) => {
      const strategy = await found(c.req.valid("param").id);
      const body = c.req.valid("json");
      if (!deps.markSource) throw errors.unavailable("The exchange's price history is not available on this server");
      const started = await startRun({ db, source: deps.markSource, now: () => now().getTime(), logger: deps.logger }, strategy, body, currentUser(c).id);
      if (!started.ok) throw errors.conflict(started.why);
      await auditFrom(c, db)({ action: "admin.autopilot_strategy.backtest", target: `autopilot_strategy:${strategy.id}`, after: { run: started.run.id, ...body } });
      return c.json(started.run, 202);
    },
  );

  app.openapi(
    createRoute({ method: "post", path: `${BASE}/{id}/backtests/{run}/use`, tags: ["admin"], summary: "Put a finished run's figures on the strategy, marked as computed in the app (HC-TR-288)", security: cookieAuth, middleware: admin, request: { params: RunParam }, responses: { 200: jsonContent(SavedStrategy, "The strategy with the figures"), ...refusals } }),
    async (c) => {
      const { id, run } = c.req.valid("param");
      const strategy = await found(id);
      const result = await useRun(db, strategy, run, now());
      if (!result) throw errors.notFound("Finished backtest");
      const s = settled(result);
      await auditFrom(c, db)({ action: "admin.autopilot_strategy.backtest_use", target: `autopilot_strategy:${id}`, before: { backtest: strategy.backtest }, after: { run, backtest: s.backtest } });
      return c.json(s, 200);
    },
  );
}
