/**
 * Live execution service (ADR-025): everything between a strategy and the venue executor. Plans contracts
 * per leg, runs the safeguards, places entry / exit / adjustment orders through `deps.trading` (the only
 * order path, trading-safety rule 1), records `strategy_orders`, and reconciles pending orders.
 * Routes call these; nothing here is reachable without a signed-in user's own vault credential.
 */
import { type LivePreview, type LivePreviewLeg, type StrategyOrder, toDecimal } from "@hapiecoin/schema";
import { type DeltaCredentials, type PlaceOrderResult, contractsFor } from "@hapiecoin/venues";
import { and, eq } from "drizzle-orm";
import { brokerCredentials, brokers, type strategies, strategyLegs, strategyOrders, userSettings, users } from "../db/schema.js";
import type { SessionUser } from "../security/context.js";
import { HttpError, errors } from "../security/errors.js";
import { type AppDeps, newId } from "./shared.js";

export type LegRow = typeof strategyLegs.$inferSelect;
export type OrderRow = typeof strategyOrders.$inferSelect;
export type StrategyRow = typeof strategies.$inferSelect;

const DEFAULT_LOTS: Record<string, string> = { BTC: "0.001", ETH: "0.01", XAUT: "0.001" };
/** Settling assets whose available balance we compare with the worst-loss estimate, in preference order. */
const SETTLING_ASSETS = ["USD", "USDT", "USDC"];

export function exchangeError(message: string, details?: Record<string, unknown>): HttpError {
  return new HttpError(502, "EXCHANGE_ERROR", message, details);
}

export async function lotSizeFor(deps: AppDeps, user: SessionUser, asset: string): Promise<string> {
  const [s] = await deps.db.select({ lotSizes: userSettings.lotSizes }).from(userSettings).where(eq(userSettings.userId, user.id)).limit(1);
  return s?.lotSizes[asset] ?? DEFAULT_LOTS[asset] ?? "1";
}

/** The caller's own exchange credential for `brokerId`, unsealed for this call only. */
export async function openCredential(deps: AppDeps, user: SessionUser, brokerId: string): Promise<DeltaCredentials> {
  const [b] = await deps.db.select({ id: brokers.id }).from(brokers).where(and(eq(brokers.id, brokerId), eq(brokers.scope, "GLOBAL"))).limit(1);
  const [own] = b ? [b] : await deps.db.select({ id: brokers.id }).from(brokers).where(and(eq(brokers.id, brokerId), eq(brokers.ownerId, user.id))).limit(1);
  if (!own) throw errors.badRequest("Select an exchange...");
  const [row] = await deps.db.select().from(brokerCredentials).where(and(eq(brokerCredentials.userId, user.id), eq(brokerCredentials.brokerId, brokerId))).limit(1);
  if (!row) throw errors.conflict("Connect your exchange in Settings → API Settings to enable live trading");
  try {
    return {
      apiKey: deps.vault.open({ ct: row.apiKeyCt, iv: row.apiKeyIv, tag: row.apiKeyTag }),
      apiSecret: deps.vault.open({ ct: row.apiSecretCt, iv: row.apiSecretIv, tag: row.apiSecretTag }),
    };
  } catch (e) {
    // sealed under another CREDENTIALS_ENC_KEY (or tampered): the only way forward is to reconnect (GAPS #42)
    deps.logger.warn({ err: e instanceof Error ? e.message : String(e), userId: user.id, brokerId }, "stored exchange credential cannot be opened");
    throw errors.conflict("Your saved exchange key cannot be decrypted because the server's encryption key changed. Reconnect it in Settings → API Settings.");
  }
}

/** Kill switches (ADR-025): the operator's env flag and the account flag. */
export async function tradingBlockedReason(deps: AppDeps, user: SessionUser): Promise<string | null> {
  if (deps.config.trading.disabled) return "Live trading is paused by the operator";
  const [u] = await deps.db.select({ disabled: users.tradingDisabled }).from(users).where(eq(users.id, user.id)).limit(1);
  return u?.disabled ? "Live trading is disabled for this account" : null;
}

