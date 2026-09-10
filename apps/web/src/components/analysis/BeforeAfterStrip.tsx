"use client";
// Before → after strip over the payoff tiles while the workbench holds a draft (ADR-044, ADR-058; HC-TR-149): the
// "This change" box, then the six H2 tiles (max loss, max profit, probability of profit, break-evens, net Δ · Θ/day,
// margin estimate), each as before → after with a verdict.
import { cn } from "@hapiecoin/ui";
import { fmtDate, fmtStrike } from "@/lib/format";
import { fmtMoney } from "@/lib/money";
import { marginEstimate } from "@/lib/strategy/analysis";
import type { StrategyAnalysis } from "@/lib/strategy/useStrategyAnalysis";
import { AdjustChangeBox } from "@/components/adjust/AdjustChangeBox";

type Tone = "profit" | "loss" | "muted";

function figure(label: string, before: string, after: string, tone: Tone, verdict: string, testId: string) {
  return (
    <div className="min-w-0 rounded border border-border px-2 py-1.5" data-testid={testId} data-tone={tone}>
      <div className="micro truncate">{label}</div>
      <div className={cn("num truncate text-[15px] font-medium", tone === "profit" && "text-profit", tone === "loss" && "text-loss")}>{after}</div>
      <div className="num flex flex-wrap items-baseline gap-x-1 text-2xs text-muted-foreground">
        <span>{before}</span>
        <span aria-hidden>→</span>
        <span className={cn(tone === "profit" && "text-profit", tone === "loss" && "text-loss")}>{verdict}</span>
      </div>
    </div>
  );
}

export function BeforeAfterStrip({ a }: { a: StrategyAnalysis }) {
  const { before, result: after, money } = a;
  const money$ = (v: number | undefined, unlimited: string) => (v === undefined ? "—" : fmtMoney(v, money, { unlimited }));
  const pct = (p: number | undefined) => (p === undefined || !Number.isFinite(p) ? "—" : `${(p * 100).toFixed(0)}%`);
  const bes = (r: typeof after) => (r ? (r.breakevens.length ? r.breakevens.map((b) => fmtStrike(String(Math.round(b)))).join(" / ") : "none") : "—");
  const toneOf = (b: number | undefined, x: number | undefined, higherIsBetter: boolean): Tone => {
    if (b === undefined || x === undefined || Number.isNaN(b) || Number.isNaN(x) || b === x) return "muted";
    const better = higherIsBetter ? x > b : x < b;
    return better ? "profit" : "loss";
  };
  const verdictOf = (tone: Tone, better: string, worse: string) => (tone === "profit" ? `▲ ${better}` : tone === "loss" ? `▼ ${worse}` : "unchanged");
  const greeks = (r: typeof after) => (r ? `${r.greeks.delta >= 0 ? "+" : ""}${r.greeks.delta.toFixed(3)} · ${fmtMoney(r.greeks.theta, money, { signed: true })}` : "—");
  const marginB = before ? marginEstimate(before) : null;
  const marginA = after ? marginEstimate(after) : null;
  const margin$ = (m: number | null | undefined, r: typeof after) => (r === null || r === undefined ? "—" : m === null ? "Unlimited" : fmtMoney(m, money));
  const marginTone: Tone = before && after ? (marginA === null && marginB !== null ? "loss" : marginA !== null && marginB === null ? "profit" : toneOf(marginB ?? undefined, marginA ?? undefined, false)) : "muted";
  const lossTone = toneOf(before?.maxLoss, after?.maxLoss, true);
  const profitTone = toneOf(before?.maxProfit, after?.maxProfit, true);
  const popTone = toneOf(before?.pop, after?.pop, true);
  const valuedAt = a.valuationMs === undefined ? null : fmtDate(new Date(a.valuationMs).toISOString().slice(0, 10));
  return (
    <div className="flex flex-col gap-2 border-b border-border bg-warning/5 px-3 py-2" data-testid="before-after">
      <div className="flex flex-wrap items-center gap-2 text-2xs">
        <span className="micro rounded border border-warning px-1 text-warning">Adjusting</span>
        <span className="text-muted-foreground">before → after{valuedAt ? ` · valued at ${valuedAt}` : ""}</span>
        {!before || !after ? <span className="ml-auto text-muted-foreground">pricing…</span> : null}
      </div>
      <AdjustChangeBox />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6" data-testid="before-after-tiles">
        {figure("Max loss", money$(before?.maxLoss, "Unlimited"), money$(after?.maxLoss, "Unlimited"), lossTone, verdictOf(lossTone, "better", "worse"), "ba-max-loss")}
        {figure("Max profit", money$(before?.maxProfit, "Unlimited"), money$(after?.maxProfit, "Unlimited"), profitTone, verdictOf(profitTone, "better", "worse"), "ba-max-profit")}
        {figure("Prob. of profit", pct(before?.pop), pct(after?.pop), popTone, verdictOf(popTone, "better", "worse"), "ba-pop")}
        {figure("Break-evens", bes(before), bes(after), "muted", "at the valuation date", "ba-breakeven")}
        {figure("Net Δ · Θ/day", greeks(before), greeks(after), "muted", "after the change", "ba-greeks")}
        {figure("Margin est.", margin$(marginB, before), margin$(marginA, after), marginTone, verdictOf(marginTone, "less held", "more held"), "ba-margin")}
      </div>
    </div>
  );
}
