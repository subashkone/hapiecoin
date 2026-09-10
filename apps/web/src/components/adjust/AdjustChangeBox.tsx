"use client";
// "This change: …" (ADR-058; HC-TR-151): the one-sentence before → after reading with the guard rails, at the top
// of the analysis pane while the workbench holds a draft, where H2 puts it. Reads the same summary the workbench
// footer used to show, so the words and the figures never disagree.
import { cn } from "@hapiecoin/ui";
import { useAdjustWorkbench } from "@/lib/adjust/useAdjustWorkbench";
import { fmtMoney } from "@/lib/money";

export function AdjustChangeBox() {
  const w = useAdjustWorkbench();
  if (!w) return null;
  const { a } = w;
  const hasCash = !w.empty && Math.abs(w.cash) >= 0.005;
  return (
    <div className={cn("rounded border px-3 py-2 text-xs", w.summary.warnings.length ? "border-warning" : "border-border")} data-testid="adjust-change-box" data-empty={w.empty ? "true" : "false"}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span data-testid="adjust-summary">
          <b>This change:</b> {w.empty ? "nothing yet · pick B / S on the chain, or change lots after on a leg" : `${w.summary.line || "pricing…"}${w.summary.line ? "." : ""}`}
        </span>
        {hasCash ? (
          <span className={cn("num ml-auto font-medium", w.cash > 0 ? "text-profit" : "text-loss")} data-testid="adjust-cash">
            {w.cash > 0 ? "credit" : "debit"} {fmtMoney(Math.abs(w.cash), a.money)}
          </span>
        ) : null}
      </div>
      {w.summary.warnings.length ? (
        <ul className="mt-1 flex flex-col gap-0.5 text-2xs text-warning" data-testid="adjust-warnings">
          {w.summary.warnings.map((x) => (
            <li key={x} data-testid="adjust-warning">⚠ {x}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
