"use client";
// Save as Draft / Enter Strategy Name (HC-TR-036): one input, Enter saves, Escape cancels, empty name refused.
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input } from "@hapiecoin/ui";
import { useEffect, useState } from "react";

export interface SaveDraftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName: string;
  /** "draft" saves only; "trade" saves then continues to the trading-mode step (Phase 3). */
  intent: "draft" | "trade";
  onSave: (name: string) => void;
}

export function SaveDraftDialog({ open, onOpenChange, initialName, intent, onSave }: SaveDraftDialogProps) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setName(initialName);
      setError(null);
    }
  }, [open, initialName]);
  const submit = () => {
    const v = name.trim();
    if (!v) {
      setError("Strategy name is required");
      return;
    }
    onSave(v);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]" data-testid="save-draft-dialog" data-tour="save-dialog">
        <DialogHeader>
          <DialogTitle>{intent === "trade" ? "Enter Strategy Name" : "Save as Draft"}</DialogTitle>
          <DialogDescription>{intent === "trade" ? "Name the strategy, then choose paper or live." : "Drafts stay on this device until strategies sync in Phase 3."}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Strategy name..."
            maxLength={80}
            aria-label="Strategy name"
            aria-invalid={error !== null}
            autoFocus
            data-testid="save-draft-name"
          />
          {error ? (
            <p className="mt-1.5 text-xs text-sell" data-testid="save-draft-error">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} data-testid="save-draft-confirm">
            {intent === "trade" ? "Save & Continue" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
