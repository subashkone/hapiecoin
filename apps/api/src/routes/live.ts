/**
 * Live trading routes (Phase 3 item 2, ADR-025): preview, place, retry, sync, Trade All → Live batch,
 * positions, and the admin kill switch. HC-TR-023, 055, 063, 070, 082..089.
 */
import { type AdjustChange, Id, LiveBatchBody, LiveBatchPreview, LiveBatchPreviewBody, type LiveBatchPreviewItem, LiveBatchResult, LivePlaceBody, toDecimal, LivePositions, LivePositionsExitBody, LivePositionsExitResult, LivePreview, LivePreviewBody, MAX_OPEN_LEGS, Strategy, type StrategyLegInput, ApiError, LiveRetryBody, MindfulPreview, LiveRepriceBody } from "@hapiecoin/schema";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { and, asc, eq } from "drizzle-orm";
import { auditFrom } from "../audit.js";
import { enforceMindful, mindfulFor } from "../day-pnl.js";
import { assertEntitled } from "../entitlements.js";
import { brokerCredentials, strategies, strategyLegs, strategyPnl, users } from "../db/schema.js";
import { type AppEnv, type SessionUser, currentUser } from "../security/context.js";
import { HttpError, errors } from "../security/errors.js";
import { requireAdmin, requireUser } from "../security/guards.js";
import { orderRateLimit } from "../security/rate-limit.js";
import { lotSizeFor, openCredential, ordersOf, placeEntries, preview, resolveAccount, retryFailed, syncOrders, tradingBlockedReason, type PlanLeg, type StrategyRow, type WalletCache, brokerVenueOf, requireLiveConfirm, cancelResting, repriceResting } from "./live-exec.js";
import { type AppDeps, cookieAuth, errorResponses, jsonContent, errorMessage } from "./shared.js";

/** The exchange did not answer the positions read (never an empty list, HC-TR-160). */
const exchangeUnavailable = jsonContent(ApiError, "Exchange unavailable");
import { addDecimal, bookExitFills, closeLegRow, disarmRules, freshTotal, loadStrategy } from "./strategies.js";

const IdParam = z.object({ id: Id });
const OrderParam = z.object({ id: Id, orderId: Id });
const PreviewBody = LivePreviewBody.extend({ worstLoss: z.number().optional() });

