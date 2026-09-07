"use client";
// Currency Settings (HC-SH-038..040): USD → INR rate, display currency tabs, live note, Save / Cancel.
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Tabs,
  TabsList,
  TabsTrigger,
  toast,
} from "@hapiecoin/ui";
import { DECIMAL_STRING_RE, isPositiveDecimal, type Currency } from "@hapiecoin/schema";
import { useEffect, useState } from "react";
import { useSettings, useUpdateSettings } from "@/lib/api/queries";
import type { DialogProps } from "./SettingsDialogs";

export function currencyNote(currency: Currency, rate: string): string {
  const name = currency === "INR" ? "Indian Rupees (₹)" : "US Dollars ($)";
  return `All calculated values (P&L, Margin, Net Premium) will be displayed in ${name} · Rate: $1 = ₹${rate || "0"}`;
}

export function CurrencyDialog({ open, onOpenChange }: DialogProps) {
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  const [rate, setRate] = useState("");
  const [currency, setCurrency] = useState<Currency>("USD");
  useEffect(() => {
    if (open && settings) {
      setRate(settings.conversionRate);
      setCurrency(settings.currency);
    }
  }, [open, settings]);

  const save = () => {
    const r = rate.trim();
    if (!DECIMAL_STRING_RE.test(r) || !isPositiveDecimal(r)) {
      toast.error("Error", { description: "Conversion rate must be greater than 0" });
      return;
    }
    update.mutate(
      { conversionRate: r, currency },
      {
        onSuccess: () => {
          toast("Currency conversion saved", { description: `Rate: $1 = ₹${r}` });
          onOpenChange(false);
        },
        onError: (e) => toast.error("Could not save", { description: e.message }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="currency-dialog">
        <DialogHeader>
          <DialogTitle>Currency Settings</DialogTitle>
          <DialogDescription>Set the USD to INR conversion rate used for all calculated values.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From Currency">
              <Input value="USD" readOnly disabled />
            </Field>
            <Field label="To Currency">
              <Input value="INR" readOnly disabled />
            </Field>
          </div>
          <Field label="USD to INR Conversion Rate">
            <Input numeric value={rate} onChange={(e) => setRate(e.target.value)} data-testid="conversion-rate" />
          </Field>
          <div className="mb-3">
            <div className="micro mb-1.5">Display currency</div>
            <Tabs variant="segmented" value={currency} onValueChange={(v) => setCurrency(v as Currency)}>
              <TabsList aria-label="Display currency">
                <TabsTrigger value="USD" data-testid="currency-USD">$ USD</TabsTrigger>
                <TabsTrigger value="INR" data-testid="currency-INR">₹ INR</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="rounded-md border border-info/30 bg-info-bg px-3 py-2 text-xs text-info" data-testid="currency-note">
            {currencyNote(currency, rate.trim())}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={update.isPending} onClick={save} data-testid="currency-save">
            {update.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
