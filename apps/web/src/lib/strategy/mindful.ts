// Mindful Trading pause (roadmap item 10, ADR-074; HC-TR-182..183): whether the trader is down on the day on live
// strategies, read from the same book the PortfolioBar's Day P&L reads, restricted to live strategies and with the
// live trades closed today included. The day is the UTC day the P&L points are keyed by (usePnlWriter), shown to the
// trader as "since 05:30 IST (00:00 UTC)" so the figure here and the bar's tile never disagree. Since ADR-084 the
// server computes the same figure from its recorded marks and carries it in the live preview (`MindfulPreview`);
// when the server's figure is known it decides, and the server delays the entry until the pause it showed has
// elapsed; this fold is the fallback while the server has no fresh mark for an open leg.
import { MindfulPreview, type MindfulSettings, type Strategy, type StrategyLeg } from "@hapiecoin/schema";
import { ApiError } from "@/lib/api/client";
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
  /** Whose figure this is: the server's recorded marks (ADR-084) or this tab's book (ADR-074). */
  source: "server" | "browser";
}

/** What a live entry dialog shows and waits for, or null when no pause applies. */
export function mindfulFor(mindful: MindfulSettings | undefined, strategies: readonly Strategy[] | undefined, book: DayBook, today = todayIso()): MindfulPauseInfo | null {
  const day = liveDayPnl(strategies, book, today);
  if (!mindful || !shouldPause(mindful, day)) return null;
  return { day, seconds: mindful.pauseSeconds, thresholdUsd: Number(mindful.thresholdUsd), source: "browser" };
}

/**
 * The server's verdict from a live preview (ADR-084): the pause it decided, null when its figure is known and no
 * pause applies, undefined when it has no figure (an open leg without a fresh mark) so the browser's fold decides.
 */
export function serverMindful(m: MindfulPreview | null | undefined): MindfulPauseInfo | null | undefined {
  if (!m || !m.day.known) return undefined;
  if (m.pause === null) return null;
  return { day: { pnl: Number(m.day.pnlUsd), count: m.day.count, closedCount: m.day.closedCount, known: true }, seconds: m.pause.seconds, thresholdUsd: Number(m.pause.thresholdUsd), source: "server" };
}

/**
 * The pause a refused live entry carries (409 MINDFUL_PAUSE, ADR-084): the server decided a pause the preview did not
 * show (the day moved after it, or its stamp had gone). The block's info with the server's seconds left; null for any
 * other error.
 */
export function refusedMindful(e: unknown): MindfulPauseInfo | null {
  if (!(e instanceof ApiError) || e.code !== "MINDFUL_PAUSE") return null;
  const parsed = MindfulPreview.safeParse({ day: e.details?.["day"], pause: e.details?.["pause"] });
  const info = parsed.success ? serverMindful(parsed.data) : undefined;
  if (!info) return null;
  const waitS = e.details?.["waitS"];
  return { ...info, seconds: typeof waitS === "number" ? waitS : info.seconds };
}
