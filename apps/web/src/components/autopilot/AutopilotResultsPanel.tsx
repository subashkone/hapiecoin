"use client";
// Autopilot results (ADR-111, ADR-116, ADR-139; HC-TR-224, HC-TR-232, HC-TR-267; narrowed by the screen's expiry, coin and search selection): what the paper
// trades Autopilot opened came to. The closed trades come first, grouped by the day they closed with a total for the
// day, and can be narrowed to one day and to the won or the lost ones; the tables by strategy and by days to expiry
// follow. Net figures are after the fees estimated at entry (the paper book charges none). Figures in USD are shown in
// the trader's display currency.
import { AUTOPILOT_DTE_BAND_LABELS, AUTOPILOT_EXIT_STYLES, type AutopilotClosedTrade, type AutopilotExitStyle, type AutopilotResults, CLOSE_REASON_LABELS, type CloseReason } from "@hapiecoin/schema";
import { Button, EmptyState, cn } from "@hapiecoin/ui";
import { useState } from "react";
import { useAutopilotResults } from "@/lib/api/autopilot";
import { fmtDateTime, fmtExpiry, fmtStrike } from "@/lib/format";
import { type MoneyFormat, fmtMoney } from "@/lib/money";
import { BUILT_IN_CATALOGUE } from "@/lib/strategy/autopilot-catalogue";

