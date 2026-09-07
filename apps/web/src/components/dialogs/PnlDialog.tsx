"use client";
// P&L Settings (HC-SH-043, 044): radio group for the price basis plus the mark-vs-bid/ask note.
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  cn,
  toast,
} from "@hapiecoin/ui";
import type { PnlBasis } from "@hapiecoin/schema";
import { useEffect, useState } from "react";
import { useSettings, useUpdateSettings } from "@/lib/api/queries";
import type { DialogProps } from "./SettingsDialogs";

const OPTIONS: { value: PnlBasis; title: string; desc: string }[] = [
  { value: "mark", title: "Mark price", desc: "P&L at the exchange mark price — the same basis Delta Exchange shows." },
  {
    value: "bid_ask",
    title: "Bid/Ask (executable)",
    desc: "P&L at the price you would actually get closing now: long legs at the bid, short legs at the ask.",
  },
];

export function PnlDialog({ open, onOpenChange }: DialogProps) {
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  const [basis, setBasis] = useState<PnlBasis>("mark");
  useEffect(() => {
    if (open && settings) setBasis(settings.pnlBasis);
  }, [open, settings]);

  const save = () =>
    update.mutate(
      { pnlBasis: basis },
      {
        onSuccess: () => {
          toast("P&L settings saved", { description: basis === "mark" ? "P&L basis: Mark price" : "P&L basis: Bid/Ask (executable)" });
          onOpenChange(false);
        },
        onError: (e) => toast.error("Could not save", { description: e.message }),
      },
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="pnl-dialog">
        <DialogHeader>
          <DialogTitle>P&amp;L Settings</DialogTitle>
          <DialogDescription>Choose the price basis for the P&amp;L shown on paper and live trades.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div role="radiogroup" aria-label="P&L price basis" className="flex flex-col gap-2">
            {OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={basis === o.value}
                data-testid={`pnl-${o.value}`}
                onClick={() => setBasis(o.value)}
                className={cn(
                  "flex items-start gap-3 rounded-md border p-3 text-left",
                  basis === o.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
                )}
              >
                <i
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 size-3.5 shrink-0 rounded-full border-2",
                    basis === o.value ? "border-primary bg-primary" : "border-muted-foreground",
                  )}
                />
                <span>
                  <b className="block text-[13px]">{o.title}</b>
                  <span className="text-xs text-muted-foreground">{o.desc}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="mt-3 rounded-md border border-info/30 bg-info-bg px-3 py-2 text-xs text-info">
            Delta Exchange shows P&amp;L at the mark price. With Bid/Ask, HapieCoin shows the P&amp;L you would realise by
            closing now, so the two figures <b>will differ</b> — usually by the bid/ask spread, and more on illiquid
            strikes.
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={update.isPending} onClick={save} data-testid="pnl-save">
            {update.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
