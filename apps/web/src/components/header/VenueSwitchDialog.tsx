"use client";
// "Switch venue?" (ADR-069): the store parks a venue switch in `venueSwitch` whenever Builder legs exist (the header
// chip, Adjust on another venue's card, Load in Builder, a share link); this dialog asks and runs the parked action.
// Mounted with the Workspace overlays, like the workbench discard question.
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@hapiecoin/ui";
import { getVenueCore } from "@hapiecoin/venues/core";
import { useUiStore } from "@/lib/store";

export function VenueSwitchDialog() {
  const pending = useUiStore((s) => s.venueSwitch);
  const venue = useUiStore((s) => s.venue);
  const confirm = useUiStore((s) => s.confirmVenueSwitch);
  const cancel = useUiStore((s) => s.cancelVenueSwitch);
  if (!pending) return null;
  const from = getVenueCore(venue).label;
  const to = getVenueCore(pending.venue).label;
  return (
    <Dialog open onOpenChange={(o) => !o && cancel()}>
      <DialogContent className="sm:max-w-[420px]" data-testid="venue-switch-confirm">
        <DialogHeader>
          <DialogTitle>Switch to {to}?</DialogTitle>
          <DialogDescription>The Builder legs on {from} will be cleared. Saved strategies, paper and live positions are not affected.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={cancel} data-testid="venue-switch-keep">Keep {from}</Button>
          <Button variant="destructive" onClick={confirm} data-testid="venue-switch-go">Switch and clear</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