export function registerLiveRoutes(app: OpenAPIHono<AppEnv>, deps: AppDeps): void {
  const guard = requireUser(deps.sessions);
  // GAPS #70: the routes that send orders get a per-user budget on top of the global one (ADR-061)
  const orderLimit = orderRateLimit(deps.rateStore, { windowMs: 60_000, max: deps.config.orderRateMaxPerMin });
  const db = deps.db;

  async function owned(user: SessionUser, id: string): Promise<StrategyRow> {
    const [row] = await db.select().from(strategies).where(and(eq(strategies.id, id), eq(strategies.userId, user.id))).limit(1);
    if (!row) throw errors.notFound("Strategy");
    return row;
  }
  const openLegs = (id: string) => db.select().from(strategyLegs).where(and(eq(strategyLegs.strategyId, id), eq(strategyLegs.status, "open"))).orderBy(asc(strategyLegs.position));
  const touch = (id: string, patch: Partial<typeof strategies.$inferInsert> = {}) => db.update(strategies).set({ ...patch, updatedAt: new Date() }).where(eq(strategies.id, id));

  /** Preview or place: shared checks. Returns the plan or throws 409 with every reason. */
  /** The account a call trades through: the body's, else the one the strategy already names (ADR-068). */
  const accountOf = (row: StrategyRow, body: { accountId?: string | undefined }): string | null => body.accountId ?? row.accountId ?? null;
  async function checkedPreview(user: SessionUser, row: StrategyRow, brokerId: string, worstLoss: number | null, accountId: string | null, mindful?: MindfulPreview, wallets?: WalletCache) {
    const legs = await openLegs(row.id);
    // ADR-084: the server's day figure, computed once per request (the batch hands the same one to every strategy)
    const m = mindful ?? (await mindfulFor(deps, user, deps.mindful.now()));
    const p = await preview(deps, user, row, legs, brokerId, worstLoss, [], accountId, m, wallets);
    return { legs, p };
  }
  /**
   * Trade All → Live as one batch (GAPS #4, ADR-087): every paper strategy's own preview, then the wallet against the
   * premiums the batch pays together, per account it trades through. Returns the items, the whole, and the plans the
   * placement loop reuses; a strategy that is not the trader's paper strategy is an item with `paper: false`.
   */
  async function batchPreview(user: SessionUser, ids: readonly string[], brokerId: string, accountId: string | null, mindful?: MindfulPreview) {
    const items: LiveBatchPreviewItem[] = [];
    const plans = new Map<string, { row: StrategyRow; legs: Awaited<ReturnType<typeof openLegs>>; p: LivePreview; rowAccount: string | null }>();
    const wallets = new Map<string, { available: number; asset: string; debit: number; count: number }>();
    const walletReads: WalletCache = new Map(); // the exchange asked once per account, not once per strategy
    // a strategy naming no account trades through the exchange's only key (ADR-068): name it, so it shares that key's wallet group
    const keys = await db.select({ id: brokerCredentials.id }).from(brokerCredentials).where(and(eq(brokerCredentials.userId, user.id), eq(brokerCredentials.brokerId, brokerId)));
    const onlyKey = keys.length === 1 ? (keys[0]?.id ?? null) : null;
    let notional = 0;
    let debit = 0;
    let available: string | null = null;
    let availableAsset: string | null = null;
    let marginUsed: string | null = null;
    let limits: LivePreview["limits"] = { maxLegs: deps.config.trading.maxLegs, maxNotionalUsd: deps.config.trading.maxNotionalUsd, markBandPct: deps.config.trading.markBandPct };
    for (const id of ids) {
      const [row] = await db.select().from(strategies).where(and(eq(strategies.id, id), eq(strategies.userId, user.id))).limit(1);
      if (!row || row.status !== "paper") {
        items.push({ id, name: row?.name ?? id, paper: false, ok: false, reasons: [row ? `Already ${row.status}: skipped` : "Not one of your strategies: skipped"], legs: [], notional: "0.00", debit: "0.00" });
        continue;
      }
      const rowAccount = row.accountId ?? accountId ?? onlyKey;
      const { legs, p } = await checkedPreview(user, row, brokerId, null, rowAccount, mindful, walletReads); // the preview names a venue mismatch itself (ADR-065)
      const own = p.legs.reduce((sum, l) => sum + (l.side === "buy" ? 1 : -1) * Number(l.notional), 0);
      items.push({ id, name: row.name, paper: true, ok: p.ok, reasons: p.reasons, legs: p.legs, notional: p.notional, debit: toDecimal(own, 2) });
      plans.set(id, { row, legs, p, rowAccount });
      notional += Number(p.notional);
      debit += own;
      limits = p.limits;
      if (p.available !== null) {
        available ??= p.available;
        availableAsset ??= p.availableAsset;
        marginUsed ??= p.marginUsed;
        const key = rowAccount ?? "";
        const w = wallets.get(key) ?? { available: Number(p.available), asset: p.availableAsset ?? "USD", debit: 0, count: 0 };
        w.debit += Math.max(own, 0); // premiums received are not netted: the strategies go out one at a time, in the order given
        w.count += 1;
        wallets.set(key, w);
      }
    }
    // the batch rule: the premiums paid together leave one wallet at placement (GAPS #81's rule for the whole)
    const reasons: string[] = [];
    for (const w of wallets.values()) if (w.count > 1 && w.debit > w.available) reasons.push(`Available ${w.asset} ${toDecimal(w.available, 2)} is below the premium these ${w.count} trades pay together (${toDecimal(w.debit, 2)})`);
    const ok = reasons.length === 0 && items.filter((i) => i.paper).every((i) => i.ok);
    // several wallets: no single available or margin figure is honest for the whole (the items' reasons name each wallet's rule)
    const one = wallets.size <= 1;
    const whole: LiveBatchPreview = { items, ok, reasons, notional: toDecimal(notional, 2), debit: toDecimal(debit, 2), available: one ? available : null, availableAsset: one ? availableAsset : null, marginUsed: one ? marginUsed : null, limits };
    return { whole, plans };
  }
  /** One sentence per refused strategy plus the batch's own reasons, for the 409 that keeps every order from going out. */
  const batchRefusal = (whole: LiveBatchPreview): string =>
    [...whole.items.filter((i) => i.paper && !i.ok).map((i) => `${i.name}: ${i.reasons.join(" · ")}`), ...whole.reasons].join(" · ");
  /** Adjustment workbench (ADR-044): price the proposed batch, not the open legs: trims / closes as reduce-only exits, adds as entries. */
  async function adjustPreview(user: SessionUser, row: StrategyRow, brokerId: string, worstLoss: number | null, adds: readonly StrategyLegInput[], changes: readonly AdjustChange[], accountId: string | null) {
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
    // ADR-084: adds are a new bet, so the workbench preview carries the pause too; trims and closes never wait
    const m = entries.length > 0 ? await mindfulFor(deps, user, deps.mindful.now()) : null;
    const p = await preview(deps, user, row, entries, brokerId, worstLoss, exits, accountId, m);
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
      const p = body.adds !== undefined || body.changes !== undefined ? await adjustPreview(me, row, body.brokerId, body.worstLoss ?? null, body.adds ?? [], body.changes ?? [], accountOf(row, body)) : (await checkedPreview(me, row, body.brokerId, body.worstLoss ?? null, accountOf(row, body))).p;
      if (p.mindful?.pause) deps.mindful.note(me.id, row.id); // ADR-084: the pause starts when the trader sees it
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
      middleware: [guard, orderLimit],
      request: { params: IdParam, body: { content: { "application/json": { schema: LivePlaceBody } }, required: true } },
      responses: { 200: jsonContent(Strategy, "Placed"), 400: errorResponses[400], 401: errorResponses[401], 404: errorResponses[404], 409: errorResponses[409], 502: errorResponses[502] },
    }),
    async (c) => {
      const me = currentUser(c);
      const row = await owned(me, c.req.valid("param").id);
      const body = c.req.valid("json");
      const existing = (await ordersOf(deps, row.id)).some((o) => o.batchId === body.idempotencyKey);
      if (existing) return c.json(await loadStrategy(deps, row.id), 200); // repeat of the same placement (idempotency key)
      requireLiveConfirm(body.confirm); // ADR-078: the typed word, before any other check
      if (row.status !== "draft" && row.status !== "paper") throw errors.conflict(`Only a draft or paper strategy can go live; this strategy is ${row.status}`);
      await assertEntitled(deps, me.id, "live_trading"); // HC-SH-054 (ADR-030)
      const accountId = accountOf(row, body);
      const { legs, p } = await checkedPreview(me, row, body.brokerId, null, accountId);
      if (!p.ok) throw errors.conflict(p.reasons.join(" · "));
      if (p.mindful) enforceMindful(deps, me, row.id, p.mindful); // ADR-084: delayed, not refused, until the pause shown at preview has passed
      const { creds, accountId: keyId } = await resolveAccount(deps, me, body.brokerId, row.venue, accountId); // ADR-065, ADR-068
      const before = await loadStrategy(deps, row.id);
      const now = new Date();
      await touch(row.id, { status: "live", tradingMode: "live", brokerId: body.brokerId, accountId: keyId, orderBatchId: body.idempotencyKey, startedAt: row.startedAt ?? now, closedAt: null, realizedPnl: "0" });
      await db.delete(strategyPnl).where(eq(strategyPnl.strategyId, row.id)); // ADR-084: the paper run's realised P&L and its points are not this live run's day figure
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
      middleware: [guard, orderLimit],
      request: { params: IdParam, body: { content: { "application/json": { schema: LiveRetryBody } }, required: true } },
      responses: { 200: jsonContent(Strategy, "Retried"), 400: errorResponses[400], 401: errorResponses[401], 404: errorResponses[404], 409: errorResponses[409] },
    }),
    async (c) => {
      const me = currentUser(c);
      const row = await owned(me, c.req.valid("param").id);
      requireLiveConfirm(c.req.valid("json").confirm); // ADR-078: a retry sends real orders again
      if (row.status !== "live" || !row.brokerId) throw errors.conflict("Only a live strategy has orders to retry");
      const blocked = await tradingBlockedReason(deps, me);
      if (blocked) throw errors.conflict(blocked);
      const creds = await openCredential(deps, me, row.brokerId, undefined, row.accountId);
      const before = await loadStrategy(deps, row.id);
      const outcome = await retryFailed(deps, creds, me, row);
      await touch(row.id);
      const after = await loadStrategy(deps, row.id);
      await auditFrom(c, db)({ action: "strategy.live_retry", target: `strategy:${row.id}`, before, after: { ...after, outcome } });
      return c.json(after, 200);
    },
  );

  // GAPS #61 / ADR-083: a resting limit entry can be pulled or moved from the app
  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/strategies/{id}/live/orders/{orderId}/cancel",
      tags: ["live"],
      summary: "Cancel a resting limit entry on the exchange (HC-TR-187)",
      security: cookieAuth,
      middleware: [guard, orderLimit],
      request: { params: OrderParam },
      responses: { 200: jsonContent(Strategy, "Cancelled, or filled before the cancel reached the exchange"), 401: errorResponses[401], 404: errorResponses[404], 409: errorResponses[409] },
    }),
    async (c) => {
      const me = currentUser(c);
      const { id, orderId } = c.req.valid("param");
      const row = await owned(me, id);
      if (row.status !== "live" || !row.brokerId) throw errors.conflict("Only a live strategy has orders to cancel");
      // no typed word and no kill-switch refusal: pulling a resting order reduces exposure (ADR-078's line)
      const creds = await openCredential(deps, me, row.brokerId, undefined, row.accountId);
      const before = await loadStrategy(deps, row.id);
      const outcome = await cancelResting(deps, creds, row, orderId);
      await touch(row.id);
      const after = await loadStrategy(deps, row.id);
      await auditFrom(c, db)({ action: "strategy.live_cancel_order", target: `strategy:${row.id}`, before, after: { ...after, outcome, orderId } });
      return c.json(after, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/strategies/{id}/live/orders/{orderId}/reprice",
      tags: ["live"],
      summary: "Move a resting limit entry's price in place (HC-TR-188)",
      security: cookieAuth,
      middleware: [guard, orderLimit],
      request: { params: OrderParam, body: { content: { "application/json": { schema: LiveRepriceBody } }, required: true } },
      responses: { 200: jsonContent(Strategy, "Re-priced, or filled at the new price"), 400: errorResponses[400], 401: errorResponses[401], 404: errorResponses[404], 409: errorResponses[409] },
    }),
    async (c) => {
      const me = currentUser(c);
      const { id, orderId } = c.req.valid("param");
      const body = c.req.valid("json");
      const row = await owned(me, id);
      requireLiveConfirm(body.confirm); // ADR-078: the order stays live at a new price and can fill
      if (row.status !== "live" || !row.brokerId) throw errors.conflict("Only a live strategy has orders to re-price");
      const blocked = await tradingBlockedReason(deps, me);
      if (blocked) throw errors.conflict(blocked);
      const creds = await openCredential(deps, me, row.brokerId, undefined, row.accountId);
      const before = await loadStrategy(deps, row.id);
      const outcome = await repriceResting(deps, creds, row, orderId, body.limitPrice);
      await touch(row.id);
      const after = await loadStrategy(deps, row.id);
      await auditFrom(c, db)({ action: "strategy.live_reprice_order", target: `strategy:${row.id}`, before, after: { ...after, outcome, orderId } });
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
      const creds = await openCredential(deps, me, row.brokerId, undefined, row.accountId);
      const { updated, exitFills } = await syncOrders(deps, creds, row);
      await bookExitFills(deps, row, exitFills);
      if (updated) await touch(row.id);
      return c.json(await loadStrategy(deps, row.id), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/strategies/live/batch/preview",
      tags: ["live"],
      summary: "Trade All → Live previewed as one batch: every strategy's check and the wallet against the premiums together (HC-TR-191, ADR-087)",
      security: cookieAuth,
      middleware: [guard],
      request: { body: { content: { "application/json": { schema: LiveBatchPreviewBody } }, required: true } },
      responses: { 200: jsonContent(LiveBatchPreview, "Batch preview"), 400: errorResponses[400], 401: errorResponses[401] },
    }),
    async (c) => {
      const me = currentUser(c);
      const body = c.req.valid("json");
      const brokerVenue = await brokerVenueOf(deps, me, body.brokerId);
      if (brokerVenue === null) throw errors.badRequest("Select an exchange...");
      const mindful = await mindfulFor(deps, me, deps.mindful.now()); // ADR-084: one figure for the whole batch
      if (mindful.pause) deps.mindful.note(me.id, "batch"); // the batch preview is where the trader sees the pause
      const { whole } = await batchPreview(me, body.ids, body.brokerId, body.accountId ?? null, mindful);
      return c.json(whole, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/strategies/live/batch",
      tags: ["live"],
      summary: "Trade All → Live: one combined preview, then every ticked paper strategy placed in order, stopping at the first venue failure (HC-TR-089, HC-TR-191, ADR-010, ADR-087)",
      security: cookieAuth,
      middleware: [guard, orderLimit],
      request: { body: { content: { "application/json": { schema: LiveBatchBody } }, required: true } },
      responses: { 200: jsonContent(LiveBatchResult, "Batch outcome"), 400: errorResponses[400], 401: errorResponses[401], 409: errorResponses[409] },
    }),
    async (c) => {
      const me = currentUser(c);
      const body = c.req.valid("json");
      requireLiveConfirm(body.confirm); // ADR-078
      const blocked = await tradingBlockedReason(deps, me);
      if (blocked) throw errors.conflict(blocked);
      await assertEntitled(deps, me.id, "live_trading"); // one check per batch: the batch counts as one placement per strategy below
      // ADR-068: each strategy goes through the account it already names (paper started on Sub 1 stays on Sub 1),
      // else the batch's chosen account, else the exchange's only key; one key opened per distinct account
      const brokerVenue = await brokerVenueOf(deps, me, body.brokerId);
      if (brokerVenue === null) throw errors.badRequest("Select an exchange..."); // an exchange the trader cannot see: refused before any row is touched
      // ADR-087: one combined preview first; a refusal anywhere in it keeps every order from going out
      const mindful = await mindfulFor(deps, me, deps.mindful.now()); // ADR-084: one figure for the whole batch
      const { whole, plans } = await batchPreview(me, body.ids, body.brokerId, body.accountId ?? null, mindful);
      if (!whole.ok) throw errors.conflict(batchRefusal(whole));
      const opened = new Map<string, Awaited<ReturnType<typeof resolveAccount>>>();
      const placed: string[] = [];
      const skipped: string[] = [];
      let failed: { id: string; error: string } | null = null;
      // ADR-084: one day figure for the whole batch; a pause not yet taken refuses the batch before any placement
      enforceMindful(deps, me, "batch", mindful);
      for (const id of body.ids) {
        const key = `${body.idempotencyKey}:${id}`;
        const plan = plans.get(id);
        if (!plan) {
          const [row] = await db.select({ status: strategies.status, orderBatchId: strategies.orderBatchId }).from(strategies).where(and(eq(strategies.id, id), eq(strategies.userId, me.id))).limit(1);
          if (row?.status === "live" && row.orderBatchId === key) placed.push(id); // this very batch already placed it: a repeat answers the same result
          else skipped.push(id);
          continue;
        }
        const { row, legs, p, rowAccount } = plan;
        let resolved = opened.get(rowAccount ?? "");
        if (!resolved) {
          try {
            resolved = await resolveAccount(deps, me, body.brokerId, undefined, rowAccount);
          } catch (e) {
            failed = { id, error: e instanceof HttpError ? e.message : errorMessage(e) }; // no key to trade through: the batch stops here
            break;
          }
          opened.set(rowAccount ?? "", resolved);
        }
        const before = await loadStrategy(deps, row.id);
        // the flip to live is guarded on the row still being paper: a second batch from another tab cannot place it twice
        const [moved] = await db.update(strategies).set({ status: "live", tradingMode: "live", brokerId: body.brokerId, accountId: resolved.accountId, orderBatchId: key, realizedPnl: "0", updatedAt: new Date() }).where(and(eq(strategies.id, row.id), eq(strategies.status, "paper"))).returning({ id: strategies.id });
        if (!moved) {
          skipped.push(id);
          continue;
        }
        await db.delete(strategyPnl).where(eq(strategyPnl.strategyId, row.id)); // ADR-084: the paper run's realised P&L and its points are not the live run's day figure
        const outcome = await placeEntries(deps, resolved.creds, row, legs, p.legs, key, "entry", {});
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

  // ADR-084: the server's day figure and the pause it decides; reading it starts the batch's pause clock
  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/me/day-pnl",
      tags: ["live"],
      summary: "Today's live P&L as the server knows it, and the Mindful pause it decides (HC-TR-189)",
      security: cookieAuth,
      middleware: [guard],
      responses: { 200: jsonContent(MindfulPreview, "The day figure and the pause"), 401: errorResponses[401] },
    }),
    async (c) => {
      const me = currentUser(c);
      const m = await mindfulFor(deps, me, deps.mindful.now());
      if (m.pause) deps.mindful.note(me.id, "batch");
      return c.json(m, 200);
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
      request: { query: z.object({ brokerId: Id, accountId: Id.optional() }) },
      responses: { 200: jsonContent(LivePositions, "Positions"), 400: errorResponses[400], 401: errorResponses[401], 409: errorResponses[409], 503: exchangeUnavailable },
    }),
    async (c) => {
      const me = currentUser(c);
      const q = c.req.valid("query");
      const { creds, venue } = await resolveAccount(deps, me, q.brokerId, undefined, q.accountId ?? null);
      const client = deps.tradingFor(venue); // ADR-070: the account's exchange answers
      const [raw, balances] = await Promise.all([client.getPositions(creds), client.getBalances(creds)]).catch((e: unknown) => {
        // an unreadable venue is 503, never "no positions": the Live tab's drift check must not read it as "holds nothing"
        deps.logger.warn({ err: errorMessage(e), userId: me.id }, "positions read failed");
        throw errors.unavailable("The exchange did not answer the positions read · try again in a moment");
      });
      // HC-TR-144: the client sizes lots and P&L from contract value and mark; unknown products stay null
      const positions = await Promise.all(
        raw.map(async (p) => {
          const [product, mark] = p.symbol ? await Promise.all([client.getProduct(p.symbol).catch(() => null), client.getMark(p.symbol).catch(() => null)]) : [null, null];
          return { ...p, contractValue: product?.contractValue ?? null, mark };
        }),
      );
      return c.json({ positions, balances, venue }, 200); // the venue names the symbol codec for the client (ADR-070)
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
      const realized = await closeLegRow(deps, strategy, leg, fill, undefined, await lotSizeFor(deps, me, strategy.asset, strategy.venue), new Date());
      const stillOpen = await db.select({ id: strategyLegs.id }).from(strategyLegs).where(and(eq(strategyLegs.strategyId, strategy.id), eq(strategyLegs.status, "open"))).limit(1);
      await touch(strategy.id, { realizedPnl: addDecimal(await freshTotal(deps, strategy.id, strategy.realizedPnl), realized), ...(stillOpen.length === 0 ? { status: "archived" as const, closedAt: new Date(), closeReason: "squared_off" as const } : {}) });
      if (stillOpen.length === 0) await disarmRules(deps, strategy.id, "disarmed: the strategy was squared off from the positions list");
    }
  }

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/strategies/live/positions/exit",
      tags: ["live"],
      summary: "Square off exchange positions with reduce-only market orders; matching live legs are closed at the fill (HC-TR-145)",
      security: cookieAuth,
      middleware: [guard, orderLimit],
      request: { body: { content: { "application/json": { schema: LivePositionsExitBody } }, required: true } },
      responses: { 200: jsonContent(LivePositionsExitResult, "Exits"), 400: errorResponses[400], 401: errorResponses[401], 409: errorResponses[409], 503: exchangeUnavailable },
    }),
    async (c) => {
      const me = currentUser(c);
      const body = c.req.valid("json");
      const blocked = await tradingBlockedReason(deps, me);
      if (blocked) throw errors.conflict(blocked);
      const { creds, venue } = await resolveAccount(deps, me, body.brokerId, undefined, body.accountId ?? null);
      const client = deps.tradingFor(venue); // ADR-070
      const positions = await client.getPositions(creds).catch((e: unknown) => {
        deps.logger.warn({ err: errorMessage(e), userId: me.id }, "positions read failed");
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
        const result = await client.placeOrder(creds, { productId, size: Math.abs(p.size), side: p.size > 0 ? "sell" : "buy", clientOrderId: `hc-pos-${productId}-${keyTail}`, reduceOnly: true });
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
