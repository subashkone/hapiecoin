"use client";
// Save as Draft / Enter Strategy Name (HC-TR-036): one input, Enter saves, Escape cancels, empty name refused.
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input } from "@hapiecoin/ui";
import { useEffect, useRef, useState } from "react";
import { emitTour } from "@/lib/tour";

export interface SaveDraftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName: string;
  /** Pre-filled when initialName is empty (ADR-059; HC-TR-155): read once as the dialog opens (fresh clock, current names), shown selected, replaced by typing over it, kept on Enter. */
  suggest?: (() => string) | undefined;
  /** "draft" saves only; "trade" saves then continues to the trading-mode step (Phase 3). */
  intent: "draft" | "trade";
  onSave: (name: string) => void;
}

export function SaveDraftDialog({ open, onOpenChange, initialName, suggest, intent, onSave }: SaveDraftDialogProps) {
  useEffect(() => {
    if (open) emitTour("save-dialog-open"); // the tour's "start a paper trade" step advances (HC-SH-071)
  }, [open]);
  const [name, setName] = useState(initialName);
  const [suggested, setSuggested] = useState("");
  const [error, setError] = useState<string | null>(null);
  // pristine: the box still holds the suggestion, selected, so typing replaces it; nothing resets while the trader edits
  const [pristine, setPristine] = useState(false);
  // the parents pass fresh closures every render: refs keep the open-edge effect keyed on `open` alone, so a
  // strategies refetch or the clock never rewrites what the trader is typing
  const initialRef = useRef(initialName);
  initialRef.current = initialName;
  const suggestRef = useRef(suggest);
  suggestRef.current = suggest;
  const boxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    const given = initialRef.current;
    const sg = given ? "" : (suggestRef.current?.() ?? "");
    setSuggested(sg);
    setName(given || sg);
    setPristine(!given && sg !== "");
    setError(null);
  }, [open]);
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
          <DialogDescription>{intent === "trade" ? "Name the strategy, then choose paper or live." : "Saved to your account: open it from Templates → My templates on any device."}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setPristine(false);
              setError(null);
            }}
            onFocus={(e) => {
              if (pristine) e.currentTarget.select();
            }}
            data-pristine={pristine ? "true" : undefined}
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
            ref={boxRef}
            data-testid="save-draft-name"
          />
          {error ? (
            <p className="mt-1.5 text-xs text-sell" data-testid="save-draft-error">
              {error}
            </p>
          ) : suggested ? (
            <p className="mt-1.5 text-2xs text-muted-foreground" data-testid="save-draft-hint">
              {pristine ? "Suggested from the legs and the time · type to replace it, or press Enter to keep it" : name.trim() === suggested ? "The suggested name" : <>Your name · <button type="button" className="underline hover:text-foreground" onClick={() => { setName(suggested); setPristine(true); requestAnimationFrame(() => boxRef.current?.focus()); }}>use the suggested {suggested}</button></>}
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
