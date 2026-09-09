"use client";
// /payoff-preview (HC-PB-042..051, 063, 064; ADR-037): the workspace's payoff chart on a public page with four
// fixed presets, legend and layer toggles, zoom, SD header, target price and target date sliders and a summary.
import { Button, cn } from "@hapiecoin/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { PayoffChart, type PayoffChartFrame } from "@/components/analysis/PayoffChart";
import { fmtDate } from "@/lib/format";
import { fmtMoneyCompact } from "@/lib/money";
import { DEFAULT_DAY, PRESETS, PREVIEW_DAYS, TARGET_NUDGE, TARGET_STEP, clamp, computePreview, dayLabel, fmtK, fmtSigned, pctFrom, syntheticOi, zoomIn, zoomOut, zoomRange } from "@/lib/payoff-preview";
import { pnlAt } from "@/lib/strategy/analysis";

type Layers = PayoffChartFrame["layers"];
const LAYERS: { key: keyof Layers; label: string }[] = [
  { key: "expiry", label: "Expiry P&L" },
  { key: "target", label: "Target Date P&L" },
  { key: "fill", label: "Profit / Loss Fill" },
  { key: "oi", label: "Open Interest" },
  { key: "band", label: "SD Bands" },
  { key: "breakeven", label: "Breakevens" },
];
const LEGEND: { key: keyof Layers; label: string; swatch: string }[] = [
  { key: "expiry", label: "On Expiry", swatch: "border-t-2 border-foreground" },
  { key: "target", label: "On Target Date", swatch: "border-t-2 border-[hsl(var(--curve))]" },
  { key: "fill", label: "Profit", swatch: "h-2.5 w-2.5 rounded-sm bg-profit/40" },
  { key: "fill", label: "Loss", swatch: "h-2.5 w-2.5 rounded-sm bg-loss/40" },
  { key: "oi", label: "Call OI", swatch: "h-2.5 w-2.5 rounded-sm bg-muted-foreground/50" },
  { key: "oi", label: "Put OI", swatch: "h-2.5 w-2.5 rounded-sm bg-muted-foreground/25" },
];

