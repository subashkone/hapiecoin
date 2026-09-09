"use client";
// Compare plans (ADR-044 extra 1; HC-TR-153): keep the working changes as Plan A / B / C, see every plan's
// max loss, max profit, POP and cash next to the current draft, load one back or drop it.
import { Button, cn } from "@hapiecoin/ui";
import { useMemo } from "react";
import { fmtMoney } from "@/lib/money";
import { useAnalysis } from "@/lib/pricing/client";
import { settlementHourUtc, toPricingLegs } from "@/lib/pricing/legs";
import { type AdjustDraft, MAX_PLANS, type SavedPlan, afterLegs, cashflow, planDraft, valuationMsOf } from "@/lib/adjust/model";
import type { AdjustWorkbench } from "@/lib/adjust/useAdjustWorkbench";

export interface PlanFigures {
  maxLoss: number;
  maxProfit: number;
  pop: number;
  delta: number;
  cash: number;
}

/** Price a draft the way the pane prices the working one (same marks, spot, clock and valuation rule). */
export function useDraftFigures(w: AdjustWorkbench, draft: AdjustDraft | null): PlanFigures | null {
  const { a, open, strategy, lotSize } = w;
  const legs = useMemo(() => (draft ? afterLegs(draft, open, strategy.asset, a.markOf) : []), [draft, open, strategy.asset, a.markOf]);
  const pricing = useMemo(() => toPricingLegs(legs, lotSize, { iv: (l) => a.quoteFor(l)?.markIv, spot: a.spotText }), [legs, lotSize, a]);
  const valuationMs = useMemo(() => (draft ? valuationMsOf(draft, open, strategy.asset, a.nowMs) : undefined), [draft, open, strategy.asset, a.nowMs]);
  const options = useMemo(() => (draft && a.spot !== null && pricing.length ? { spot: a.spot, nowMs: a.nowMs, settlementHourUtc: settlementHourUtc(strategy.asset), defaultIv: 0.5, points: 81, ...(valuationMs === undefined ? {} : { valuationMs }) } : null), [draft, a.spot, a.nowMs, pricing.length, strategy.asset, valuationMs]);
  const { result } = useAnalysis(pricing, options);
  const cash = draft ? cashflow(draft, open, a.markOf, lotSize) : 0;
  return result ? { maxLoss: result.maxLoss, maxProfit: result.maxProfit, pop: result.pop, delta: result.greeks.delta, cash } : null;
}

function PlanRow({ w, plan, current }: { w: AdjustWorkbench; plan: SavedPlan | null; current: boolean }) {
  const draft = plan ? planDraft(w.draft, plan) : w.draft;
  const f = useDraftFigures(w, draft);
  const money = w.a.money;
  const cell = (v: string, cls?: string) => <td className={cn("num py-1 pr-2 text-right", cls)}>{v}</td>;
  return (
    <tr className={cn("border-t border-border", current && "bg-warning/5")} data-testid="plan-row" data-plan={plan?.id ?? "current"} data-state={f ? "ready" : "pending"}>
      <td className="py-1 pr-2 text-left">
        <b>{plan ? plan.name : "Current"}</b>
        {plan ? <span className="micro ml-1 text-muted-foreground">{plan.picks.length + Object.keys(plan.lotsAfter).length} edits</span> : null}
      </td>
      {cell(f ? fmtMoney(f.maxLoss, money, { unlimited: "Unlimited" }) : "—", "text-loss")}
      {cell(f ? fmtMoney(f.maxProfit, money, { unlimited: "Unlimited" }) : "—", "text-profit")}
      {cell(f && Number.isFinite(f.pop) ? `${(f.pop * 100).toFixed(0)}%` : "—")}
      {cell(f ? fmtMoney(f.cash, money, { signed: true }) : "—", f && f.cash >= 0 ? "text-profit" : "text-loss")}
      <td className="py-1 text-right">
        {plan ? (
          <span className="inline-flex gap-1">
            <Button size="sm" variant="outline" onClick={() => w.loadPlan(plan.id)} title="Load this plan into the workbench" data-testid="plan-use">
              Use
            </Button>
            <button type="button" onClick={() => w.removePlan(plan.id)} aria-label={`Remove ${plan.name}`} className="px-1 text-muted-foreground hover:text-loss" data-testid="plan-remove">
              ✕
            </button>
          </span>
        ) : null}
      </td>
    </tr>
  );
}

export function PlansBar({ w }: { w: AdjustWorkbench }) {
  const plans = w.draft.plans;
  return (
    <div className="mb-2 rounded border border-border" data-testid="plans-bar" data-count={plans.length}>
      <div className="flex flex-wrap items-center gap-2 px-2 py-1 text-2xs">
        <span className="micro">Plans</span>
        <span className="text-muted-foreground">{plans.length ? `${plans.length} of ${MAX_PLANS} saved · compare, then Use one` : "keep this change as a plan, build another, compare"}</span>
        <Button size="sm" variant="outline" className="ml-auto" disabled={w.empty || plans.length >= MAX_PLANS} title={w.empty ? "Make a change first" : plans.length >= MAX_PLANS ? `At most ${MAX_PLANS} plans` : "Save the current change as a plan"} onClick={w.savePlan} data-testid="plan-save">
          Save as plan
        </Button>
      </div>
      {plans.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs" data-testid="plans-table">
            <thead>
              <tr className="micro">
                <th className="px-2 py-1 text-left">Plan</th>
                <th className="py-1 pr-2 text-right">Max loss</th>
                <th className="py-1 pr-2 text-right">Max profit</th>
                <th className="py-1 pr-2 text-right">POP</th>
                <th className="py-1 pr-2 text-right">Cash</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              <PlanRow w={w} plan={null} current />
              {plans.map((p) => (
                <PlanRow key={p.id} w={w} plan={p} current={false} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
