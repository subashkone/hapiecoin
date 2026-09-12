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
import { queryKeys, useMe, useSettings, useUpdateSettings } from "@/lib/api/queries";
import { useQueryClient } from "@tanstack/react-query";
import { isSecondFactorError } from "@/lib/api/second-factor";
import { SECOND_FACTOR_MISSING_MESSAGE, SecondFactorField, secondFactorMissing } from "./SecondFactorField";
import type { DialogProps } from "./SettingsDialogs";

export function LotSizeDialog({ open, onOpenChange }: DialogProps) {
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  const [lots, setLots] = useState<Record<Underlying, string>>({ BTC: "", ETH: "", XAUT: "" });
  // ADR-086: the lot size is the size of every order; an account with the authenticator on confirms a change with its code
  const { data: me } = useMe();
  const qc = useQueryClient();
  const needsCode = me?.twoFactorEnabled === true;
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setCode("");
      setCodeError(null);
    }
  }, [open]);
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
    const next = { BTC: lots.BTC.trim(), ETH: lots.ETH.trim(), XAUT: lots.XAUT.trim() };
    // the server asks for the code only when a lot size changes; the same values save without one
    const changed = !settings || UNDERLYINGS.some((s) => settings.lotSizes[s] !== next[s]);
    if (changed && secondFactorMissing(needsCode, code)) {
      setCodeError(SECOND_FACTOR_MISSING_MESSAGE);
      return;
    }
    update.mutate(
      { lotSizes: next, ...(changed && needsCode ? { secondFactor: code } : {}) },
      {
        onSuccess: () => {
          toast("Lot sizes saved");
          setCode("");
          onOpenChange(false);
        },
        onError: (e) => {
          if (isSecondFactorError(e) && needsCode) setCodeError(e.message);
          else {
            toast.error("Failed to save lot sizes", { description: e.message });
            if (isSecondFactorError(e)) void qc.invalidateQueries({ queryKey: queryKeys.me }); // 2FA turned on elsewhere: the field appears on the next render
          }
        },
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
          {needsCode ? <SecondFactorField value={code} onChange={(v) => { setCode(v); setCodeError(null); }} error={codeError} what="a lot size change" /> : null}
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
