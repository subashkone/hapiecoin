"use client";
// Confirm Adjustment Order · Live (HC-TR-088): the picked legs as real orders, with the venue's preview.
import type { LivePreview, Strategy } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, cn } from "@hapiecoin/ui";
import { fmtExpiry, fmtPrice, fmtStrike } from "@/lib/format";
import { fmtMoney, type MoneyFormat } from "@/lib/money";
import type { NewLegInput } from "@/lib/strategy/legs";
import { ModePill } from "./StrategyDetailsDialog";

export function ConfirmAdjustmentDialog({ open, onOpenChange, strategy, legs, lotSize, money, brokerName, preview, busy, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; strategy: Strategy; legs: NewLegInput[]; lotSize: string; money: MoneyFormat; brokerName: string; preview: LivePreview | null; busy: boolean; onConfirm: () => void }) {
  const lot = Number(lotSize);
  const np = legs.reduce((s, l) => s + (l.side === "sell" ? 1 : -1) * Number(l.price) * l.lots * lot, 0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px]" data-testid="confirm-adjustment">
        <DialogHeader>
          <DialogTitle>
            <span className="inline-flex items-center gap-2">Confirm Adjustment Order <ModePill status="live" /></span>
          </DialogTitle>
          <DialogDescription>{strategy.name} · {brokerName}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <table className="w-full text-xs">
            <thead>
              <tr className="micro text-left"><th className="py-1 pr-2">Side</th><th className="py-1 pr-2">Instrument</th><th className="py-1 pr-2 text-right">Lots</th><th className="py-1 pr-2 text-right">Est. price</th><th className="py-1 text-right">Value</th></tr>
            </thead>
            <tbody>
              {legs.map((l, i) => (
                <tr key={i} className="border-t border-border" data-testid="adj-row">
                  <td className={cn("py-1 pr-2 font-mono text-3xs font-bold uppercase", l.side === "buy" ? "text-buy" : "text-sell")}>{l.side}</td>
                  <td className="num py-1 pr-2">{l.kind === "future" ? `${l.asset}USD` : `${fmtStrike(l.strike)} ${l.kind === "call" ? "C" : "P"} · ${fmtExpiry(l.expiry)}`}</td>
                  <td className="num py-1 pr-2 text-right">{l.lots}</td>
                  <td className="num py-1 pr-2 text-right">{fmtPrice(l.price, 1)}</td>
                  <td className="num py-1 text-right">{fmtMoney(Number(l.price) * l.lots * lot, money)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-2xs">
            <dt className="text-muted-foreground">Net premium</dt>
            <dd className={cn("num", np >= 0 && "text-profit")}>{np >= 0 ? "Est. premium received " : "Est. cost "}{fmtMoney(Math.abs(np), money)}</dd>
            {preview ? (
              <>
                <dt className="text-muted-foreground">Exchange check</dt>
                <dd className={cn(preview.ok ? "text-profit" : "text-loss")} data-testid="adj-verdict">{preview.ok ? "ok · contracts sized, products live" : preview.reasons.join(" · ")}</dd>
                <dt className="text-muted-foreground">Available</dt>
                <dd className="num">{preview.available ? `${preview.available} ${preview.availableAsset ?? ""}` : "—"}</dd>
              </>
            ) : null}
          </dl>
          <div className="mt-3 rounded border border-loss/40 p-2 text-2xs">Orders will be placed on Delta Exchange at market with real funds. Prices may differ from the estimates.</div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" disabled={preview !== null && !preview.ok} loading={busy} onClick={onConfirm} data-testid="adj-confirm">Place {legs.length} {legs.length === 1 ? "order" : "orders"} →</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