export function PayoffPreview() {
  const [nowMs] = useState(() => Date.now());
  const [presetIdx, setPresetIdx] = useState(0);
  const preset = PRESETS[presetIdx] ?? PRESETS[0]!;
  const [zoom, setZoom] = useState(1);
  const [day, setDay] = useState(DEFAULT_DAY);
  const [target, setTarget] = useState(preset.spot);
  const [layers, setLayers] = useState<Layers>({ expiry: true, target: true, fill: true, oi: true, band: true, breakeven: true });
  const [layersOpen, setLayersOpen] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const c = useMemo(() => computePreview(preset, { nowMs, day, target, zoom }), [preset, nowMs, day, target, zoom]);
  const oi = useMemo(() => syntheticOi(preset), [preset]);
  const useTarget = layers.target && day < PREVIEW_DAYS;
  const frame = useMemo<PayoffChartFrame>(
    () => ({
      points: c.result.points,
      spot: preset.spot,
      breakevens: c.result.breakevens,
      band: [c.sd.m1, c.sd.p1],
      target: target !== preset.spot ? { price: target, pnl: useTarget ? c.result.target.pnlTarget : c.result.target.pnlExpiry } : null,
      targetLabel: day > 0 ? `${day}d` : "today",
      layers: { ...layers, target: useTarget },
      oi,
      range: c.range,
      fmtPrice: fmtK,
      fmtMoney: (v) => fmtMoneyCompact(v),
    }),
    [c, preset.spot, target, useTarget, day, layers, oi],
  );

  useEffect(() => {
    if (!layersOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node)) setLayersOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [layersOpen]);

  const pickPreset = (i: number) => {
    const p = PRESETS[i];
    if (!p) return;
    setPresetIdx(i);
    setTarget(p.spot);
    setZoom(1);
    setDay(DEFAULT_DAY);
  };
  const applyZoom = (z: number) => {
    setZoom(z);
    const [lo, hi] = zoomRange(preset.spot, z);
    setTarget((t) => clamp(t, lo, hi));
  };
  const toggle = (k: keyof Layers) => setLayers((s) => ({ ...s, [k]: !s[k] }));
  const nudge = (d: number) => setTarget((t) => clamp(t + d, c.range[0], c.range[1]));
  const atTarget = { exp: c.result.target.pnlExpiry, tgt: c.result.target.pnlTarget };
  const profit = atTarget.exp >= 0;
  const dl = day > 0 ? `${day}D` : "Today";
  const hoverPnl = hover !== null ? { exp: pnlAt(c.result.points, hover, "pnlExpiry"), tgt: pnlAt(c.result.points, hover, "pnlTarget") } : null;
  const tone = (v: number) => (v >= 0 ? "text-profit" : "text-loss");

  return (
    <div data-testid="payoff-preview" data-preset={presetIdx} data-zoom={Math.round(zoom * 100)} data-day={day}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-[15px] font-semibold">Payoff chart preview</span>
        <div className="flex flex-wrap gap-1" data-testid="pp-presets">
          {PRESETS.map((p, i) => (
            <Button key={p.name} size="sm" variant={i === presetIdx ? "secondary" : "outline"} aria-pressed={i === presetIdx} onClick={() => pickPreset(i)} data-testid="pp-preset">
              {p.name}
            </Button>
          ))}
        </div>
        <span className="micro ml-auto">Spot · amber &nbsp;·&nbsp; Target date · blue &nbsp;·&nbsp; OI · faint bars</span>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="rounded-md border border-border bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-2xs" data-testid="pp-legend">
              {LEGEND.map((l) => (
                <button key={l.label} type="button" onClick={() => toggle(l.key)} title={`Toggle ${l.label}`} className={cn("inline-flex items-center gap-1.5", !layers[l.key] && "line-through opacity-50")} data-testid="pp-legend-item" data-on={layers[l.key]}>
                  <i className={cn("inline-block w-3", l.swatch)} aria-hidden="true" />
                  {l.label}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => applyZoom(zoomIn(zoom))} title="Zoom In" aria-label="Zoom In" data-testid="pp-zoom-in">+</Button>
              <button type="button" onClick={() => applyZoom(1)} title="Reset Zoom" className="font-mono text-2xs text-muted-foreground hover:text-foreground" data-testid="pp-zoom-label">{Math.round(zoom * 100)}%</button>
              <Button size="sm" variant="ghost" onClick={() => applyZoom(zoomOut(zoom))} title="Zoom Out" aria-label="Zoom Out" data-testid="pp-zoom-out">−</Button>
              <div className="relative" ref={popRef}>
                <Button size="sm" variant="outline" onClick={() => setLayersOpen((o) => !o)} aria-expanded={layersOpen} data-testid="pp-layers-button">Layers</Button>
                {layersOpen ? (
                  <div className="absolute right-0 top-full z-20 mt-1 w-[220px] rounded-md border border-border bg-popover p-2 text-xs shadow-md" role="dialog" aria-label="Chart Layers" data-testid="pp-layers">
                    <h4 className="micro mb-1 px-1">Chart Layers</h4>
                    {LAYERS.map((l) => (
                      <label key={l.key} className="flex cursor-pointer items-center justify-between rounded px-1 py-1 hover:bg-muted">
                        <span>{l.label}</span>
                        <button type="button" role="switch" aria-checked={layers[l.key]} onClick={() => toggle(l.key)} className={cn("relative h-4 w-7 rounded-full transition-colors", layers[l.key] ? "bg-accent" : "bg-muted-foreground/40")} data-testid={`pp-layer-${l.key}`}>
                          <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-background transition-transform", layers[l.key] ? "left-3.5" : "left-0.5")} />
                        </button>
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-5 border-b border-border text-center font-mono text-3xs text-muted-foreground" data-testid="pp-sd">
            {([["-2SD", c.sd.m2], ["-1SD", c.sd.m1], ["Current", preset.spot], ["+1SD", c.sd.p1], ["+2SD", c.sd.p2]] as const).map(([k, v]) => (
              <div key={k} className={cn("px-2 py-1.5", k === "Current" && "bg-muted/40")}>
                <span className="block">{k}</span>
                <b className={cn("block text-xs font-medium", k === "Current" ? "text-spot" : "text-foreground")}>{fmtK(v)}</b>
                {k === "Current" ? <span className="block">Expected move by {c.sd.byExpiry ? "expiry" : "target date"} ({c.sd.days}d)</span> : null}
              </div>
            ))}
          </div>

          <div className="relative h-[360px]">
            <span className="micro absolute left-2 top-2 z-10">Profit / Loss</span>
            <span className="micro absolute right-2 top-2 z-10">Open Interest</span>
            <PayoffChart frame={frame} onHover={setHover} className="absolute inset-0 px-1" />
          </div>
          <div className="micro pb-1 text-center">Underlying Price</div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-3 py-2 font-mono text-2xs" data-testid="pp-summary">
            <span>
              @ <span className="text-foreground">{fmtK(target)}</span> <span className={tone(target - preset.spot)}>({pctFrom(preset.spot, target)})</span>
            </span>
            <span>
              {dl}: <b className={tone(atTarget.tgt)} data-testid="pp-summary-target">{fmtSigned(atTarget.tgt)}</b>
            </span>
            <span>
              Expiry: <b className={tone(atTarget.exp)} data-testid="pp-summary-expiry">{fmtSigned(atTarget.exp)}</b>
            </span>
            <span className={cn("rounded px-1.5 py-0.5 font-medium", profit ? "bg-profit/15 text-profit" : "bg-loss/15 text-loss")} data-testid="pp-pill">
              {profit ? "Profit" : "Loss"}: ${fmtSigned(Math.abs(atTarget.exp)).slice(2)}
            </span>
            {hoverPnl ? (
              <span className="ml-auto text-muted-foreground" data-testid="pp-hover">
                {fmtK(hover ?? 0)} · Expiry <span className={tone(hoverPnl.exp)}>{fmtSigned(hoverPnl.exp)}</span> · {dl} <span className={tone(hoverPnl.tgt)}>{fmtSigned(hoverPnl.tgt)}</span>
              </span>
            ) : null}
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-md border border-border bg-card p-3" data-testid="pp-target-card">
            <div className="flex items-center justify-between">
              <span className="micro">BTC Target</span>
              <span className={cn("rounded border px-1.5 font-mono text-2xs", target >= preset.spot ? "border-profit/40 text-profit" : "border-loss/40 text-loss")} data-testid="pp-target-pct">{pctFrom(preset.spot, target)}</span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => nudge(-TARGET_NUDGE)} aria-label="Target down $500" data-testid="pp-target-minus">−</Button>
              <input type="range" min={c.range[0]} max={c.range[1]} step={TARGET_STEP} value={target} onChange={(e) => setTarget(Number(e.target.value))} className="flex-1 accent-[hsl(var(--curve))]" aria-label="BTC target price" data-testid="pp-target" />
              <Button size="sm" variant="outline" onClick={() => nudge(TARGET_NUDGE)} aria-label="Target up $500" data-testid="pp-target-plus">+</Button>
            </div>
            <div className="mt-1 flex justify-between font-mono text-3xs text-muted-foreground">
              <span>{fmtK(c.range[0])}</span>
              <span className="text-foreground" data-testid="pp-target-value">${target.toLocaleString("en-US")}</span>
              <span>{fmtK(c.range[1])}</span>
            </div>
          </div>
          <div className="rounded-md border border-border bg-card p-3" data-testid="pp-day-card">
            <div className="flex items-center justify-between">
              <span className="micro">Today</span>
              <span className="micro" title="Move the target date between today and expiry; the blue curve shows P&L on that date">{fmtDate(c.expiry)} expiry</span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setDay((d) => clamp(d - 1, 0, PREVIEW_DAYS))} aria-label="One day earlier" data-testid="pp-day-prev">‹</Button>
              <input type="range" min={0} max={PREVIEW_DAYS} step={1} value={day} onChange={(e) => setDay(Number(e.target.value))} className="flex-1 accent-[hsl(var(--curve))]" aria-label="Target date" data-testid="pp-day" />
              <Button size="sm" variant="outline" onClick={() => setDay((d) => clamp(d + 1, 0, PREVIEW_DAYS))} aria-label="One day later" data-testid="pp-day-next">›</Button>
            </div>
            <div className="mt-1 flex justify-between gap-2 font-mono text-3xs text-muted-foreground">
              <span>Today</span>
              <span className="text-foreground" data-testid="pp-day-label">{dayLabel(nowMs, day)}</span>
              <span>Expiry ({fmtDate(c.expiry)})</span>
            </div>
          </div>
          <p className="micro leading-relaxed">
            Sample legs priced by HapieCoin&apos;s engine at a fixed spot; one contract = 1 BTC. Sign in to build the same charts on live Delta Exchange strikes.
          </p>
        </div>
      </div>
    </div>
  );
}
