// Background reconciliation of pending venue orders (ADR-029, GAPS #40): every `intervalMs` the API walks the live
// strategies that still have pending orders and runs the same sync the Live tab's Sync button runs. Polling, not a
// private WebSocket: one signed GET per pending order, spaced by the trading client's token bucket, and nothing at
// all while no order is pending. Never runs under NODE_ENV=test unless a test calls `reconcilePending` itself.
import { and, eq } from "drizzle-orm";
import { strategies, strategyOrders } from "./db/schema.js";
import { openCredential, syncOrders } from "./routes/live-exec.js";
import { bookExitFills } from "./routes/strategies.js";
import type { AppDeps } from "./routes/shared.js";

export interface ReconcileResult {
  strategies: number;
  updated: number;
  failed: number;
}

/** One pass over every live strategy with a pending order; failures are logged per strategy and never thrown. */
export async function reconcilePending(deps: AppDeps): Promise<ReconcileResult> {
  const rows = await deps.db
    .selectDistinct({ strategy: strategies })
    .from(strategyOrders)
    .innerJoin(strategies, eq(strategyOrders.strategyId, strategies.id))
    .where(and(eq(strategyOrders.state, "pending"), eq(strategies.status, "live")));
  const out: ReconcileResult = { strategies: rows.length, updated: 0, failed: 0 };
  for (const { strategy } of rows) {
    if (!strategy.brokerId) continue;
    try {
      const creds = await openCredential(deps, { id: strategy.userId, email: "", name: "", role: "user" }, strategy.brokerId, undefined, strategy.accountId);
      const r = await syncOrders(deps, creds, strategy);
      await bookExitFills(deps, strategy, r.exitFills);
      out.updated += r.updated;
      if (r.updated) await deps.db.update(strategies).set({ updatedAt: new Date() }).where(eq(strategies.id, strategy.id));
    } catch (e) {
      out.failed += 1;
      deps.logger.warn({ strategyId: strategy.id, err: e instanceof Error ? e.message : String(e) }, "reconcile: strategy skipped");
    }
  }
  if (out.strategies) deps.logger.info(out, "reconcile: pending orders checked");
  return out;
}

/** Start the periodic pass; returns the stop function. Overlapping passes are skipped. */
export function startReconciler(deps: AppDeps, intervalMs = 15_000): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await reconcilePending(deps);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
