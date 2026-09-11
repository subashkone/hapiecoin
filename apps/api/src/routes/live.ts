/**
 * Live trading routes (Phase 3 item 2, ADR-025): preview, place, retry, sync, Trade All → Live batch,
 * positions, and the admin kill switch. HC-TR-023, 055, 063, 070, 082..089.
 */
import { type AdjustChange, Id, LiveBatchBody, LiveBatchResult, LivePlaceBody, LivePositions, LivePositionsExitBody, LivePositionsExitResult, LivePreview, LivePreviewBody, MAX_OPEN_LEGS, Strategy, type StrategyLegInput, ApiError } from "@hapiecoin/schema";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { and, asc, eq } from "drizzle-orm";
import { auditFrom } from "../audit.js";
import { assertEntitled } from "../entitlements.js";
import { strategies, strategyLegs, users } from "../db/schema.js";
import { type AppEnv, type SessionUser, currentUser } from "../security/context.js";
import { errors } from "../security/errors.js";
import { requireAdmin, requireUser } from "../security/guards.js";
import { lotSizeFor, openCredential, ordersOf, placeEntries, preview, retryFailed, syncOrders, tradingBlockedReason, type PlanLeg, type StrategyRow } from "./live-exec.js";
import { type AppDeps, cookieAuth, errorResponses, jsonContent } from "./shared.js";

