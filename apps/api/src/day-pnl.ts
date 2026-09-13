/**
 * The server's live day P&L and the Mindful pause it decides (GAPS #90, ADR-084; HC-TR-189..190). ADR-074 built the
 * pause in the browser from the book; a trader who orders through the API directly, or whose tab never priced the
 * legs, met no pause. Here the same figure is computed from what the server holds: open live strategies at the latest
 * recorded marks (the alerts evaluator's rule) against the day's baseline in `strategy_pnl`, live trades closed today
 * at their realised figure. The figure is unknown while an open leg has no fresh mark, and no pause is decided on a
 * guess. The pause delays, never refuses: a live entry answers 409 MINDFUL_PAUSE with the seconds left until the pause,
 * shown at preview time or started by the first refusal, has elapsed. A leader job writes today's `strategy_pnl` point for every live strategy, so the
 * baseline exists without a browser.
 */
import { DEFAULT_MINDFUL, type MindfulPreview, MindfulSettings, toDecimal } from "@hapiecoin/schema";
import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { strategyPnlFromMarks } from "./alerts-evaluate.js";
import { strategies, strategyPnl, userSettings } from "./db/schema.js";
import type { SessionUser } from "./security/context.js";
import { HttpError } from "./security/errors.js";
import { type AppDeps, errorMessage } from "./routes/shared.js";

/** How the day boundary reads on screen (the UTC day, in the trader's clock); the browser's `DAY_BASIS` verbatim. */
export const DAY_BASIS = "since 05:30 IST (00:00 UTC)";

/** The UTC day key every P&L point is filed under (the browser's `todayIso`). */
export function dayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export interface LiveDay {
  /** Today's P&L across live strategies (USD), closed-today trades included. */
  pnlUsd: number;
  /** Live strategies counted (active plus closed today). */
  count: number;
  /** Of them, closed today. */
  closedCount: number;
  /** False while an open live leg has no fresh mark: the figure would be wrong, so no pause is decided on it. */
  known: boolean;
}

/**
 * Today's live P&L for one trader: active live strategies at the marks' total minus the last point before today,
 * live strategies closed today at their realised figure minus the same baseline (the browser's `dayPnl` rule).
 */
export async function liveDayPnl(deps: AppDeps, user: SessionUser, nowMs: number): Promise<LiveDay> {
  const today = dayKey(nowMs);
  const dayStart = new Date(`${today}T00:00:00.000Z`);
  const live = await deps.db.select({ id: strategies.id, realizedPnl: strategies.realizedPnl }).from(strategies).where(and(eq(strategies.userId, user.id), eq(strategies.status, "live")));
  const closed = await deps.db
    .select({ id: strategies.id, realizedPnl: strategies.realizedPnl })
    .from(strategies)
    .where(and(eq(strategies.userId, user.id), eq(strategies.status, "archived"), eq(strategies.tradingMode, "live"), gte(strategies.closedAt, dayStart)));
  const ids = [...live, ...closed].map((s) => s.id);
  const baseline = new Map<string, number>();
  if (ids.length > 0) {
    // ascending by day: the last write per strategy is the latest point before today
    const rows = await deps.db.select({ strategyId: strategyPnl.strategyId, pnl: strategyPnl.pnl }).from(strategyPnl).where(and(inArray(strategyPnl.strategyId, ids), lt(strategyPnl.day, today))).orderBy(asc(strategyPnl.day));
    for (const r of rows) baseline.set(r.strategyId, Number(r.pnl));
  }
  let pnlUsd = 0;
  let known = true;
  for (const s of live) {
    const total = await strategyPnlFromMarks(deps, s.id, nowMs);
    if (total === null) {
      known = false;
      continue;
    }
    pnlUsd += total - (baseline.get(s.id) ?? 0);
  }
  for (const s of closed) pnlUsd += Number(s.realizedPnl) - (baseline.get(s.id) ?? 0);
  return { pnlUsd, count: live.length + closed.length, closedCount: closed.length, known };
}

/** The trader's Mindful settings (the stored row, else the defaults) and the day figure, folded into what a live preview carries. */
export async function mindfulFor(deps: AppDeps, user: SessionUser, nowMs: number): Promise<MindfulPreview> {
  const [row] = await deps.db.select({ mindful: userSettings.mindful }).from(userSettings).where(eq(userSettings.userId, user.id)).limit(1);
  const parsed = MindfulSettings.safeParse(row?.mindful);
  const m = parsed.success ? parsed.data : DEFAULT_MINDFUL;
  const d = await liveDayPnl(deps, user, nowMs);
  const day = { pnlUsd: toDecimal(d.pnlUsd, 2), count: d.count, closedCount: d.closedCount, known: d.known };
  const pause = m.enabled && d.known && d.count > 0 && d.pnlUsd < -Number(m.thresholdUsd) ? { seconds: m.pauseSeconds, thresholdUsd: m.thresholdUsd, basis: DAY_BASIS } : null;
  return { day, pause };
}

