"use client";
// Stop Paper Trading (HC-TR-064, HC-TR-081): archive with the legs squared off at live prices, or keep the
// strategy as a draft for later.
import type { Strategy, StrategyLeg as ServerLeg } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, cn, toast } from "@hapiecoin/ui";
import { useEffect, useState } from "react";
import { useStopStrategy } from "@/lib/api/strategies";
import { fmtPrice } from "@/lib/format";
import { fmtMoney, type MoneyFormat } from "@/lib/money";
import { fmtLeg, openLegs, priceMap } from "@/lib/strategy/paper";

export function StopPaperDialog({ open, onOpenChange, strategy, priceOf, total, money, live, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; strategy: Strategy; priceOf: (leg: ServerLeg) => number | null; total: number; money: MoneyFormat; live: boolean; onDone?: ((s: Strategy) => void) | undefined }) {
  const stop = useStopStrategy();
  const [archive, setArchive] = useState(true);
  useEffect(() => {
    if (open) setArchive(true);
  }, [open]);
  const legs = openLegs(strategy);
  const go = () =>
    stop.mutate(
      { id: strategy.id, body: { archive, exits: archive ? priceMap(legs, priceOf) : {} } },
      {
        onSuccess: (s) => {
          toast.success("Paper trading stopped", { description: archive ? `${strategy.name} archived · legs squared off at live prices` : `${strategy.name} moved to Draft Strategies` });
          onOpenChange(false);
          if (s) onDone?.(s);
        },
        onError: (e) => toast.error("Could not stop", { description: e.message }),
      },
    );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]" data-testid="stop-paper">
        <DialogHeader>
          <DialogTitle>Stop Paper Trading</DialogTitle>
          <DialogDescription>Choose what to do with this strategy</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="rounded border border-border p-2 text-xs">
            <div className="flex flex-wrap items-center gap-2"><b>{strategy.name}</b><span className="micro rounded border border-border px-1">Paper</span><span className="micro">● live prices</span></div>
            <div className="mt-1 flex gap-4 font-mono text-2xs text-muted-foreground">
              <span>Asset <b className="text-foreground">{strategy.asset}</b></span>
              <span>Legs <b className="text-foreground">{strategy.legs.length}</b></span>
              <span>P&amp;L <b className={cn(total >= 0 ? "text-profit" : "text-loss")} data-testid="stop-pnl">{fmtMoney(total, money, { signed: true })}</b></span>
            </div>
          </div>
          {legs.length ? (
            <div className="mt-2">
              <div className="micro mb-1">Active legs</div>
              {legs.map((l) => (
                <div key={l.id} className="flex items-center gap-2 py-0.5 text-xs" data-testid="stop-leg">
                  <span className={cn("font-mono text-3xs font-bold uppercase", l.side === "buy" ? "text-buy" : "text-sell")}>{l.side}</span>
                  <span className="num">{fmtLeg(l).replace(/^(BUY|SELL) /, "")}</span>
                  <span className="num ml-auto">{fmtPrice(priceOf(l) ?? undefined, 1)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">No active legs · all legs are already squared off</p>
          )}
          <div className={cn("mt-2 rounded border p-2 text-2xs", live ? "border-profit/40" : "border-warning/40")} data-testid="stop-feed">
            {live ? <><b>Using live WebSocket prices</b><div className="text-muted-foreground">Current market prices will be used for all legs when stopping</div></> : <><b>Connecting to live prices</b><div className="text-muted-foreground">Please wait while we fetch current market prices...</div></>}
          </div>
          <label className="mt-3 flex items-start gap-2 text-xs">
            <input type="checkbox" checked={archive} onChange={(e) => setArchive(e.target.checked)} className="mt-0.5" data-testid="stop-archive" />
            <span><b>Archive this strategy</b><span className="block text-muted-foreground">Move to archived strategies and the Journal. Uncheck to keep it as a draft for future use.</span></span>
          </label>
          <p className="micro mt-2" data-testid="stop-hint">{archive ? "Strategy will be moved to Archived Strategies and marked as closed. All active legs will be squared off at current prices." : "Strategy will remain in Draft Strategies but paper trading will be stopped. Legs stay saved so you can activate it again later."}</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="outline" className="text-warning" disabled={archive && legs.length > 0 && !live} loading={stop.isPending} onClick={go} title={archive && legs.length > 0 && !live ? "Waiting for live prices..." : "Stop paper trading"} data-testid="stop-go">
            {archive && legs.length > 0 && !live ? "Connecting..." : "Stop trading"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
