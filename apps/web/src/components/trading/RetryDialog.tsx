"use client";
// Retry refused entry orders (HC-TR-085; the typed word ADR-078 / HC-TR-186): the card's one-click retry becomes a
// small dialog that names the refused legs and asks for the word, because a retry sends real orders again.
import type { Strategy } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@hapiecoin/ui";
import { useEffect, useState } from "react";
import { fmtLeg } from "@/lib/strategy/paper";
import { TypedConfirm, isLiveConfirm } from "./TypedConfirm";

export function RetryDialog({ strategy, open, onOpenChange, busy, brokerName, onRetry }: { strategy: Strategy | null; open: boolean; onOpenChange: (o: boolean) => void; busy: boolean; brokerName: string; onRetry: (id: string, confirm: string) => void }) {
  const [word, setWord] = useState("");
  useEffect(() => {
    if (open) setWord("");
  }, [open]);
  const failed = strategy ? strategy.orders.filter((o) => o.state === "failed") : [];
  const legs = failed.map((o) => strategy?.legs.find((l) => l.id === o.legId)).filter((l): l is Strategy["legs"][number] => l !== undefined);
  const go = () => {
    if (strategy && isLiveConfirm(word) && !busy) onRetry(strategy.id, word);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="retry-dialog">
        <DialogHeader>
          <DialogTitle>Retry failed orders</DialogTitle>
          <DialogDescription>
            Re-send {failed.length} refused entry {failed.length === 1 ? "order" : "orders"} on {brokerName}. The exchange treats them as the same orders, so nothing is placed twice.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ul className="flex flex-col gap-1 text-xs" data-testid="retry-legs">
            {legs.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1" data-testid="retry-leg">
                <span className="num">{fmtLeg(l)}</span>
                <span className="micro text-loss">{failed.find((o) => o.legId === l.id)?.error ?? "refused"}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 rounded border border-loss/40 p-2 text-2xs" data-testid="retry-warning">
            <b className="text-loss">Real Money Trading</b>
            <div>The venue checks each order again; a refusal leaves the leg failed for another retry.</div>
          </div>
          <TypedConfirm value={word} onChange={setWord} onSubmit={go} disabled={busy} focusKey={open} verb="retry" />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="retry-cancel">
            Cancel
          </Button>
          <Button variant="destructive" disabled={!isLiveConfirm(word) || busy || !strategy} loading={busy} onClick={go} data-testid="retry-confirm">
            Retry {failed.length} {failed.length === 1 ? "order" : "orders"} →
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
