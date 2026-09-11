/**
 * Strategies (Phase 3 item 1, ADR-024): drafts, paper trades and archived strategies per user.
 * HC-TR-020, 036, 041..049 (drafts); HC-TR-050..057 (start paper); HC-TR-058..081 (paper list, details,
 * adjustments, square off, partial exit, stop). Paper trading is bookkeeping: the client proposes entry and
 * exit premiums at the live mark, the server validates, records and audits them. No route here reaches a
 * venue; live trading (item 2) adds its own guarded routes.
 */
import {
  AddLegsBody,
  AdjustBody,
  CloseAllBody,
  ReconcileBody,
  CloseLegBody,
  Id,
  MAX_OPEN_LEGS,
  PnlUpsert,
  StopBody,
  Strategy,
  StrategyCreate,
  StrategyList,
  StrategyPatch,
  StrategyStart,
  StrategyStatus,
  realizedPnl,
  toDecimal,
  type StrategyLegInput,
} from "@hapiecoin/schema";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { auditFrom } from "../audit.js";
import { assertEntitled } from "../entitlements.js";
import { brokers, strategies, strategyAdjustments, strategyLegs, strategyOrders, strategyPnl } from "../db/schema.js";
import { type AppEnv, type SessionUser, currentUser } from "../security/context.js";
import { errors } from "../security/errors.js";
import { requireUser } from "../security/guards.js";
import { type AppDeps, cookieAuth, errorResponses, jsonContent, newId } from "./shared.js";
import { type OrderRow, type PlanLeg, lotSizeFor as lotSizeOf, openCredential, ordersOf, placeEntries, placeExit, planLegs, preview, toOrder, tradingBlockedReason } from "./live-exec.js";

type StrategyRow = typeof strategies.$inferSelect;
type LegRow = typeof strategyLegs.$inferSelect;
type PnlRow = typeof strategyPnl.$inferSelect;
type AdjustmentRow = typeof strategyAdjustments.$inferSelect;

/** Load one strategy with legs, P&L points and orders (shared with the live routes). */
export async function loadStrategy(deps: AppDeps, id: string): Promise<Strategy> {
  const [row] = await deps.db.select().from(strategies).where(eq(strategies.id, id)).limit(1);
  if (!row) throw errors.notFound("Strategy");
  const [legs, pnl, orders, adjustments] = await Promise.all([
    deps.db.select().from(strategyLegs).where(eq(strategyLegs.strategyId, id)).orderBy(asc(strategyLegs.position), asc(strategyLegs.createdAt)),
    deps.db.select().from(strategyPnl).where(eq(strategyPnl.strategyId, id)).orderBy(asc(strategyPnl.day)),
    ordersOf(deps, id),
    deps.db.select().from(strategyAdjustments).where(eq(strategyAdjustments.strategyId, id)).orderBy(asc(strategyAdjustments.createdAt), asc(strategyAdjustments.id)),
  ]);
  return toStrategy(row, legs, pnl, orders, adjustments);
}

const IdParam = z.object({ id: Id });
const LegParam = z.object({ id: Id, legId: Id });
const ListQuery = z.object({ status: StrategyStatus.optional() });

function iso(d: Date | null): string | null {
  return d === null ? null : d.toISOString();
}

