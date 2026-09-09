"use client";
// Select Option from Chain (HC-TR-015, 027, 028, 031..034): a compact live chain with B / S multi-select per
// side, a selected list with lots, and "Add N legs" into the Builder within the remaining slots.
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, cn, toast } from "@hapiecoin/ui";
import { useEffect, useState } from "react";
import { fmtExpiry, fmtPrice, fmtStrike } from "@/lib/format";
import { useUiStore } from "@/lib/store";
import { type LegKind, type LegSide, MAX_ACTIVE_LEGS, type NewLegInput } from "@/lib/strategy/legs";
import type { Underlying } from "@hapiecoin/schema";
import { ChainPickerBody, type PickerRow, usePickerChain } from "./ChainPickerBody";

interface Pick {
  key: string;
  kind: LegKind;
  side: LegSide;
  strike: string;
  expiry: string;
  price: string;
  iv: number | undefined;
  lots: number;
}

export interface ChainPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  remaining: number;
  /** Override the workspace asset / expiry (adjustments on an active strategy). */
  asset?: Underlying | undefined;
  expiry?: string | null | undefined;
  /** When set, the picks go here instead of the Builder legs. */
  onAdd?: ((legs: NewLegInput[]) => void) | undefined;
  title?: string | undefined;
}

export function ChainPickerDialog({ open, onOpenChange, remaining, asset: assetOverride, expiry: expiryOverride, onAdd, title }: ChainPickerProps) {
  const storeAsset = useUiStore((s) => s.asset);
  const asset = assetOverride ?? storeAsset;
  const storeExpiry = useUiStore((s) => s.expiry[asset] ?? null);
  const workspaceExpiry = expiryOverride ?? storeExpiry;
  const chainLots = useUiStore((s) => s.chainLots);
  const addLeg = useUiStore((s) => s.addLeg);
  const chain = usePickerChain(asset, open, workspaceExpiry);
  const { expiry } = chain;
  const [picks, setPicks] = useState<Pick[]>([]);
  useEffect(() => {
    if (!open) setPicks([]);
  }, [open]);

  const toggle = (kind: LegKind, side: LegSide, row: PickerRow) => {
    if (!expiry) return;
    const q = kind === "call" ? row.call : row.put;
    if (!q) return;
    const key = `${expiry}:${row.strike}:${kind}:${side}`;
    setPicks((ps) => {
      const without = ps.filter((p) => !(p.strike === row.strike && p.kind === kind && p.expiry === expiry));
      const existed = ps.some((p) => p.key === key);
      if (existed) return without;
      if (without.length >= remaining) {
        toast.error("Limit reached", { description: `${remaining} more ${remaining === 1 ? "leg" : "legs"} can be added` });
        return ps;
      }
      return [...without, { key, kind, side, strike: row.strike, expiry, price: q.mark, iv: q.markIv, lots: chainLots }];
    });
  };
  const add = () => {
    if (onAdd) {
      onAdd(picks.map((p) => ({ asset, kind: p.kind, side: p.side, strike: p.strike, expiry: p.expiry, lots: p.lots, price: p.price, iv: p.iv })));
      onOpenChange(false);
      return;
    }
    let added = 0;
    for (const p of picks) {
      const r = addLeg({ asset, kind: p.kind, side: p.side, strike: p.strike, expiry: p.expiry, lots: p.lots, price: p.price, iv: p.iv });
      if (r.ok) added += 1;
      else {
        toast.error("Limit reached", { description: `Maximum ${MAX_ACTIVE_LEGS} active legs per strategy` });
        break;
      }
    }
    if (added) toast(`${added} ${added === 1 ? "leg" : "legs"} added`);
    onOpenChange(false);
  };
  const pickOf = (strike: string, kind: LegKind) => picks.find((p) => p.strike === strike && p.kind === kind && p.expiry === expiry);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[820px]" data-testid="chain-picker">
        <DialogHeader>
          <DialogTitle>{title ?? "Select Option from Chain"}</DialogTitle>
          <DialogDescription>
            {asset} • Spot {fmtPrice(chain.spot?.price)} · <span className="micro rounded border border-border px-1">Maximum {remaining} more {remaining === 1 ? "leg" : "legs"}</span>
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ChainPickerBody asset={asset} expiries={chain.expiries} expiry={expiry} onExpiry={chain.setExpiry} rows={chain.rows} atm={chain.atm} stateOf={(strike, kind) => ({ picked: pickOf(strike, kind)?.side })} onToggle={toggle} />
          {picks.length ? (
            <div className="mt-2 flex flex-col gap-1" data-testid="picker-selected">
              {picks.map((p) => (
                <div key={p.key} className="flex items-center gap-2 rounded border border-border px-2 py-1 text-xs">
                  <span className={cn("font-mono text-3xs font-bold uppercase", p.side === "buy" ? "text-buy" : "text-sell")}>{p.side}</span>
                  <span className="font-mono text-3xs uppercase text-muted-foreground">{p.kind}</span>
                  <span className="num font-medium">{fmtStrike(p.strike)}</span>
                  <span className="text-muted-foreground">{fmtExpiry(p.expiry)}</span>
                  <span className="num ml-auto">{fmtPrice(p.price, 1)}</span>
                  <label className="flex items-center gap-1 text-muted-foreground">
                    Qty
                    <input type="number" min={1} step={1} value={p.lots} onChange={(e) => setPicks((ps) => ps.map((x) => (x.key === p.key ? { ...x, lots: Math.max(1, Math.round(Number(e.target.value) || 1)) } : x)))} className="w-14 rounded border border-input bg-transparent px-1 text-right" aria-label="Lots" data-testid="picker-qty" />
                    <span className="micro">lots</span>
                  </label>
                  <button type="button" onClick={() => setPicks((ps) => ps.filter((x) => x.key !== p.key))} aria-label="Remove" className="text-muted-foreground hover:text-loss">
                    ✕
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => setPicks([])} className="self-end text-xs text-muted-foreground hover:text-foreground" data-testid="picker-clear">
                Clear
              </button>
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter className="items-center">
          <span className="mr-auto text-2xs text-muted-foreground">B selects a buy leg, S a sell leg; click again to deselect.</span>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={add} disabled={picks.length === 0} data-testid="picker-add">
            Add {picks.length || ""} {picks.length === 1 ? "Leg" : "Legs"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
