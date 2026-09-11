/**
 * Server-side alert evaluation (ADR-057, GAPS #64): after every IV snapshot the API checks the armed alerts against
 * what it just recorded, so price, ATM IV and strategy P&L alerts fire with the app closed. Price = the latest spot,
 * IV = the latest front-expiry ATM IV (vol points), P&L = realised + Σ (latest mark − entry) × lots × lot size for the
 * strategy's open legs (skipped when a leg has no mark in the last 20 minutes). The browser engine stays the fast
 * path while a tab is open; both go through `fireAlert`, whose update is the single guard against double firing.
 */
import { type Underlying, UNDERLYINGS, alertMet } from "@hapiecoin/schema";
import { DEFAULT_VENUE, defaultLotSizes, getVenue } from "@hapiecoin/venues";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { fireAlert } from "./alerts-fire.js";
import { alerts, instrumentMarks, ivSnapshots, strategies, strategyLegs, userSettings } from "./db/schema.js";
import type { AppDeps } from "./routes/shared.js";

const MARK_FRESH_MS = 20 * 60_000;
const DEFAULT_LOTS: Record<string, string> = defaultLotSizes(getVenue(DEFAULT_VENUE)); // ADR-063

export interface EvaluationReport {
  checked: number;
  fired: string[];
  /** Alerts with no reading available (no snapshot yet, a leg without a fresh mark). */
  skipped: number;
}

async function latestFront(deps: AppDeps, asset: Underlying): Promise<{ spot: number; atmIv: number } | null> {
  const [row] = await deps.db.select({ spot: ivSnapshots.spot, atmIv: ivSnapshots.atmIv }).from(ivSnapshots).where(and(eq(ivSnapshots.asset, asset), eq(ivSnapshots.front, true))).orderBy(desc(ivSnapshots.ts), desc(ivSnapshots.id)).limit(1);
  return row ? { spot: Number(row.spot), atmIv: Number(row.atmIv) } : null;
}

/** Total P&L of a paper / live strategy from the latest recorded marks; null when a leg has no fresh mark. */
export async function strategyPnlFromMarks(deps: AppDeps, strategyId: string, nowMs: number): Promise<number | null> {
  const [s] = await deps.db.select({ id: strategies.id, userId: strategies.userId, asset: strategies.asset, status: strategies.status, realizedPnl: strategies.realizedPnl }).from(strategies).where(eq(strategies.id, strategyId)).limit(1);
  if (!s || (s.status !== "paper" && s.status !== "live")) return null;
  const legs = await deps.db.select({ symbol: strategyLegs.symbol, side: strategyLegs.side, lots: strategyLegs.lots, entryPrice: strategyLegs.entryPrice, price: strategyLegs.price }).from(strategyLegs).where(and(eq(strategyLegs.strategyId, s.id), eq(strategyLegs.status, "open")));
  const [settings] = await deps.db.select({ lotSizes: userSettings.lotSizes }).from(userSettings).where(eq(userSettings.userId, s.userId)).limit(1);
  const lotSize = Number(settings?.lotSizes[s.asset] ?? DEFAULT_LOTS[s.asset] ?? "1");
  let total = Number(s.realizedPnl);
  if (legs.length === 0) return total;
  const symbols = [...new Set(legs.map((l) => l.symbol))];
  const marks = await deps.db.select({ symbol: instrumentMarks.symbol, mark: instrumentMarks.mark, ts: instrumentMarks.ts }).from(instrumentMarks).where(and(inArray(instrumentMarks.symbol, symbols), gte(instrumentMarks.ts, new Date(nowMs - MARK_FRESH_MS)))).orderBy(desc(instrumentMarks.ts), desc(instrumentMarks.id));
  const latest = new Map<string, number>();
  for (const m of marks) if (!latest.has(m.symbol)) latest.set(m.symbol, Number(m.mark));
  for (const l of legs) {
    const mark = latest.get(l.symbol);
    if (mark === undefined) return null;
    const entry = Number(l.entryPrice ?? l.price);
    total += (mark - entry) * l.lots * lotSize * (l.side === "buy" ? 1 : -1);
  }
  return total;
}

/** One pass over every armed alert; returns what fired. */
export async function evaluateAlerts(deps: AppDeps, now: () => number = Date.now): Promise<EvaluationReport> {
  const armed = await deps.db.select().from(alerts).where(eq(alerts.state, "armed"));
  const report: EvaluationReport = { checked: armed.length, fired: [], skipped: 0 };
  if (armed.length === 0) return report;
  const fronts = new Map<Underlying, { spot: number; atmIv: number } | null>();
  for (const asset of UNDERLYINGS) if (armed.some((a) => a.asset === asset && a.kind !== "pnl")) fronts.set(asset, await latestFront(deps, asset));
  for (const row of armed) {
    let current: number | null = null;
    if (row.kind === "price") current = fronts.get(row.asset)?.spot ?? null;
    else if (row.kind === "iv") {
      const iv = fronts.get(row.asset)?.atmIv;
      current = iv === undefined ? null : Math.round(iv * 1_000_000) / 10_000;
    } else if (row.strategyId) current = await strategyPnlFromMarks(deps, row.strategyId, now());
    if (current === null) {
      report.skipped += 1;
      continue;
    }
    if (!alertMet(row, current)) continue;
    const fired = await fireAlert(deps, row, decimalOf(current), { source: "server" }, () => new Date(now()));
    if (fired) report.fired.push(row.id);
  }
  return report;
}

/** A number as the decimal string the schema accepts, trimmed of trailing zeros. */
export function decimalOf(n: number): string {
  const fixed = n.toFixed(4);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}
