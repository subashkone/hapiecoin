"use client";
// Autopilot results (ADR-111; HC-TR-224): what the paper trades Autopilot opened came to, by strategy, coin and exit
// style, and by the days to expiry at entry, with the newest closed trades. Net figures are after the fees estimated
// at entry (the paper book charges none). Figures in USD are shown in the trader's display currency.
import { PLAYBOOKS } from "@hapiecoin/pricing";
import { AUTOPILOT_DTE_BAND_LABELS, AUTOPILOT_EXIT_STYLES, type AutopilotExitStyle, type AutopilotResults, CLOSE_REASON_LABELS, type CloseReason } from "@hapiecoin/schema";
import { Button, EmptyState, cn } from "@hapiecoin/ui";
import { useAutopilotResults } from "@/lib/api/autopilot";
import { fmtDateTime, fmtExpiry, fmtStrike } from "@/lib/format";
import { type MoneyFormat, fmtMoney } from "@/lib/money";

const TRADES_SHOWN = 25;
const EXIT_SHORT: Record<AutopilotExitStyle, string> = { trail: "Trail", target: "Target" };
const nameOf = (playbookId: string) => PLAYBOOKS.find((p) => p.id === playbookId)?.name ?? playbookId;
const reasonOf = (reason: string | null) => (reason === null ? "closed" : (CLOSE_REASON_LABELS[reason as CloseReason] ?? reason));
const tone = (v: string) => (Number(v) > 0 ? "text-profit" : Number(v) < 0 ? "text-loss" : "");
const winRate = (wins: number, closed: number) => (closed ? `${Math.round((wins / closed) * 100)}%` : "—");
const hold = (minutes: number | null) => (minutes === null ? "—" : minutes < 90 ? `${minutes} min` : minutes < 48 * 60 ? `${(minutes / 60).toFixed(1)} h` : `${(minutes / 1440).toFixed(1)} d`);
const th = "micro whitespace-nowrap px-2 py-1.5 text-left font-normal";
const td = "whitespace-nowrap px-2 py-1.5";

/** Trail against target over every strategy and coin: the comparison the proving phase is run for. */
export function exitTotals(rows: AutopilotResults["rows"]): { exit: AutopilotExitStyle; closed: number; wins: number; netUsd: number }[] {
  return AUTOPILOT_EXIT_STYLES.map((exit) => {
    const mine = rows.filter((r) => r.exit === exit);
    return { exit, closed: mine.reduce((n, r) => n + r.closed, 0), wins: mine.reduce((n, r) => n + r.wins, 0), netUsd: mine.reduce((n, r) => n + Math.round(Number(r.netUsd) * 100), 0) / 100 };
  });
}

