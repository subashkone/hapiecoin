"use client";
// Global keydown dispatcher (HC-SH-101, 103): "?" opens the shortcuts help, T toggles the theme, D the density, plus
// whatever other parts registered. Ignored while typing in a field or while a dialog is open (Ctrl K lives in the
// palette, Esc in each dialog). Mounted once in the header while signed in; renders nothing.
import { useDensity, useTheme } from "@hapiecoin/ui";
import { useEffect } from "react";
import { findRegistered, isTypingTarget } from "@/lib/shortcuts";
import { useUiStore } from "@/lib/store";

/** A dialog is open when the store says so or a Radix dialog is in the document (trade flow, details, palette …). */
export function dialogOpen(): boolean {
  const s = useUiStore.getState();
  if (s.dialog !== null || s.paletteOpen || s.tradeFlow !== null || s.detailsId !== null) return true;
  return typeof document !== "undefined" && document.querySelector('[role="dialog"][data-state="open"]') !== null;
}

export function ShortcutsDispatcher() {
  const { toggleTheme } = useTheme();
  const { toggleDensity } = useDensity();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const blocked = isTypingTarget(e.target) || dialogOpen();
      const registered = findRegistered(e, blocked);
      if (registered) {
        e.preventDefault();
        registered.handler(e);
        return;
      }
      if (blocked || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "?") {
        e.preventDefault();
        useUiStore.getState().openDialog("shortcuts");
      } else if (e.key === "t" || e.key === "T") {
        if (e.shiftKey) return;
        e.preventDefault();
        toggleTheme();
      } else if (e.key === "d" || e.key === "D") {
        if (e.shiftKey) return;
        e.preventDefault();
        toggleDensity();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleTheme, toggleDensity]);
  return null;
}
