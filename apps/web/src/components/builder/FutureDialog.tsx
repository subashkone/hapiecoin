"use client";
// Add Futures Contract (HC-TR-016, HC-TR-035): the asset's perpetual at the live spot, side and lots.
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, cn, toast } from "@hapiecoin/ui";
import { useState } from "react";
import { fmtPrice } from "@/lib/format";
import { useSpot } from "@/lib/gateway/hooks";
import { ASSET_META, useUiStore } from "@/lib/store";
import { LOT_PRESETS, type LegSide, MAX_ACTIVE_LEGS } from "@/lib/strategy/legs";

export function FutureDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const asset = useUiStore((s) => s.asset);
  const chainLots = useUiStore((s) => s.chainLots);
  const addLeg = useUiStore((s) => s.addLeg);
  const spot = useSpot(asset);
  const [side, setSide] = useState<LegSide>("buy");
  const [lots, setLots] = useState<number>(chainLots);
  const price = spot?.price;
  const add = () => {
    if (!price) return;
    const r = addLeg({ asset, kind: "future", side, strike: "", expiry: "PERP", lots, price, iv: undefined });
    if (r.ok) {
      toast("Leg added", { description: `${side.toUpperCase()} ${lots} × ${r.leg.symbol} @ ${fmtPrice(price)}` });
      onOpenChange(false);
    } else toast.error("Limit reached", { description: `Maximum ${MAX_ACTIVE_LEGS} active legs per strategy` });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]" data-testid="future-dialog">
        <DialogHeader>
          <DialogTitle>Add Futures Contract</DialogTitle>
          <DialogDescription>
            USD Future · {ASSET_META[asset].symbol} · Spot {fmtPrice(price)}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex items-center gap-2">
            {(["buy", "sell"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSide(s)}
                aria-pressed={side === s}
                className={cn("rounded border px-3 py-1 text-xs font-bold uppercase", s === "buy" ? "border-buy text-buy" : "border-sell text-sell", side === s && (s === "buy" ? "bg-buy text-white" : "bg-sell text-white"))}
                data-testid={`future-${s}`}
              >
                {s}
              </button>
            ))}
            <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              Lots
              <select className="h-8 rounded border border-input bg-background px-2 font-mono text-xs text-foreground" value={lots} onChange={(e) => setLots(Number(e.target.value))} aria-label="Lots" data-testid="future-lots">
                {LOT_PRESETS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">The perpetual is priced at the live spot; the leg follows the feed in live mode.</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={add} disabled={!price} data-testid="future-add">
            Add leg
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
