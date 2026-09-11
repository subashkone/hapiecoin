// Journal arithmetic (HC-TR-128..136): closed trades from archived strategies, squared-off legs of active ones,
// the stats strip, the equity curve, filters, search and the CSV export. Pure functions over the server's
// strategies; the panel calls them on every list refresh.
import { type CloseReason, type Strategy, type StrategyLeg, CLOSE_REASON_LABELS } from "@hapiecoin/schema";
import { daysOf, legPnl } from "./paper";

export interface Trade {
  s: Strategy;
  /** Realised P&L in USD as the server stores it. */
  pnl: number;
  mode: "paper" | "live";
  days: number;
  openedAt: string;
  closedAt: string;
  /** Why it closed (ADR-059 §2.4); null for trades closed before reasons were recorded. */
  reason: CloseReason | null;
}
/** The reason as shown: "expired", "squared off", "stopped", "closed outside the app"; "" when unknown. */
export const reasonLabel = (reason: CloseReason | null | undefined): string => (reason ? CLOSE_REASON_LABELS[reason] : "");
export const PRESET_TAGS = ["earnings", "range", "hedge"] as const;
export const JOURNAL_FILTERS = ["all", "paper", "live", "wins", "losses", "BTC", "ETH", "XAUT"] as const;
export type JournalFilter = (typeof JOURNAL_FILTERS)[number];
export const FILTER_LABELS: Record<JournalFilter, string> = { all: "All", paper: "Paper", live: "Live", wins: "Wins", losses: "Losses", BTC: "BTC", ETH: "ETH", XAUT: "XAUT" };

/** Archived strategies that were actually traded (started and closed), newest close first. An archived draft never traded, so it is not a trade. */
export function closedTrades(all: readonly Strategy[]): Trade[] {
  const out: Trade[] = [];
  for (const s of all) {
    if (s.status !== "archived" || !s.startedAt || !s.closedAt) continue;
    out.push({ s, pnl: Number(s.realizedPnl), mode: s.tradingMode === "live" ? "live" : "paper", days: daysOf(s), openedAt: s.startedAt, closedAt: s.closedAt, reason: s.closeReason ?? null });
  }
  return out.sort((a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime());
}

export interface ClosedLeg {
  s: Strategy;
  leg: StrategyLeg;
  pnl: number;
  closedAt: string | null;
}
/** Squared-off legs of strategies that are still active, newest close first (their P&L is already realised). */
export function closedLegs(all: readonly Strategy[], lotSizeOf: (asset: Strategy["asset"]) => string): ClosedLeg[] {
  const out: ClosedLeg[] = [];
  for (const s of all) {
    if (s.status !== "paper" && s.status !== "live") continue;
    for (const leg of s.legs) if (leg.status === "squared_off") out.push({ s, leg, pnl: legPnl(leg, null, lotSizeOf(s.asset)).pnl, closedAt: leg.closedAt });
  }
  return out.sort((a, b) => (b.closedAt ? new Date(b.closedAt).getTime() : 0) - (a.closedAt ? new Date(a.closedAt).getTime() : 0));
}

export const isWin = (t: Trade): boolean => t.pnl > 0;
export const isLoss = (t: Trade): boolean => t.pnl < 0;

/** One chip plus a search over name, template, asset, tags and notes. */
export function filterTrades(trades: readonly Trade[], filter: JournalFilter, query: string): Trade[] {
  const q = query.trim().toLowerCase();
  return trades.filter((t) => {
    if (filter === "paper" || filter === "live") {
      if (t.mode !== filter) return false;
    } else if (filter === "wins") {
      if (!isWin(t)) return false;
    } else if (filter === "losses") {
      if (!isLoss(t)) return false;
    } else if (filter !== "all" && t.s.asset !== filter) return false;
    if (!q) return true;
    return `${t.s.name} ${t.s.templateName} ${t.s.asset} ${t.s.tags.join(" ")} ${t.s.notes}`.toLowerCase().includes(q);
  });
}

export interface JournalStats {
  trades: number;
  wins: number;
  losses: number;
  /** wins ÷ trades, 0..1; null without trades. */
  winRate: number | null;
  avg: number | null;
  best: number | null;
  worst: number | null;
  /** gross profit ÷ gross loss; Infinity when nothing was lost; null without trades. */
  profitFactor: number | null;
}
export function journalStats(trades: readonly Trade[]): JournalStats {
  if (trades.length === 0) return { trades: 0, wins: 0, losses: 0, winRate: null, avg: null, best: null, worst: null, profitFactor: null };
  let wins = 0;
  let losses = 0;
  let gross = 0;
  let lost = 0;
  let sum = 0;
  let best = Number.NEGATIVE_INFINITY;
  let worst = Number.POSITIVE_INFINITY;
  for (const t of trades) {
    sum += t.pnl;
    if (t.pnl > 0) {
      wins += 1;
      gross += t.pnl;
    } else if (t.pnl < 0) {
      losses += 1;
      lost += -t.pnl;
    }
    best = Math.max(best, t.pnl);
    worst = Math.min(worst, t.pnl);
  }
  return { trades: trades.length, wins, losses, winRate: wins / trades.length, avg: sum / trades.length, best, worst, profitFactor: lost > 0 ? gross / lost : gross > 0 ? Number.POSITIVE_INFINITY : 0 };
}

export interface EquityPoint {
  t: number;
  /** Cumulative realised P&L after this point. */
  v: number;
  /** The trade that closed here; absent on the opening point. */
  trade?: Trade;
}
/** Cumulative realised P&L over the close dates, starting at zero when the first trade opened. */
export function equityCurve(trades: readonly Trade[]): EquityPoint[] {
  if (trades.length === 0) return [];
  const asc = [...trades].sort((a, b) => new Date(a.closedAt).getTime() - new Date(b.closedAt).getTime());
  const start = Math.min(...asc.map((t) => new Date(t.openedAt).getTime()));
  const out: EquityPoint[] = [{ t: start, v: 0 }];
  let v = 0;
  for (const t of asc) {
    v += t.pnl;
    out.push({ t: new Date(t.closedAt).getTime(), v, trade: t });
  }
  return out;
}

const csvCell = (v: string | number): string => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** id,name,mode,asset,template,legs,opened,closed,days,realized_pnl,close_reason,tags,notes for the given trades. */
export function journalCsv(trades: readonly Trade[]): string {
  const head = "id,name,mode,asset,template,legs,opened,closed,days,realized_pnl,close_reason,tags,notes";
  const lines = trades.map((t) => [t.s.id, t.s.name, t.mode, t.s.asset, t.s.templateName, t.s.legs.length, t.openedAt.slice(0, 10), t.closedAt.slice(0, 10), t.days, t.pnl.toFixed(2), reasonLabel(t.reason), t.s.tags.join(" "), t.s.notes].map(csvCell).join(","));
  return [head, ...lines].join("\n");
}

/** Copy text through the async clipboard, falling back to a hidden textarea + execCommand. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
