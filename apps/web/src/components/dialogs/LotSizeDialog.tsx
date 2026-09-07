"use client";
// Lot Size Settings (HC-SH-041, 042): "1 lot = [0.001] BTC" rows; values stay decimal strings.
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  toast,
} from "@hapiecoin/ui";
import { DECIMAL_STRING_RE, UNDERLYINGS, isPositiveDecimal, type Underlying } from "@hapiecoin/schema";
import { useEffect, useState } from "react";
import { useSettings, useUpdateSettings } from "@/lib/api/queries";
import type { DialogProps } from "./SettingsDialogs";

export function LotSizeDialog({ open, onOpenChange }: DialogProps) {
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  const [lots, setLots] = useState<Record<Underlying, string>>({ BTC: "", ETH: "", XAUT: "" });
  useEffect(() => {
    if (open && settings) setLots({ ...settings.lotSizes });
  }, [open, settings]);

  const save = () => {
    for (const s of UNDERLYINGS) {
      const v = (lots[s] ?? "").trim();
      if (!DECIMAL_STRING_RE.test(v) || !isPositiveDecimal(v)) {
        toast.error("Failed to save lot sizes", { description: `${s} lot size must be greater than 0` });
        return;
      }
    }
    update.mutate(
      { lotSizes: { BTC: lots.BTC.trim(), ETH: lots.ETH.trim(), XAUT: lots.XAUT.trim() } },
      {
        onSuccess: () => {
          toast("Lot sizes saved");
          onOpenChange(false);
        },
        onError: (e) => toast.error("Failed to save lot sizes", { description: e.message }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="lot-dialog">
        <DialogHeader>
          <DialogTitle>Lot Size Settings</DialogTitle>
          <DialogDescription>Lot size for each symbol</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {UNDERLYINGS.map((s) => (
            <div key={s} className="mb-3 flex items-center justify-between gap-3">
              <label htmlFor={`lot-${s}`} className="text-[12.5px] font-medium">
                {s} Lot Size
              </label>
              <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                <span>1 lot =</span>
                <Input id={`lot-${s}`} numeric size="sm" className="w-24" value={lots[s]} onChange={(e) => setLots({ ...lots, [s]: e.target.value })} data-testid={`lot-${s}`} />
                <span>{s}</span>
              </div>
            </div>
          ))}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={update.isPending} onClick={save} data-testid="lot-save">
            {update.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
