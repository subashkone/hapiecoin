"use client";
// "Leave the workbench?" (ADR-058 addendum): the store parks any action that would throw away the working change or
// the saved plans (Exit, another card, Back to Builder, a tab or palette command) in adjustDiscard; this dialog asks
// the question and runs the parked action on Discard. It is mounted with the Workspace overlays so it shows even when
// the stacked layout has the workbench itself unmounted.
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@hapiecoin/ui";
import { useAdjustWorkbench } from "@/lib/adjust/useAdjustWorkbench";
import { useUiStore } from "@/lib/store";

export function AdjustDiscardDialog() {
  const discard = useUiStore((s) => s.adjustDiscard);
  // the counts need the workbench hook (marks, pricing, a 1 s clock): only pay for it while the question is open
  return discard ? <DiscardQuestion discard={discard} /> : null;
}

function DiscardQuestion({ discard }: { discard: () => void }) {
  const keepAdjust = useUiStore((s) => s.keepAdjust);
  const w = useAdjustWorkbench();
  const orders = w?.effects.length ?? 0;
  const plans = w?.draft.plans.length ?? 0;
  const parts = [orders ? `${orders} ${orders === 1 ? "order" : "orders"} in this change` : "", plans ? `${plans} saved ${plans === 1 ? "plan" : "plans"}` : ""].filter(Boolean);
  return (
    <Dialog open onOpenChange={(o) => !o && keepAdjust()}>
      <DialogContent className="sm:max-w-[420px]" data-testid="adjust-exit-confirm">
        <DialogHeader>
          <DialogTitle>Leave the workbench?</DialogTitle>
          <DialogDescription>{parts.length ? `${parts.join(" and ")} will be discarded.` : "This change will be discarded."} Nothing has been sent to the venue.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={keepAdjust} data-testid="adjust-exit-keep">Keep editing</Button>
          <Button variant="destructive" onClick={discard} data-testid="adjust-exit-discard">Discard and leave</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
