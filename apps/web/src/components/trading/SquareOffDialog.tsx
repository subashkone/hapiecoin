"use client";
// Square Off Position (HC-TR-014, HC-TR-079): close one leg fully or partially at an exit premium.
import type { Strategy, StrategyLeg as ServerLeg } from "@hapiecoin/schema";
import { toDecimal } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, cn, toast } from "@hapiecoin/ui";
import { useEffect, useState } from "react";
import { useCloseLeg } from "@/lib/api/strategies";
import { fmtPrice, fmtStrike } from "@/lib/format";
import { fmtMoney, type MoneyFormat } from "@/lib/money";

export function SquareOffDialog({ open, onOpenChange, strategy, leg, current, lotSize, money, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; strategy: Strategy; leg: ServerLeg; current: number | null; lotSize: string; money: MoneyFormat; onDone?: (() => void) | undefined }) {
  const close = useCloseLeg();
  const entry = Number(leg.entryPrice ?? leg.price);
  const [exit, setExit] = useState("");
  const [qty, setQty] = useState(String(leg.lots));
  useEffect(() => {
    if (open) {
      setExit(current === null ? "" : toDecimal(current, 4));
      setQty(String(leg.lots));
    }
  }, [open, current, leg.lots]);
  const ex = exit.trim() === "" ? (current ?? entry) : Math.max(0, Number(exit) || 0);
  const q = Math.max(1, Math.min(Math.round(Number(qty) || 1), leg.lots));
  const lot = Number(lotSize);
  const sign = leg.side === "buy" ? 1 : -1;
  const pnl = (ex - entry) * q * lot * sign;
  const confirm = () =>
    close.mutate(
      { id: strategy.id, legId: leg.id, body: { exitPrice: toDecimal(ex, 4), ...(q < leg.lots ? { lots: q } : {}) } },
      {
        onSuccess: () => {
          toast.success("Leg squared off successfully", { description: `Leg squared off at ${fmtPrice(ex, 1)}` });
          onOpenChange(false);
          onDone?.();
        },
        onError: (e) => toast.error("Could not square off", { description: e.message }),
      },
    );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]" data-testid="square-off">
        <DialogHeader>
          <DialogTitle>Square Off Position</DialogTitle>
          <DialogDescription>Close this {leg.kind === "future" ? "futures" : "option"} leg</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="rounded border border-border p-2 text-xs">
            <div className="micro mb-1">Position</div>
            <div className="grid grid-cols-2 gap-2">
              <div><span className="micro block">Leg</span><span className={cn("font-mono text-3xs font-bold uppercase", leg.side === "buy" ? "text-buy" : "text-sell")}>{leg.side}</span> <span className="uppercase">{leg.kind}</span>{leg.isAdjustment ? <span className="micro ml-1 rounded border border-border px-1">adj</span> : null}</div>
              <div><span className="micro block">{leg.kind === "future" ? "Symbol" : "Strike"}</span><span className="num">{leg.kind === "future" ? leg.symbol : fmtStrike(leg.strike)}</span></div>
              <div><span className="micro block">Quantity</span><span className="num">{leg.lots} <span className="text-muted-foreground">lots × {lotSize}</span></span></div>
              <div><span className="micro block">Entry premium</span><span className="num">{fmtPrice(entry, 1)}</span></div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="text-xs">
              <span className="micro block">Exit premium</span>
              <input type="number" step="0.1" min={0} value={exit} onChange={(e) => setExit(e.target.value)} placeholder="Enter exit premium" className="h-8 w-full rounded border border-input bg-transparent px-2 font-mono" aria-label="Exit premium" data-testid="sqoff-exit" />
              <span className="micro">Market {current === null ? "—" : fmtPrice(current, 1)} · or your desired exit price</span>
            </label>
            <label className="text-xs">
              <span className="micro block">Exit qty (max {leg.lots})</span>
              <input type="number" min={1} max={leg.lots} step={1} value={qty} onChange={(e) => setQty(e.target.value)} className="h-8 w-full rounded border border-input bg-transparent px-2 font-mono" aria-label="Exit quantity" data-testid="sqoff-qty" />
              <span className="micro">Less than {leg.lots} = partial exit</span>
            </label>
          </div>
          <div className="mt-3 rounded border border-border p-2 text-xs">
            <div className="micro mb-1">Realised P&amp;L</div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
              <dt className="text-muted-foreground">Entry value</dt><dd className="num text-right">{fmtMoney(entry * q * lot, money)}</dd>
              <dt className="text-muted-foreground">Exit value</dt><dd className="num text-right">{fmtMoney(ex * q * lot, money)}</dd>
              <dt className="font-medium">Net P&amp;L</dt><dd className={cn("num text-right font-medium", pnl >= 0 ? "text-profit" : "text-loss")} data-testid="sqoff-pnl">{fmtMoney(pnl, money, { signed: true })}</dd>
            </dl>
          </div>
          <p className="mt-2 text-2xs text-warning">This action cannot be undone. The position will be closed and P&amp;L will be realised.</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" loading={close.isPending} onClick={confirm} data-testid="sqoff-confirm">Confirm square off</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
