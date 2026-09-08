"use client";
// Payoff tab (HC-WS-033..058): summary tiles, the canvas chart with layers and zoom, target price and
// date sliders, the "win if" strip and the net Greeks strip. Every figure comes from @hapiecoin/pricing.
import { Button, EmptyState, cn } from "@hapiecoin/ui";
import { useMemo, useState } from "react";
import { fmtDelta, fmtGamma, fmtPrice, fmtStrike, fmtVega } from "@/lib/format";
import { useChain } from "@/lib/gateway/hooks";
import { fmtMoney, fmtMoneyCompact } from "@/lib/money";
import { useUiStore } from "@/lib/store";
import { cleanStep, pnlAt, popGrade, rrGrade, rrText, whereExtreme, winZone } from "@/lib/strategy/analysis";
import { type StrategyAnalysis, useStrategyAnalysis } from "@/lib/strategy/useStrategyAnalysis";
import { PayoffChart, type PayoffChartFrame } from "./PayoffChart";

type Layers = PayoffChartFrame["layers"];
const LAYER_LABELS: { key: keyof Layers; label: string; title: string }[] = [
  { key: "expiry", label: "Expiry", title: "P&L if held to the nearest expiry" },
  { key: "target", label: "Target", title: "P&L on the target date (Black-76 at today's IV)" },
  { key: "fill", label: "Fill", title: "Shade profit and loss zones" },
  { key: "breakeven", label: "BE", title: "Break-even lines" },
  { key: "band", label: "±1σ", title: "Expected one-standard-deviation move to expiry" },
  { key: "oi", label: "OI", title: "Open interest per strike (calls + puts)" },
];
const ZOOMS = [1, 2, 4] as const;

export function Tile({ label, value, sub, tone, testId, title }: { label: string; value: string; sub?: string | undefined; tone?: "profit" | "loss" | "warning" | "muted" | undefined; testId?: string | undefined; title?: string | undefined }) {
  return (
    <div className="min-w-0 rounded border border-border px-2.5 py-2" data-testid={testId} title={title}>
      <div className="micro truncate">{label}</div>
      <div className={cn("num truncate text-[15px] font-medium", tone === "profit" && "text-profit", tone === "loss" && "text-loss", tone === "warning" && "text-warning", tone === "muted" && "text-muted-foreground")}>{value}</div>
      {sub ? <div className="micro truncate">{sub}</div> : null}
    </div>
  );
}

export function GreeksStrip({ a }: { a: StrategyAnalysis }) {
  const g = a.result?.greeks;
  const items: [string, string, string][] = [
    ["Δ", g ? fmtDelta(g.delta) : "—", "Position delta · units of the underlying"],
    ["Γ", g ? fmtGamma(g.gamma) : "—", "Delta change per 1 USD move"],
    ["Θ", g ? fmtMoney(g.theta, a.money, { signed: true }) : "—", "Time decay per calendar day"],
    ["ν", g ? fmtVega(g.vega) : "—", "P&L per 1 vol point"],
  ];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-1.5 font-mono text-2xs" data-testid="greeks-strip">
      {items.map(([k, v, t]) => (
        <span key={k} title={t}>
          <span className="text-muted-foreground">{k} </span>
          <span className={cn(v.startsWith("−") || v.startsWith("-") ? "text-loss" : "text-foreground")}>{v}</span>
        </span>
      ))}
      <span className="ml-auto text-muted-foreground">{a.result ? "greeks at spot · Black-76" : ""}</span>
    </div>
  );
}