/** A pause shown longer ago than this belongs to an abandoned flow: the next preview restarts it. */
export const PAUSE_STAMP_TTL_MS = 10 * 60_000;

/**
 * When each trader last saw the pause for a scope (a strategy id, or "batch"), so the entry routes can tell "took the
 * pause" from "skipped the preview". In memory per replica: another replica asks for the preview again (GAPS #100).
 */
export class MindfulGate {
  /** Per user and scope: when the pause was first shown (its clock) and last seen (its TTL). */
  private readonly shown = new Map<string, { first: number; last: number }>();
  constructor(readonly now: () => number = Date.now) {}
  /** The pause was shown for this scope now; a stamp still within the TTL keeps its clock, so a re-preview never restarts a running pause. */
  note(userId: string, scope: string): void {
    const key = `${userId}:${scope}`;
    const at = this.shown.get(key);
    const t = this.now();
    if (at === undefined || t - at.last > PAUSE_STAMP_TTL_MS) this.shown.set(key, { first: t, last: t });
    else at.last = t;
  }
  /** Seconds still to wait: the whole pause when it was never shown (or last seen too long ago), else what is left since it was first shown. */
  waitS(userId: string, scope: string, seconds: number): number {
    const at = this.shown.get(`${userId}:${scope}`);
    const t = this.now();
    if (at === undefined || t - at.last > PAUSE_STAMP_TTL_MS) return seconds;
    return Math.max(0, Math.ceil(seconds - (t - at.first) / 1000));
  }
  /** The entry went through: the next one on this scope waits its own pause, as each dialog shows its own countdown. */
  consume(userId: string, scope: string): void {
    this.shown.delete(`${userId}:${scope}`);
  }
}

/**
 * A live entry while the pause applies: 409 MINDFUL_PAUSE with the seconds left, until the pause has elapsed. The refusal
 * starts the clock when nothing did: a client that skipped the preview waits the same pause once, not forever. An entry
 * that goes through consumes the stamp: the next entry on the scope waits its own pause.
 */
export function enforceMindful(deps: AppDeps, user: SessionUser, scope: string, mindful: MindfulPreview): void {
  if (mindful.pause === null) return;
  const left = deps.mindful.waitS(user.id, scope, mindful.pause.seconds);
  if (left === 0) {
    deps.mindful.consume(user.id, scope);
    return;
  }
  deps.mindful.note(user.id, scope);
  const down = Math.abs(Number(mindful.day.pnlUsd)).toFixed(2);
  throw new HttpError(409, "MINDFUL_PAUSE", `Mindful pause: ${left} s to go before this order. You are down ${down} USD today on live strategies; take the pause, then place.`, { waitS: left, day: mindful.day, pause: mindful.pause });
}

/** Today's `strategy_pnl` point for every live strategy whose legs have fresh marks; a strategy without one is skipped, never guessed. */
export async function writeDayPnlPoints(deps: AppDeps, nowMs: number): Promise<{ written: number; skipped: number }> {
  const today = dayKey(nowMs);
  const rows = await deps.db.select({ id: strategies.id }).from(strategies).where(eq(strategies.status, "live"));
  let written = 0;
  let skipped = 0;
  for (const s of rows) {
    const total = await strategyPnlFromMarks(deps, s.id, nowMs);
    if (total === null) {
      skipped += 1;
      continue;
    }
    const pnl = toDecimal(total, 2);
    await deps.db
      .insert(strategyPnl)
      .values({ strategyId: s.id, day: today, pnl })
      .onConflictDoUpdate({ target: [strategyPnl.strategyId, strategyPnl.day], set: { pnl, updatedAt: new Date(nowMs) } });
    written += 1;
  }
  return { written, skipped };
}

/** The leader job (ADR-062): one pass now, then every `intervalMs`; overlapping passes are skipped. Returns the stop. */
export function startDayPnlWriter(deps: AppDeps, intervalMs: number, now: () => number = Date.now): () => void {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const r = await writeDayPnlPoints(deps, now());
      if (r.written > 0) deps.logger.debug({ written: r.written, skipped: r.skipped }, "day P&L points written");
    } catch (error) {
      deps.logger.warn({ error: errorMessage(error) }, "day P&L writer failed");
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
