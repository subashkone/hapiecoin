"use client";
// Backtest tab (ADR-077; HC-TR-185): a catalogue template entered at every recorded end of day on the venue's own
// chain history and held to expiry or to its exit rule. Every figure comes from marks the venue published; an open trade valued from the
// model says "modelled". The coverage line always says how much history there is, so a week of data never reads as
// a year of evidence (ADR-060: "ready-made structures", never "proven"). ADR-099 (HC-WS-117): a Rules row charges the
// venue's fee rule (on by default), sets entry conditions and exit rules, and every trade says why it ended.
import { BACKTEST_MIN_DTE, BACKTEST_SMA_DAYS, type BacktestFees, type BacktestTrade } from "@hapiecoin/schema";
import { TEMPLATES, TEMPLATE_CATEGORIES, type TemplateCategory } from "@hapiecoin/pricing";
import { getVenueCore } from "@hapiecoin/venues/core";
import { Button, EmptyState, cn } from "@hapiecoin/ui";
import { useMemo, useState } from "react";
import { ApiError } from "@/lib/api/client";
import { useBacktest } from "@/lib/api/backtest";
import { useSettings } from "@/lib/api/queries";
import { fmtDate, fmtExpiry } from "@/lib/format";
import { type MoneyFormat, USD, fmtMoney } from "@/lib/money";
import { useUiStore } from "@/lib/store";
import { useVenueId } from "@/lib/useVenue";
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
const IV_BANDS = { "": undefined, low: [0, 30], mid: [30, 70], high: [70, 100] } as const;
type IvBand = keyof typeof IV_BANDS;
/** UTC weekdays in the order a trader reads them. */
const WEEKDAYS: readonly { day: number; label: string }[] = [
  { day: 1, label: "Mon" },
  { day: 2, label: "Tue" },
  { day: 3, label: "Wed" },
  { day: 4, label: "Thu" },
  { day: 5, label: "Fri" },
  { day: 6, label: "Sat" },
  { day: 0, label: "Sun" },
];
const TARGETS = [25, 50, 75] as const;
const STOPS = [50, 100, 200] as const;
const TIME_STOPS = [1, 2, 7] as const;
const EXIT_LABEL: Record<BacktestTrade["exitReason"], string> = { settled: "settled", target: "target", stop: "stop", time: "time stop", open: "open" };
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
  // ADR-099: the venue's rule by default; a venue whose schedule was never read (Deribit) can only run without fees
  const venueId = useVenueId();
  const venueRule = getVenueCore(venueId).feeRule;
  const [feesChoice, setFees] = useState<BacktestFees>("venue");
  const fees: BacktestFees = venueRule ? feesChoice : "none";
  const [smaDays, setSmaDays] = useState<number | undefined>(undefined);
  const [smaSide, setSmaSide] = useState<"above" | "below">("above");
  const [ivBand, setIvBand] = useState<IvBand>("");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [targetPct, setTargetPct] = useState<number | undefined>(undefined);
  const [stopPct, setStopPct] = useState<number | undefined>(undefined);
  const [timeStopDte, setTimeStopDte] = useState<number | undefined>(undefined);
  const from = useMemo(() => dayBack(RANGES.find((r) => r.id === range)!.days), [range]);
  const band = IV_BANDS[ivBand];
  const hasExitRules = targetPct !== undefined || stopPct !== undefined || timeStopDte !== undefined;
  // a time stop at or past the entry's minimum days to expiry would fire on the first day of every trade
  const timeStops = TIME_STOPS.filter((v) => v < minDte);
  const q = useBacktest({ asset, template, lots, minDte, from, fees, smaDays, smaSide: smaDays === undefined ? undefined : smaSide, ivRankMin: band?.[0], ivRankMax: band?.[1], weekdays, targetPct, stopPct, timeStopDte });
  const optNum = (v: string) => (v === "" ? undefined : Number(v));
  const selectCls = "h-7 rounded border border-input bg-background px-1 text-xs";
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
      <div className="flex flex-wrap items-end gap-2 text-xs" data-testid="backtest-rules">
        <label className="flex flex-col gap-0.5">
          <span className="micro" title="Delta's published rule: options 0.01 % of notional capped at 3.5 % of the premium, futures 0.05 %, 18 % GST, the taker fee again on an in-the-money settlement">Fees</span>
          <select value={fees} onChange={(e) => setFees(e.target.value === "none" ? "none" : "venue")} className={selectCls} data-testid="backtest-fees" disabled={!venueRule} title={venueRule ? undefined : "This venue's fee schedule has not been read, so the backtest runs without fees here"}>
            <option value="venue">Venue rule</option>
            <option value="none">None</option>
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="micro" title="Enter only when the spot is above or below the average of the last N recorded spots">Trend filter</span>
          <span className="flex gap-1">
            <select value={smaDays ?? ""} onChange={(e) => setSmaDays(optNum(e.target.value))} className={selectCls} data-testid="backtest-sma">
              <option value="">Off</option>
              {BACKTEST_SMA_DAYS.map((d) => (
                <option key={d} value={d}>
                  {d}-day average
                </option>
              ))}
            </select>
            {smaDays !== undefined ? (
              <select value={smaSide} onChange={(e) => setSmaSide(e.target.value === "below" ? "below" : "above")} className={selectCls} data-testid="backtest-sma-side">
                <option value="above">spot above</option>
                <option value="below">spot below</option>
              </select>
            ) : null}
          </span>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="micro" title="Today's front-expiry ATM IV against the recorded ATM IVs of the past year; needs twenty recorded points, reconstructed days carry none">IV rank</span>
          <select value={ivBand} onChange={(e) => setIvBand(e.target.value in IV_BANDS ? (e.target.value as IvBand) : "")} className={selectCls} data-testid="backtest-ivrank">
            <option value="">Any</option>
            <option value="low">Low (0 to 30)</option>
            <option value="mid">Middle (30 to 70)</option>
            <option value="high">High (70 to 100)</option>
          </select>
        </label>
        <div className="flex flex-col gap-0.5">
          <span className="micro" title="UTC weekdays allowed to enter; none selected means every day">Weekdays</span>
          <div className="flex gap-0.5" role="group" aria-label="Weekdays">
            {WEEKDAYS.map((w) => {
              const on = weekdays.includes(w.day);
              return (
                <Button key={w.day} size="sm" variant={on ? "secondary" : "ghost"} aria-pressed={on} onClick={() => setWeekdays(on ? weekdays.filter((d) => d !== w.day) : [...weekdays, w.day])} data-testid={`backtest-weekday-${w.day}`}>
                  {w.label}
                </Button>
              );
            })}
          </div>
        </div>
        <label className="flex flex-col gap-0.5">
          <span className="micro" title="Close when the open profit reaches this share of the maximum profit (of the credit when the profit is unbounded), judged once a day on recorded marks">Target</span>
          <select value={targetPct ?? ""} onChange={(e) => setTargetPct(optNum(e.target.value))} className={selectCls} data-testid="backtest-target">
            <option value="">Off</option>
            {TARGETS.map((v) => (
              <option key={v} value={v}>
                {v} % of max profit
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="micro" title="Close when the open loss reaches this share of the maximum loss (of the premium when the loss is unbounded)">Stop</span>
          <select value={stopPct ?? ""} onChange={(e) => setStopPct(optNum(e.target.value))} className={selectCls} data-testid="backtest-stop">
            <option value="">Off</option>
            {STOPS.map((v) => (
              <option key={v} value={v}>
                {v} % of max loss
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="micro" title="Close on the first recorded day with at most this many days left to the nearest settlement">Time stop</span>
          <select value={timeStopDte !== undefined && timeStops.includes(timeStopDte as (typeof TIME_STOPS)[number]) ? timeStopDte : ""} onChange={(e) => setTimeStopDte(optNum(e.target.value))} className={selectCls} data-testid="backtest-timestop">
            <option value="">Off</option>
            {timeStops.map((v) => (
              <option key={v} value={v}>
                {v} {v === 1 ? "day" : "days"} before settlement
              </option>
            ))}
          </select>
        </label>
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
            {r.coverage.days} {r.coverage.days === 1 ? "day" : "days"} of history
            {r.coverage.reconstructedDays ? ` (${r.coverage.reconstructedDays} reconstructed from the venue's candle history, ${r.coverage.days - r.coverage.reconstructedDays} recorded live)` : ""}
            {r.coverage.firstDay ? ` from ${fmtDate(r.coverage.firstDay)}` : ""}
            {r.coverage.lastDay ? ` to ${fmtDate(r.coverage.lastDay)}` : ""} · {r.coverage.entries} {r.coverage.entries === 1 ? "entry" : "entries"}
            {r.coverage.skipped.noExpiry ? ` · ${r.coverage.skipped.noExpiry} skipped (no expiry ${minDte}+ days out)` : ""}
            {r.coverage.skipped.noFit ? ` · ${r.coverage.skipped.noFit} skipped (ladder too short)` : ""}
            {r.coverage.skipped.noSignal ? ` · ${r.coverage.skipped.noSignal} skipped (no entry signal)` : ""}
            {r.coverage.openTrades ? ` · ${r.coverage.openTrades} still open` : ""}
            {r.coverage.modelledTrades ? ` · ${r.coverage.modelledTrades} modelled` : ""}. Recorded marks,{" "}
            {r.fees === "venue" ? `net of the venue's fees (${m(r.stats.totalFees, false)} on the closed trades)` : "no fees"}, no slippage.
            {hasExitRules ? ` Exits: ${r.coverage.exits.target} on target, ${r.coverage.exits.stop} on stop, ${r.coverage.exits.time} on time, ${r.coverage.exits.settled} settled.` : ""}
            {r.coverage.exits.inert ? ` ${r.coverage.exits.inert} ${r.coverage.exits.inert === 1 ? "trade had" : "trades had"} no base for the target or stop (a near-zero premium on an unbounded payoff), so the rule could not fire.` : ""}
          </p>
          {r.coverage.entries === 0 ? (
            <EmptyState
              title="No entries in this range"
              description={
                r.coverage.skipped.noSignal >= Math.max(r.coverage.skipped.noExpiry, r.coverage.skipped.noFit, 1)
                  ? `No recorded day in this range met the entry conditions (${r.coverage.skipped.noSignal} skipped for no signal). A trend filter or IV-rank band also needs enough recorded history before the day, and reconstructed days carry no IV.`
                  : "No recorded day had an expiry far enough out for this template, or the ladder was too short for it."
              }
              data-testid="backtest-no-entries"
            />
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
              <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-2xs" data-testid="backtest-trades">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-1 text-left font-normal">Entry</th>
                    <th className="py-1 text-left font-normal">Expiry</th>
                    <th className="py-1 text-left font-normal">Legs</th>
                    <th className="py-1 text-right font-normal">Cost</th>
                    <th className="py-1 text-right font-normal">Fees</th>
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
                      <td className="num py-0.5 pr-2 text-right text-muted-foreground" data-testid="backtest-fees-cell">{m(t.fees, false)}</td>
                      <td className="py-0.5 pr-2">
                        {t.status === "closed" ? fmtDate(t.exitDay) : <span className="text-muted-foreground" data-testid="backtest-open">open · marked {fmtDate(t.exitDay)}</span>}
                        {t.status === "closed" && t.exitReason !== "settled" ? (
                          <span className="ml-1 rounded bg-muted px-1 text-muted-foreground" data-testid="backtest-exit-reason">
                            {EXIT_LABEL[t.exitReason]}
                          </span>
                        ) : null}
                        {t.modelled ? <span className="ml-1 text-warning" title="A recorded mark was missing on the last day; valued with Black-76 at that day's ATM IV" data-testid="backtest-modelled">modelled</span> : null}
                      </td>
                      <td className={cn("num py-0.5 text-right", tone(Number(t.pnl)))}>{m(t.pnl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              {trades.length > 60 ? <p className="text-2xs text-muted-foreground">and {trades.length - 60} earlier trades</p> : null}
            </>
          )}
        </>
      )}
    </div>
  );
}
