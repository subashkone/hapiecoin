"use client";
// The settings dialogs (profile, API, currency, lot, P&L, exchanges, logout) only matter once a menu item is
// clicked, so their chunk loads on first open rather than with the header (route-level split, budget).
import dynamic from "next/dynamic";
import { useUiStore } from "@/lib/store";

const SettingsDialogs = dynamic(() => import("./SettingsDialogs").then((m) => m.SettingsDialogs), { ssr: false });

export function SettingsDialogsLoader() {
  // Mount the chunk only once the first dialog is requested; after that keep it mounted so close animations work.
  const requested = useUiStore((s) => s.dialog !== null || s.dialogsTouched);
  if (!requested) return null;
  return <SettingsDialogs />;
}
