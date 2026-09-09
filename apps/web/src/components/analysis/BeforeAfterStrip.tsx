"use client";
// Before → after strip over the payoff tiles while the workbench holds a draft (ADR-044, HC-TR-149): the four
// figures a trader checks before committing an adjustment, each as "before → after" with the direction toned.
import { cn } from "@hapiecoin/ui";
import { fmtDate, fmtStrike } from "@/lib/format";
import { fmtMoney } from "@/lib/money";
import type { StrategyAnalysis } from "@/lib/strategy/useStrategyAnalysis";

type Tone = "profit" | "loss" | "muted";

function figure(label: string, before: string, after: string, tone: Tone, testId: string) {
  return (
    <div className="min-w-0" data-testid={testId} data-tone={tone}>
      <div className="micro truncate">{label}</div>
      <div className="num flex flex-wrap items-baseline gap-x-1 text-xs">
        <span className="text-muted-foreground line-through decoration-muted-foreground/60">{before}</span>
        <span aria-hidden className="text-muted-foreground">→</span>
        <span className={cn("font-medium", tone === "profit" && "text-profit", tone === "loss" && "text-loss")}>{after}</span>
      </div>
    </div>
  );
}

export function BeforeAfterStrip({ a }: { a: StrategyAnalysis }) {
  const { before, result: after, money } = a;
  const money$ = (v: number | undefined, unlimited: string) => (v === undefined ? "—" : fmtMoney(v, money, { unlimited }));
  const pct = (p: number | undefined) => (p === undefined || !Number.isFinite(p) ? "—" : `${(p * 100).toFixed(0)}%`);
  const bes = (r: typeof after) => (r ? (r.breakevens.length ? r.breakevens.map((b) => fmtStrike(String(Math.round(b)))).join(" · ") : "none") : "—");
  const toneOf = (b: number | undefined, x: number | undefined, higherIsBetter: boolean): Tone => {
    if (b === undefined || x === undefined || Number.isNaN(b) || Number.isNaN(x) || b === x) return "muted";
    const better = higherIsBetter ? x > b : x < b;
    return better ? "profit" : "loss";
  };
  const valuedAt = a.valuationMs === undefined ? null : fmtDate(new Date(a.valuationMs).toISOString().slice(0, 10));
  return (
    <div className="border-b border-border bg-warning/5 px-3 py-2" data-testid="before-after">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-2xs">
        <span className="micro rounded border border-warning px-1 text-warning">Adjusting</span>
        <span className="text-muted-foreground">before → after{valuedAt ? ` · valued at ${valuedAt}` : ""}</span>
        {!before || !after ? <span className="ml-auto text-muted-foreground">pricing…</span> : null}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4">
        {figure("Max loss", money$(before?.maxLoss, "Unlimited"), money$(after?.maxLoss, "Unlimited"), toneOf(before?.maxLoss, after?.maxLoss, true), "ba-max-loss")}
        {figure("Max profit", money$(before?.maxProfit, "Unlimited"), money$(after?.maxProfit, "Unlimited"), toneOf(before?.maxProfit, after?.maxProfit, true), "ba-max-profit")}
        {figure("POP", pct(before?.pop), pct(after?.pop), toneOf(before?.pop, after?.pop, true), "ba-pop")}
        {figure("Break-even", bes(before), bes(after), "muted", "ba-breakeven")}
      </div>
    </div>
  );
}
