"use client";
// Trade All → Live (HC-TR-089, ADR-010): an explicit batch selector over the open paper strategies, one
// exchange, one confirm; the API places one strategy at a time and stops at the first failure.
import type { Broker, Strategy } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, cn, toast } from "@hapiecoin/ui";
import { useEffect, useState } from "react";
import { newIdempotencyKey, useLiveBatch } from "@/lib/api/live";
import { fmtMoney, type MoneyFormat } from "@/lib/money";
import { useUiStore } from "@/lib/store";
import { openLegs } from "@/lib/strategy/paper";

export function BatchLiveDialog({ open, onOpenChange, strategies, brokers, connected, money, totalOf }: { open: boolean; onOpenChange: (o: boolean) => void; strategies: Strategy[]; brokers: Broker[]; connected: boolean; money: MoneyFormat; totalOf: (s: Strategy) => number }) {
  const batch = useLiveBatch();
  const setWorkspaceTab = useUiStore((s) => s.setWorkspaceTab);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [brokerId, setBrokerId] = useState("");
  const [key, setKey] = useState("");
  useEffect(() => {
    if (open) {
      setSel(new Set(strategies.filter((s) => openLegs(s).length > 0).map((s) => s.id)));
      setBrokerId(brokers[0]?.id ?? "");
      setKey(newIdempotencyKey());
    }
  }, [open, strategies, brokers]);
  const go = () =>
    batch.mutate(
      { ids: [...sel], brokerId, idempotencyKey: key },
      {
        onSuccess: (r) => {
          onOpenChange(false);
          if (r.placed.length) setWorkspaceTab("live");
          if (r.failed) toast.error("Batch stopped", { description: `${strategies.find((s) => s.id === r.failed?.id)?.name ?? r.failed.id}: ${r.failed.error}` });
          else toast.success("Live Orders Placed", { description: `${r.placed.length} ${r.placed.length === 1 ? "strategy" : "strategies"} moved to live` });
        },
        onError: (e) => toast.error("Batch refused", { description: e.message }),
      },
    );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]" data-testid="batch-live">
        <DialogHeader>
          <DialogTitle>Trade All → Live</DialogTitle>
          <DialogDescription>Place every ticked paper strategy as real orders on the exchange, one strategy at a time</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {strategies.length === 0 ? <p className="text-xs text-muted-foreground">No paper strategies to convert.</p> : null}
          {strategies.map((s) => {
            const open = openLegs(s);
            return (
              <label key={s.id} className={cn("mb-1 flex items-center gap-2 rounded border border-border px-2 py-1 text-xs", open.length === 0 && "opacity-50")} data-testid="batch-row">
                <input type="checkbox" checked={sel.has(s.id)} disabled={open.length === 0} onChange={(e) => setSel((x) => { const n = new Set(x); if (e.target.checked) n.add(s.id); else n.delete(s.id); return n; })} aria-label={s.name} data-testid="batch-check" />
                <span className="font-medium">{s.name}</span>
                <span className="micro rounded border border-border px-1">{s.asset}</span>
                <span className="micro">{open.length} open {open.length === 1 ? "leg" : "legs"}</span>
                <span className={cn("num ml-auto", totalOf(s) >= 0 ? "text-profit" : "text-loss")}>{fmtMoney(totalOf(s), money, { signed: true })}</span>
              </label>
            );
          })}
          <div className="mt-3">
            <div className="micro mb-1">Exchange</div>
            <select className="h-8 w-full rounded border border-input bg-background px-2 text-xs" value={brokerId} onChange={(e) => setBrokerId(e.target.value)} aria-label="Exchange" data-testid="batch-broker">
              {brokers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} · Fee {b.feePct}% · GST {b.gstPct}%
                </option>
              ))}
            </select>
          </div>
          <div className="mt-3 rounded border border-loss/40 p-2 text-2xs" data-testid="batch-warning">
            <b className="text-loss">Real Money Trading</b>
            <div>Each strategy is previewed against the exchange (contracts, marks, wallet, limits) and placed in order; the batch stops at the first refusal and tells you which strategy.</div>
            {!connected ? <div className="mt-1 text-warning">Connect your exchange in Settings → API Settings first.</div> : null}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" disabled={sel.size === 0 || !connected || !brokerId} loading={batch.isPending} onClick={go} data-testid="batch-go">
            Trade {sel.size} {sel.size === 1 ? "strategy" : "strategies"} live →
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
