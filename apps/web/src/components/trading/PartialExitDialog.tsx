"use client";
// Partial Exit (HC-TR-080): pick legs, choose an exit percentage, exit each selected leg at its price.
import type { Strategy, StrategyLeg as ServerLeg } from "@hapiecoin/schema";
import { toDecimal } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, cn, toast } from "@hapiecoin/ui";
import { useEffect, useState } from "react";
import { useCloseLeg } from "@/lib/api/strategies";
import { fmtPrice } from "@/lib/format";
import { fmtLeg, openLegs } from "@/lib/strategy/paper";

const PRESETS = [25, 50, 75, 100] as const;

export function exitLots(lots: number, pct: number): number {
  return Math.max(1, Math.round((lots * pct) / 100));
}

export function PartialExitDialog({ open, onOpenChange, strategy, priceOf, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; strategy: Strategy; priceOf: (leg: ServerLeg) => number | null; onDone?: (() => void) | undefined }) {
  const close = useCloseLeg();
  const legs = openLegs(strategy);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pct, setPct] = useState(50);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setSel(new Set());
      setPct(50);
      setPrices({});
    }
  }, [open]);
  const priceFor = (l: ServerLeg): number => {
    const typed = prices[l.id];
    if (typed !== undefined && typed.trim() !== "") return Math.max(0, Number(typed) || 0);
    return priceOf(l) ?? Number(l.entryPrice ?? l.price);
  };
  const run = async () => {
    const chosen = legs.filter((l) => sel.has(l.id));
    if (!chosen.length) return;
    setBusy(true);
    try {
      for (const l of chosen) {
        const lots = exitLots(l.lots, pct);
        await close.mutateAsync({ id: strategy.id, legId: l.id, body: { exitPrice: toDecimal(priceFor(l), 4), ...(lots < l.lots ? { lots } : {}) } });
      }
      toast.success("Partial exit complete", { description: `${chosen.length} ${chosen.length === 1 ? "leg" : "legs"} exited at ${pct}%` });
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      toast.error("Partial exit stopped", { description: e instanceof Error ? e.message : "request failed" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]" data-testid="partial-exit">
        <DialogHeader>
          <DialogTitle>Partial Exit</DialogTitle>
          <DialogDescription>Select legs and choose exit percentage</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="mb-2 flex items-center justify-between text-2xs">
            <span className="micro" data-testid="pe-count">{legs.length} active {legs.length === 1 ? "leg" : "legs"} · {sel.size} selected</span>
            <span className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setSel(new Set(legs.map((l) => l.id)))}>Select all</Button>
              <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>Deselect all</Button>
            </span>
          </div>
          {legs.map((l) => {
            const cur = priceOf(l);
            return (
              <label key={l.id} className="mb-1 flex items-center gap-2 rounded border border-border px-2 py-1 text-xs" data-testid="pe-row">
                <input type="checkbox" checked={sel.has(l.id)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(l.id); else n.delete(l.id); return n; })} aria-label={fmtLeg(l)} data-testid="pe-check" />
                <span className={cn("font-mono text-3xs font-bold uppercase", l.side === "buy" ? "text-buy" : "text-sell")}>{l.side}</span>
                <span className="num">{fmtLeg(l).replace(/^(BUY|SELL) /, "")}</span>
                <span className="num text-muted-foreground">{l.lots} → <b data-testid="pe-lots">{exitLots(l.lots, pct)}</b> lots</span>
                <span className="micro ml-auto">Exit</span>
                <input type="number" step="0.1" min={0} value={prices[l.id] ?? (cur === null ? "" : toDecimal(cur, 4))} onChange={(e) => setPrices((p) => ({ ...p, [l.id]: e.target.value }))} className="h-7 w-24 rounded border border-input bg-transparent px-1 text-right font-mono" aria-label="Exit price" title="Exit price (default: current market)" />
              </label>
            );
          })}
          <div className="mt-3">
            <div className="micro mb-1">Exit %</div>
            <div className="flex flex-wrap items-center gap-1">
              {PRESETS.map((p) => (
                <button key={p} type="button" aria-pressed={pct === p} onClick={() => setPct(p)} className={cn("rounded border px-2 py-0.5 font-mono text-2xs", pct === p ? "border-foreground/50 text-foreground" : "border-border text-muted-foreground")} data-testid={`pe-pct-${p}`}>
                  {p}%
                </button>
              ))}
              <input type="number" min={1} max={100} value={pct} onChange={(e) => setPct(Math.max(1, Math.min(100, Math.round(Number(e.target.value) || 1))))} className="h-7 w-16 rounded border border-input bg-transparent px-1 text-right font-mono text-2xs" aria-label="Custom exit percent" data-testid="pe-custom" />
              <span className="text-2xs">%</span>
            </div>
            <div className="micro mt-1">Exit quantity per leg = round(qty × {pct}%) · minimum 1 lot · market {legs[0] ? fmtPrice(priceOf(legs[0]) ?? undefined, 1) : "—"}</div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" disabled={sel.size === 0} loading={busy} onClick={() => void run()} data-testid="pe-go">
            Exit {sel.size} {sel.size === 1 ? "leg" : "legs"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