export function AutopilotResultsPanel({ money }: { money: MoneyFormat }) {
  const q = useAutopilotResults();
  const signed = (v: string | number) => fmtMoney(v, money, { signed: true });
  return (
    <section className="flex flex-col gap-3 rounded border border-border p-3" aria-label="Results" data-testid="autopilot-results" data-state={q.isPending ? "loading" : q.isError ? "error" : "ready"}>
      <div>
        <h2 className="text-sm">Results</h2>
        <p className="mt-0.5 max-w-[80ch] text-2xs text-muted-foreground">Every paper trade Autopilot opened (they cannot be deleted, so the losing ones stay counted). A closed trade counts its profit or loss at the prices it was closed on, less the entry and exit fees estimated when it was entered. A win is a closed trade that is above zero after those fees.</p>
      </div>
      {q.isPending ? <p className="text-xs text-muted-foreground">Loading results…</p> : null}
      {q.isError && !q.data ? <EmptyState title="The results could not be loaded" description="Check your connection and try again." action={<Button size="sm" onClick={() => void q.refetch()}>Try again</Button>} className="py-4" /> : null}
      {q.isError && q.data ? <p className="text-2xs text-warning" role="status" data-testid="results-stale">The results could not be refreshed: these are the last figures read. <button type="button" className="underline" onClick={() => void q.refetch()}>Try again</button></p> : null}
      {q.data && q.data.total.open + q.data.total.closed === 0 ? <EmptyState title="No trade yet" description="Results appear here once Autopilot has entered a trade." className="py-4" /> : null}
      {q.data && q.data.total.open + q.data.total.closed > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5" data-testid="autopilot-results-total">
            <div><div className="micro">Closed</div><div className="num text-lg font-medium" data-testid="results-closed">{q.data.total.closed}</div><div className="text-2xs text-muted-foreground">{q.data.total.open} still open</div></div>
            <div><div className="micro">Won</div><div className="num text-lg font-medium" data-testid="results-won">{q.data.total.wins} · {winRate(q.data.total.wins, q.data.total.closed)}</div></div>
            <div><div className="micro">Net after fees</div><div className={cn("num text-lg font-medium", tone(q.data.total.netUsd))} data-testid="results-net">{signed(q.data.total.netUsd)}</div><div className="text-2xs text-muted-foreground">{signed(q.data.total.grossUsd)} before {fmtMoney(q.data.total.feesUsd, money)} of fees</div></div>
            {exitTotals(q.data.rows).map((x) => (
              <div key={x.exit} data-testid="results-exit" data-exit={x.exit}><div className="micro">{EXIT_SHORT[x.exit]} exit</div><div className={cn("num text-lg font-medium", tone(String(x.netUsd)))}>{x.closed ? signed(x.netUsd) : "—"}</div><div className="text-2xs text-muted-foreground">{x.closed} closed · {winRate(x.wins, x.closed)} won</div></div>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-2xs" data-testid="results-by-strategy">
              <caption className="micro pb-1 text-left">By strategy, coin and exit style</caption>
              <thead><tr className="border-b border-border">{["Strategy", "Coin", "Exit", "Open", "Closed", "Won", "Net after fees", "Per trade", "Best", "Worst", "Held on average", "How they ended"].map((h) => <th key={h} scope="col" className={th}>{h}</th>)}</tr></thead>
              <tbody>
                {q.data.rows.map((r) => (
                  <tr key={`${r.playbookId}|${r.asset}|${r.exit}`} className="border-b border-border last:border-b-0" data-testid="results-row" data-playbook={r.playbookId} data-asset={r.asset} data-exit={r.exit}>
                    <th scope="row" className={cn(td, "text-left font-medium")}>{nameOf(r.playbookId)}</th>
                    <td className={cn(td, "font-mono")}>{r.asset}</td>
                    <td className={td}>{EXIT_SHORT[r.exit]}</td>
                    <td className={cn(td, "num")}>{r.open}</td>
                    <td className={cn(td, "num")}>{r.closed}</td>
                    <td className={cn(td, "num")}>{r.closed ? `${r.wins} · ${winRate(r.wins, r.closed)}` : "—"}</td>
                    <td className={cn(td, "num", tone(r.netUsd))}>{r.closed ? signed(r.netUsd) : "—"}</td>
                    <td className={cn(td, "num")}>{r.closed ? signed(Number(r.netUsd) / r.closed) : "—"}</td>
                    <td className={cn(td, "num")}>{r.bestNetUsd === null ? "—" : signed(r.bestNetUsd)}</td>
                    <td className={cn(td, "num")}>{r.worstNetUsd === null ? "—" : signed(r.worstNetUsd)}</td>
                    <td className={cn(td, "num")}>{hold(r.avgHoldMinutes)}</td>
                    <td className={td}>{Object.entries(r.reasons).map(([k, n]) => `${n} ${reasonOf(k)}`).join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-2xs" data-testid="results-by-dte">
              <caption className="micro pb-1 text-left">By days to expiry when entered</caption>
              <thead><tr className="border-b border-border">{["Entered", "Open", "Closed", "Won", "Fees", "Net after fees"].map((h) => <th key={h} scope="col" className={th}>{h}</th>)}</tr></thead>
              <tbody>
                {q.data.byDte.map((b) => (
                  <tr key={b.band} className="border-b border-border last:border-b-0" data-testid="results-dte" data-band={b.band}>
                    <th scope="row" className={cn(td, "text-left font-medium")}>{AUTOPILOT_DTE_BAND_LABELS[b.band]}</th>
                    <td className={cn(td, "num")}>{b.open}</td>
                    <td className={cn(td, "num")}>{b.closed}</td>
                    <td className={cn(td, "num")}>{b.closed ? `${b.wins} · ${winRate(b.wins, b.closed)}` : "—"}</td>
                    <td className={cn(td, "num")}>{b.closed ? fmtMoney(b.feesUsd, money) : "—"}</td>
                    <td className={cn(td, "num", tone(b.netUsd))}>{b.closed ? signed(b.netUsd) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {q.data.trades.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-2xs" data-testid="results-trades">
                <caption className="micro pb-1 text-left">Closed trades, newest first{q.data.trades.length > TRADES_SHOWN ? ` (the newest ${TRADES_SHOWN})` : ""}</caption>
                <thead><tr className="border-b border-border">{["Closed", "Strategy", "Strikes", "Exit", "Ended", "Before fees", "Fees", "Net"].map((h) => <th key={h} scope="col" className={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {q.data.trades.slice(0, TRADES_SHOWN).map((x) => (
                    <tr key={x.strategyId} className="border-b border-border last:border-b-0" data-testid="results-trade" data-id={x.strategyId}>
                      <td className={cn(td, "num text-muted-foreground")}>{fmtDateTime(x.closedAt)}</td>
                      <th scope="row" className={cn(td, "text-left font-medium")}>{nameOf(x.playbookId)} · {x.asset}</th>
                      <td className={cn(td, "num")}>{[...new Set(x.strikes.map(fmtStrike))].join(" / ") || "—"}{x.expiry ? ` · ${fmtExpiry(x.expiry)}` : ""}{x.dte === null ? "" : ` · ${x.dte}d out`}</td>
                      <td className={td}>{EXIT_SHORT[x.exit]}</td>
                      <td className={td}>{reasonOf(x.closeReason)}</td>
                      <td className={cn(td, "num")}>{signed(x.grossUsd)}</td>
                      <td className={cn(td, "num")}>{fmtMoney(x.feesUsd, money)}</td>
                      <td className={cn(td, "num", tone(x.netUsd))}>{signed(x.netUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-2xs text-muted-foreground">No trade has closed yet: the figures fill in as the open trades reach their exits.</p>
          )}
          <p className="text-2xs text-muted-foreground" data-testid="results-since">Counted since {fmtDateTime(q.data.since)}. Fees are an estimate made at entry; the paper book itself charges none.</p>
        </>
      ) : null}
    </section>
  );
}
