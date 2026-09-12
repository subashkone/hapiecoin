// Mindful Trading pause (roadmap item 10, ADR-074; HC-TR-182..183): whether the trader is down on the day on live
// strategies, read from the same book the PortfolioBar's Day P&L reads, restricted to live strategies and with the
// live trades closed today included. The day is the UTC day the P&L points are keyed by (usePnlWriter), shown to the
// trader as "since 05:30 IST (00:00 UTC)" so the figure here and the bar's tile never disagree. Browser-side only:
// the server has no per-day P&L yet (GAPS #90), so this is a mindfulness aid, never a control.
import type { MindfulSettings, Strategy, StrategyLeg } from "@hapiecoin/schema";
import { dayPnl } from "./paper";
import { todayIso } from "./usePnlWriter";

/** How the day boundary reads on screen (the UTC day, in the trader's clock). */
export const DAY_BASIS = "since 05:30 IST (00:00 UTC)";

export interface LiveDay {
  /** Today's P&L across live strategies (USD, the engine's unit), closed-today trades included. */
  pnl: number;
  /** Live strategies counted (active plus closed today). */
  count: number;
  /** Of them, closed today. */
  closedCount: number;
  /** False while an open live leg has no price yet: the figure would be wrong, so no pause is decided on it. */
  known: boolean;
}

export interface DayBook {
  pnlOf: (s: Strategy) => { total: number };
  priceOf: (s: Strategy, leg: StrategyLeg) => number | null;
}

/** Today's live P&L: active live strategies at the book's total, live strategies closed today at their realised P&L. */
export function liveDayPnl(strategies: readonly Strategy[] | undefined, book: DayBook, today = todayIso()): LiveDay {
  let pnl = 0;
  let count = 0;
  let closedCount = 0;
  let known = true;
  for (const s of strategies ?? []) {
    if (s.status === "live") {
      const open = s.legs.filter((l) => l.status === "open");
      if (open.some((l) => book.priceOf(s, l) === null)) known = false;
      pnl += dayPnl(s, book.pnlOf(s).total, today);
      count += 1;
    } else if (s.status === "archived" && s.tradingMode === "live" && s.closedAt && s.closedAt.slice(0, 10) === today) {
      pnl += dayPnl(s, Number(s.realizedPnl), today);
      count += 1;
      closedCount += 1;
    }
  }
  return { pnl, count, closedCount, known };
}

/** The pause applies when it is on, the figure is known and today's live P&L is below −threshold. */
export function shouldPause(mindful: MindfulSettings | undefined, day: LiveDay): boolean {
  if (!mindful?.enabled || !day.known || day.count === 0) return false;
  return day.pnl < -Number(mindful.thresholdUsd);
}

export interface MindfulPauseInfo {
  day: LiveDay;
  seconds: number;
  thresholdUsd: number;
}

/** What a live entry dialog shows and waits for, or null when no pause applies. */
export function mindfulFor(mindful: MindfulSettings | undefined, strategies: readonly Strategy[] | undefined, book: DayBook, today = todayIso()): MindfulPauseInfo | null {
  const day = liveDayPnl(strategies, book, today);
  if (!mindful || !shouldPause(mindful, day)) return null;
  return { day, seconds: mindful.pauseSeconds, thresholdUsd: Number(mindful.thresholdUsd) };
}
