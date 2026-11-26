"use client";
// Admin · the backtest of a saved Autopilot strategy in the app (HC-TR-289, HC-TR-290; ADR-144): run it on the
// strategy's saved settings, watch it, read its figures with the period, the prices and the limits beside them, and
// put them on the strategy. Opened from the list, never from the editor: a run tests what is saved. Paper arithmetic
// only: public prices are read and nothing is placed.
import { CLOSE_REASON_LABELS, type SavedBacktestRun, type SavedBacktestTrade, type SavedStrategy } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, cn, toast } from "@hapiecoin/ui";
import { useState } from "react";
import { useSavedBacktests, useStartSavedBacktest, useUseSavedBacktest } from "@/lib/api/autopilot-saved";
import { fmtDate, fmtDateTime } from "@/lib/format";

const input = "num h-8 rounded border border-input bg-background px-2 text-xs";
/** USD with its sign, two decimals: the figures of a run are money after fees. */
export const signedUsd = (n: number): string => `${n > 0 ? "+" : n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const tone = (n: number): string | undefined => (n > 0 ? "text-profit" : n < 0 ? "text-loss" : undefined);
export const pricesOf = (r: Pick<SavedBacktestRun, "resolution">): string => (r.resolution === "5m" ? "5-minute prices" : "hourly prices");
/** What a run covered, said the same way wherever its figures are shown. */
export const periodOf = (r: Pick<SavedBacktestRun, "from" | "to" | "resolution">): string => `${fmtDate(r.from)} to ${fmtDate(r.to)} · ${pricesOf(r)}`;
const reasonOf = (reason: string): string => (CLOSE_REASON_LABELS as Record<string, string>)[reason] ?? reason;
const legsOf = (t: SavedBacktestTrade): string => t.legs.map((l) => `${l.side === "sell" ? "S" : "B"} ${l.strike.toLocaleString("en-US")}${l.kind === "call" ? "C" : "P"}`).join(" · ");
/** The whole run before fees, after them, and the fees as what lies between the two. */
export function totalsOf(trades: readonly SavedBacktestTrade[]): { gross: number; fees: number; net: number } {
  // A trade's result before and after fees comes in whole cents and its fees finer than that: the two results are added
  // up in cents and the fees are their difference, so the three figures of the line always agree.
  const cents = (pick: (t: SavedBacktestTrade) => number) => trades.reduce((a, t) => a + Math.round(pick(t) * 100), 0);
  const gross = cents((t) => t.gross);
  const net = cents((t) => t.net);
  return { gross: gross / 100, fees: (gross - net) / 100, net: net / 100 };
}

export function AutopilotBacktestDialog({ strategy, onOpenChange }: { strategy: SavedStrategy; onOpenChange: (open: boolean) => void }) {
  const runs = useSavedBacktests(strategy.id);
  const start = useStartSavedBacktest(strategy.id);
  const use = useUseSavedBacktest(strategy.id);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [used, setUsed] = useState<string | null>(null);
  const latest = runs.data?.[0];
  const earlier = runs.data?.slice(1) ?? [];
  const running = latest?.status === "running";
  const usable = latest?.status === "done" && latest.current && latest.figures !== null && strategy.stage !== "retired";
  const inUse = latest !== undefined && (used === latest.id || strategy.backtest?.run?.id === latest.id);
  const run = () => {
    setRefusal(null);
    if (from && to && from > to) return setRefusal("The period ends before it starts.");
    start.mutate({ ...(from ? { from } : {}), ...(to ? { to } : {}) }, { onError: (e) => setRefusal(e.message) });
    setUsed(null);
  };
  const take = () => {
    if (!latest) return;
    setRefusal(null);
    use.mutate(latest.id, { onSuccess: (s) => { setUsed(latest.id); toast.success("Figures stored", { description: `${s.name} · from the backtest in the app` }); }, onError: (e) => setRefusal(e.message) });
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[880px]" data-testid="saved-backtest-dialog" data-state={runs.isLoading ? "loading" : runs.isError ? "error" : latest ? latest.status : "none"}>
        <DialogHeader>
          <DialogTitle><span className="truncate" title={strategy.name}>Backtest · {strategy.name}</span> <span className="micro">v{strategy.version}</span> <span className="ml-1 rounded border border-border px-1.5 py-0.5 font-mono text-3xs text-muted-foreground">PAPER</span></DialogTitle>
          <DialogDescription>Tests the saved settings of this strategy on the exchange&apos;s recorded prices, with its real fees. Public prices are read; nothing is placed.</DialogDescription>
        </DialogHeader>
        <DialogBody className="max-h-[70vh] space-y-3 overflow-y-auto text-xs">
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(); }}>
            <label className="space-y-1"><span className="micro block">From (optional)</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} data-testid="saved-backtest-from" /></label>
            <label className="space-y-1"><span className="micro block">To (optional)</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={input} data-testid="saved-backtest-to" /></label>
            <Button type="submit" size="sm" variant={usable && !inUse ? "outline" : "primary"} loading={start.isPending} disabled={running} data-testid="saved-backtest-run">{latest ? "Run again" : "Run backtest"}</Button>
            <p className="basis-full text-muted-foreground">Left empty, the period is the latest the recorded history covers: about four months on 5-minute prices for a daily strategy on the next expiries, about a year on hourly prices for anything held longer.</p>
          </form>
          {refusal ? <p className="rounded border border-border p-2 text-loss" role="alert" data-testid="saved-backtest-refusal">{refusal}</p> : null}
          {runs.isLoading ? <div className="h-16 animate-pulse rounded bg-muted" /> : null}
          {runs.isError ? <p className="text-loss" role="alert" data-testid="saved-backtest-load-error">Couldn&apos;t load the backtests: {runs.error.message}</p> : null}
          {runs.data && !latest ? <p className="text-muted-foreground" data-testid="saved-backtest-none">No backtest has been run on this strategy yet.</p> : null}
          {latest ? <RunView run={latest} /> : null}
          {inUse ? <p className="rounded border border-border p-2" data-testid="saved-backtest-used">These figures are on the strategy, marked as a backtest in the app. {strategy.stage === "paper" ? "It stays on paper." : "Its stage is Backtested: publish it from the list to trade on paper."}</p> : null}
          {earlier.length > 0 ? (
            <div data-testid="saved-backtest-earlier">
              <div className="micro">Earlier runs</div>
              <ul className="num text-muted-foreground">
                {earlier.map((r) => <li key={r.id}>{fmtDateTime(r.createdAt)} · {r.status === "done" ? periodOf(r) : pricesOf(r)} · {r.status === "done" ? (r.figures ? `${signedUsd(r.figures.mean)} a ${r.figures.per}, ${r.figures.samples} trades` : "no trade") : r.status === "failed" ? "failed" : "running"}{r.current ? "" : " · settings since changed"}</li>)}
              </ul>
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="saved-backtest-close">Close</Button>
          {usable && !inUse ? <Button loading={use.isPending} onClick={take} data-testid="saved-backtest-use">Use these figures</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One run: where it is, or what it found, with what the figures cover and leave out beside them. */
function RunView({ run }: { run: SavedBacktestRun }) {
  // (the period a run covered is written when it finishes: until then, and on a failed one, only its prices are known)
  const head = <div className="micro" data-testid="saved-backtest-period">Run of {fmtDateTime(run.createdAt)} · {run.status === "done" ? periodOf(run) : pricesOf(run)}</div>;
  if (run.status === "running") {
    const { done, total } = run.progress;
    return (
      <div className="space-y-1 rounded border border-border p-2" data-testid="saved-backtest-running">
        {head}
        <div>{total > 0 ? `Entry day ${done} of ${total}` : "Starting: reading the recorded prices"}</div>
        <div className="h-1.5 overflow-hidden rounded bg-muted" role="progressbar" aria-label="Backtest progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}><div className="h-full bg-foreground/60" style={{ width: `${total > 0 ? Math.round((done / total) * 100) : 0}%` }} /></div>
        <div className="text-muted-foreground">It goes on if you close this; open Backtest again to see it. The first run of a period downloads its prices and can take a few minutes.</div>
      </div>
    );
  }
  if (run.status === "failed") return <div className="space-y-1 rounded border border-border p-2" data-testid="saved-backtest-failed">{head}<div className="text-loss" role="alert">{run.error ?? "The backtest did not finish."}</div></div>;
  const f = run.figures;
  const totals = totalsOf(run.trades);
  const skippedDays = Object.entries(run.noEntry);
  const trades = [...run.trades].reverse();
  return (
    <div className={cn("space-y-2 rounded border border-border p-2", !run.current && "opacity-70")} data-testid="saved-backtest-result" data-current={run.current}>
      {head}
      {run.current ? null : <div data-testid="saved-backtest-stale">The settings changed since this run: its figures cannot be used. Run it again.</div>}
      {f ? (
        <>
          <div className="num flex flex-wrap gap-x-5 gap-y-1 text-sm" data-testid="saved-backtest-figures">
            <span className={tone(f.mean)}>{signedUsd(f.mean)} a {f.per}</span>
            <span>{f.positivePct} % won</span>
            <span>worst <span className={tone(f.worst)}>{signedUsd(f.worst)}</span></span>
            <span>{f.samples} {f.samples === 1 ? "trade" : "trades"}</span>
          </div>
          <div className="num text-muted-foreground" data-testid="saved-backtest-totals">Before fees {signedUsd(totals.gross)} · fees −${totals.fees.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · after fees {signedUsd(totals.net)} (USD, at this strategy&apos;s size)</div>
        </>
      ) : <div data-testid="saved-backtest-empty">It made no trade in this period, so there are no figures to use.</div>}
      <details open data-testid="saved-backtest-notes">
        <summary className="cursor-pointer">The limits of these figures ({run.notes.length + 1})</summary>
        <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
          {run.notes.map((n) => <li key={n}>{n}</li>)}
          <li>A backtest is not a result: past prices do not promise future ones.</li>
        </ul>
      </details>
      {run.barsSkipped === 0 && run.barsJudged > 0 ? <div className="text-muted-foreground" data-testid="saved-backtest-bars">Every one of its {run.barsJudged.toLocaleString("en-US")} price bars had a price for each open option.</div> : null}
      {skippedDays.length > 0 ? (
        <details data-testid="saved-backtest-no-entry">
          <summary className="cursor-pointer">Entry days with no trade: {skippedDays.reduce((a, [, n]) => a + n, 0)}</summary>
          <ul className="list-disc pl-4 text-muted-foreground">{skippedDays.map(([why, n]) => <li key={why}>{why}: {n}</li>)}</ul>
        </details>
      ) : null}
      {trades.length > 0 ? (
        <div className="max-h-[320px] overflow-auto rounded border border-border" tabIndex={0} role="region" aria-label="Trades of this run">
          <table className="w-full min-w-[700px] text-xs" data-testid="saved-backtest-trades">
            <thead className="sticky top-0 bg-background"><tr className="micro text-left"><th className="py-1 pl-2 pr-2">Entered</th><th className="py-1 pr-2">Expiry</th><th className="py-1 pr-2">Legs</th><th className="py-1 pr-2">Ended</th><th className="py-1 pr-2">How</th><th className="py-1 pr-2 text-right">After fees</th></tr></thead>
            <tbody>
              {trades.map((t) => (
                <tr key={`${t.asset}-${t.entryAt}`} className="border-t border-border align-top" data-testid="saved-backtest-trade">
                  <td className="num whitespace-nowrap py-1 pl-2 pr-2">{fmtDateTime(t.entryAt)}</td>
                  <td className="num whitespace-nowrap py-1 pr-2">{t.asset} {fmtDate(t.expiry)}</td>
                  <td className="num whitespace-nowrap py-1 pr-2">{legsOf(t)}</td>
                  <td className="num whitespace-nowrap py-1 pr-2">{fmtDateTime(t.closedAt)}</td>
                  <td className="py-1 pr-2">{reasonOf(t.reason)}</td>
                  <td className={cn("num whitespace-nowrap py-1 pr-2 text-right", tone(t.net))}>{signedUsd(t.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
