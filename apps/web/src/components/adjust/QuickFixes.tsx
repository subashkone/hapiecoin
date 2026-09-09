"use client";
// Quick fixes (ADR-044 extra 3; HC-TR-154): Roll strikes up, Roll out, Hedge with a call, each priced with the
// engine and tagged (smallest max loss, largest credit, closest to delta-neutral); a click loads the draft for review.
import { cn } from "@hapiecoin/ui";
import { useMemo } from "react";
import { useChain } from "@/lib/gateway/hooks";
import { fmtMoney } from "@/lib/money";
import { type FixContext, quickFixes, rankFixes } from "@/lib/adjust/fixes";
import type { AdjustWorkbench } from "@/lib/adjust/useAdjustWorkbench";
import type { PickerRow } from "@/components/builder/ChainPickerBody";
import { useDraftFigures } from "./PlansBar";

export function QuickFixes({ w, expiry, rows, expiries }: { w: AdjustWorkbench; expiry: string | null; rows: readonly PickerRow[]; expiries: readonly string[] }) {
  const nextExpiry = useMemo(() => (expiry ? (expiries[expiries.indexOf(expiry) + 1] ?? null) : null), [expiry, expiries]);
  const next = useChain(w.strategy.asset, nextExpiry);
  const ctx = useMemo<FixContext>(() => ({ open: w.open, asset: w.strategy.asset, expiry, rows, nextExpiry, nextRows: next?.rows ?? [], spot: w.a.spot }), [w.open, w.strategy.asset, expiry, rows, nextExpiry, next?.rows, w.a.spot]);
  const candidates = useMemo(() => quickFixes(w.draft, ctx), [w.draft, ctx]);
  // one pricing hook per fix, always called in the same order
  const f0 = useDraftFigures(w, candidates[0]?.draft ?? null);
  const f1 = useDraftFigures(w, candidates[1]?.draft ?? null);
  const f2 = useDraftFigures(w, candidates[2]?.draft ?? null);
  const figures = [f0, f1, f2];
  const tags = rankFixes(figures.map((f) => (f ? { maxLoss: f.maxLoss, cash: f.cash, delta: f.delta } : null)));
  const money = w.a.money;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1" data-testid="quick-fixes">
      <span className="micro mr-1">Quick fixes</span>
      {candidates.map((c, i) => {
        const f = figures[i] ?? null;
        const t = tags[i] ?? [];
        const title = c.draft ? `${c.note}${f ? ` · max loss ${fmtMoney(f.maxLoss, money, { unlimited: "Unlimited" })} · cash ${fmtMoney(f.cash, money, { signed: true })}` : ""}` : c.note;
        return (
          <button key={c.kind} type="button" disabled={!c.draft} title={title} onClick={() => c.draft && w.applyDraft(c.draft)} className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs", c.draft ? "border-border hover:border-foreground/40" : "border-border/50 text-muted-foreground")} data-testid="quick-fix" data-kind={c.kind} data-state={c.draft ? (f ? "ready" : "pending") : "unavailable"}>
            <span>{c.label}</span>
            {f ? <span className="num text-loss">{fmtMoney(f.maxLoss, money, { unlimited: "∞" })}</span> : null}
            {t.map((x) => (
              <span key={x} className="micro rounded border border-profit/50 px-1 text-profit" data-testid="quick-fix-tag">
                {x}
              </span>
            ))}
          </button>
        );
      })}
    </div>
  );
}
