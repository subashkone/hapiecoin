// What the Autopilot screen reads off a strategy Autopilot opened (ADR-109; HC-TR-220): its exit levels from the rules
// armed at entry, and a three-step health reading of where its P&L stands against the stop. Pure.
import { type AutopilotRun, type Strategy, restTrailFloorUsd, trailFloorUsd } from "@hapiecoin/schema";

export interface AutopilotLevels {
  /** The profit (USD) the exit starts from: closing there, or trailing from there. */
  targetUsd: number | null;
  /** True when the target trails instead of closing. */
  trails: boolean;
  /** The best P&L seen since the trailing target was reached, once it has been. */
  bestUsd: number | null;
  /** The level a trailing target now exits at (the best less its give-back), once it trails. */
  trailExitUsd: number | null;
  /** The loss (USD, positive) the stop closes at; null when the playbook has none. */
  stopUsd: number | null;
  /** ADR-112: the multiple of its entry price at which each sold option is closed on its own; null with no such stop. */
  legStop: number | null;
  /** ADR-114: a stopped option starts a trail on what is left, with this percentage give-back; null when the stops trail nothing. */
  legStopTrailPct: number | null;
  /**
   * ADR-114: the trail running on what is left after a stop: the profit of the rest it exits at, or null while the rest
   * has not been in profit yet. Absent (undefined) when no such trail is running.
   */
  restTrailExitUsd?: number | null;
  /** ADR-121 / ADR-134: when a timed exit closes the whole trade, epoch ms. Absent when the trade has none armed. */
  closesAtMs?: number;
}

export function autopilotLevels(s: Strategy): AutopilotLevels {
  const armed = (s.rules ?? []).filter((r) => r.state === "armed");
  const target = armed.find((r) => r.kind === "target");
  const stop = armed.find((r) => r.kind === "stop");
  const legStop = armed.find((r) => r.kind === "leg_stop" && r.trigger === "multiple");
  const best = target?.peakPnl ? Number(target.peakPnl) : null;
  const restTrail = armed.find((r) => r.kind === "trail");
  const timed = armed.find((r) => r.kind === "time" && r.trigger === "at");
  const closesAtMs = timed ? Date.parse(timed.value) : NaN;
  return {
    targetUsd: target ? Number(target.thresholdUsd) : null,
    trails: Boolean(target?.trail),
    bestUsd: best,
    // the engine's own floor (a percentage of the best, or a money give-back if the trader edited the rule)
    trailExitUsd: best !== null && target?.trail ? trailFloorUsd(best, target.trail) : null,
    stopUsd: stop ? Math.abs(Number(stop.thresholdUsd)) : null,
    legStop: legStop ? Number(legStop.value) : null,
    legStopTrailPct: legStop?.trail?.trigger === "pct" ? Number(legStop.trail.value) : null,
    ...(restTrail ? { restTrailExitUsd: restTrail.peakPnl === null ? null : restTrailFloorUsd(Number(restTrail.peakPnl), { trigger: restTrail.trigger === "pct" ? "pct" : "money", value: restTrail.value }) } : {}),
    ...(Number.isFinite(closesAtMs) ? { closesAtMs } : {}),
  };
}

export type TradeHealth = "good" | "watch" | "danger";
export const HEALTH_LABELS: Record<TradeHealth, string> = { good: "On track", watch: "Losing", danger: "Close to its stop" };

/**
 * In profit: good. In loss: watch. In loss with three quarters of the allowed loss used: danger. `usedPct` is the
 * share of the stop distance the loss has covered (0..100), null when the trade has no stop.
 */
export function tradeHealth(pnlUsd: number, stopUsd: number | null): { health: TradeHealth; usedPct: number | null } {
  const usedPct = stopUsd !== null && stopUsd > 0 ? Math.min(100, Math.max(0, (-pnlUsd / stopUsd) * 100)) : null;
  if (pnlUsd >= 0) return { health: "good", usedPct };
  return { health: usedPct !== null && usedPct >= 75 ? "danger" : "watch", usedPct };
}

/** The newest log line of one playbook on one asset, or undefined. `runs` is newest first, as the API returns it. */
export function latestRun(runs: readonly AutopilotRun[], playbookId: string, asset: string): AutopilotRun | undefined {
  return runs.find((r) => r.playbookId === playbookId && r.asset === asset);
}

/** ADR-112: an open trade was entered with no maximum loss (a naked strangle): the capital in use is not a number. */
export function capitalUnbounded(runs: readonly AutopilotRun[], openIds: ReadonlySet<string>): boolean {
  return runs.some((r) => r.kind === "entered" && r.strategyId !== null && openIds.has(r.strategyId) && r.detail.capital === null);
}

/**
 * HC-TR-314: the capital of one Autopilot trade and what the figure is, as the trade card reads it (ADR-128): the most
 * it could lose at expiry where bought options cover it, otherwise the margin estimated at entry. Null with neither.
 */
export function tradeCapital(maxLossUsd: string | null | undefined, marginUsd: string | null | undefined): { usd: number; basis: "max loss" | "est. margin" } | null {
  const worst = maxLossUsd === null || maxLossUsd === undefined ? NaN : Number(maxLossUsd);
  if (Number.isFinite(worst) && worst > 0) return { usd: worst, basis: "max loss" };
  const margin = marginUsd === null || marginUsd === undefined ? NaN : Number(marginUsd);
  return Number.isFinite(margin) && margin > 0 ? { usd: margin, basis: "est. margin" } : null;
}

/** The capital (USD) the log says the open Autopilot trades tie up: each trade's maximum loss at entry. */
export function capitalInUse(runs: readonly AutopilotRun[], openIds: ReadonlySet<string>): number {
  let sum = 0;
  for (const r of runs) if (r.kind === "entered" && r.strategyId !== null && openIds.has(r.strategyId)) sum += Number(r.detail.capital ?? 0) || 0;
  return sum;
}