export function toOrder(o: OrderRow): StrategyOrder {
  return {
    id: o.id,
    legId: o.legId,
    purpose: o.purpose,
    batchId: o.batchId,
    clientOrderId: o.clientOrderId,
    venueOrderId: o.venueOrderId,
    symbol: o.symbol,
    side: o.side,
    size: o.size,
    state: o.state,
    fillPrice: o.fillPrice,
    error: o.error,
    attempts: o.attempts,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

export async function ordersOf(deps: AppDeps, strategyId: string): Promise<OrderRow[]> {
  return deps.db.select().from(strategyOrders).where(eq(strategyOrders.strategyId, strategyId)).orderBy(strategyOrders.createdAt, strategyOrders.id);
}

/** The slice of a leg row the planner and the preview read; the adjustment preview passes synthetic rows for proposed legs. */
export type PlanLeg = Pick<LegRow, "id" | "symbol" | "side" | "lots">;
/** Contracts, product state and current mark for each leg; reasons collect what would block a placement. */
export async function planLegs(deps: AppDeps, legs: readonly PlanLeg[], lotSize: string): Promise<{ legs: LivePreviewLeg[]; reasons: string[] }> {
  const reasons: string[] = [];
  const out: LivePreviewLeg[] = [];
  for (const l of legs) {
    let product;
    try {
      product = await deps.trading.getProduct(l.symbol);
    } catch (e) {
      reasons.push(`${l.symbol}: ${e instanceof Error ? e.message : "product lookup failed"}`);
      out.push({ legId: l.id, symbol: l.symbol, side: l.side, lots: l.lots, contracts: null, contractValue: "0", productState: "unknown", mark: null, notional: "0" });
      continue;
    }
    const contracts = contractsFor(l.lots, lotSize, product.contractValue);
    if (contracts === null) reasons.push(`${l.symbol}: ${l.lots} lots × ${lotSize} is not a whole number of ${product.contractValue}-unit contracts`);
    if (product.state !== "live") reasons.push(`${l.symbol}: product is ${product.state} on the exchange`);
    const mark = await deps.trading.getMark(l.symbol);
    const notional = contracts !== null && mark !== null ? toDecimal(contracts * Number(product.contractValue) * Number(mark), 2) : "0";
    out.push({ legId: l.id, symbol: l.symbol, side: l.side, lots: l.lots, contracts, contractValue: product.contractValue, productState: product.state, mark, notional });
  }
  return { legs: out, reasons };
}

/**
 * Every check a placement needs, as reasons. `legs` are entries (the per-placement leg and notional caps apply to them);
 * `exits` are reduce-only rows of an adjustment batch (ADR-044): planned for product state and sizing, listed first,
 * never counted against the entry caps because they reduce risk.
 */
export async function preview(deps: AppDeps, user: SessionUser, strategy: StrategyRow, legs: readonly PlanLeg[], brokerId: string, worstLoss: number | null, exits: readonly PlanLeg[] = []): Promise<LivePreview> {
  const reasons: string[] = [];
  const blocked = await tradingBlockedReason(deps, user);
  if (blocked) reasons.push(blocked);
  const { trading } = deps.config;
  if (legs.length === 0 && exits.length === 0) reasons.push("Add at least one leg to trade");
  if (legs.length > trading.maxLegs) reasons.push(`At most ${trading.maxLegs} legs per live placement`);
  const lotSize = await lotSizeFor(deps, user, strategy.asset);
  const exitPlan = await planLegs(deps, exits, lotSize);
  const plan = await planLegs(deps, legs, lotSize);
  reasons.push(...exitPlan.reasons, ...plan.reasons);
  const notional = plan.legs.reduce((s, l) => s + Number(l.notional), 0);
  if (notional > trading.maxNotionalUsd) reasons.push(`Notional ${toDecimal(notional, 2)} USD exceeds the ${trading.maxNotionalUsd} USD limit per placement`);
  let available: string | null = null;
  let availableAsset: string | null = null;
  let marginUsed: string | null = null;
  try {
    const creds = await openCredential(deps, user, brokerId);
    const balances = await deps.trading.getBalances(creds);
    const row = SETTLING_ASSETS.map((a) => balances.find((b) => b.asset === a)).find((b) => b !== undefined);
    // the venue has no pre-trade margin estimate; show what it holds right now so the trader sees the real headroom (ADR-029)
    const positions = await deps.trading.getPositions(creds);
    marginUsed = toDecimal(positions.reduce((s, p) => s + (p.margin ? Number(p.margin) : 0), 0), 2);
    if (row) {
      available = row.availableBalance;
      availableAsset = row.asset;
      if (worstLoss !== null && Number.isFinite(worstLoss) && Math.abs(worstLoss) > Number(row.availableBalance)) reasons.push(`Available ${row.asset} ${row.availableBalance} is below the worst-loss estimate ${toDecimal(Math.abs(worstLoss), 2)}`);
    }
  } catch (e) {
    // the reason matters to the trader (vault, venue, network); log it and show it, never the key material
    deps.logger.warn({ err: e instanceof Error ? e.message : String(e), userId: user.id, brokerId }, "live preview: wallet read failed");
    reasons.push(e instanceof HttpError ? e.message : `Could not read the exchange wallet (${e instanceof Error ? e.message : "unknown error"})`);
  }
  return { ok: reasons.length === 0, reasons, legs: [...exitPlan.legs, ...plan.legs], notional: toDecimal(notional, 2), available, availableAsset, marginUsed, limits: { maxLegs: trading.maxLegs, maxNotionalUsd: trading.maxNotionalUsd, markBandPct: trading.markBandPct } };
}

export interface PlacementOutcome {
  filled: number;
  pending: number;
  failed: number;
  errors: string[];
}

function describeResult(r: PlaceOrderResult): string {
  return r.ok ? "" : r.message;
}

/**
 * Place a market order per leg (entry or adjustment) and record it; fills set the leg's entry premium.
 * Never throws for a venue refusal: failed legs stay open with a `failed` order the user can retry.
 */
export async function placeEntries(deps: AppDeps, creds: DeltaCredentials, strategy: StrategyRow, legs: readonly LegRow[], plan: readonly LivePreviewLeg[], batchId: string, purpose: "entry" | "adjustment", expected: Record<string, string>): Promise<PlacementOutcome> {
  const out: PlacementOutcome = { filled: 0, pending: 0, failed: 0, errors: [] };
  const band = deps.config.trading.markBandPct / 100;
  for (const l of legs) {
    const p = plan.find((x) => x.legId === l.id);
    if (!p || p.contracts === null) {
      out.failed += 1;
      out.errors.push(`${l.symbol}: cannot size the order`);
      continue;
    }
    const exp = expected[l.id];
    if (exp !== undefined && p.mark !== null && Math.abs(Number(p.mark) - Number(exp)) / Number(exp) > band) {
      out.failed += 1;
      const msg = `${l.symbol}: mark moved from ${exp} to ${p.mark}, beyond the ${deps.config.trading.markBandPct} % band; preview again`;
      out.errors.push(msg);
      await recordOrder(deps, strategy, l, batchId, purpose, `hc-${l.id}-${await nextAttempt(deps, l.id)}`, p, null, "failed", msg);
      continue;
    }
    const attempt = await nextAttempt(deps, l.id);
    const clientOrderId = `hc-${l.id}-${attempt}`;
    const product = await deps.trading.getProduct(l.symbol);
    const result = await deps.trading.placeOrder(creds, { productId: product.id, size: p.contracts, side: l.side, clientOrderId, reduceOnly: false });
    await applyEntryResult(deps, strategy, l, batchId, purpose, clientOrderId, p, result, out, attempt);
  }
  return out;
}

async function nextAttempt(deps: AppDeps, legId: string): Promise<number> {
  const rows = await deps.db.select({ attempts: strategyOrders.attempts }).from(strategyOrders).where(eq(strategyOrders.legId, legId));
  return rows.reduce((m, r) => Math.max(m, r.attempts), 0) + 1;
}

async function recordOrder(deps: AppDeps, strategy: StrategyRow, leg: LegRow, batchId: string, purpose: "entry" | "exit" | "adjustment", clientOrderId: string, plan: LivePreviewLeg, venue: { id: number; fill: string | null } | null, state: OrderRow["state"], error: string | null, attempts = 1): Promise<void> {
  const product = plan.contracts === null ? null : await deps.trading.getProduct(leg.symbol).catch(() => null);
  await deps.db
    .insert(strategyOrders)
    .values({ id: newId("ord"), strategyId: strategy.id, legId: leg.id, batchId, purpose, clientOrderId, venueOrderId: venue ? String(venue.id) : null, productId: product?.id ?? 0, symbol: leg.symbol, side: leg.side, size: plan.contracts ?? 0, state, fillPrice: venue?.fill ?? null, error, attempts })
    .onConflictDoUpdate({ target: strategyOrders.clientOrderId, set: { venueOrderId: venue ? String(venue.id) : null, state, fillPrice: venue?.fill ?? null, error, attempts, updatedAt: new Date() } });
}

async function applyEntryResult(deps: AppDeps, strategy: StrategyRow, leg: LegRow, batchId: string, purpose: "entry" | "adjustment", clientOrderId: string, plan: LivePreviewLeg, result: PlaceOrderResult, out: PlacementOutcome, attempts: number): Promise<void> {
  const now = new Date();
  if (result.ok && result.order.state === "closed" && result.order.averageFillPrice !== null) {
    await recordOrder(deps, strategy, leg, batchId, purpose, clientOrderId, plan, { id: result.order.id, fill: result.order.averageFillPrice }, "filled", null, attempts);
    await deps.db.update(strategyLegs).set({ entryPrice: result.order.averageFillPrice, price: result.order.averageFillPrice, status: "open", openedAt: now, closedAt: null, exitPrice: null, orderId: String(result.order.id), updatedAt: now }).where(eq(strategyLegs.id, leg.id));
    out.filled += 1;
    return;
  }
  if (result.ok) {
    await recordOrder(deps, strategy, leg, batchId, purpose, clientOrderId, plan, { id: result.order.id, fill: result.order.averageFillPrice }, "pending", null, attempts);
    await deps.db.update(strategyLegs).set({ orderId: String(result.order.id), openedAt: now, updatedAt: now }).where(eq(strategyLegs.id, leg.id));
    out.pending += 1;
    return;
  }
  if ("unknown" in result && result.unknown) {
    await recordOrder(deps, strategy, leg, batchId, purpose, clientOrderId, plan, null, "pending", result.message, attempts);
    out.pending += 1;
    out.errors.push(`${leg.symbol}: ${result.message}`);
    return;
  }
  await recordOrder(deps, strategy, leg, batchId, purpose, clientOrderId, plan, null, "failed", describeResult(result), attempts);
  out.failed += 1;
  out.errors.push(`${leg.symbol}: ${result.message}`);
}

/** Retry every failed entry / adjustment order of the strategy with the same client order id. */
export async function retryFailed(deps: AppDeps, creds: DeltaCredentials, user: SessionUser, strategy: StrategyRow): Promise<PlacementOutcome> {
  const out: PlacementOutcome = { filled: 0, pending: 0, failed: 0, errors: [] };
  const failed = (await ordersOf(deps, strategy.id)).filter((o) => o.state === "failed" && o.purpose !== "exit");
  if (failed.length === 0) return out;
  const lotSize = await lotSizeFor(deps, user, strategy.asset);
  for (const o of failed) {
    const [leg] = await deps.db.select().from(strategyLegs).where(eq(strategyLegs.id, o.legId)).limit(1);
    if (!leg || leg.status !== "open") continue;
    const plan = await planLegs(deps, [leg], lotSize);
    const p = plan.legs[0]!;
    if (p.contracts === null) {
      out.failed += 1;
      out.errors.push(plan.reasons.join("; "));
      continue;
    }
    const product = await deps.trading.getProduct(leg.symbol);
    const result = await deps.trading.placeOrder(creds, { productId: product.id, size: p.contracts, side: leg.side, clientOrderId: o.clientOrderId, reduceOnly: false });
    await applyEntryResult(deps, strategy, leg, o.batchId, o.purpose === "exit" ? "entry" : o.purpose, o.clientOrderId, p, result, out, o.attempts + 1);
  }
  return out;
}

/** Reduce-only market order that closes `lots` of a live leg; returns the fill price or throws 502. */
export async function placeExit(deps: AppDeps, creds: DeltaCredentials, user: SessionUser, strategy: StrategyRow, leg: LegRow, lots: number, batchId: string): Promise<string> {
  const lotSize = await lotSizeFor(deps, user, strategy.asset);
  const product = await deps.trading.getProduct(leg.symbol).catch((e: unknown) => {
    throw exchangeError(e instanceof Error ? e.message : "product lookup failed");
  });
  const contracts = contractsFor(lots, lotSize, product.contractValue);
  if (contracts === null) throw errors.badRequest(`${leg.symbol}: ${lots} lots is not a whole number of contracts`);
  const attempt = await nextAttempt(deps, leg.id);
  const clientOrderId = `hc-${leg.id}-x${attempt}`;
  const side = leg.side === "buy" ? "sell" : "buy";
  const plan: LivePreviewLeg = { legId: leg.id, symbol: leg.symbol, side, lots, contracts, contractValue: product.contractValue, productState: product.state, mark: null, notional: "0" };
  const result = await deps.trading.placeOrder(creds, { productId: product.id, size: contracts, side, clientOrderId, reduceOnly: true });
  if (result.ok && result.order.state === "closed" && result.order.averageFillPrice !== null) {
    await recordOrder(deps, strategy, { ...leg, side }, batchId, "exit", clientOrderId, plan, { id: result.order.id, fill: result.order.averageFillPrice }, "closed", null, attempt);
    return result.order.averageFillPrice;
  }
  if (result.ok) {
    await recordOrder(deps, strategy, { ...leg, side }, batchId, "exit", clientOrderId, plan, { id: result.order.id, fill: result.order.averageFillPrice }, "pending", null, attempt);
    throw exchangeError(`${leg.symbol}: the exit order is still filling on the exchange; sync the strategy in a moment`, { orderId: result.order.id });
  }
  await recordOrder(deps, strategy, { ...leg, side }, batchId, "exit", clientOrderId, plan, null, "failed", result.message, attempt);
  throw exchangeError(`${leg.symbol}: ${result.message}`, { code: result.code });
}

/** Reconcile pending orders with the venue: fills set entry premiums, cancellations mark the order failed. */
export async function syncOrders(deps: AppDeps, creds: DeltaCredentials, strategy: StrategyRow): Promise<{ updated: number }> {
  const pending = (await ordersOf(deps, strategy.id)).filter((o) => o.state === "pending");
  let updated = 0;
  const now = new Date();
  for (const o of pending) {
    let venue = o.venueOrderId ? await deps.trading.getOrder(creds, Number(o.venueOrderId)) : null;
    if (!venue && o.productId) venue = (await deps.trading.listOpenOrders(creds, [o.productId])).find((v) => v.clientOrderId === o.clientOrderId) ?? null;
    if (!venue) {
      if (!o.venueOrderId) {
        await deps.db.update(strategyOrders).set({ state: "failed", error: o.error ?? "not found on the exchange", updatedAt: now }).where(eq(strategyOrders.id, o.id));
        updated += 1;
      }
      continue;
    }
    if (venue.state === "closed" && venue.averageFillPrice !== null) {
      await deps.db.update(strategyOrders).set({ state: o.purpose === "exit" ? "closed" : "filled", venueOrderId: String(venue.id), fillPrice: venue.averageFillPrice, error: null, updatedAt: now }).where(eq(strategyOrders.id, o.id));
      if (o.purpose !== "exit") await deps.db.update(strategyLegs).set({ entryPrice: venue.averageFillPrice, price: venue.averageFillPrice, orderId: String(venue.id), updatedAt: now }).where(eq(strategyLegs.id, o.legId));
      updated += 1;
    } else if (venue.state === "cancelled") {
      await deps.db.update(strategyOrders).set({ state: "cancelled", venueOrderId: String(venue.id), error: "cancelled on the exchange", updatedAt: now }).where(eq(strategyOrders.id, o.id));
      updated += 1;
    } else if (!o.venueOrderId) {
      await deps.db.update(strategyOrders).set({ venueOrderId: String(venue.id), updatedAt: now }).where(eq(strategyOrders.id, o.id));
      updated += 1;
    }
  }
  return { updated };
}
