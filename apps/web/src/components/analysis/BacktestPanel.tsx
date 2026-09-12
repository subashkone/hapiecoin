"use client";
// Backtest tab (ADR-077; HC-TR-185): a catalogue template entered at every recorded end of day on the venue's own
// chain history and held to expiry. Every figure comes from marks the venue published; an open trade valued from the
// model says "modelled". The coverage line always says how much history there is, so a week of data never reads as
// a year of evidence (ADR-060: "ready-made structures", never "proven").
import { BACKTEST_MIN_DTE, type BacktestTrade } from "@hapiecoin/schema";
import { TEMPLATES, TEMPLATE_CATEGORIES, type TemplateCategory } from "@hapiecoin/pricing";
import { Button, EmptyState, cn } from "@hapiecoin/ui";
import { useMemo, useState } from "react";
import { ApiError } from "@/lib/api/client";
import { useBacktest } from "@/lib/api/backtest";
import { useSettings } from "@/lib/api/queries";
import { fmtDate, fmtExpiry } from "@/lib/format";
import { type MoneyFormat, USD, fmtMoney } from "@/lib/money";
import { useUiStore } from "@/lib/store";
import { DEFAULT_LOTS } from "@/lib/strategy/legs";
import { Chart } from "@/components/analytics/Chart";

const RANGES = [
  { id: "7D", days: 7 },
  { id: "30D", days: 30 },
  { id: "90D", days: 90 },
  { id: "1Y", days: 365 },
] as const;
type RangeId = (typeof RANGES)[number]["id"];

const dayBack = (n: number, now = Date.now()) => new Date(now - n * 86_400_000).toISOString().slice(0, 10);
const tone = (v: number) => (v > 0 ? "text-profit" : v < 0 ? "text-loss" : "text-muted-foreground");

/** "B C 80000 · S C 82000": the legs of a trade in one line. */
export function legsLine(t: BacktestTrade): string {
  return t.legs.map((l) => `${l.side === "buy" ? "B" : "S"} ${l.kind === "call" ? "C" : l.kind === "put" ? "P" : "F"}${l.kind === "future" ? "" : ` ${Number(l.strike)}`}`).join(" · ");
}

