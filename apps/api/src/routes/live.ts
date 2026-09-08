/**
 * Live trading routes (Phase 3 item 2, ADR-025): preview, place, retry, sync, Trade All → Live batch,
 * positions, and the admin kill switch. HC-TR-023, 055, 063, 070, 082..089.
 */
import { Id, LiveBatchBody, LiveBatchResult, LivePlaceBody, LivePositions, LivePreview, LivePreviewBody, Strategy } from "@hapiecoin/schema";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { and, asc, eq } from "drizzle-orm";
import { auditFrom } from "../audit.js";
import { strategies, strategyLegs, users } from "../db/schema.js";
import { type AppEnv, type SessionUser, currentUser } from "../security/context.js";
import { errors } from "../security/errors.js";
import { requireAdmin, requireUser } from "../security/guards.js";
import { openCredential, ordersOf, placeEntries, preview, retryFailed, syncOrders, tradingBlockedReason, type StrategyRow } from "./live-exec.js";
import { type AppDeps, cookieAuth, errorResponses, jsonContent } from "./shared.js";
import { loadStrategy } from "./strategies.js";

const IdParam = z.object({ id: Id });
const PreviewBody = LivePreviewBody.extend({ worstLoss: z.number().optional() });

export function registerLiveRoutes(app: OpenAPIHono<AppEnv>, deps: AppDeps): void {
  const guard = requireUser(deps.sessions);
  const db = deps.db;

  async function owned(user: SessionUser, id: string): Promise<StrategyRow> {
    const [row] = await db.select().from(strategies).where(and(eq(strategies.id, id), eq(strategies.userId, user.id))).limit(1);
    if (!row) throw errors.notFound("Strategy");
    return row;
  }
  const openLegs = (id: string) => db.select().from(strategyLegs).where(and(eq(strategyLegs.strategyId, id), eq(strategyLegs.status, "open"))).orderBy(asc(strategyLegs.position));
  const touch = (id: string, patch: Partial<typeof strategies.$inferInsert> = {}) => db.update(strategies).set({ ...patch, updatedAt: new Date() }).where(eq(strategies.id, id));

  /** Preview or place: shared checks. Returns the plan or throws 409 with every reason. */
  async function checkedPreview(user: SessionUser, row: StrategyRow, brokerId: string, worstLoss: number | null) {
    const legs = await openLegs(row.id);
    const p = await preview(deps, user, row, legs, brokerId, worstLoss);
    return { legs, p };
  }

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/strategies/{id}/live/preview",
      tags: ["live"],
      summary: "Preview a live placement: contracts, marks, notional, wallet and safeguard verdicts (HC-TR-056, HC-TR-088)",
      security: cookieAuth,
      middleware: [guard],
      request: { params: IdParam, body: { content: { "application/json": { schema: PreviewBody } }, required: true } },
      responses: { 200: jsonContent(LivePreview, "Preview"), 400: errorResponses[400], 401: errorResponses[401], 404: errorResponses[404] },
    }),
    async (c) => {
      const me = currentUser(c);
      const row = await owned(me, c.req.valid("param").id);
      const body = c.req.valid("json");
      const { p } = await checkedPreview(me, row, body.brokerId, body.worstLoss ?? null);
      return c.json(p, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/strategies/{id}/live/place",
      tags: ["live"],
      summary: "Place market orders for every open leg through the executor; idempotent per key (HC-TR-057, HC-TR-063)",
      security: cookieAuth,
      middleware: [guard],
      request: { params: IdParam, body: { content: { "application/json": { schema: LivePlaceBody } }, required: true } },
      responses: { 200: jsonContent(Strategy, "Placed"), 400: errorResponses[400], 401: errorResponses[401], 404: errorResponses[404], 409: errorResponses[409], 502: errorResponses[502] },
    }),
    async (c) => {
      const me = currentUser(c);
      const row = await owned(me, c.req.valid("param").id);
      const body = c.req.valid("json");
      const existing = (await ordersOf(deps, row.id)).some((o) => o.batchId === body.idempotencyKey);
      if (existing) return c.json(await loadStrategy(deps, row.id), 200); // repeat of the same placement (idempotency key)
      if (row.status !== "draft" && row.status !== "paper") throw errors.conflict(`Only a draft or paper strategy can go live; this strategy is ${row.status}`);
      const { legs, p } = await checkedPreview(me, row, body.brokerId, null);
      if (!p.ok) throw errors.conflict(p.reasons.join(" · "));
      const creds = await openCredential(deps, me, body.brokerId);
      const before = await loadStrategy(deps, row.id);
      const now = new Date();
      await touch(row.id, { status: "live", tradingMode: "live", brokerId: body.brokerId, orderBatchId: body.idempotencyKey, startedAt: row.startedAt ?? now, closedAt: null });
      const outcome = await placeEntries(deps, creds, row, legs, p.legs, body.idempotencyKey, "entry", body.expected);
      const after = await loadStrategy(deps, row.id);
      await auditFrom(c, db)({ action: "strategy.live_place", target: `strategy:${row.id}`, before, after: { ...after, outcome } });
      return c.json(after, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/strategies/{id}/live/retry",
      tags: ["live"],
      summary: "Retry failed orders with the same client order ids (HC-TR-085)",
      security: cookieAuth,
      middleware: [guard],
      request: { params: IdParam },
      responses: { 200: jsonContent(Strategy, "Retried"), 401: errorResponses[401], 404: errorResponses[404], 409: errorResponses[409] },
    }),
    async (c) => {
      const me = currentUser(c);
      const row = await owned(me, c.req.valid("param").id);
      if (row.status !== "live" || !row.brokerId) throw errors.conflict("Only a live strategy has orders to retry");
      const blocked = await tradingBlockedReason(deps, me);
      if (blocked) throw errors.conflict(blocked);
      const creds = await openCredential(deps, me, row.brokerId);
      const before = await loadStrategy(deps, row.id);
      const outcome = await retryFailed(deps, creds, me, row);
      await touch(row.id);
      const after = await loadStrategy(deps, row.id);
      await auditFrom(c, db)({ action: "strategy.live_retry", target: `strategy:${row.id}`, before, after: { ...after, outcome } });
      return c.json(after, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/strategies/{id}/live/sync",
      tags: ["live"],
      summary: "Reconcile pending orders with the exchange (HC-TR-084)",
      security: cookieAuth,
      middleware: [guard],
      request: { params: IdParam },
      responses: { 200: jsonContent(Strategy, "Synced"), 401: errorResponses[401], 404: errorResponses[404], 409: errorResponses[409] },
    }),
    async (c) => {
      const me = currentUser(c);
      const row = await owned(me, c.req.valid("param").id);
      if (row.status !== "live" || !row.brokerId) throw errors.conflict("Only a live strategy can be synced");
      const creds = await openCredential(deps, me, row.brokerId);
      const { updated } = await syncOrders(deps, creds, row);
      if (updated) await touch(row.id);
      return c.json(await loadStrategy(deps, row.id), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/strategies/live/batch",
      tags: ["live"],
      summary: "Trade All → Live: place every ticked paper strategy, stopping at the first failure (HC-TR-089, ADR-010)",
      security: cookieAuth,
      middleware: [guard],
      request: { body: { content: { "application/json": { schema: LiveBatchBody } }, required: true } },
      responses: { 200: jsonContent(LiveBatchResult, "Batch outcome"), 400: errorResponses[400], 401: errorResponses[401], 409: errorResponses[409] },
    }),
    async (c) => {
      const me = currentUser(c);
      const body = c.req.valid("json");
      const blocked = await tradingBlockedReason(deps, me);
      if (blocked) throw errors.conflict(blocked);
      const creds = await openCredential(deps, me, body.brokerId);
      const placed: string[] = [];
      const skipped: string[] = [];
      let failed: { id: string; error: string } | null = null;
      for (const id of body.ids) {
        const [row] = await db.select().from(strategies).where(and(eq(strategies.id, id), eq(strategies.userId, me.id))).limit(1);
        const key = `${body.idempotencyKey}:${id}`;
        if (row?.status === "live" && row.orderBatchId === key) {
          placed.push(id); // this very batch already placed it: a repeat answers the same result
          continue;
        }
        if (!row || row.status !== "paper") {
          skipped.push(id);
          continue;
        }
        const { legs, p } = await checkedPreview(me, row, body.brokerId, null);
        if (!p.ok) {
          failed = { id, error: p.reasons.join(" · ") };
          break;
        }
        const before = await loadStrategy(deps, row.id);
        await touch(row.id, { status: "live", tradingMode: "live", brokerId: body.brokerId, orderBatchId: key });
        const outcome = await placeEntries(deps, creds, row, legs, p.legs, key, "entry", {});
        const after = await loadStrategy(deps, row.id);
        await auditFrom(c, db)({ action: "strategy.live_place", target: `strategy:${row.id}`, before, after: { ...after, outcome, batch: body.idempotencyKey } });
        placed.push(id);
        if (outcome.failed > 0) {
          failed = { id, error: outcome.errors.join(" · ") };
          break;
        }
      }
      return c.json({ placed, failed, skipped }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/strategies/live/positions",
      tags: ["live"],
      summary: "Exchange positions and wallet balances for the connected broker (HC-TR-082)",
      security: cookieAuth,
      middleware: [guard],
      request: { query: z.object({ brokerId: Id }) },
      responses: { 200: jsonContent(LivePositions, "Positions"), 400: errorResponses[400], 401: errorResponses[401], 409: errorResponses[409] },
    }),
    async (c) => {
      const me = currentUser(c);
      const creds = await openCredential(deps, me, c.req.valid("query").brokerId);
      const [positions, balances] = await Promise.all([deps.trading.getPositions(creds), deps.trading.getBalances(creds)]);
      return c.json({ positions, balances }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/admin/users/{id}/trading",
      tags: ["admin"],
      summary: "Account kill switch: disable or enable live trading for a user (ADR-025)",
      security: cookieAuth,
      middleware: requireAdmin(deps.sessions),
      request: { params: IdParam, body: { content: { "application/json": { schema: z.object({ disabled: z.boolean() }) } }, required: true } },
      responses: { 200: jsonContent(z.object({ id: Id, tradingDisabled: z.boolean() }), "Updated"), 401: errorResponses[401], 403: errorResponses[403], 404: errorResponses[404] },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const { disabled } = c.req.valid("json");
      const [u] = await db.select({ id: users.id, tradingDisabled: users.tradingDisabled }).from(users).where(eq(users.id, id)).limit(1);
      if (!u) throw errors.notFound("User");
      await db.update(users).set({ tradingDisabled: disabled, updatedAt: new Date() }).where(eq(users.id, id));
      await auditFrom(c, db)({ action: disabled ? "user.trading_disable" : "user.trading_enable", target: `user:${id}`, before: { tradingDisabled: u.tradingDisabled }, after: { tradingDisabled: disabled } });
      return c.json({ id, tradingDisabled: disabled }, 200);
    },
  );

}
