"use client";
// Install HapieCoin (ADR-082; HC-SH-134): Chrome and Android get the native prompt from here; iPhone Safari has no
// prompt, so the dialog shows the two Share-sheet steps; an installed app and an unsupported browser each say so.
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Share, SquarePlus, toast } from "@hapiecoin/ui";
import { promptInstall, useInstallState } from "@/lib/pwa/install";
import { LogoMark } from "@/components/shell/Logo";
import type { DialogProps } from "./SettingsDialogs";

export function InstallDialog({ open, onOpenChange }: DialogProps) {
  const state = useInstallState();
  const install = async () => {
    const outcome = await promptInstall();
    if (outcome === "accepted") {
      toast.success("HapieCoin installed", { description: "Open it from your home screen." });
      onOpenChange(false);
    } else if (outcome === "unavailable") {
      toast("Install is not offered here", { description: "Open HapieCoin in Chrome or Safari on your phone." });
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]" data-testid="install-dialog" data-state-install={state}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogoMark className="size-5" /> Install HapieCoin
          </DialogTitle>
          <DialogDescription>A full-screen chain on your home screen. Prices and orders always come live; nothing is cached.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {state === "ios" ? (
            <ol className="space-y-3 text-sm" data-testid="install-ios-steps">
              <li className="flex items-start gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded border border-border font-mono text-xs" aria-hidden="true">1</span>
                <span>
                  Tap <Share className="inline size-4 align-text-bottom" aria-hidden="true" /> <b>Share</b> in the browser toolbar.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded border border-border font-mono text-xs" aria-hidden="true">2</span>
                <span>
                  Choose <SquarePlus className="inline size-4 align-text-bottom" aria-hidden="true" /> <b>Add to Home Screen</b>, then <b>Add</b>.
                </span>
              </li>
            </ol>
          ) : state === "installed" ? (
            <p className="text-sm text-muted-foreground" data-testid="install-installed">HapieCoin is already on your home screen.</p>
          ) : state === "ready" ? (
            <p className="text-sm text-muted-foreground">Your browser will ask once to confirm.</p>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="install-unsupported">This browser does not offer install. On a phone, open HapieCoin in Chrome (Android) or Safari (iPhone).</p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {state === "ready" ? (
            <Button onClick={() => void install()} data-testid="install-now">Install</Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
