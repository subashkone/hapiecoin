"use client";
// Confirm Logout (HC-SH-026).
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from "@hapiecoin/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth/client";
import { clearServerCache } from "@/lib/api/queries";
import type { DialogProps } from "./SettingsDialogs";

export function LogoutDialog({ open, onOpenChange }: DialogProps) {
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const router = useRouter();
  const confirm = async () => {
    setBusy(true);
    await authClient.signOut();
    clearServerCache(qc);
    setBusy(false);
    onOpenChange(false);
    toast("Logged out", { description: "You have been signed out." });
    router.replace("/");
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="logout-dialog">
        <DialogHeader>
          <DialogTitle>Confirm Logout</DialogTitle>
          <DialogDescription>
            Are you sure you want to sign out? You&apos;ll need to sign in again to access your account.
          </DialogDescription>
        </DialogHeader>
        <DialogBody />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" loading={busy} onClick={() => void confirm()} data-testid="logout-confirm">
            Logout
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