/** Closed trades drawn at first, and added by "Show more": a year of dailies is thousands of rows. */
export const TRADES_PAGE = 100;
const EXIT_SHORT: Record<AutopilotExitStyle, string> = { trail: "Trail", target: "Target", own: "Own" };
const reasonOf = (reason: string | null) => (reason === null ? "closed" : (CLOSE_REASON_LABELS[reason as CloseReason] ?? reason));
const tone = (v: string | number) => (Number(v) > 0 ? "text-profit" : Number(v) < 0 ? "text-loss" : "");
const winRate = (wins: number, closed: number) => (closed ? `${Math.round((wins / closed) * 100)}%` : "—");
const hold = (minutes: number | null) => (minutes === null ? "—" : minutes < 90 ? `${minutes} min` : minutes < 48 * 60 ? `${(minutes / 60).toFixed(1)} h` : `${(minutes / 1440).toFixed(1)} d`);
const th = "micro whitespace-nowrap px-2.5 py-2 text-left font-normal";
const thNum = "micro whitespace-nowrap px-2.5 py-2 text-right font-normal";
const td = "whitespace-nowrap px-2.5 py-2";
const tdNum = "num whitespace-nowrap px-2.5 py-2 text-right";
const chip = (on: boolean) => cn("h-7 rounded border border-border px-2.5 text-xs", on ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground");
const NUMERIC = new Set(["Open", "Closed", "Won", "Net after fees", "Per trade", "Best", "Worst", "Held on average", "Fees", "Before fees", "Net", "Strikes"]);
const head = (h: string) => <th key={h} scope="col" className={NUMERIC.has(h) ? thNum : th}>{h}</th>;

/** "1 trade", "3 trades". */
export const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
/** The day of a moment as the viewer's clock has it: "24 Nov 2026" (the first part of the screen's own date and time). */
export const dayOf = (iso: string): string => fmtDateTime(iso).split(",")[0] ?? "";
/** The time of a moment with its zone: "17:32 IST". */
const timeOf = (iso: string): string => fmtDateTime(iso).split(", ")[1] ?? "";

export type Outcome = "all" | "won" | "lost";
/** A win is a closed trade above zero after the estimated fees; everything else counts as lost (ADR-111). */
export const won = (t: Pick<AutopilotClosedTrade, "netUsd">): boolean => Number(t.netUsd) > 0;

/** Closed trades by the day they closed, newest day first, each with what the day came to in cents. */
export function byDay(trades: readonly AutopilotClosedTrade[]): { day: string; trades: AutopilotClosedTrade[]; wins: number; netUsd: number }[] {
  const days = new Map<string, AutopilotClosedTrade[]>();
  for (const t of trades) days.set(dayOf(t.closedAt), [...(days.get(dayOf(t.closedAt)) ?? []), t]);
  return [...days.entries()].map(([day, list]) => ({ day, trades: list, wins: list.filter(won).length, netUsd: list.reduce((n, t) => n + Math.round(Number(t.netUsd) * 100), 0) / 100 }));
}

/** Trail against target over every strategy and coin: the comparison the proving phase is run for. */
export function exitTotals(rows: AutopilotResults["rows"]): { exit: AutopilotExitStyle; closed: number; wins: number; netUsd: number }[] {
  return AUTOPILOT_EXIT_STYLES.map((exit) => {
    const mine = rows.filter((r) => r.exit === exit);
    return { exit, closed: mine.reduce((n, r) => n + r.closed, 0), wins: mine.reduce((n, r) => n + r.wins, 0), netUsd: mine.reduce((n, r) => n + Math.round(Number(r.netUsd) * 100), 0) / 100 };
  });
}

/** The totals of a set of rows, in cents (the server's total covers every row; a selection is added up here). */
export function totalOf(rows: AutopilotResults["rows"]): AutopilotResults["total"] {
  const sum = (f: (r: AutopilotResults["rows"][number]) => number) => rows.reduce((n, r) => n + f(r), 0);
  const usd = (f: (r: AutopilotResults["rows"][number]) => string) => (sum((r) => Math.round(Number(f(r)) * 100)) / 100).toFixed(2);
  return { open: sum((r) => r.open), closed: sum((r) => r.closed), wins: sum((r) => r.wins), grossUsd: usd((r) => r.grossUsd), feesUsd: usd((r) => r.feesUsd), netUsd: usd((r) => r.netUsd) };
}

/** `show` (ADR-116): the screen's selection by expiry and coin; the rows, the totals and the closed trades follow it. */
export function AutopilotResultsPanel({ money, show, nameOf = BUILT_IN_CATALOGUE.nameOf }: { money: MoneyFormat; show?: ((playbookId: string, asset: string) => boolean) | undefined; /** The name of a strategy by its id: the screen passes its own, which knows the saved ones (HC-TR-279). */ nameOf?: ((playbookId: string) => string) | undefined }) {
  const raw = useAutopilotResults();
  const [day, setDay] = useState("all");
  const [outcome, setOutcome] = useState<Outcome>("all");
  const [limit, setLimit] = useState(TRADES_PAGE);
  const q = { ...raw, data: raw.data && show ? { ...raw.data, rows: raw.data.rows.filter((r) => show(r.playbookId, r.asset)), trades: raw.data.trades.filter((t) => show(t.playbookId, t.asset)), total: totalOf(raw.data.rows.filter((r) => show(r.playbookId, r.asset))) } : raw.data };
  const signed = (v: string | number) => fmtMoney(v, money, { signed: true });
  const days = byDay(q.data?.trades ?? []);
  // a day that has left the selection (the coin was changed) is not kept as an empty list
  const dayShown = days.some((d) => d.day === day) ? day : "all";
  const picked = days.filter((d) => dayShown === "all" || d.day === dayShown).map((d) => ({ ...d, list: d.trades.filter((t) => outcome === "all" || won(t) === (outcome === "won")) })).filter((d) => d.list.length > 0);
  const pickedCount = picked.reduce((n, d) => n + d.list.length, 0);
  // the server sends its newest closed trades; every closed one is in the total (of the selection, when one is on)
  const cut = q.data ? Math.max(0, q.data.total.closed - q.data.trades.length) : 0;
  // with older trades left out, the oldest day listed may be only a part of that day
  const partDay = cut > 0 ? days[days.length - 1]?.day : undefined;
  // the rows drawn: the days in order until the page is full
  const drawn: typeof picked = [];
  let room = limit;
  for (const d of picked) {
    if (room <= 0) break;
    drawn.push({ ...d, list: d.list.slice(0, room) });
    room -= Math.min(room, d.list.length);
  }
  return (
    <section className="flex flex-col gap-3" aria-label="Results" data-testid="autopilot-results" data-state={q.isPending ? "loading" : q.isError ? "error" : "ready"} data-filtered={Boolean(show)}>
      <div>
        <h2 className="text-sm">Closed trades and results</h2>
        <p className="mt-0.5 max-w-[90ch] text-xs text-muted-foreground">Every paper trade Autopilot opened (they cannot be deleted, so the losing ones stay counted). A closed trade counts its profit or loss at the prices it was closed on, less the entry and exit fees estimated when it was entered. A win is a closed trade that is above zero after those fees; every other closed trade counts as lost.</p>
      </div>
      {q.isPending ? <p className="text-xs text-muted-foreground">Loading results…</p> : null}
      {q.isError && !q.data ? <EmptyState title="The results could not be loaded" description="Check your connection and try again." action={<Button size="sm" onClick={() => void q.refetch()}>Try again</Button>} className="py-4" /> : null}
      {q.isError && q.data ? <p className="text-xs text-warning" role="status" data-testid="results-stale">The results could not be refreshed: these are the last figures read. <button type="button" className="underline" onClick={() => void q.refetch()}>Try again</button></p> : null}
      {q.data && q.data.total.open + q.data.total.closed === 0 ? <EmptyState title={show ? "No trade in this selection yet" : "No trade yet"} description="Results appear here once Autopilot has entered a trade." className="py-4" /> : null}
      {q.data && q.data.total.open + q.data.total.closed > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded border border-border p-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="autopilot-results-total">
            <div><div className="micro">Closed</div><div className="num text-lg font-medium" data-testid="results-closed">{q.data.total.closed}</div><div className="text-xs text-muted-foreground">{q.data.total.open} still open</div></div>
            <div><div className="micro">Won</div><div className="num text-lg font-medium" data-testid="results-won">{q.data.total.wins} · {winRate(q.data.total.wins, q.data.total.closed)}</div></div>
            <div><div className="micro">Net after fees</div><div className={cn("num text-lg font-medium", tone(q.data.total.netUsd))} data-testid="results-net">{signed(q.data.total.netUsd)}</div><div className="text-xs text-muted-foreground">{signed(q.data.total.grossUsd)} before {fmtMoney(q.data.total.feesUsd, money)} of fees</div></div>
            {exitTotals(q.data.rows).map((x) => (
              <div key={x.exit} data-testid="results-exit" data-exit={x.exit}><div className="micro">{EXIT_SHORT[x.exit]} exit</div><div className={cn("num text-lg font-medium", tone(String(x.netUsd)))}>{x.closed ? signed(x.netUsd) : "—"}</div><div className="text-xs text-muted-foreground">{x.closed} closed · {winRate(x.wins, x.closed)} won</div></div>
            ))}
          </div>

          {q.data.trades.length ? (
            <>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2" data-testid="results-pick">
                <label className="flex items-center gap-2 text-xs">
                  <span className="micro">Day closed</span>
                  <select value={dayShown} onChange={(e) => { setDay(e.target.value); setLimit(TRADES_PAGE); }} className="h-7 rounded border border-border bg-background px-1.5 text-xs" data-testid="results-day-pick">
                    <option value="all">All days · {count(q.data.trades.length, "trade")}</option>
                    {days.map((d) => <option key={d.day} value={d.day}>{d.day} · {count(d.trades.length, "trade")}</option>)}
                  </select>
                </label>
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Result">
                  <span className="micro mr-1" aria-hidden="true">Result</span>
                  {(["all", "won", "lost"] as const).map((o) => (
                    <button key={o} type="button" className={chip(outcome === o)} aria-pressed={outcome === o} onClick={() => { setOutcome(o); setLimit(TRADES_PAGE); }} data-testid="results-outcome" data-value={o}>{o === "all" ? "All" : o === "won" ? "Won" : "Lost"}</button>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto rounded border border-border">
                <table className="w-full min-w-[980px] border-collapse text-sm" data-testid="results-trades">
                  <caption className="micro px-2.5 pb-1 pt-2 text-left">Closed trades by the day they closed, newest first{cut > 0 ? ` (the newest ${q.data.trades.length} of ${q.data.total.closed})` : ""}</caption>
                  <thead><tr className="border-b border-border">{["Closed at", "Strategy", "Strikes", "Opened", "Exit", "Ended", "Before fees", "Fees", "Net"].map(head)}</tr></thead>
                  <tbody>
                    {picked.length === 0 ? <tr><td colSpan={9} className="px-2.5 py-3 text-xs text-muted-foreground" data-testid="results-none">No {outcome === "all" ? "closed" : outcome} trade {dayShown === "all" ? "in this selection" : `on ${dayShown}`}.</td></tr> : null}
                    {drawn.map((d) => [
                        <tr key={d.day} className="border-b border-border bg-muted" data-testid="results-day" data-day={d.day}>
                          <th scope="row" colSpan={8} className="px-2.5 py-1.5 text-left text-xs font-medium">{d.day} · {d.trades.length} closed · {d.wins} won · {d.trades.length - d.wins} lost{d.day === partDay ? " · only the part of this day that is listed" : ""}</th>
                          <td className={cn(tdNum, "py-1.5 text-xs font-medium", tone(d.netUsd))} data-testid="results-day-net">{signed(d.netUsd)}</td>
                        </tr>,
                        ...d.list.map((x) => (
                          <tr key={x.strategyId} className="border-b border-border last:border-b-0" data-testid="results-trade" data-id={x.strategyId} data-won={won(x)}>
                            <td className={cn(td, "num text-muted-foreground")}>{timeOf(x.closedAt)}</td>
                            <th scope="row" className={cn(td, "text-left font-medium")}>{nameOf(x.playbookId)} · {x.asset}</th>
                            <td className={tdNum}>{[...new Set(x.strikes.map(fmtStrike))].join(" / ") || "—"}{x.expiry ? ` · ${fmtExpiry(x.expiry)}` : ""}{x.dte === null ? "" : ` · ${x.dte}d out`}</td>
                            <td className={cn(td, "num text-muted-foreground")}>{fmtDateTime(x.openedAt)}</td>
                            <td className={td}>{EXIT_SHORT[x.exit]}</td>
                            <td className={td}>{reasonOf(x.closeReason)}</td>
                            <td className={tdNum}>{signed(x.grossUsd)}</td>
                            <td className={tdNum}>{fmtMoney(x.feesUsd, money)}</td>
                            <td className={cn(tdNum, tone(x.netUsd))}>{signed(x.netUsd)}</td>
                          </tr>
                        )),
                    ])}
                  </tbody>
                </table>
              </div>
              {pickedCount > limit ? <div><Button size="sm" variant="outline" onClick={() => setLimit(limit + TRADES_PAGE)} data-testid="results-more">Show {Math.min(TRADES_PAGE, pickedCount - limit)} more of {pickedCount}</Button></div> : null}
              <p className="text-xs text-muted-foreground" data-testid="results-day-note">A day's total counts every trade closed that day in this selection, whatever the Result buttons show.{cut > 0 ? ` ${cut} older closed ${cut === 1 ? "trade is" : "trades are"} counted in the totals and not listed.` : ""}</p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">No trade has closed yet: the figures fill in as the open trades reach their exits.</p>
          )}

          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full min-w-[980px] border-collapse text-sm" data-testid="results-by-strategy">
              <caption className="micro px-2.5 pb-1 pt-2 text-left">By strategy, coin and exit style</caption>
              <thead><tr className="border-b border-border">{["Strategy", "Coin", "Exit", "Open", "Closed", "Won", "Net after fees", "Per trade", "Best", "Worst", "Held on average", "How they ended"].map(head)}</tr></thead>
              <tbody>
                {q.data.rows.map((r) => (
                  <tr key={`${r.playbookId}|${r.asset}|${r.exit}`} className="border-b border-border last:border-b-0" data-testid="results-row" data-playbook={r.playbookId} data-asset={r.asset} data-exit={r.exit}>
                    <th scope="row" className={cn(td, "text-left font-medium")}>{nameOf(r.playbookId)}</th>
                    <td className={cn(td, "font-mono")}>{r.asset}</td>
                    <td className={td}>{EXIT_SHORT[r.exit]}</td>
                    <td className={tdNum}>{r.open}</td>
                    <td className={tdNum}>{r.closed}</td>
                    <td className={tdNum}>{r.closed ? `${r.wins} · ${winRate(r.wins, r.closed)}` : "—"}</td>
                    <td className={cn(tdNum, tone(r.netUsd))}>{r.closed ? signed(r.netUsd) : "—"}</td>
                    <td className={tdNum}>{r.closed ? signed(Number(r.netUsd) / r.closed) : "—"}</td>
                    <td className={tdNum}>{r.bestNetUsd === null ? "—" : signed(r.bestNetUsd)}</td>
                    <td className={tdNum}>{r.worstNetUsd === null ? "—" : signed(r.worstNetUsd)}</td>
                    <td className={tdNum}>{hold(r.avgHoldMinutes)}</td>
                    <td className={td}>{Object.entries(r.reasons).map(([k, n]) => `${n} ${reasonOf(k)}`).join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {show ? null : (
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full min-w-[520px] border-collapse text-sm" data-testid="results-by-dte">
              <caption className="micro px-2.5 pb-1 pt-2 text-left">By days to expiry when entered</caption>
              <thead><tr className="border-b border-border">{["Entered", "Open", "Closed", "Won", "Fees", "Net after fees"].map(head)}</tr></thead>
              <tbody>
                {q.data.byDte.map((b) => (
                  <tr key={b.band} className="border-b border-border last:border-b-0" data-testid="results-dte" data-band={b.band}>
                    <th scope="row" className={cn(td, "text-left font-medium")}>{AUTOPILOT_DTE_BAND_LABELS[b.band]}</th>
                    <td className={tdNum}>{b.open}</td>
                    <td className={tdNum}>{b.closed}</td>
                    <td className={tdNum}>{b.closed ? `${b.wins} · ${winRate(b.wins, b.closed)}` : "—"}</td>
                    <td className={tdNum}>{b.closed ? fmtMoney(b.feesUsd, money) : "—"}</td>
                    <td className={cn(tdNum, tone(b.netUsd))}>{b.closed ? signed(b.netUsd) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
          <p className="text-xs text-muted-foreground" data-testid="results-since">Counted since {fmtDateTime(q.data.since)}. Fees are an estimate made at entry; the paper book itself charges none.</p>
        </>
      ) : null}
    </section>
  );
}
