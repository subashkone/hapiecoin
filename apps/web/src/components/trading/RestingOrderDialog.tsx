"use client";
// A resting limit entry on the Live card (GAPS #61, ADR-083; HC-TR-187 cancel, HC-TR-188 re-price). Cancel pulls the
// order from the exchange and places nothing, so it asks for one plain click; re-price keeps a real order live at a
// new price, so it asks for the word like every entry. Both name the leg, the resting price and the current mark.
import type { Strategy, StrategyOrder } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input } from "@hapiecoin/ui";
import { useEffect, useState } from "react";
import { fmtLeg } from "@/lib/strategy/paper";
import { TypedConfirm, isLiveConfirm } from "./TypedConfirm";

export type RestingMode = "cancel" | "reprice";

export interface RestingOrderDialogProps {
  strategy: Strategy | null;
  order: StrategyOrder | null;
  mode: RestingMode;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  busy: boolean;
  brokerName: string;
  /** The leg's current mark (decimal string) or null when the feed has none. */
  mark: string | null;
  onCancel: (strategyId: string, orderId: string) => void;
  onReprice: (strategyId: string, orderId: string, limitPrice: string, confirm: string) => void;
}

/** A positive decimal with at most 8 decimals, as the API takes it. */
export function priceOk(value: string): boolean {
  return /^\d+(\.\d{1,8})?$/.test(value.trim()) && Number(value) > 0;
}

export function RestingOrderDialog({ strategy, order, mode, open, onOpenChange, busy, brokerName, mark, onCancel, onReprice }: RestingOrderDialogProps) {
  const [price, setPrice] = useState("");
  const [word, setWord] = useState("");
  useEffect(() => {
    if (open) {
      setPrice(order?.limitPrice ?? "");
      setWord("");
    }
  }, [open, order?.limitPrice]);
  const leg = strategy && order ? strategy.legs.find((l) => l.id === order.legId) : undefined;
  const ready = strategy !== null && order !== null && !busy;
  // a different number, not a different string: "1150" and "1150.0" are the same resting price
  const canReprice = ready && priceOk(price) && Number(price) !== Number(order?.limitPrice ?? "") && isLiveConfirm(word);
  const go = () => {
    if (!ready || !strategy || !order) return;
    if (mode === "cancel") onCancel(strategy.id, order.id);
    else if (canReprice) onReprice(strategy.id, order.id, price.trim(), word);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="resting-dialog" data-mode={mode}>
        <DialogHeader>
          <DialogTitle>{mode === "cancel" ? "Cancel resting order" : "Re-price resting order"}</DialogTitle>
          <DialogDescription>
            {mode === "cancel"
              ? `The order is pulled from ${brokerName}. Nothing is placed. The leg stays on the card, so you can retry it at the same price or re-price it later.`
              : `${brokerName} keeps the same order and moves its price. A price across the market fills at once; the exchange snaps it to the product's tick.`}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {leg && order ? (
            <div className="rounded border border-border px-2 py-1.5 text-xs" data-testid="resting-leg">
              <span className="num">{fmtLeg(leg)}</span>
              <span className="micro ml-2">
                resting @ {order.limitPrice ?? "?"} · mark {mark ?? "n/a"} · {order.size} {order.size === 1 ? "contract" : "contracts"}
              </span>
            </div>
          ) : null}
          {mode === "reprice" ? (
            <>
              <Field label="New limit price" className="mt-3">
                <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" autoComplete="off" className="num" data-testid="resting-price" aria-invalid={price !== "" && !priceOk(price) ? true : undefined} />
              </Field>
              <div className="mt-3 rounded border border-loss/40 p-2 text-2xs" data-testid="resting-warning">
                <b className="text-loss">Real Money Trading</b>
                <div>The order stays live at the new price and fills when the market reaches it.</div>
              </div>
              <TypedConfirm value={word} onChange={setWord} onSubmit={go} disabled={busy} focusKey={open} verb="re-price" />
            </>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="resting-dismiss">
            Keep it
          </Button>
          <Button variant="destructive" disabled={mode === "cancel" ? !ready : !canReprice} loading={busy} onClick={go} data-testid="resting-confirm">
            {mode === "cancel" ? "Cancel order" : "Move the price →"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
