"use client";
// The typed LIVE confirmation (roadmap item 28, ADR-078; HC-TR-186): one field under the red block of every live entry
// dialog; the destructive button stays disabled, not hidden, until the word is in. The API refuses a live entry without
// it too (`requireLiveConfirm`), so the field is the visible half of a server-side interlock, not a ritual.
import { LIVE_CONFIRM_WORD, isLiveConfirm } from "@hapiecoin/schema";
import { Input } from "@hapiecoin/ui";
import { useEffect, useRef } from "react";

export { isLiveConfirm };

export interface TypedConfirmProps {
  value: string;
  onChange: (value: string) => void;
  /** Enter with the word typed. */
  onSubmit?: (() => void) | undefined;
  disabled?: boolean | undefined;
  /** Moves focus into the field when it turns true (a dialog opening, a pause ending). */
  focusKey?: string | number | boolean | undefined;
  /** "place" (default), "retry", "adjust": the verb in the label. */
  verb?: string | undefined;
}

export function TypedConfirm({ value, onChange, onSubmit, disabled, focusKey, verb = "place" }: TypedConfirmProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusKey) ref.current?.focus();
  }, [focusKey]);
  const ok = isLiveConfirm(value);
  return (
    <label className="mt-3 flex flex-wrap items-center gap-2 text-2xs text-muted-foreground" data-testid="live-confirm-field" data-ok={ok}>
      <span>
        Type <b className="font-mono text-foreground">{LIVE_CONFIRM_WORD}</b> to {verb}
      </span>
      <Input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        onKeyDown={(e) => {
          if (e.key === "Enter" && ok && onSubmit) {
            e.preventDefault();
            onSubmit();
          }
        }}
        disabled={disabled}
        maxLength={8}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder={LIVE_CONFIRM_WORD}
        aria-label={`Type ${LIVE_CONFIRM_WORD} to confirm a real order`}
        className="h-7 w-24 font-mono text-xs uppercase tracking-[0.15em]"
        data-testid="live-confirm"
      />
      <span className="micro">real orders on the exchange · HapieCoin will not send one without this word</span>
    </label>
  );
}