export function PayoffPanel() {
  const a = useStrategyAnalysis();
  const setTarget = useUiStore((s) => s.setTarget);
  const setWorkspaceTab = useUiStore((s) => s.setWorkspaceTab);
  const [layers, setLayers] = useState<Layers>({ expiry: true, target: true, fill: true, oi: false, band: true, breakeven: true });
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(1);
  const [hover, setHover] = useState<number | null>(null);
  const { result, spot, money, legs } = a;
  const nearestExpiry = useMemo(() => legs.filter((l) => l.kind !== "future").map((l) => l.expiry).sort()[0] ?? null, [legs]);
  const chain = useChain(a.asset, nearestExpiry);
  const oi = useMemo(() => {
    const rows = chain?.rows ?? [];
    const raw = rows.map((r) => ({ strike: Number(r.strike), value: Number(r.call?.oi ?? 0) + Number(r.put?.oi ?? 0) }));
    const max = Math.max(0, ...raw.map((r) => r.value));
    return max > 0 ? raw.map((r) => ({ strike: r.strike, value: r.value / max })) : [];
  }, [chain]);

  const range = useMemo<[number, number]>(() => {
    if (!result || spot === null) return [0, 1];
    const pts = result.points;
    const full: [number, number] = [pts[0]?.price ?? spot * 0.8, pts[pts.length - 1]?.price ?? spot * 1.2];
    if (zoom === 1) return full;
    const half = ((full[1] - full[0]) / 2) / zoom;
    return [Math.max(full[0], spot - half), Math.min(full[1], spot + half)];
  }, [result, spot, zoom]);

  const frame = useMemo<PayoffChartFrame | null>(() => {
    if (!result || spot === null) return null;
    const pts = result.points.filter((p) => p.price >= range[0] && p.price <= range[1]);
    const sigma = result.expectedMove;
    return {
      points: pts,
      spot,
      breakevens: result.breakevens,
      band: Number.isFinite(sigma) && sigma > 0 ? [spot - sigma, spot + sigma] : null,
      target: { price: a.targetPrice, pnl: result.target.pnlTarget },
      targetLabel: a.targetDays === 0 ? "today" : `+${a.targetDays}d`,
      layers,
      oi,
      range,
      fmtPrice: (p) => fmtStrike(String(Math.round(p))),
      fmtMoney: (v) => fmtMoneyCompact(v, money),
    };
  }, [result, spot, range, a.targetPrice, a.targetDays, layers, oi, money]);

  if (legs.length === 0) {
    return (
      <div className="flex h-full flex-col" data-testid="payoff-panel" data-state="empty">
        <EmptyState
          title="No strategy yet"
          description="Add legs from the chain (hover a row and press B or S), pick a template, or open the Builder."
          className="py-16"
          action={
            <Button size="sm" variant="outline" onClick={() => setWorkspaceTab("builder")} data-testid="payoff-open-builder">
              Open Builder
            </Button>
          }
        />
        <svg viewBox="0 0 400 120" className="mx-auto w-full max-w-[400px] opacity-30" aria-hidden>
          <line x1="0" x2="400" y1="70" y2="70" stroke="currentColor" strokeDasharray="3 3" />
          <polyline points="20,100 150,100 250,30 380,30" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      </div>
    );
  }

  const pop = result ? popGrade(result.pop) : null;
  const rr = result ? rrGrade(result.rewardRisk, result.maxProfit, result.maxLoss) : null;
  const maxPAt = result ? whereExtreme(result.points, result.maxProfit) : null;
  const maxLAt = result ? whereExtreme(result.points, result.maxLoss) : null;
  const where = (w: { price: number; side: "at" | "above" | "below" } | null) => (w ? `${w.side === "at" ? "at" : w.side} ${fmtStrike(String(Math.round(w.price)))}` : "");
  const dte = result && Number.isFinite(result.daysToNearestExpiry) ? Math.max(0, Math.ceil(result.daysToNearestExpiry)) : 0;
  const priceStep = spot ? cleanStep(spot * 0.001) : 1;
  const hoverPnl = hover !== null && result ? { exp: pnlAt(result.points, hover, "pnlExpiry"), tgt: pnlAt(result.points, hover, "pnlTarget") } : null;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="payoff-panel" data-state={result ? "ready" : a.error ? "error" : "pending"}>
      <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3" data-testid="payoff-tiles">
        <Tile label="Max profit" value={result ? fmtMoney(result.maxProfit, money, { unlimited: "Unlimited" }) : "—"} sub={where(maxPAt)} tone="profit" testId="tile-max-profit" title="Highest P&L at expiry over the price axis" />
        <Tile label="Max loss" value={result ? fmtMoney(result.maxLoss, money, { unlimited: "Unlimited" }) : "—"} sub={where(maxLAt)} tone="loss" testId="tile-max-loss" title="Lowest P&L at expiry over the price axis" />
        <Tile label="Break-even" value={result ? (result.breakevens.length ? result.breakevens.map((b) => fmtStrike(String(Math.round(b)))).join(" · ") : "none") : "—"} sub={result ? (result.breakevens.length === 1 ? "one point" : result.breakevens.length ? `${result.breakevens.length} points` : "") : ""} testId="tile-breakeven" title="Underlying prices where the expiry P&L is zero" />
        <Tile label="POP" value={result && Number.isFinite(result.pop) ? `${(result.pop * 100).toFixed(0)}%` : "—"} sub={pop?.text} tone={pop?.tone} testId="tile-pop" title="Probability of any profit at expiry: lognormal on the ATM IV" />
        <Tile label="R : R" value={result ? rrText(result.rewardRisk, result.maxProfit, result.maxLoss) : "—"} sub={rr?.text} tone={rr?.tone} testId="tile-rr" title="Max profit : max loss" />
        <Tile label="Net premium" value={result ? fmtMoney(result.netPremium, money, { signed: true }) : "—"} sub={result ? (result.netPremium >= 0 ? "credit received" : "debit paid") : ""} tone={result ? (result.netPremium >= 0 ? "profit" : "loss") : "muted"} testId="tile-net" title="Premium received minus premium paid, at the prices in the Builder" />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 text-2xs" data-testid="payoff-strip">
        <span>
          <span className="text-muted-foreground">Win if </span>
          <span className="num font-medium" data-testid="win-zone">{result ? winZone(result, (p) => fmtStrike(String(Math.round(p)))) : "—"}</span>
        </span>
        <span>
          <span className="text-muted-foreground">Expected move </span>
          <span className="num" data-testid="expected-move">{result && Number.isFinite(result.expectedMove) ? `±${fmtStrike(String(Math.round(result.expectedMove)))} (${((result.expectedMove / (spot || 1)) * 100).toFixed(1)}%)` : "—"}</span>
        </span>
        <span>
          <span className="text-muted-foreground">Nearest expiry </span>
          <span className="num">{result && Number.isFinite(result.daysToNearestExpiry) ? `${result.daysToNearestExpiry.toFixed(1)}d` : "—"}</span>
        </span>
        {hoverPnl ? (
          <span className="num ml-auto" data-testid="hover-readout">
            {fmtStrike(String(Math.round(hover ?? 0)))} · exp {fmtMoney(hoverPnl.exp, money, { signed: true })} · target {fmtMoney(hoverPnl.tgt, money, { signed: true })}
          </span>
        ) : a.error ? (
          <span className="ml-auto text-loss">{a.error}</span>
        ) : null}
      </div>
      <div className="flex items-center gap-1 px-3 pt-2">
        <span className="micro mr-1">Layers</span>
        {LAYER_LABELS.map((l) => (
          <button key={l.key} type="button" aria-pressed={layers[l.key]} title={l.title} onClick={() => setLayers((s) => ({ ...s, [l.key]: !s[l.key] }))} className={cn("rounded border px-1.5 py-0.5 text-2xs", layers[l.key] ? "border-foreground/40 text-foreground" : "border-border text-muted-foreground")} data-testid={`layer-${l.key}`}>
            {l.label}
          </button>
        ))}
        <span className="micro ml-auto mr-1">Zoom</span>
        {ZOOMS.map((z) => (
          <button key={z} type="button" aria-pressed={zoom === z} onClick={() => setZoom(z)} className={cn("rounded border px-1.5 py-0.5 font-mono text-2xs", zoom === z ? "border-foreground/40 text-foreground" : "border-border text-muted-foreground")} data-testid={`zoom-${z}`}>
            {z}×
          </button>
        ))}
      </div>
      <div className="relative min-h-[260px] flex-1">
        {frame ? (
          <PayoffChart frame={frame} onHover={setHover} className="absolute inset-0 px-1" />
        ) : (
          <div className="grid h-full place-items-center text-xs text-muted-foreground" data-testid="payoff-waiting">
            {spot === null ? "Waiting for the spot price…" : a.error ? "Pricing failed for these legs" : "Pricing…"}
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2 px-3 py-2 sm:grid-cols-2" data-testid="target-controls">
        <label className="flex items-center gap-2 text-2xs">
          <span className="micro w-[72px] shrink-0">Target price</span>
          <input type="range" min={spot ? Math.round(spot * 0.8) : 0} max={spot ? Math.round(spot * 1.2) : 1} step={priceStep} value={a.targetPrice} onChange={(e) => setTarget({ price: Number(e.target.value) })} className="flex-1 accent-[hsl(var(--curve))]" aria-label="Target price" data-testid="target-price" disabled={spot === null} />
          <span className="num w-[80px] text-right">{fmtPrice(a.targetPrice, 0)}</span>
          <button type="button" onClick={() => setTarget({ price: null })} className="text-muted-foreground hover:text-foreground" title="Reset to spot" data-testid="target-price-reset">
            spot
          </button>
        </label>
        <label className="flex items-center gap-2 text-2xs">
          <span className="micro w-[72px] shrink-0">Target date</span>
          <input type="range" min={0} max={Math.max(0, dte)} step={1} value={Math.min(a.targetDays, Math.max(0, dte))} onChange={(e) => setTarget({ days: Number(e.target.value) })} className="flex-1 accent-[hsl(var(--curve))]" aria-label="Target days ahead" data-testid="target-days" disabled={dte === 0} />
          <span className="num w-[80px] text-right">{a.targetDays === 0 ? "today" : `+${a.targetDays}d`}</span>
          <button type="button" onClick={() => setTarget({ days: dte })} className="text-muted-foreground hover:text-foreground" title="Move the target to expiry" data-testid="target-days-expiry">
            expiry
          </button>
        </label>
      </div>
      <GreeksStrip a={a} />
    </div>
  );
}
