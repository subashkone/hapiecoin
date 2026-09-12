"use client";
// Renders whichever settings dialog the UI store says is open (HC-SH-026..049). Mounted once in the app
// shell so any header (analyse or default) can open them.
import { useUiStore } from "@/lib/store";
import { ApiSettingsDialog } from "./ApiSettingsDialog";
import { ColumnSettingsDialog } from "./ColumnSettingsDialog";
import { CurrencyDialog } from "./CurrencyDialog";
import { ExchangeManagementDialog } from "./ExchangeManagementDialog";
import { LogoutDialog } from "./LogoutDialog";
import { LotSizeDialog } from "./LotSizeDialog";
import { OptionDetailsDialog } from "./OptionDetailsDialog";
import { UpgradeRequiredDialog } from "./UpgradeRequiredDialog";
import { MindfulDialog } from "./MindfulDialog";
import { PnlDialog } from "./PnlDialog";
import { ProfileDialog } from "./ProfileDialog";
import { PublicPageDialog } from "./PublicPageDialog";
import { AlertsDialog } from "@/components/alerts/AlertsDialog";
import { ShortcutsDialog } from "./ShortcutsDialog";

export function SettingsDialogs() {
  const dialog = useUiStore((s) => s.dialog);
  const close = useUiStore((s) => s.closeDialog);
  const onOpenChange = (open: boolean) => {
    if (!open) close();
  };
  return (
    <>
      <ProfileDialog open={dialog === "profile"} onOpenChange={onOpenChange} />
      <PublicPageDialog open={dialog === "public"} onOpenChange={onOpenChange} />
      <ApiSettingsDialog open={dialog === "api"} onOpenChange={onOpenChange} />
      <CurrencyDialog open={dialog === "currency"} onOpenChange={onOpenChange} />
      <LotSizeDialog open={dialog === "lot"} onOpenChange={onOpenChange} />
      <PnlDialog open={dialog === "pnl"} onOpenChange={onOpenChange} />
      <MindfulDialog open={dialog === "mindful"} onOpenChange={onOpenChange} />
      <ExchangeManagementDialog open={dialog === "exchanges"} onOpenChange={onOpenChange} />
      <LogoutDialog open={dialog === "logout"} onOpenChange={onOpenChange} />
      <ColumnSettingsDialog open={dialog === "columns"} onOpenChange={onOpenChange} />
      <OptionDetailsDialog open={dialog === "option"} onOpenChange={onOpenChange} />
      <UpgradeRequiredDialog open={dialog === "upgrade"} onOpenChange={onOpenChange} />
      <AlertsDialog open={dialog === "alerts"} onOpenChange={onOpenChange} />
      <ShortcutsDialog open={dialog === "shortcuts"} onOpenChange={onOpenChange} />
    </>
  );
}

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
