"use client";
// Ladder tab (HC-WS-062..064): P&L at expiry and on the target date for a ladder of prices around spot,
// with the spot row and each break-even inserted, and a status pill per row.
import { EmptyState, cn, useDensity } from "@hapiecoin/ui";
import { useMemo, useState } from "react";
import { fmtStrike } from "@/lib/format";
import { fmtMoney } from "@/lib/money";
import { type LadderStatus, cleanStep, ladderPrices, ladderRows } from "@/lib/strategy/analysis";
import { useStrategyAnalysis } from "@/lib/strategy/useStrategyAnalysis";

const PILL: Record<LadderStatus, { text: string; cls: string }> = {
  profit: { text: "profit", cls: "border-profit/40 text-profit" },
  loss: { text: "loss", cls: "border-loss/40 text-loss" },
  flat: { text: "flat", cls: "border-border text-muted-foreground" },
  breakeven: { text: "break-even", cls: "border-border text-foreground" },
  spot: { text: "spot", cls: "border-spot text-spot" },
};

export function LadderPanel() {
  const compact = useDensity().density === "compact"; // HC-WS-066
  const a = useStrategyAnalysis();
  const { result, spot, money, legs } = a;
  const [stepMul, setStepMul] = useState<1 | 2 | 4>(1);
  const step = spot ? cleanStep(spot * 0.0025 * stepMul) : 1;
  const rows = useMemo(() => (result && spot ? ladderRows(result, spot, ladderPrices(spot, step)) : []), [result, spot, step]);
  if (legs.length === 0) return <EmptyState title="No strategy yet" description="The ladder shows P&L at each price once the strategy has legs." className="py-16" data-testid="ladder-empty" />;
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="ladder-panel" data-rows={rows.length}>
      <div className="flex items-center gap-2 px-3 py-2 text-2xs">
        <span className="micro">Step</span>
        {([1, 2, 4] as const).map((m) => (
          <button key={m} type="button" aria-pressed={stepMul === m} onClick={() => setStepMul(m)} className={cn("rounded border px-1.5 py-0.5 font-mono", stepMul === m ? "border-foreground/40 text-foreground" : "border-border text-muted-foreground")} data-testid={`ladder-step-${m}`}>
            {spot ? fmtStrike(String(cleanStep(spot * 0.0025 * m))) : m}
          </button>
        ))}
        <span className="micro ml-auto">±20 % around spot · target {a.targetDays === 0 ? "today" : `+${a.targetDays}d`}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-xs" data-testid="ladder-table">
          <thead className="sticky top-0 bg-background">
            <tr className="micro text-left">
              <th className="py-1 pl-3 pr-2 text-right">Price</th>
              <th className="py-1 pr-2 text-right">Change</th>
              <th className="py-1 pr-2 text-right">P&amp;L at expiry</th>
              <th className="py-1 pr-2 text-right">P&amp;L on target</th>
              <th className="py-1 pr-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.price} className={cn("border-t border-border", compact ? "[&>td]:py-0" : "", r.status === "spot" && "atm-band", r.status === "breakeven" && "bg-muted/40")} data-testid="ladder-row" data-status={r.status} data-density={compact ? "compact" : "comfortable"}>
                <td className={cn("num py-1 pl-3 pr-2 text-right", r.status === "spot" && "text-spot")}>{fmtStrike(String(Math.round(r.price)))}</td>
                <td className={cn("num py-1 pr-2 text-right", r.changePct > 0 ? "text-profit" : r.changePct < 0 ? "text-loss" : "text-muted-foreground")}>{r.changePct === 0 ? "0.0%" : `${r.changePct > 0 ? "+" : "−"}${Math.abs(r.changePct).toFixed(1)}%`}</td>
                <td className={cn("num py-1 pr-2 text-right", r.atExpiry > 0 ? "text-profit" : r.atExpiry < 0 ? "text-loss" : "")}>{fmtMoney(r.atExpiry, money, { signed: true })}</td>
                <td className={cn("num py-1 pr-2 text-right", r.onTarget > 0 ? "text-profit" : r.onTarget < 0 ? "text-loss" : "")}>{fmtMoney(r.onTarget, money, { signed: true })}</td>
                <td className="py-1 pr-3">
                  <span className={cn("micro rounded border px-1 py-px", PILL[r.status].cls)}>{PILL[r.status].text}</span>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-muted-foreground">
                  {spot === null ? "Waiting for the spot price…" : "Pricing…"}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
