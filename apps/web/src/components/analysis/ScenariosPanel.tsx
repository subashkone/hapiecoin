"use client";
// Scenarios tab (HC-WS-088..093): the position's P&L, delta or theta across a price × date matrix, computed by the
// pricing worker; ±10 % / ±20 % rows, six date columns to the nearest expiry, an IV shift, cell shading by
// magnitude, the target cell outlined (click sets the target sliders), and a smooth bilinear heat field.
import { expiryMs } from "@hapiecoin/pricing";
import type { ScenarioOptions } from "@hapiecoin/pricing";
import { Button, EmptyState, cn } from "@hapiecoin/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { type ScenarioRange, SCENARIO_RANGES, gridMax, heatAlpha, nearestIndex, scenarioAxes } from "@/lib/chain/structure";
import { fmtDate, fmtDelta, fmtStrike } from "@/lib/format";
import { fmtMoney } from "@/lib/money";
import { useScenario } from "@/lib/pricing/client";
import { settlementHourUtc } from "@/lib/pricing/legs";
import { useUiStore } from "@/lib/store";
import { useStrategyAnalysis } from "@/lib/strategy/useStrategyAnalysis";
import { venueCalendar } from "@/lib/venue";
import { type HeatFrame, drawHeat, hslTokenToRgb } from "./heatDraw";

type Mode = NonNullable<ScenarioOptions["mode"]>;
const MODES: { id: Mode; label: string; title: string }[] = [
  { id: "pnl", label: "P&L", title: "Position P&L at that price and date" },
  { id: "delta", label: "Δ", title: "Position delta at that price and date" },
  { id: "theta", label: "Θ", title: "Position theta per day at that price and date" },
];

/** Canvas host for the smooth field: sizes to its box and redraws per frame change. */
function HeatCanvas({ frame }: { frame: Omit<HeatFrame, "width" | "height" | "colors"> }) {
  const box = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || size.w < 2 || size.h < 2) return;
    const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.w * dpr);
    canvas.height = Math.floor(size.h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const style = typeof document === "undefined" ? null : getComputedStyle(document.documentElement);
    const tok = (name: string, fallback: string) => hslTokenToRgb(style?.getPropertyValue(name).trim() || fallback);
    // painted at device resolution so the ridge and the hairline stay crisp on HiDPI screens
    drawHeat(ctx, { ...frame, width: canvas.width, height: canvas.height, colors: { profit: tok("--profit", "150 60% 45%"), loss: tok("--loss", "0 70% 55%"), background: tok("--background", "0 0% 8%"), foreground: tok("--foreground", "0 0% 90%"), spot: tok("--spot", "38 90% 55%") } });
  }, [frame, size]);
  return (
    <div ref={box} className="relative h-full min-h-[220px] w-full" data-testid="scenario-heat" data-rows={frame.cells.length}>
      <canvas ref={ref} style={{ width: size.w, height: size.h, display: "block" }} role="img" aria-label="Heat field of the scenario matrix" />
    </div>
  );
}

