"use client";
// Renders whichever settings dialog the UI store says is open (HC-SH-026..049). Mounted once in the app
// shell so any header (analyse or default) can open them.
import { useUiStore } from "@/lib/store";
import { ApiSettingsDialog } from "./ApiSettingsDialog";
import { CurrencyDialog } from "./CurrencyDialog";
import { ExchangeManagementDialog } from "./ExchangeManagementDialog";
import { LogoutDialog } from "./LogoutDialog";
import { LotSizeDialog } from "./LotSizeDialog";
import { PnlDialog } from "./PnlDialog";
import { ProfileDialog } from "./ProfileDialog";

export function SettingsDialogs() {
  const dialog = useUiStore((s) => s.dialog);
  const close = useUiStore((s) => s.closeDialog);
  const onOpenChange = (open: boolean) => {
    if (!open) close();
  };
  return (
    <>
      <ProfileDialog open={dialog === "profile"} onOpenChange={onOpenChange} />
      <ApiSettingsDialog open={dialog === "api"} onOpenChange={onOpenChange} />
      <CurrencyDialog open={dialog === "currency"} onOpenChange={onOpenChange} />
      <LotSizeDialog open={dialog === "lot"} onOpenChange={onOpenChange} />
      <PnlDialog open={dialog === "pnl"} onOpenChange={onOpenChange} />
      <ExchangeManagementDialog open={dialog === "exchanges"} onOpenChange={onOpenChange} />
      <LogoutDialog open={dialog === "logout"} onOpenChange={onOpenChange} />
    </>
  );
}

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