/** The exchange did not answer the positions read (never an empty list, HC-TR-160). */
const exchangeUnavailable = jsonContent(ApiError, "Exchange unavailable");
import { addDecimal, closeLegRow, loadStrategy } from "./strategies.js";

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
  /** Adjustment workbench (ADR-044): price the proposed batch, not the open legs: trims / closes as reduce-only exits, adds as entries. */
  async function adjustPreview(user: SessionUser, row: StrategyRow, brokerId: string, worstLoss: number | null, adds: readonly StrategyLegInput[], changes: readonly AdjustChange[]) {
    const open = await openLegs(row.id);
    const exits: PlanLeg[] = [];
    for (const ch of changes) {
      const leg = open.find((l) => l.id === ch.legId);
      if (!leg) throw errors.badRequest(`Leg ${ch.legId} is not an open leg of this strategy`);
      if (ch.lotsAfter > leg.lots) throw errors.badRequest(`${leg.symbol}: lots after (${ch.lotsAfter}) exceed the open ${leg.lots}`);
      if (ch.lotsAfter < leg.lots) exits.push({ id: leg.id, symbol: leg.symbol, side: leg.side === "buy" ? "sell" : "buy", lots: leg.lots - ch.lotsAfter });
    }
    const entries: PlanLeg[] = adds.map((l, i) => ({ id: `new-${i + 1}`, symbol: l.symbol, side: l.side, lots: l.lots }));
    const closes = changes.filter((ch) => ch.lotsAfter === 0).length;
    const p = await preview(deps, user, row, entries, brokerId, worstLoss, exits);
    if (open.length - closes + adds.length > MAX_OPEN_LEGS) p.reasons.push(`Maximum ${MAX_OPEN_LEGS} active legs allowed per strategy`);
    return { ...p, ok: p.reasons.length === 0 };
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
      if (body.adds !== undefined || body.changes !== undefined) return c.json(await adjustPreview(me, row, body.brokerId, body.worstLoss ?? null, body.adds ?? [], body.changes ?? []), 200);
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
      await assertEntitled(deps, me.id, "live_trading"); // HC-SH-054 (ADR-030)
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
      await assertEntitled(deps, me.id, "live_trading"); // one check per batch: the batch counts as one placement per strategy below
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
      responses: { 200: jsonContent(LivePositions, "Positions"), 400: errorResponses[400], 401: errorResponses[401], 409: errorResponses[409], 503: exchangeUnavailable },
    }),
    async (c) => {
      const me = currentUser(c);
      const creds = await openCredential(deps, me, c.req.valid("query").brokerId);
      const [raw, balances] = await Promise.all([deps.trading.getPositions(creds), deps.trading.getBalances(creds)]).catch((e: unknown) => {
        // an unreadable venue is 503, never "no positions": the Live tab's drift check must not read it as "holds nothing"
        deps.logger.warn({ err: e instanceof Error ? e.message : String(e), userId: me.id }, "positions read failed");
        throw errors.unavailable("The exchange did not answer the positions read · try again in a moment");
      });
      // HC-TR-144: the client sizes lots and P&L from contract value and mark; unknown products stay null
      const positions = await Promise.all(
        raw.map(async (p) => {
          const [product, mark] = p.symbol ? await Promise.all([deps.trading.getProduct(p.symbol).catch(() => null), deps.trading.getMark(p.symbol).catch(() => null)]) : [null, null];
          return { ...p, contractValue: product?.contractValue ?? null, mark };
        }),
      );
      return c.json({ positions, balances }, 200);
    },
  );

  /** Close every open live leg of the user with this symbol at the venue fill (the position is gone at the venue). */
  async function squareOffLegsFor(me: SessionUser, symbol: string, fill: string): Promise<void> {
    const rows = await db
      .select({ strategy: strategies, leg: strategyLegs })
      .from(strategyLegs)
      .innerJoin(strategies, eq(strategyLegs.strategyId, strategies.id))
      .where(and(eq(strategies.userId, me.id), eq(strategies.status, "live"), eq(strategyLegs.symbol, symbol), eq(strategyLegs.status, "open")));
    for (const { strategy, leg } of rows) {
      const realized = await closeLegRow(deps, strategy, leg, fill, undefined, await lotSizeFor(deps, me, strategy.asset), new Date());
      const [fresh] = await db.select({ realizedPnl: strategies.realizedPnl }).from(strategies).where(eq(strategies.id, strategy.id)).limit(1);
      const stillOpen = await db.select({ id: strategyLegs.id }).from(strategyLegs).where(and(eq(strategyLegs.strategyId, strategy.id), eq(strategyLegs.status, "open"))).limit(1);
      await touch(strategy.id, { realizedPnl: addDecimal(fresh?.realizedPnl ?? strategy.realizedPnl, realized), ...(stillOpen.length === 0 ? { status: "archived" as const, closedAt: new Date(), closeReason: "squared_off" as const } : {}) });
    }
  }

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/strategies/live/positions/exit",
      tags: ["live"],
      summary: "Square off exchange positions with reduce-only market orders; matching live legs are closed at the fill (HC-TR-145)",
      security: cookieAuth,
      middleware: [guard],
      request: { body: { content: { "application/json": { schema: LivePositionsExitBody } }, required: true } },
      responses: { 200: jsonContent(LivePositionsExitResult, "Exits"), 400: errorResponses[400], 401: errorResponses[401], 409: errorResponses[409], 503: exchangeUnavailable },
    }),
    async (c) => {
      const me = currentUser(c);
      const body = c.req.valid("json");
      const blocked = await tradingBlockedReason(deps, me);
      if (blocked) throw errors.conflict(blocked);
      const creds = await openCredential(deps, me, body.brokerId);
      const positions = await deps.trading.getPositions(creds).catch((e: unknown) => {
        deps.logger.warn({ err: e instanceof Error ? e.message : String(e), userId: me.id }, "positions read failed");
        throw errors.unavailable("The exchange did not answer the positions read · nothing was sent");
      });
      const closed: LivePositionsExitResult["closed"] = [];
      const failed: LivePositionsExitResult["failed"] = [];
      const keyTail = body.idempotencyKey.replace(/[^A-Za-z0-9]/g, "").slice(-10);
      for (const productId of body.productIds) {
        const p = positions.find((x) => x.productId === productId && x.size !== 0);
        if (!p) {
          failed.push({ productId, error: "No open position for this product" });
          continue;
        }
        // one reduce-only market order per position; the client id ties a repeat of the same key to the same order
        const result = await deps.trading.placeOrder(creds, { productId, size: Math.abs(p.size), side: p.size > 0 ? "sell" : "buy", clientOrderId: `hc-pos-${productId}-${keyTail}`, reduceOnly: true });
        if (!result.ok) {
          failed.push({ productId, error: result.message });
          continue;
        }
        const fill = result.order.averageFillPrice;
        closed.push({ productId, fillPrice: fill, state: result.order.state === "closed" ? "closed" : result.order.state === "cancelled" ? "cancelled" : "pending" });
        if (result.order.state === "closed" && fill && p.symbol) await squareOffLegsFor(me, p.symbol, fill);
      }
      await auditFrom(c, db)({ action: "positions.exit", target: `broker:${body.brokerId}`, after: { closed, failed, key: body.idempotencyKey } });
      return c.json({ closed, failed }, 200);
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