export function BacktestPanel() {
  const asset = useUiStore((s) => s.asset);
  const { data: settings } = useSettings();
  const money: MoneyFormat = settings ? { currency: settings.currency, rate: settings.conversionRate } : USD;
  const [template, setTemplate] = useState("Bull Call Spread");
  const [lots, setLots] = useState(DEFAULT_LOTS);
  const [minDte, setMinDte] = useState<number>(7);
  const [range, setRange] = useState<RangeId>("30D");
  const from = useMemo(() => dayBack(RANGES.find((r) => r.id === range)!.days), [range]);
  const q = useBacktest({ asset, template, lots, minDte, from });
  const r = q.data;
  const notYet = q.isError && q.error instanceof ApiError && q.error.status === 503;
  const errorText = q.isError ? (q.error instanceof Error ? q.error.message : String(q.error)) : null;
  const state = q.isError ? (notYet ? "empty" : "error") : !r ? "loading" : r.coverage.entries === 0 ? "empty" : "ready";
  const byCategory = useMemo(() => TEMPLATE_CATEGORIES.filter((c): c is TemplateCategory => c !== "All").map((c) => ({ category: c, names: TEMPLATES.filter((t) => t.category === c).map((t) => t.name) })), []);
  const m = (v: string | null | undefined, signed = true) => (v === null || v === undefined ? "—" : fmtMoney(Number(v), money, { signed }));
  const trades = r ? [...r.trades].reverse() : [];
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-auto p-2" data-testid="backtest-panel" data-state={state} data-trades={r?.trades.length ?? 0}>
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label className="flex flex-col gap-0.5">
          <span className="micro">Template</span>
          <select value={template} onChange={(e) => setTemplate(e.target.value)} className="h-7 rounded border border-input bg-background px-1 text-xs" data-testid="backtest-template">
            {byCategory.map((g) => (
              <optgroup key={g.category} label={g.category}>
                {g.names.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="micro">Lots</span>
          <input type="number" min={1} max={1000} value={lots} onChange={(e) => setLots(Math.max(1, Math.min(1000, Math.floor(Number(e.target.value) || 1))))} className="num h-7 w-16 rounded border border-input bg-background px-1 text-xs" data-testid="backtest-lots" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="micro" title="The entry takes the nearest listed expiry with at least this many days left">Min days to expiry</span>
          <select value={minDte} onChange={(e) => setMinDte(Number(e.target.value))} className="h-7 rounded border border-input bg-background px-1 text-xs" data-testid="backtest-mindte">
            {BACKTEST_MIN_DTE.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex gap-1" role="group" aria-label="Range">
          {RANGES.map((x) => (
            <Button key={x.id} size="sm" variant={x.id === range ? "secondary" : "ghost"} onClick={() => setRange(x.id)} aria-pressed={x.id === range} data-testid={`backtest-range-${x.id}`}>
              {x.id}
            </Button>
          ))}
        </div>
      </div>
      {q.isError && !notYet ? (
        <p className="text-xs text-loss" data-testid="backtest-error">
          {errorText}
        </p>
      ) : notYet ? (
        <EmptyState title="No end-of-day chains recorded yet" description={`A backtest needs at least one recorded day for ${asset}; the first one lands at the settlement hour once the venue's chain is being recorded.`} data-testid="backtest-empty" />
      ) : !r ? (
        <p className="text-xs text-muted-foreground">Running…</p>
      ) : (
        <>
          <p className="text-2xs text-muted-foreground" data-testid="backtest-coverage">
            {r.coverage.days} recorded {r.coverage.days === 1 ? "day" : "days"}
            {r.coverage.firstDay ? ` from ${fmtDate(r.coverage.firstDay)}` : ""}
            {r.coverage.lastDay ? ` to ${fmtDate(r.coverage.lastDay)}` : ""} · {r.coverage.entries} {r.coverage.entries === 1 ? "entry" : "entries"}
            {r.coverage.skipped.noExpiry ? ` · ${r.coverage.skipped.noExpiry} skipped (no expiry ${minDte}+ days out)` : ""}
            {r.coverage.skipped.noFit ? ` · ${r.coverage.skipped.noFit} skipped (ladder too short)` : ""}
            {r.coverage.openTrades ? ` · ${r.coverage.openTrades} still open` : ""}
            {r.coverage.modelledTrades ? ` · ${r.coverage.modelledTrades} modelled` : ""}. Recorded marks, net of nothing: no fees, no slippage.
          </p>
          {r.coverage.entries === 0 ? (
            <EmptyState title="No entries in this range" description="No recorded day had an expiry far enough out for this template, or the ladder was too short for it." data-testid="backtest-no-entries" />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {(
                  [
                    ["Realised", m(r.stats.total), tone(Number(r.stats.total)), "backtest-total", `${r.stats.trades} closed ${r.stats.trades === 1 ? "trade" : "trades"}`],
                    ["Win rate", r.stats.winRate === null ? "—" : `${Math.round(r.stats.winRate * 100)}%`, "", "backtest-winrate", `${r.stats.wins} won · ${r.stats.losses} lost`],
                    ["Average", m(r.stats.average), tone(Number(r.stats.average ?? 0)), "backtest-average", `median ${m(r.stats.median)}`],
                    ["Max drawdown", m(r.stats.maxDrawdown, false), r.stats.maxDrawdown === "0" ? "text-muted-foreground" : "text-loss", "backtest-drawdown", `best ${m(r.stats.best)} · worst ${m(r.stats.worst)}`],
                    ["Profit factor", r.stats.profitFactor === null ? "—" : r.stats.profitFactor.toFixed(2), "", "backtest-pf", "gross wins over gross losses"],
                  ] as const
                ).map(([label, value, cls, id, sub]) => (
                  <div key={id} className="rounded border border-border px-2 py-1.5">
                    <div className="micro">{label}</div>
                    <div className={cn("num text-[15px] font-medium", cls)} data-testid={id}>
                      {value}
                    </div>
                    <div className="text-2xs text-muted-foreground">{sub}</div>
                  </div>
                ))}
              </div>
              <Chart
                h={150}
                x={r.equity.map((e) => e.day.slice(5))}
                xTip={r.equity.map((e) => e.day)}
                series={[{ label: "Realised P&L", type: "line", data: r.equity.map((e) => Number(e.pnl)), color: "hsl(var(--foreground))", width: 1.4, fmt: (v) => fmtMoney(v, money, { signed: true }) }]}
                yFmt={(v) => fmtMoney(v, money)}
                zero
                empty="No closed trades yet"
                testId="chart-backtest"
              />
              <table className="w-full text-2xs" data-testid="backtest-trades">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-1 text-left font-normal">Entry</th>
                    <th className="py-1 text-left font-normal">Expiry</th>
                    <th className="py-1 text-left font-normal">Legs</th>
                    <th className="py-1 text-right font-normal">Cost</th>
                    <th className="py-1 text-left font-normal">Exit</th>
                    <th className="py-1 text-right font-normal">P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.slice(0, 60).map((t) => (
                    <tr key={`${t.entryDay}-${t.expiry}`} className="border-t border-border" data-testid="backtest-trade" data-status={t.status} data-modelled={t.modelled}>
                      <td className="py-0.5 pr-2">{fmtDate(t.entryDay)}</td>
                      <td className="py-0.5 pr-2">{fmtExpiry(t.expiry)}</td>
                      <td className="py-0.5 pr-2 font-mono">{legsLine(t)}</td>
                      <td className="num py-0.5 pr-2 text-right">{m(t.entryCost)}</td>
                      <td className="py-0.5 pr-2">
                        {t.status === "closed" ? fmtDate(t.exitDay) : <span className="text-muted-foreground" data-testid="backtest-open">open · marked {fmtDate(t.exitDay)}</span>}
                        {t.modelled ? <span className="ml-1 text-warning" title="A recorded mark was missing on the last day; valued with Black-76 at that day's ATM IV" data-testid="backtest-modelled">modelled</span> : null}
                      </td>
                      <td className={cn("num py-0.5 text-right", tone(Number(t.pnl)))}>{m(t.pnl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {trades.length > 60 ? <p className="text-2xs text-muted-foreground">and {trades.length - 60} earlier trades</p> : null}
            </>
          )}
        </>
      )}
    </div>
  );
}
