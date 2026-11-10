"use client";
// Backtest tab (ADR-077; HC-TR-185): a catalogue template entered at every recorded end of day on the venue's own
// chain history and held to expiry or to its exit rule. ADR-100 (HC-WS-118): a Split control shows the record in two
// or three consecutive periods, and a Sweep view runs one or two rule parameters over a capped grid with a plateau
// reading and the trial count, so a lucky peak and a broad plateau read differently. Every figure comes from marks the venue published; an open trade valued from the
// model says "modelled". The coverage line always says how much history there is, so a week of data never reads as
// a year of evidence (ADR-060: "ready-made structures", never "proven"). ADR-099 (HC-WS-117): a Rules row charges the
// venue's fee rule (on by default), sets entry conditions and exit rules, and every trade says why it ended.
import { BACKTEST_MIN_DTE, BACKTEST_SMA_DAYS, type BacktestFees, type BacktestTrade, type SweepAxis } from "@hapiecoin/schema";
import { TEMPLATES, TEMPLATE_CATEGORIES, type TemplateCategory } from "@hapiecoin/pricing";
import { getVenueCore } from "@hapiecoin/venues/core";
import { Button, EmptyState, cn } from "@hapiecoin/ui";
import { useEffect, useMemo, useState } from "react";
import { ApiError } from "@/lib/api/client";
import { useBacktest, useBacktestSweep } from "@/lib/api/backtest";
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
const IV_BANDS = { "": undefined, low: [0, 30], mid: [30, 70], high: [70, 100], upper: [50, 100] } as const;
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
const TIME_STOPS = [1, 2, 7, 21] as const;
const EXIT_LABEL: Record<BacktestTrade["exitReason"], string> = { settled: "settled", target: "target", stop: "stop", time: "time stop", open: "open" };
/** The values a sweep tries per axis (ADR-100): the Rules row's own option lists, so every loadable cell is a visible option; the time stop is filtered below the minimum days to expiry at render time. */
const SWEEP_PRESETS: Record<SweepAxis, readonly number[]> = { smaDays: BACKTEST_SMA_DAYS, minDte: BACKTEST_MIN_DTE, targetPct: TARGETS, stopPct: STOPS, timeStopDte: TIME_STOPS };
const AXIS_LABEL: Record<SweepAxis, string> = { smaDays: "Average length (days)", minDte: "Min days to expiry", targetPct: "Target (% of max profit)", stopPct: "Stop (% of max loss)", timeStopDte: "Time stop (days before settlement)" };
const AXES = Object.keys(SWEEP_PRESETS) as SweepAxis[];
const isAxis = (v: string): v is SweepAxis => v in SWEEP_PRESETS;
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
  // ADR-100: walk-forward periods and the bounded sweep
  const [folds, setFolds] = useState<number | undefined>(undefined);
  const [sweepOn, setSweepOn] = useState(false);
  const [axis1, setAxis1] = useState<SweepAxis>("minDte");
  const [axis2, setAxis2] = useState<SweepAxis | undefined>(undefined);
  const from = useMemo(() => dayBack(RANGES.find((r) => r.id === range)!.days), [range]);
  const band = IV_BANDS[ivBand];
  const hasExitRules = targetPct !== undefined || stopPct !== undefined || timeStopDte !== undefined;
  // a time stop at or past the entry's minimum days to expiry would fire on the first day of every trade
  const timeStops = TIME_STOPS.filter((v) => v < minDte);
  const params = { asset, template, lots, minDte, from, fees, smaDays, smaSide: smaDays === undefined ? undefined : smaSide, ivRankMin: band?.[0], ivRankMax: band?.[1], weekdays, targetPct, stopPct, timeStopDte };
  const q = useBacktest({ ...params, folds });
  const sweepAxis2 = axis2 !== undefined && axis2 !== axis1 ? axis2 : undefined;
  /** The sweep's values per axis: the time stop keeps only the values below the minimum days to expiry (a later one would fire on day one). */
  const sweepValues = (a: SweepAxis): readonly number[] => (a === "timeStopDte" ? SWEEP_PRESETS[a].filter((v) => v < minDte) : SWEEP_PRESETS[a]);
  // the swept fields are pinned in the sweep's own query (the axis overrides them anyway), so loading a cell into the
  // Rules row does not re-run the sweep; the trend filter keeps its side through a pinned length
  const pinned = (a: SweepAxis | undefined, base: typeof params) =>
    a === undefined ? base : a === "smaDays" ? { ...base, smaDays: base.smaDays === undefined ? undefined : BACKTEST_SMA_DAYS[0] } : a === "minDte" ? { ...base, minDte: BACKTEST_MIN_DTE[0] } : { ...base, [a]: undefined };
  const sweepBase = pinned(sweepAxis2, pinned(axis1, params));
  const sweep = useBacktestSweep({ ...sweepBase, axis1, values1: sweepValues(axis1), axis2: sweepAxis2, values2: sweepAxis2 ? sweepValues(sweepAxis2) : undefined }, sweepOn && sweepValues(axis1).length > 0 && (sweepAxis2 === undefined || sweepValues(sweepAxis2).length > 0));
  const s = sweep.data;
  const sweepNotYet = sweep.isError && sweep.error instanceof ApiError && sweep.error.status === 503;
  // ADR-101: a playbook opened from the Playbooks tab fills the template and the Rules row once
  const preset = useUiStore((s) => s.backtestPreset);
  const setBacktestPreset = useUiStore((s) => s.setBacktestPreset);
  useEffect(() => {
    if (!preset) return;
    if (preset.template) setTemplate(preset.template);
    if (preset.lots !== undefined) setLots(preset.lots);
    if (preset.range !== undefined) setRange(preset.range);
    setFolds(preset.folds);
    if (preset.minDte !== undefined) setMinDte(preset.minDte);
    setSmaDays(preset.smaDays);
    setSmaSide(preset.smaSide ?? "above");
    const band = (Object.entries(IV_BANDS) as [IvBand, readonly [number, number] | undefined][]).find(([, v]) => v !== undefined && v[0] === (preset.ivRankMin ?? 0) && v[1] === (preset.ivRankMax ?? 100));
    setIvBand(preset.ivRankMin === undefined && preset.ivRankMax === undefined ? "" : (band?.[0] ?? ""));
    setTargetPct(preset.targetPct);
    setStopPct(preset.stopPct);
    setTimeStopDte(preset.timeStopDte);
    setBacktestPreset(null);
  }, [preset, setBacktestPreset]);
  /** A sweep cell's parameters become the Rules row's. */
  const loadCell = (values: { [K in SweepAxis]?: number | undefined }) => {
    if (values.smaDays !== undefined) setSmaDays(values.smaDays);
    if (values.minDte !== undefined) setMinDte(values.minDte);
    if (values.targetPct !== undefined) setTargetPct(values.targetPct);
    if (values.stopPct !== undefined) setStopPct(values.stopPct);
    if (values.timeStopDte !== undefined) setTimeStopDte(values.timeStopDte);
  };
  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
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
            <option value="upper">Upper half (50 to 100)</option>
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
        <label className="flex flex-col gap-0.5">
          <span className="micro" title="Cut the range's entries into consecutive periods of equal count, each with its own record: the later period is the test the earlier one did not see">Split</span>
          <select value={folds ?? ""} onChange={(e) => setFolds(optNum(e.target.value))} className={selectCls} data-testid="backtest-folds-select">
            <option value="">Off</option>
            <option value={2}>In-sample / out-of-sample</option>
            <option value={3}>Three periods</option>
          </select>
        </label>
        <Button size="sm" variant={sweepOn ? "secondary" : "ghost"} aria-pressed={sweepOn} onClick={() => setSweepOn((v) => !v)} data-testid="backtest-sweep-toggle" title="Run one rule parameter (or two) over a small grid and see every cell's result">
          Sweep
        </Button>
      </div>
      {sweepOn ? (
        <div className="flex flex-col gap-2 rounded border border-border p-2 text-xs" data-testid="backtest-sweep">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-0.5">
              <span className="micro">Sweep</span>
              <select
                value={axis1}
                onChange={(e) => {
                  if (!isAxis(e.target.value)) return;
                  setAxis1(e.target.value);
                  if (e.target.value === axis2) setAxis2(undefined); // the second axis cannot repeat the first
                }}
                className={selectCls}
                data-testid="backtest-sweep-axis1"
              >
                {AXES.map((a) => (
                  <option key={a} value={a}>
                    {AXIS_LABEL[a]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="micro">against</span>
              <select value={axis2 ?? ""} onChange={(e) => setAxis2(isAxis(e.target.value) ? e.target.value : undefined)} className={selectCls} data-testid="backtest-sweep-axis2">
                <option value="">nothing</option>
                {AXES.filter((a) => a !== axis1).map((a) => (
                  <option key={a} value={a}>
                    {AXIS_LABEL[a]}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-2xs text-muted-foreground">Values: {sweepValues(axis1).join(", ") || "none below the minimum days to expiry"}{sweepAxis2 ? ` × ${sweepValues(sweepAxis2).join(", ") || "none"}` : ""}. Click a cell to load its parameters.</span>
          </div>
          {sweepNotYet ? (
            <p className="text-muted-foreground" data-testid="backtest-sweep-empty">No end-of-day chains recorded yet, so there is nothing to sweep.</p>
          ) : sweep.isError ? (
            <p className="text-loss" data-testid="backtest-sweep-error">
              {sweep.error instanceof Error ? sweep.error.message : String(sweep.error)}
            </p>
          ) : sweepValues(axis1).length === 0 || (sweepAxis2 !== undefined && sweepValues(sweepAxis2).length === 0) ? (
            <p className="text-muted-foreground" data-testid="backtest-sweep-empty">No time stop sits below the minimum days to expiry; raise it or sweep another parameter.</p>
          ) : !s ? (
            <p className="text-muted-foreground">Running {sweepValues(axis1).length * (sweepAxis2 ? sweepValues(sweepAxis2).length : 1)} trials…</p>
          ) : (
            <>
              <div className={cn("overflow-x-auto", sweep.isPlaceholderData ? "opacity-60" : "")} title={sweep.isPlaceholderData ? "Running the new grid; this is the previous one" : undefined}>
                <table className="text-2xs" data-testid="backtest-sweep-grid" data-stale={sweep.isPlaceholderData}>
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="py-0.5 pr-2 text-left font-normal">{AXIS_LABEL[s.axes[0]!.axis]}</th>
                      {s.axes[1] ? s.axes[1].values.map((v) => <th key={v} className="num px-1 py-0.5 text-right font-normal">{AXIS_LABEL[s.axes[1]!.axis].split(" (")[0]} {v}</th>) : <th className="num px-1 py-0.5 text-right font-normal">Net</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {s.axes[0]!.values.map((v1, i1) => {
                      const n2 = s.axes[1]?.values.length ?? 1;
                      return (
                        <tr key={v1} className="border-t border-border">
                          <th className="num py-0.5 pr-2 text-left font-normal">{v1}</th>
                          {Array.from({ length: n2 }, (_, i2) => {
                            const idx = i1 * n2 + i2;
                            const t = s.trials[idx]!;
                            return (
                              <td key={idx} className="px-0.5 py-0.5">
                                <button
                                  type="button"
                                  onClick={() => loadCell(t.values)}
                                  className={cn("num w-full rounded px-1 py-0.5 text-right hover:bg-muted", tone(Number(t.total)), idx === s.best ? "ring-1 ring-foreground" : "")}
                                  title={`${t.trades} ${t.trades === 1 ? "trade" : "trades"} · win rate ${pct(t.winRate)} · max drawdown ${m(t.maxDrawdown, false)} · neighbours keeping at least half: ${pct(t.plateau)}`}
                                  data-testid="backtest-sweep-cell"
                                  data-best={idx === s.best}
                                >
                                  {t.trades === 0 ? "—" : m(t.total)}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-2xs text-muted-foreground" data-testid="backtest-sweep-summary">
                {s.trials.length} {s.trials.length === 1 ? "trial" : "trials"} of a cap of {s.cap}.{" "}
                {s.best === null
                  ? "No trial closed a trade."
                  : `Best: ${Object.entries(s.trials[s.best]!.values)
                      .map(([k, v]) => `${AXIS_LABEL[k as SweepAxis].split(" (")[0]} ${v}`)
                      .join(", ")} at ${m(s.trials[s.best]!.total)} over ${s.trials[s.best]!.trades} ${s.trials[s.best]!.trades === 1 ? "trade" : "trades"}; ${
                      s.trials[s.best]!.plateau === null ? "no neighbour to compare" : `${pct(s.trials[s.best]!.plateau)} of its neighbours keep at least half of that`
                    }.`}{" "}
                Many trials on one year of data produce winners by luck: a lone peak is noise, a broad plateau is evidence.
              </p>
            </>
          )}
        </div>
      ) : null}
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
              {r.folds ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[480px] text-2xs" data-testid="backtest-folds">
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="py-1 text-left font-normal">Period</th>
                        <th className="py-1 text-left font-normal">Entries</th>
                        <th className="py-1 text-right font-normal">Closed</th>
                        <th className="py-1 text-right font-normal">Net</th>
                        <th className="py-1 text-right font-normal">Win rate</th>
                        <th className="py-1 text-right font-normal">Max drawdown</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.folds.map((f, i) => (
                        <tr key={f.index} className="border-t border-border" data-testid="backtest-fold">
                          <td className="py-0.5 pr-2">
                            {r.folds!.length === 2 ? (i === 0 ? "In-sample" : "Out-of-sample") : `Period ${i + 1}`}
                            {f.firstDay && f.lastDay ? <span className="ml-1 text-muted-foreground">{fmtDate(f.firstDay)} to {fmtDate(f.lastDay)}</span> : null}
                          </td>
                          <td className="py-0.5 pr-2">{f.entries}</td>
                          <td className="num py-0.5 pr-2 text-right">{f.stats.trades}</td>
                          <td className={cn("num py-0.5 pr-2 text-right", tone(Number(f.stats.total)))}>{m(f.stats.total)}</td>
                          <td className="num py-0.5 pr-2 text-right">{pct(f.stats.winRate)}</td>
                          <td className="num py-0.5 text-right">{m(f.stats.maxDrawdown, false)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {r.folds.length === 2 && r.folds[0]!.stats.trades > 0 && r.folds[1]!.stats.trades > 0 ? (
                    <p className="text-2xs text-muted-foreground" data-testid="backtest-folds-verdict">
                      {Number(r.folds[0]!.stats.total) > 0 && Number(r.folds[1]!.stats.total) > 0
                        ? "Both halves made money: the record held up in the period the first half did not see."
                        : Number(r.folds[0]!.stats.total) > 0
                          ? "The first half made money and the second did not: the record did not hold up out of sample."
                          : Number(r.folds[1]!.stats.total) > 0
                            ? "The first half lost and the second made money: the record is not consistent, so it proves nothing yet."
                            : "Both halves lost money."}{" "}
                      Both halves are small samples; the entry counts say how small.
                    </p>
                  ) : null}
                </div>
              ) : null}
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
