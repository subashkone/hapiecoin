"use client";
// Mindful trading (roadmap item 10, ADR-074; HC-TR-183): on / off, the loss that starts the pause, the pause length.
// Reached from the settings menu, the palette and the bar's Day P&L tile. Design: docs/design/mindful-pause.md.
import { DECIMAL_STRING_RE, MINDFUL_PAUSE_MAX_S, MINDFUL_PAUSE_MIN_S, type MindfulSettings } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, Switch, toast } from "@hapiecoin/ui";
import { useEffect, useState } from "react";
import { queryKeys, useMe, useSettings, useUpdateSettings } from "@/lib/api/queries";
import { useQueryClient } from "@tanstack/react-query";
import { isSecondFactorError } from "@/lib/api/second-factor";
import { SECOND_FACTOR_MISSING_MESSAGE, SecondFactorField, secondFactorMissing } from "./SecondFactorField";
import { DAY_BASIS } from "@/lib/strategy/mindful";
import type { DialogProps } from "./SettingsDialogs";

/** The form's reading of the fields, or the message to show. */
export function readMindful(enabled: boolean, threshold: string, seconds: string): { ok: true; value: MindfulSettings } | { ok: false; error: string } {
  const t = threshold.trim();
  if (!DECIMAL_STRING_RE.test(t) || Number(t) < 0) return { ok: false, error: "Threshold must be 0 or a positive amount in USD" };
  const s = Number(seconds.trim());
  if (!Number.isInteger(s) || s < MINDFUL_PAUSE_MIN_S || s > MINDFUL_PAUSE_MAX_S) return { ok: false, error: `Pause must be a whole number of seconds from ${MINDFUL_PAUSE_MIN_S} to ${MINDFUL_PAUSE_MAX_S}` };
  return { ok: true, value: { enabled, thresholdUsd: t, pauseSeconds: s } };
}

export function MindfulDialog({ open, onOpenChange }: DialogProps) {
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  // ADR-086: the pause is a safety knob; an account with the authenticator on confirms a change with its code
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
  const [enabled, setEnabled] = useState(true);
  const [threshold, setThreshold] = useState("0");
  const [seconds, setSeconds] = useState("30");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open && settings) {
      setEnabled(settings.mindful.enabled);
      setThreshold(settings.mindful.thresholdUsd);
      setSeconds(String(settings.mindful.pauseSeconds));
      setError(null);
    }
  }, [open, settings]);

  const save = () => {
    const r = readMindful(enabled, threshold, seconds);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    if (!settings) return;
    // the server asks for the code only when the pause changes; the same values save without one
    const changed = settings.mindful.enabled !== r.value.enabled || settings.mindful.thresholdUsd !== r.value.thresholdUsd || settings.mindful.pauseSeconds !== r.value.pauseSeconds;
    if (changed && secondFactorMissing(needsCode, code)) {
      setCodeError(SECOND_FACTOR_MISSING_MESSAGE);
      return;
    }
    // the route replaces the whole settings object (GAPS #45)
    update.mutate(
      { ...settings, mindful: r.value, ...(changed && needsCode ? { secondFactor: code } : {}) },
      {
        onSuccess: () => {
          toast("Mindful trading saved", { description: r.value.enabled ? `Pause of ${r.value.pauseSeconds} s once today's live P&L is below ${Number(r.value.thresholdUsd) > 0 ? `−$${r.value.thresholdUsd}` : "zero"}` : "The pause is off" });
          setCode("");
          onOpenChange(false);
        },
        onError: (e) => {
          if (isSecondFactorError(e) && needsCode) setCodeError(e.message);
          else {
            toast.error("Could not save", { description: e.message });
            if (isSecondFactorError(e)) void qc.invalidateQueries({ queryKey: queryKeys.me }); // 2FA turned on elsewhere: the field appears on the next render
          }
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="mindful-dialog">
        <DialogHeader>
          <DialogTitle>Mindful trading</DialogTitle>
          <DialogDescription>A pause before a live order on a day you are already down, with the day's loss and the order's worst case in front of you.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <label className="flex items-center justify-between gap-3 text-xs">
            <span>Pause before a live order when I am down on the day</span>
            <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Mindful pause" data-testid="mindful-enabled" />
          </label>
          {!enabled ? (
            <p className="mt-2 text-2xs text-warning" data-testid="mindful-off-note">
              The pause is there for the day you most want to skip it.
            </p>
          ) : null}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Start the pause below" hint="0 = any loss · USD">
              <Input numeric size="sm" value={threshold} disabled={!enabled} onChange={(e) => setThreshold(e.target.value)} data-testid="mindful-threshold" />
            </Field>
            <Field label="Pause" hint={`${MINDFUL_PAUSE_MIN_S}–${MINDFUL_PAUSE_MAX_S} seconds`}>
              <Input numeric size="sm" value={seconds} disabled={!enabled} onChange={(e) => setSeconds(e.target.value)} data-testid="mindful-seconds" />
            </Field>
          </div>
          {error ? (
            <p className="mt-2 text-2xs text-loss" role="alert" data-testid="mindful-error">
              {error}
            </p>
          ) : null}
          <p className="mt-3 text-2xs text-muted-foreground">Counts live strategies only, today {DAY_BASIS}, trades closed today included. Paper trades, adjustments and exits are never paused; the pause is yours, not the exchange's.</p>
          {needsCode ? <SecondFactorField value={code} onChange={(v) => { setCode(v); setCodeError(null); }} error={codeError} what="a change to the pause" /> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} loading={update.isPending} data-testid="mindful-save">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
