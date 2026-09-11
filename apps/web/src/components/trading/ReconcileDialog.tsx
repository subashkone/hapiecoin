"use client";
// Reconcile (ADR-059 §2.2.3; HC-TR-161): the exchange no longer holds lots this strategy tracks (a stop, a manual
// close, a liquidation). Book those lots closed at the price the trader confirms; no order is sent. The reason is kept
// in the strategy's history (Details); the Journal shows the closed trade (close reasons arrive with roadmap item 3).
import { isNonNegativeDecimal, type Strategy, type StrategyLeg } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, toast } from "@hapiecoin/ui";
import { useEffect, useMemo, useState } from "react";
import { useReconcileStrategy } from "@/lib/api/strategies";
import { instrumentOf } from "@/lib/adjust/model";
import { type DriftRow, shortfallFor } from "@/lib/strategy/drift";
import { lotsWord } from "@/lib/strategy/overlap";

export interface ReconcileDialogProps {
  strategy: Strategy | null;
  rows: readonly DriftRow[];
  /** The price to book a leg at: the exchange's mark while it quotes the contract, else the pane's mark; null falls back to the entry. */
  markOf: (leg: StrategyLeg) => string | null;
  onOpenChange: (open: boolean) => void;
}

export function ReconcileDialog({ strategy, rows, markOf, onOpenChange }: ReconcileDialogProps) {
  const reconcile = useReconcileStrategy();
  // the legs whose lots are gone from the exchange, with the lots to book closed and a default price
  const items = useMemo(() => {
    if (!strategy) return [];
    return strategy.legs
      .filter((l) => l.status === "open")
      .map((l) => {
        const row = rows.find((r) => r.symbol === l.symbol);
        const lots = row ? shortfallFor(row, l) : 0;
        return { leg: l, row, lots, mark: markOf(l) ?? l.entryPrice ?? l.price };
      })
      .filter((x) => x.lots > 0);
  }, [strategy, rows, markOf]);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  // seed the prices and clear the reason once per strategy opened: the Live tab re-renders on every quote tick and
  // the positions poll, which would otherwise wipe what the trader is typing
  const openedFor = strategy?.id ?? null;
  useEffect(() => {
    if (openedFor === null) return;
    setPrices(Object.fromEntries(items.map((x) => [x.leg.id, x.mark])));
    setReason("");
    // items is read once here on purpose (see above)
  }, [openedFor]);
  // a leg that appears later (a refresh widened the drift) still gets a default price without touching typed ones
  useEffect(() => {
    setPrices((p) => {
      const missing = items.filter((x) => p[x.leg.id] === undefined);
      return missing.length ? { ...p, ...Object.fromEntries(missing.map((x) => [x.leg.id, x.mark])) } : p;
    });
  }, [items]);
  const held = rows.filter((r) => Math.abs(r.held) > Math.abs(r.expected));
  const shared = rows.filter((r) => r.strategies.length > 1);
  // the server takes the schema's non-negative decimal; anything else would only come back as a 400
  const priceOk = (v: string | undefined) => v !== undefined && isNonNegativeDecimal(v);
  const valid = items.length > 0 && items.every((x) => priceOk(prices[x.leg.id]));
  const confirm = () => {
    if (!strategy || !valid) return;
    reconcile.mutate(
      { id: strategy.id, body: { legs: items.map((x) => ({ legId: x.leg.id, ...(x.lots < x.leg.lots ? { lots: x.lots } : {}), price: prices[x.leg.id]! })), ...(reason.trim() ? { reason: reason.trim() } : {}) } },
      {
        onSuccess: (s) => {
          toast("Reconciled", { description: `${strategy.name} · ${items.length} ${items.length === 1 ? "leg" : "legs"} booked closed outside the app${s.status === "archived" ? " · strategy closed" : ""}` });
          onOpenChange(false);
        },
        onError: (e) => toast.error("Could not reconcile", { description: e.message }),
      },
    );
  };
  return (
    <Dialog open={strategy !== null} onOpenChange={(o) => !o && !reconcile.isPending && onOpenChange(false)}>
      <DialogContent className="sm:max-w-[560px] border-loss" data-testid="reconcile-dialog">
        <DialogHeader>
          <DialogTitle>Out of sync at the exchange</DialogTitle>
          <DialogDescription>{strategy?.name} · the exchange no longer holds lots this strategy tracks. Book them closed at the price they went for; nothing is sent to the exchange.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {items.length ? (
            <table className="w-full text-xs" data-testid="reconcile-rows">
              <thead>
                <tr className="micro text-left">
                  <th className="py-1 pr-2">Leg</th>
                  <th className="py-1 pr-2 text-right">Tracked</th>
                  <th className="py-1 pr-2 text-right">Exchange</th>
                  <th className="py-1 pr-2 text-right">Book closed</th>
                  <th className="py-1 text-right">At price</th>
                </tr>
              </thead>
              <tbody>
                {items.map((x) => (
                  <tr key={x.leg.id} className="border-t border-border" data-testid="reconcile-row" data-leg-id={x.leg.id} data-lots={x.lots}>
                    <td className="num py-1 pr-2"><span className={x.leg.side === "buy" ? "text-buy" : "text-sell"}>{x.leg.side.toUpperCase()}</span> {instrumentOf(x.leg)}</td>
                    <td className="num py-1 pr-2 text-right">{x.row ? lotsWord(x.row.expected) : "—"}</td>
                    <td className="num py-1 pr-2 text-right text-loss">{x.row ? lotsWord(x.row.held) : "—"}</td>
                    <td className="num py-1 pr-2 text-right">{x.lots} of {x.leg.lots}</td>
                    <td className="py-1 text-right">
                      <input type="number" min={0} step="0.1" value={prices[x.leg.id] ?? ""} onChange={(e) => setPrices((p) => ({ ...p, [x.leg.id]: e.target.value }))} className="h-6 w-24 rounded border border-input bg-background px-1.5 text-right text-xs" aria-label={`Exit price for ${instrumentOf(x.leg)}`} data-testid="reconcile-price" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-xs text-muted-foreground" data-testid="reconcile-empty">Nothing to book: the exchange holds at least what this strategy tracks on every contract. If it holds more, the extra lots were opened outside the app.</p>
          )}
          {held.length ? <p className="mt-2 text-2xs text-muted-foreground">On {held.map((r) => r.symbol).join(", ")} the exchange holds more than the strategies track; nothing is booked for that.</p> : null}
          {shared.length ? <p className="mt-2 text-2xs text-warning" data-testid="reconcile-shared">{shared.map((r) => r.symbol).join(", ")}: shared with {shared.some((r) => r.strategies.length > 2) ? "other strategies" : "another strategy"}. The exchange cannot say whose lots went; book only what this strategy lost, then reconcile the other from its own card.</p> : null}
          <label className="mt-3 block text-2xs">
            <span className="micro">Why (kept in the history)</span>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. stop loss hit on the exchange" maxLength={200} className="mt-1 h-7 w-full rounded border border-input bg-background px-2 text-xs" data-testid="reconcile-reason" />
          </label>
          <p className="mt-2 text-2xs text-muted-foreground">Default price: the exchange's current mark for the contract, else the leg's entry. Realised P&amp;L is booked at the price you confirm.</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={reconcile.isPending}>Cancel</Button>
          <Button variant="destructive" onClick={confirm} disabled={!valid} loading={reconcile.isPending} data-testid="reconcile-confirm">
            Book {items.length ? `${items.length} ${items.length === 1 ? "leg" : "legs"} ` : ""}closed · no orders
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** For the card badge: "exchange holds 0 · 1,000 sold expected across 2 strategies". */
export function driftTitle(rows: readonly DriftRow[]): string {
  return rows.map((r) => `${r.symbol}: exchange holds ${lotsWord(r.held)} · ${lotsWord(r.expected)} expected${r.strategies.length > 1 ? ` across ${r.strategies.length} strategies` : ""}`).join(" · ");
}