export function ScenariosPanel() {
  const a = useStrategyAnalysis();
  const setTarget = useUiStore((s) => s.setTarget);
  const setWorkspaceTab = useUiStore((s) => s.setWorkspaceTab);
  const [mode, setMode] = useState<Mode>("pnl");
  const [range, setRange] = useState<ScenarioRange>(10);
  const [ivPct, setIvPct] = useState(0);
  const [smooth, setSmooth] = useState(false);
  const [hover, setHover] = useState<{ i: number; j: number } | null>(null);
  const { legs, result, spot, money, asset, venue } = a;
  const nearestExpiry = useMemo(() => legs.filter((l) => l.kind !== "future").map((l) => l.expiry).sort()[0] ?? null, [legs]);
  const expiryAtMs = nearestExpiry ? expiryMs(nearestExpiry, settlementHourUtc(asset, venue)) : undefined;
  // the expiry column is valued at the settlement instant; the day count follows it, the way the payoff slider counts
  const maxDte = expiryAtMs !== undefined ? Math.max(1, Math.ceil((expiryAtMs - a.nowMs) / 86_400_000)) : result && Number.isFinite(result.daysToNearestExpiry) ? Math.max(1, Math.ceil(result.daysToNearestExpiry)) : 30;
  const axes = useMemo(() => (spot === null ? null : scenarioAxes(spot, range, maxDte, a.nowMs, expiryAtMs)), [spot, range, maxDte, a.nowMs, expiryAtMs]);
  // the slider shifts every leg's IV by a share of the ATM IV (the engine takes an additive vol-point shift)
  const ivShift = (result?.atmIv && Number.isFinite(result.atmIv) ? result.atmIv : 0.5) * (ivPct / 100);
  const options = useMemo<ScenarioOptions | null>(() => (axes ? { prices: axes.prices, dates: axes.dates, ivShift, mode, defaultIv: 0.5, calendar: venueCalendar(asset, venue) } : null), [axes, ivShift, mode, asset, venue]);
  const { grid, error, pending } = useScenario(a.pricingLegs, options);
  // values[dateIndex][priceIndex] → cells[row = price][col = date]
  const cells = useMemo(() => (grid && axes ? axes.prices.map((_, i) => axes.dates.map((__, j) => grid.values[j]?.[i] ?? Number.NaN)) : []), [grid, axes]);
  const vmax = useMemo(() => gridMax(cells), [cells]);
  const ti = axes ? nearestIndex(axes.prices, a.targetPrice) : -1;
  const tj = axes ? nearestIndex(axes.days, a.targetDays) : -1;
  const spotRow = axes ? axes.pcts.findIndex((p) => Math.abs(p) < 1e-9) : -1;
  const unit = mode === "pnl" ? money.currency : mode === "delta" ? `${asset} Δ` : `${money.currency} / day`;
  const fmtCell = (v: number) => (!Number.isFinite(v) ? "—" : mode === "delta" ? fmtDelta(v) : fmtMoney(v, money, { signed: true }));
  // labels come from the instants each column is valued at (the expiry column sits on the settlement date itself)
  const dateOf = (j: number) => fmtDate(new Date(axes?.dates[j] ?? a.nowMs).toISOString().slice(0, 10));
  const dayLabel = (d: number, j: number) => (d === 0 ? "Today" : d === maxDte ? "Expiry" : dateOf(j));
  const daySub = (d: number, j: number) => (d === 0 || d === maxDte ? dateOf(j) : `+${d}d`);
  const heatFrame = useMemo(() => ({ cells, vmax, target: ti >= 0 && tj >= 0 ? { i: ti, j: tj } : null, spotRow: spotRow >= 0 ? spotRow : null }), [cells, vmax, ti, tj, spotRow]);

  const controls = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-2xs" data-testid="scenario-controls">
      <span className="micro">Scenarios</span>
      <span className="inline-flex rounded border border-border" role="group" aria-label="Mode">
        {MODES.map((m) => (
          <button key={m.id} type="button" aria-pressed={mode === m.id} title={m.title} onClick={() => setMode(m.id)} className={cn("px-2 py-0.5", mode === m.id ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")} data-testid={`scenario-mode-${m.id}`}>
            {m.label}
          </button>
        ))}
      </span>
      <span className="inline-flex rounded border border-border" role="group" aria-label="Price range">
        {SCENARIO_RANGES.map((r) => (
          <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)} className={cn("px-2 py-0.5 font-mono", range === r ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")} data-testid={`scenario-range-${r}`}>
            ±{r}%
          </button>
        ))}
      </span>
      <label className="flex items-center gap-1" title="Shift every leg's implied volatility by this share of the ATM IV">
        <span className="micro">IV</span>
        <input type="range" min={-20} max={20} step={1} value={ivPct} onChange={(e) => setIvPct(Number(e.target.value))} className="w-24 accent-[hsl(var(--curve))]" aria-label="IV shift percent" data-testid="scenario-iv" />
        <span className="num w-10" data-testid="scenario-iv-value">{ivPct >= 0 ? "+" : ""}{ivPct}%</span>
      </label>
      <button type="button" aria-pressed={smooth} onClick={() => setSmooth((v) => !v)} className={cn("rounded border px-1.5 py-0.5", smooth ? "border-foreground/40 text-foreground" : "border-border text-muted-foreground")} title="Bilinear heat field between the cells, with the break-even ridge" data-testid="scenario-smooth">
        Smooth
      </button>
      <span className="ml-auto text-muted-foreground" data-testid="scenario-unit">{unit}</span>
    </div>
  );

  if (legs.length === 0) {
    return (
      <div className="flex h-full flex-col" data-testid="scenarios-panel" data-state="empty">
        {controls}
        <EmptyState title="No strategy yet" description="The price × date matrix appears once legs are added." className="py-16" action={<Button size="sm" variant="outline" onClick={() => setWorkspaceTab("builder")}>Open Builder</Button>} />
      </div>
    );
  }
  const state = cells.length ? "ready" : error ? "error" : "pending";
  const hovered = hover && cells[hover.i]?.[hover.j] !== undefined ? { price: axes!.prices[hover.i]!, pct: axes!.pcts[hover.i]!, day: axes!.days[hover.j]!, j: hover.j, v: cells[hover.i]![hover.j]! } : null;
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="scenarios-panel" data-state={state} data-mode={mode} data-pending={pending ? "true" : undefined}>
      {controls}
      {/* one fixed-height line: the hover readout must never wrap this row and shift the matrix under the pointer mid-click */}
      <div className="flex min-h-5 items-center gap-x-3 overflow-hidden px-3 text-2xs">
        <span className="inline-flex shrink-0 items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "hsl(var(--profit) / 0.5)" }} />profit</span>
        <span className="inline-flex shrink-0 items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "hsl(var(--loss) / 0.5)" }} />loss</span>
        <span className="min-w-0 truncate text-muted-foreground">shade = magnitude · outlined = target from the sliders · click a cell to set the target</span>
        <span className="num ml-auto shrink-0 whitespace-nowrap" data-testid="scenario-readout">{hovered ? `${fmtStrike(String(Math.round(hovered.price)))} (${hovered.pct >= 0 ? "+" : ""}${hovered.pct}%) · ${dayLabel(hovered.day, hovered.j)} · ${fmtCell(hovered.v)}` : error ? <span className="text-loss">{error}</span> : ""}</span>
      </div>
      {axes ? (
        <div className="min-h-0 flex-1 overflow-auto px-3 pb-3 pt-2" onMouseLeave={() => setHover(null)}>
          <div className="grid gap-px text-2xs" style={{ gridTemplateColumns: `76px repeat(${axes.days.length}, minmax(52px, 1fr))` }} data-testid="scenario-matrix" data-cols={axes.days.length} data-rows={axes.prices.length} data-ti={ti} data-tj={tj} data-target-price={Math.round(a.targetPrice)} data-target-days={a.targetDays}>
            <div className="micro flex items-end justify-end pb-1 pr-2">Price</div>
            {axes.days.map((d, j) => (
              <div key={j} className={cn("flex flex-col items-center pb-1 text-center", j === tj && "font-medium text-foreground")} data-testid="scenario-col" data-target={j === tj ? "true" : undefined}>
                <span>{dayLabel(d, j)}</span>
                <small className="micro">{daySub(d, j)}</small>
              </div>
            ))}
            {smooth ? (
              <>
                <div className="flex flex-col justify-between" style={{ gridRow: `2 / span ${axes.prices.length}` }}>
                  {axes.prices.map((p, i) => (
                    <div key={i} className={cn("num flex h-5 items-center justify-end pr-2", i === ti && "font-medium text-foreground", i === spotRow && "text-spot")} data-testid="scenario-row-label">
                      {i === spotRow ? <em className="micro mr-1 not-italic">SPOT</em> : null}
                      {fmtStrike(String(Math.round(p)))}
                    </div>
                  ))}
                </div>
                <div style={{ gridRow: `2 / span ${axes.prices.length}`, gridColumn: `2 / span ${axes.days.length}` }}>
                  <HeatCanvas frame={heatFrame} />
                </div>
              </>
            ) : (
              // rows and cells are keyed by position, not by price, so a spot tick updates them in place (a click must never land on a replaced node)
              axes.prices.map((p, i) => (
                <div key={i} className="contents">
                  <div className={cn("num flex items-center justify-end pr-2", i === ti && "font-medium text-foreground", i === spotRow && "text-spot")} data-testid="scenario-row-label">
                    {i === spotRow ? <em className="micro mr-1 not-italic">SPOT</em> : null}
                    {fmtStrike(String(Math.round(p)))}
                  </div>
                  {axes.days.map((d, j) => {
                    const v = cells[i]?.[j] ?? Number.NaN;
                    const alpha = heatAlpha(v, vmax);
                    return (
                      <button
                        key={j}
                        type="button"
                        onMouseEnter={() => setHover({ i, j })}
                        onFocus={() => setHover({ i, j })}
                        onClick={() => setTarget({ price: axes.prices[i]!, days: d })}
                        title={`${fmtStrike(String(Math.round(p)))} · ${dayLabel(d, j)} · ${fmtCell(v)} · click to set the target`}
                        className={cn("num h-6 rounded-[2px] text-right pr-1 outline-none focus-visible:ring-1 focus-visible:ring-ring", i === ti && j === tj && "shadow-[inset_0_0_0_1.5px_hsl(var(--foreground))]", hover?.i === i && hover.j === j && "shadow-[inset_0_0_0_1px_hsl(var(--muted-foreground))]")}
                        style={{ background: Number.isFinite(v) ? `hsl(var(${v >= 0 ? "--profit" : "--loss"}) / ${alpha.toFixed(2)})` : undefined }}
                        data-testid="scenario-cell"
                        data-i={i}
                        data-j={j}
                        data-target={i === ti && j === tj ? "true" : undefined}
                        data-tone={Number.isFinite(v) ? (v >= 0 ? "profit" : "loss") : "none"}
                      >
                        {fmtCell(v)}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="grid flex-1 place-items-center text-xs text-muted-foreground" data-testid="scenario-waiting">Waiting for the spot price…</div>
      )}
    </div>
  );
}