export function toStrategy(row: StrategyRow, legs: LegRow[], pnl: PnlRow[], orders: OrderRow[] = [], adjustments: AdjustmentRow[] = []): Strategy {
  return {
    id: row.id,
    name: row.name,
    asset: row.asset,
    status: row.status,
    tradingMode: row.tradingMode,
    templateName: row.templateName,
    brokerId: row.brokerId,
    legs: legs
      .slice()
      .sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime())
      .map((l) => ({
        id: l.id,
        kind: l.kind,
        side: l.side,
        strike: l.strike,
        expiry: l.expiry,
        symbol: l.symbol,
        lots: l.lots,
        price: l.price,
        entryPrice: l.entryPrice,
        exitPrice: l.exitPrice,
        iv: l.iv === null ? null : Number(l.iv),
        status: l.status,
        isAdjustment: l.isAdjustment,
        position: l.position,
        openedAt: iso(l.openedAt),
        closedAt: iso(l.closedAt),
        orderId: l.orderId,
      })),
    realizedPnl: row.realizedPnl,
    pnlHistory: pnl
      .slice()
      .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
      .map((p) => ({ day: p.day, pnl: p.pnl })),
    notes: row.notes,
    tags: row.tags,
    orderBatchId: row.orderBatchId,
    orders: orders.map(toOrder),
    adjustments: adjustments.map((a) => ({ id: a.id, at: a.createdAt.toISOString(), reason: a.reason, added: a.added, trimmed: a.trimmed, closed: a.closed, realizedPnl: a.realizedPnl, batchId: a.batchId })),
    startedAt: iso(row.startedAt),
    closedAt: iso(row.closedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function legValues(strategyId: string, input: StrategyLegInput, position: number, extra: Partial<typeof strategyLegs.$inferInsert> = {}): typeof strategyLegs.$inferInsert {
  return {
    id: newId("leg"),
    strategyId,
    kind: input.kind,
    side: input.side,
    strike: input.strike,
    expiry: input.expiry,
    symbol: input.symbol,
    lots: input.lots,
    price: input.price,
    iv: input.iv === undefined ? null : String(input.iv),
    position,
    ...extra,
  };
}

export function addDecimal(a: string, b: string): string {
  return toDecimal(Number(a) + Number(b));
}

/**
 * Square off `lots` of a leg (all of it when undefined) at `exitPrice`, splitting a partial exit into a closed
 * copy; returns the realised P&L of the closed part. Shared by the strategy routes and the positions exit (HC-TR-145).
 */
export async function closeLegRow(deps: AppDeps, strategy: StrategyRow, leg: LegRow, exitPrice: string, lots: number | undefined, lotSize: string, now: Date): Promise<string> {
  const db = deps.db;
  if (leg.status !== "open") throw errors.conflict("This leg is already squared off");
  const qty = lots ?? leg.lots;
  if (qty > leg.lots) throw errors.badRequest(`Exit quantity exceeds the leg's ${leg.lots} lots`);
  const closedPart = { side: leg.side, lots: qty, entryPrice: leg.entryPrice ?? leg.price, exitPrice };
  const realized = realizedPnl(closedPart, lotSize);
  if (qty < leg.lots) {
    await db.update(strategyLegs).set({ lots: leg.lots - qty, updatedAt: now }).where(eq(strategyLegs.id, leg.id));
    await db.insert(strategyLegs).values({
      ...legValues(strategy.id, { kind: leg.kind, side: leg.side, strike: leg.strike, expiry: leg.expiry, symbol: leg.symbol, lots: qty, price: leg.price, ...(leg.iv === null ? {} : { iv: Number(leg.iv) }) }, leg.position),
      entryPrice: leg.entryPrice ?? leg.price,
      exitPrice,
      status: "squared_off",
      isAdjustment: leg.isAdjustment,
      openedAt: leg.openedAt,
      closedAt: now,
    });
  } else {
    await db.update(strategyLegs).set({ exitPrice, status: "squared_off", closedAt: now, updatedAt: now }).where(eq(strategyLegs.id, leg.id));
  }
  return realized;
}

export function registerStrategyRoutes(app: OpenAPIHono<AppEnv>, deps: AppDeps): void {
  const guard = requireUser(deps.sessions);
  const db = deps.db;

  async function loadOwned(user: SessionUser, id: string): Promise<StrategyRow> {
    const [row] = await db
      .select()
      .from(strategies)
      .where(and(eq(strategies.id, id), eq(strategies.userId, user.id)))
      .limit(1);
    if (!row) throw errors.notFound("Strategy");
    return row;
  }
  async function legsOf(id: string): Promise<LegRow[]> {
    return db.select().from(strategyLegs).where(eq(strategyLegs.strategyId, id)).orderBy(asc(strategyLegs.position), asc(strategyLegs.createdAt));
  }
  const full = (row: StrategyRow) => loadStrategy(deps, row.id);
  const reload = (id: string) => loadStrategy(deps, id);
  const lotSizeFor = (user: SessionUser, asset: string) => lotSizeOf(deps, user, asset);
  async function brokerVisible(user: SessionUser, brokerId: string): Promise<boolean> {
    const [b] = await db
      .select({ id: brokers.id })
      .from(brokers)
      .where(and(eq(brokers.id, brokerId), or(eq(brokers.scope, "GLOBAL"), eq(brokers.ownerId, user.id))))
      .limit(1);
    return b !== undefined;
  }
  const touch = (id: string, patch: Partial<typeof strategies.$inferInsert> = {}) =>
    db.update(strategies).set({ ...patch, updatedAt: new Date() }).where(eq(strategies.id, id));
  const active = (row: StrategyRow) => row.status === "paper" || row.status === "live";

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/strategies",
      tags: ["strategies"],
      summary: "List your strategies, newest first (HC-TR-041, HC-TR-058, HC-TR-082)",
      security: cookieAuth,
      middleware: [guard],
      request: { query: ListQuery },
      responses: { 200: jsonContent(StrategyList, "Strategies"), 401: errorResponses[401] },
    }),
    async (c) => {
      const me = currentUser(c);
      const { status } = c.req.valid("query");
      const rows = await db
        .select()
        .from(strategies)
        .where(status ? and(eq(strategies.userId, me.id), eq(strategies.status, status)) : eq(strategies.userId, me.id))
        .orderBy(desc(strategies.createdAt), desc(strategies.id));
      if (rows.length === 0) return c.json({ items: [] }, 200);
      const ids = rows.map((r) => r.id);
      const [legs, pnl, orders] = await Promise.all([
        db.select().from(strategyLegs).where(inArray(strategyLegs.strategyId, ids)),
        db.select().from(strategyPnl).where(inArray(strategyPnl.strategyId, ids)),
        db.select().from(strategyOrders).where(inArray(strategyOrders.strategyId, ids)),
      ]);
      const items = rows.map((r) =>
        toStrategy(
          r,
          legs.filter((l) => l.strategyId === r.id),
          pnl.filter((p) => p.strategyId === r.id),
          orders.filter((o) => o.strategyId === r.id),
        ),
      );
      return c.json({ items }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/strategies",
      tags: ["strategies"],
      summary: "Save a draft (HC-TR-020, HC-TR-036); at most 8 legs on a new strategy (HC-TR-017)",
      security: cookieAuth,
      middleware: [guard],
      request: { body: { content: { "application/json": { schema: StrategyCreate } }, required: true } },
      responses: { 201: jsonContent(Strategy, "Created"), 400: errorResponses[400], 401: errorResponses[401] },
    }),
    async (c) => {
      const me = currentUser(c);
      const body = c.req.valid("json");
      const id = newId("strat");
      await db.insert(strategies).values({ id, userId: me.id, name: body.name, asset: body.asset, status: "draft", templateName: body.templateName });
      await db.insert(strategyLegs).values(body.legs.map((l, i) => legValues(id, l, i)));
      const out = await reload(id);
      await auditFrom(c, db)({ action: "strategy.create", target: `strategy:${id}`, before: null, after: out });
      return c.json(out, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/strategies/{id}",
      tags: ["strategies"],
      summary: "One strategy with legs and P&L history (HC-TR-068)",
      security: cookieAuth,
      middleware: [guard],
      request: { params: IdParam },
      responses: { 200: jsonContent(Strategy, "Strategy"), 401: errorResponses[401], 404: errorResponses[404] },
    }),
    async (c) => c.json(await full(await loadOwned(currentUser(c), c.req.valid("param").id)), 200),
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/v1/strategies/{id}",
      tags: ["strategies"],
      summary: "Rename, replace draft legs, edit notes and tags (HC-TR-020 Update)",
      security: cookieAuth,
      middleware: [guard],
      request: { params: IdParam, body: { content: { "application/json": { schema: StrategyPatch } }, required: true } },
      responses: { 200: jsonContent(Strategy, "Updated"), 400: errorResponses[400], 401: errorResponses[401], 404: errorResponses[404], 409: errorResponses[409] },
    }),
    async (c) => {
      const me = currentUser(c);
      const row = await loadOwned(me, c.req.valid("param").id);
      const body = c.req.valid("json");
      const before = await full(row);
      if (body.legs !== undefined) {
        if (row.status !== "draft") throw errors.conflict("Legs can only be replaced on a draft; use adjustments on an active strategy");
        await db.delete(strategyLegs).where(eq(strategyLegs.strategyId, row.id));
        await db.insert(strategyLegs).values(body.legs.map((l, i) => legValues(row.id, l, i)));
      }
      const patch: Partial<typeof strategies.$inferInsert> = {};
      if (body.name !== undefined) patch.name = body.name;
      if (body.templateName !== undefined) patch.templateName = body.templateName;
      if (body.notes !== undefined) patch.notes = body.notes;
      if (body.tags !== undefined) patch.tags = body.tags;
      await touch(row.id, patch);
      const after = await reload(row.id);
      await auditFrom(c, db)({ action: "strategy.update", target: `strategy:${row.id}`, before, after });
      return c.json(after, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/v1/strategies/{id}",
      tags: ["strategies"],
      summary: "Delete a strategy (HC-TR-048, HC-TR-065)",
      security: cookieAuth,
      middleware: [guard],
      request: { params: IdParam },
      responses: { 204: { description: "Deleted" }, 401: errorResponses[401], 404: errorResponses[404] },
    }),
    async (c) => {
      const me = currentUser(c);
      const row = await loadOwned(me, c.req.valid("param").id);
      const before = await full(row);
      await db.delete(strategies).where(eq(strategies.id, row.id));
      await auditFrom(c, db)({ action: "strategy.delete", target: `strategy:${row.id}`, before, after: null });
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/strategies/{id}/start",
      tags: ["strategies"],
      summary: "Start paper trading a draft at the given entry premiums (HC-TR-050..057)",
      security: cookieAuth,
      middleware: [guard],
      request: { params: IdParam, body: { content: { "application/json": { schema: StrategyStart } }, required: true } },
      responses: { 200: jsonContent(Strategy, "Started"), 400: errorResponses[400], 401: errorResponses[401], 404: errorResponses[404], 409: errorResponses[409] },
    }),
    async (c) => {
      const me = currentUser(c);
      const row = await loadOwned(me, c.req.valid("param").id);
      const body = c.req.valid("json");
      if (row.status !== "draft") throw errors.conflict(`Only a draft can be started; this strategy is ${row.status}`);
      if (body.mode === "live") throw errors.conflict("Live placement goes through /live/preview and /live/place (ADR-025)");
      await assertEntitled(deps, me.id, "paper_trading"); // HC-SH-054: plan limit per calendar month (ADR-030)
      if (!(await brokerVisible(me, body.brokerId))) throw errors.badRequest("Select an exchange...");
      const legs = await legsOf(row.id);
      if (legs.length === 0) throw errors.badRequest("Add at least one leg to trade");
      const before = toStrategy(row, legs, []);
      const now = new Date();
      for (const l of legs) {
        const entry = body.entries[l.id] ?? l.price;
        await db.update(strategyLegs).set({ entryPrice: entry, exitPrice: null, status: "open", openedAt: now, closedAt: null, price: entry, updatedAt: now }).where(eq(strategyLegs.id, l.id));
      }
      await touch(row.id, { status: "paper", tradingMode: "paper", brokerId: body.brokerId, startedAt: now, closedAt: null, realizedPnl: "0" });
      await db.delete(strategyPnl).where(eq(strategyPnl.strategyId, row.id));
      const after = await reload(row.id);
      await auditFrom(c, db)({ action: "strategy.start", target: `strategy:${row.id}`, before, after });
      return c.json(after, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/strategies/{id}/legs",
      tags: ["strategies"],
      summary: "Add adjustment legs to an active strategy, at most 10 open legs (HC-TR-071, HC-TR-017)",
      security: cookieAuth,
      middleware: [guard],
      request: { params: IdParam, body: { content: { "application/json": { schema: AddLegsBody } }, required: true } },
      responses: { 200: jsonContent(Strategy, "Updated"), 400: errorResponses[400], 401: errorResponses[401], 404: errorResponses[404], 409: errorResponses[409] },
    }),
    async (c) => {
      const me = currentUser(c);
      const row = await loadOwned(me, c.req.valid("param").id);
      if (!active(row)) throw errors.conflict("Adjustments apply to a paper or live strategy");
      const legs = await legsOf(row.id);
      const open = legs.filter((l) => l.status === "open").length;
      const body = c.req.valid("json");
      if (open + body.legs.length > MAX_OPEN_LEGS) throw errors.conflict(`Maximum ${MAX_OPEN_LEGS} active legs allowed per strategy`);
      const before = await full(row);
      const now = new Date();
      const nextPos = legs.reduce((m, l) => Math.max(m, l.position), -1) + 1;
      // paper: the client price is the entry; live: the entry is the venue fill, set by the executor
      const inserted = await db.insert(strategyLegs).values(body.legs.map((l, i) => legValues(row.id, l, nextPos + i, { entryPrice: row.status === "live" ? null : l.price, status: "open", isAdjustment: true, openedAt: row.status === "live" ? null : now }))).returning();
      if (row.status === "live") {
        // HC-TR-088: adjustment legs on a live strategy are real orders; a refused placement removes the leg again
        const blocked = await tradingBlockedReason(deps, me);
        if (blocked) {
          await db.delete(strategyLegs).where(inArray(strategyLegs.id, inserted.map((l) => l.id)));
          throw errors.conflict(blocked);
        }
        const creds = await openCredential(deps, me, row.brokerId ?? "");
        const plan = await planLegs(deps, inserted, await lotSizeFor(me, row.asset));
        if (plan.reasons.length) {
          await db.delete(strategyLegs).where(inArray(strategyLegs.id, inserted.map((l) => l.id)));
          throw errors.conflict(plan.reasons.join(" · "));
        }
        // a refused leg stays open with its failed order so Retry (HC-TR-085) can place it again
        await placeEntries(deps, creds, row, inserted, plan.legs, `adj:${newId("b")}`, "adjustment", {});
      }
      await touch(row.id);
      const after = await reload(row.id);
      await auditFrom(c, db)({ action: "strategy.adjust", target: `strategy:${row.id}`, before, after });
      return c.json(after, 200);
    },
  );

  const closeLeg = (strategy: StrategyRow, leg: LegRow, exitPrice: string, lots: number | undefined, lotSize: string, now: Date) => closeLegRow(deps, strategy, leg, exitPrice, lots, lotSize, now);

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/strategies/{id}/adjust",
      tags: ["strategies"],
      summary: "Adjustment batch: add legs, trim or close open legs, in one go (adjustment workbench, ADR-044; HC-TR-071, HC-TR-088)",
      security: cookieAuth,
      middleware: [guard],
      request: { params: IdParam, body: { content: { "application/json": { schema: AdjustBody } }, required: true } },
      responses: { 200: jsonContent(Strategy, "Adjusted"), 400: errorResponses[400], 401: errorResponses[401], 404: errorResponses[404], 409: errorResponses[409], 502: errorResponses[502] },
    }),
    async (c) => {
      const me = currentUser(c);
      const row = await loadOwned(me, c.req.valid("param").id);
      if (!active(row)) throw errors.conflict("Adjustments apply to a paper or live strategy");
      const body = c.req.valid("json");
      if (body.idempotencyKey) {
        const [seen] = await db.select({ id: strategyAdjustments.id }).from(strategyAdjustments).where(and(eq(strategyAdjustments.strategyId, row.id), eq(strategyAdjustments.batchId, body.idempotencyKey))).limit(1);
        if (seen) return c.json(await reload(row.id), 200); // repeat of the same batch
      }
      const legs = await legsOf(row.id);
      const open = legs.filter((l) => l.status === "open");
      // validate the changes against the open legs before touching anything
      const changes: { leg: LegRow; exitLots: number; price: string }[] = [];
      const seen = new Set<string>();
      for (const ch of body.changes) {
        const leg = open.find((l) => l.id === ch.legId);
        if (!leg) throw errors.badRequest(`Leg ${ch.legId} is not an open leg of this strategy`);
        if (seen.has(leg.id)) throw errors.badRequest(`${leg.symbol}: listed twice`);
        seen.add(leg.id);
        if (ch.lotsAfter > leg.lots) throw errors.badRequest(`${leg.symbol}: lots after (${ch.lotsAfter}) exceed the open ${leg.lots}; add lots through "adds"`);
        if (ch.lotsAfter === leg.lots) continue; // no-op
        changes.push({ leg, exitLots: leg.lots - ch.lotsAfter, price: ch.price });
      }
      if (changes.length === 0 && body.adds.length === 0) throw errors.badRequest("Nothing to adjust");
      const closes = changes.filter((x) => x.exitLots === x.leg.lots).length;
      if (open.length - closes + body.adds.length > MAX_OPEN_LEGS) throw errors.conflict(`Maximum ${MAX_OPEN_LEGS} active legs allowed per strategy`);
      const before = await full(row);
      const now = new Date();
      const lotSize = await lotSizeFor(me, row.asset);
      const batchId = body.idempotencyKey ?? `adj:${newId("b")}`;
      const nextPos = legs.reduce((m, l) => Math.max(m, l.position), -1) + 1;
      let creds: Awaited<ReturnType<typeof openCredential>> | null = null;
      if (row.status === "live") {
        // HC-TR-088: every check before the first order. Trims and closes are reduce-only rows; adds go through the same
        // guards as a placement (product state, sizing, notional cap, wallet). One refusal stops the batch before the
        // venue sees anything.
        const exits: PlanLeg[] = changes.map((x) => ({ id: x.leg.id, symbol: x.leg.symbol, side: x.leg.side === "buy" ? "sell" : "buy", lots: x.exitLots }));
        const entries: PlanLeg[] = body.adds.map((l, i) => ({ id: `new-${i + 1}`, symbol: l.symbol, side: l.side, lots: l.lots }));
        const p = await preview(deps, me, row, entries, row.brokerId ?? "", null, exits);
        if (p.reasons.length) throw errors.conflict(p.reasons.join(" · "));
        creds = await openCredential(deps, me, row.brokerId ?? "");
      }
      // The history row goes in first: (strategy, batch) is unique, so a concurrent repeat of the same key sees the
      // strategy as it is instead of placing twice. The key wins over the body: a different body under a used key is
      // ignored, so the client sends a fresh key for every Review.
      const adjId = newId("adj");
      try {
        await db.insert(strategyAdjustments).values({ id: adjId, strategyId: row.id, batchId, reason: body.reason ? body.reason : null, createdAt: now });
      } catch (e) {
        if (e instanceof Error && e.message.includes("strategy_adjustments_batch_uq")) return c.json(await reload(row.id), 200);
        throw e;
      }
      const done = { added: 0, trimmed: 0, closed: 0, realizedPnl: "0" };
      let total = row.realizedPnl;
      try {
        for (const ch of changes) {
          const whole = ch.exitLots === ch.leg.lots;
          const exit = creds ? await placeExit(deps, creds, me, row, ch.leg, ch.exitLots, batchId) : ch.price;
          const realized = await closeLeg(row, ch.leg, exit, whole ? undefined : ch.exitLots, lotSize, now);
          done.realizedPnl = addDecimal(done.realizedPnl, realized);
          total = addDecimal(total, realized);
          if (whole) done.closed += 1;
          else done.trimmed += 1;
          await touch(row.id, { realizedPnl: total }); // booked per fill, so a later refusal leaves nothing unbooked
        }
        if (body.adds.length) {
          // paper: the client price is the entry; live: the entry is the venue fill, set by the executor
          const inserted = await db.insert(strategyLegs).values(body.adds.map((l, i) => legValues(row.id, l, nextPos + i, { entryPrice: creds ? null : l.price, status: "open", isAdjustment: true, openedAt: creds ? null : now }))).returning();
          if (creds) {
            const plan = await planLegs(deps, inserted, lotSize);
            if (plan.reasons.length) {
              // the venue changed between the checks and now: the legs go again, nothing was placed
              await db.delete(strategyLegs).where(inArray(strategyLegs.id, inserted.map((l) => l.id)));
              throw errors.conflict(plan.reasons.join(" · "));
            }
            const expectedById: Record<string, string> = {};
            for (const l of inserted) {
              const mark = body.expected[l.symbol];
              if (mark !== undefined) expectedById[l.id] = mark;
            }
            // a refused leg stays open with its failed order so Retry (HC-TR-085) can place it again
            await placeEntries(deps, creds, row, inserted, plan.legs, batchId, "adjustment", expectedById, body.orderType);
          }
          done.added = inserted.length;
        }
      } catch (e) {
        // HC-TR-088: what filled stays booked; the history row says where the batch stopped, and the client rebuilds the
        // rest from the strategy as it is, under a new key
        const why = e instanceof Error ? e.message : String(e);
        await db.update(strategyAdjustments).set({ ...done, reason: `${body.reason ? `${body.reason} · ` : ""}Stopped: ${why}` }).where(eq(strategyAdjustments.id, adjId));
        throw e;
      }
      await db.update(strategyAdjustments).set(done).where(eq(strategyAdjustments.id, adjId));
      await touch(row.id);
      const after = await reload(row.id);
      await auditFrom(c, db)({ action: "strategy.adjust", target: `strategy:${row.id}`, before, after });
      return c.json(after, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/strategies/{id}/legs/{legId}/close",
      tags: ["strategies"],
      summary: "Square off one leg fully or partially (HC-TR-014, HC-TR-079, HC-TR-080)",
      security: cookieAuth,
      middleware: [guard],
      request: { params: LegParam, body: { content: { "application/json": { schema: CloseLegBody } }, required: true } },
      responses: { 200: jsonContent(Strategy, "Updated"), 400: errorResponses[400], 401: errorResponses[401], 404: errorResponses[404], 409: errorResponses[409] },
    }),
    async (c) => {
      const me = currentUser(c);
      const { id, legId } = c.req.valid("param");
      const row = await loadOwned(me, id);
      if (!active(row)) throw errors.conflict("Only legs of a paper or live strategy can be squared off");
      const [leg] = await db.select().from(strategyLegs).where(and(eq(strategyLegs.id, legId), eq(strategyLegs.strategyId, row.id))).limit(1);
      if (!leg) throw errors.notFound("Leg");
      const body = c.req.valid("json");
      const before = await full(row);
      const now = new Date();
      const exitPrice = row.status === "live" ? await placeExit(deps, await openCredential(deps, me, row.brokerId ?? ""), me, row, leg, body.lots ?? leg.lots, `exit:${newId("b")}`) : body.exitPrice;
      const realized = await closeLeg(row, leg, exitPrice, body.lots, await lotSizeFor(me, row.asset), now);
      await touch(row.id, { realizedPnl: addDecimal(row.realizedPnl, realized) });
      const after = await reload(row.id);
      await auditFrom(c, db)({ action: "leg.close", target: `strategy:${row.id}:leg:${legId}`, before, after });
      return c.json(after, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/strategies/{id}/close",
      tags: ["strategies"],
      summary: "Square off every open leg at the given exits (HC-TR-070, HC-TR-072, HC-TR-086)",
      security: cookieAuth,
      middleware: [guard],
      request: { params: IdParam, body: { content: { "application/json": { schema: CloseAllBody } }, required: true } },
      responses: { 200: jsonContent(Strategy, "Updated"), 400: errorResponses[400], 401: errorResponses[401], 404: errorResponses[404], 409: errorResponses[409] },
    }),
    async (c) => {
      const me = currentUser(c);
      const row = await loadOwned(me, c.req.valid("param").id);
      if (!active(row)) throw errors.conflict("Only a paper or live strategy can be squared off");
      const body = c.req.valid("json");
      const legs = (await legsOf(row.id)).filter((l) => l.status === "open");
      if (legs.length === 0) throw errors.conflict("Nothing to square off");
      if (row.status !== "live") for (const l of legs) if (body.exits[l.id] === undefined) throw errors.badRequest(`Missing exit price for leg ${l.id}`);
      const before = await full(row);
      const lotSize = await lotSizeFor(me, row.asset);
      const now = new Date();
      let realized = row.realizedPnl;
      const creds = row.status === "live" ? await openCredential(deps, me, row.brokerId ?? "") : null;
      const batch = `exit:${newId("b")}`;
      for (const l of legs) {
        const exit = creds ? await placeExit(deps, creds, me, row, l, l.lots, batch) : body.exits[l.id]!;
        realized = addDecimal(realized, await closeLeg(row, l, exit, undefined, lotSize, now));
      }
      await touch(row.id, row.status === "live" ? { realizedPnl: realized, status: "archived", closedAt: now } : { realizedPnl: realized });
      const after = await reload(row.id);
      await auditFrom(c, db)({ action: "strategy.close_all", target: `strategy:${row.id}`, before, after });
      return c.json(after, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/strategies/{id}/reconcile",
      tags: ["strategies"],
      summary: "Book lots closed outside the app at the given prices; no order is sent (HC-TR-161, ADR-059)",
      security: cookieAuth,
      middleware: [guard],
      request: { params: IdParam, body: { content: { "application/json": { schema: ReconcileBody } }, required: true } },
      responses: { 200: jsonContent(Strategy, "Updated"), 400: errorResponses[400], 401: errorResponses[401], 404: errorResponses[404], 409: errorResponses[409] },
    }),
    async (c) => {
      const me = currentUser(c);
      const row = await loadOwned(me, c.req.valid("param").id);
      if (!active(row)) throw errors.conflict("Only a paper or live strategy can be reconciled");
      const body = c.req.valid("json");
      const open = (await legsOf(row.id)).filter((l) => l.status === "open");
      const seen = new Set<string>();
      for (const x of body.legs) {
        const l = open.find((y) => y.id === x.legId);
        if (!l) throw errors.badRequest(`Leg ${x.legId} is not an open leg of this strategy`);
        if (seen.has(l.id)) throw errors.badRequest(`${l.symbol}: listed twice`);
        seen.add(l.id);
        if (x.lots !== undefined && x.lots > l.lots) throw errors.badRequest(`${l.symbol}: ${x.lots} lots exceed the open ${l.lots}`);
      }
      const before = await full(row);
      const lotSize = await lotSizeFor(me, row.asset);
      const now = new Date();
      // the exchange already closed these lots (a stop, a manual close, a liquidation): book them, send nothing
      const adjId = newId("adj");
      const batchId = `reconcile:${newId("b")}`;
      await db.insert(strategyAdjustments).values({ id: adjId, strategyId: row.id, batchId, reason: `closed outside the app${body.reason ? `: ${body.reason}` : ""}`, createdAt: now });
      const done = { added: 0, trimmed: 0, closed: 0, realizedPnl: "0" };
      let total = row.realizedPnl;
      for (const x of body.legs) {
        const l = open.find((y) => y.id === x.legId)!;
        const whole = x.lots === undefined || x.lots === l.lots;
        const realized = await closeLeg(row, l, x.price, whole ? undefined : x.lots, lotSize, now);
        done.realizedPnl = addDecimal(done.realizedPnl, realized);
        total = addDecimal(total, realized);
        if (whole) done.closed += 1;
        else done.trimmed += 1;
      }
      await db.update(strategyAdjustments).set(done).where(eq(strategyAdjustments.id, adjId));
      const left = (await legsOf(row.id)).filter((l) => l.status === "open").length;
      await touch(row.id, left === 0 ? { realizedPnl: total, status: "archived", closedAt: now } : { realizedPnl: total });
      const after = await reload(row.id);
      await auditFrom(c, db)({ action: "strategy.reconcile", target: `strategy:${row.id}`, before, after });
      return c.json(after, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/strategies/{id}/stop",
      tags: ["strategies"],
      summary: "Stop paper trading: archive with legs squared off, or keep as a draft (HC-TR-064, HC-TR-081)",
      security: cookieAuth,
      middleware: [guard],
      request: { params: IdParam, body: { content: { "application/json": { schema: StopBody } }, required: true } },
      responses: { 200: jsonContent(Strategy, "Updated"), 400: errorResponses[400], 401: errorResponses[401], 404: errorResponses[404], 409: errorResponses[409] },
    }),
    async (c) => {
      const me = currentUser(c);
      const row = await loadOwned(me, c.req.valid("param").id);
      if (row.status !== "paper") throw errors.conflict("Only a paper strategy can be stopped");
      const body = c.req.valid("json");
      const before = await full(row);
      const legs = await legsOf(row.id);
      const open = legs.filter((l) => l.status === "open");
      const now = new Date();
      if (body.archive) {
        for (const l of open) if (body.exits[l.id] === undefined) throw errors.badRequest(`Missing exit price for leg ${l.id}`);
        const lotSize = await lotSizeFor(me, row.asset);
        let realized = row.realizedPnl;
        for (const l of open) realized = addDecimal(realized, await closeLeg(row, l, body.exits[l.id]!, undefined, lotSize, now));
        await touch(row.id, { realizedPnl: realized, status: "archived", closedAt: now });
      } else {
        for (const l of open) await db.update(strategyLegs).set({ price: l.entryPrice ?? l.price, entryPrice: null, openedAt: null, updatedAt: now }).where(eq(strategyLegs.id, l.id));
        await touch(row.id, { status: "draft", tradingMode: null, startedAt: null, closedAt: null });
      }
      const after = await reload(row.id);
      await auditFrom(c, db)({ action: body.archive ? "strategy.stop_archive" : "strategy.stop_draft", target: `strategy:${row.id}`, before, after });
      return c.json(after, 200);
    },
  );

  for (const kind of ["archive", "restore"] as const) {
    app.openapi(
      createRoute({
        method: "post",
        path: `/v1/strategies/{id}/${kind}`,
        tags: ["strategies"],
        summary: kind === "archive" ? "Archive a draft (HC-TR-047)" : "Restore an archived strategy to a draft (ADR-010)",
        security: cookieAuth,
        middleware: [guard],
        request: { params: IdParam },
        responses: { 200: jsonContent(Strategy, "Updated"), 401: errorResponses[401], 404: errorResponses[404], 409: errorResponses[409] },
      }),
      async (c) => {
        const me = currentUser(c);
        const row = await loadOwned(me, c.req.valid("param").id);
        const from = kind === "archive" ? "draft" : "archived";
        if (row.status !== from) throw errors.conflict(`Only a ${from} strategy can be ${kind}d`);
        const before = await full(row);
        const now = new Date();
        await touch(row.id, kind === "archive" ? { status: "archived", closedAt: now } : { status: "draft", tradingMode: null, closedAt: null });
        const after = await reload(row.id);
        await auditFrom(c, db)({ action: `strategy.${kind}`, target: `strategy:${row.id}`, before, after });
        return c.json(after, 200);
      },
    );
  }

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/strategies/{id}/pnl",
      tags: ["strategies"],
      summary: "Record the day's P&L point for the history chart (HC-TR-076)",
      security: cookieAuth,
      middleware: [guard],
      request: { params: IdParam, body: { content: { "application/json": { schema: PnlUpsert } }, required: true } },
      responses: { 200: jsonContent(Strategy, "Updated"), 400: errorResponses[400], 401: errorResponses[401], 404: errorResponses[404], 409: errorResponses[409] },
    }),
    async (c) => {
      const me = currentUser(c);
      const row = await loadOwned(me, c.req.valid("param").id);
      if (!active(row)) throw errors.conflict("P&L history is recorded for paper and live strategies");
      const body = c.req.valid("json");
      const now = new Date();
      await db
        .insert(strategyPnl)
        .values({ strategyId: row.id, day: body.day, pnl: body.pnl })
        .onConflictDoUpdate({ target: [strategyPnl.strategyId, strategyPnl.day], set: { pnl: body.pnl, updatedAt: now } });
      return c.json(await reload(row.id), 200);
    },
  );
}
