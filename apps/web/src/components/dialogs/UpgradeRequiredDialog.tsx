"use client";
// Upgrade Required (HC-SH-054): the API refused with 403 UPGRADE_REQUIRED and said why; "Subscribe Here →" goes to
// the subscription page, Dismiss closes. Opened through the store by `openUpgrade(message)` (ADR-030).
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@hapiecoin/ui";
import Link from "next/link";
import { useUiStore } from "@/lib/store";
import type { DialogProps } from "./SettingsDialogs";

export function UpgradeRequiredDialog({ open, onOpenChange }: DialogProps) {
  const message = useUiStore((s) => s.upgradeMessage);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]" data-testid="upgrade-required">
        <DialogHeader>
          <DialogTitle>Upgrade Required</DialogTitle>
          <DialogDescription>Your current plan does not cover this.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm" data-testid="upgrade-message">
            {message}
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="upgrade-dismiss">
            Dismiss
          </Button>
          <Button asChild data-testid="upgrade-subscribe">
            <Link href="/subscription" onClick={() => onOpenChange(false)}>
              Subscribe Here →
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
