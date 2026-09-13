// Install state for the home-screen app (ADR-082; HC-SH-134). Chrome and Android fire `beforeinstallprompt`, which
// the app keeps so the settings menu can trigger the native prompt later; iPhone Safari has no prompt, so the app
// shows the Share → Add to Home Screen steps instead; once installed (standalone display) there is nothing to offer.
// A tiny external store: no React state in the shell, one subscription, SSR-safe defaults.
import { useSyncExternalStore } from "react";

export type InstallState = "unsupported" | "ready" | "ios" | "installed";

/** The subset of Chrome's BeforeInstallPromptEvent the app uses. */
export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export const INSTALL_HINT_KEY = "hapiecoin.install-hint";

let state: InstallState = "unsupported";
let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function emit(next: InstallState) {
  if (next === state) return;
  state = next;
  for (const l of listeners) l();
}

export function isStandalone(win: Window): boolean {
  const nav = win.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || (typeof win.matchMedia === "function" && win.matchMedia("(display-mode: standalone)").matches);
}

/** iPhone or iPad Safari (an iPad on iPadOS 13+ reports a Mac UA with touch points). */
export function isIos(nav: Navigator): boolean {
  const ua = nav.userAgent;
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && (nav.maxTouchPoints ?? 0) > 1);
}

/** Attach to the window once (the Pwa shell component does this); returns the detach function. */
export function bindInstall(win: Window): () => void {
  if (isStandalone(win)) emit("installed");
  else if (isIos(win.navigator)) emit("ios");
  const onPrompt = (e: Event) => {
    e.preventDefault(); // keep the mini-infobar away; the settings menu owns the moment
    deferred = e as InstallPromptEvent;
    emit("ready");
  };
  const onInstalled = () => {
    deferred = null;
    emit("installed");
  };
  win.addEventListener("beforeinstallprompt", onPrompt);
  win.addEventListener("appinstalled", onInstalled);
  return () => {
    win.removeEventListener("beforeinstallprompt", onPrompt);
    win.removeEventListener("appinstalled", onInstalled);
  };
}

/** Show the native prompt Chrome deferred; resolves to the trader's choice, or "unavailable" when there is none. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const ev = deferred;
  if (!ev) return "unavailable";
  await ev.prompt();
  const { outcome } = await ev.userChoice;
  if (outcome === "accepted") {
    deferred = null;
    emit("installed");
  }
  return outcome;
}

export const getInstallState = (): InstallState => state;
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const serverState = (): InstallState => "unsupported";

export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribe, getInstallState, serverState);
}

/** The one-time phone hint: seen once per browser. */
export function installHintSeen(storage: Storage): boolean {
  return storage.getItem(INSTALL_HINT_KEY) === "1";
}
export function markInstallHintSeen(storage: Storage): void {
  storage.setItem(INSTALL_HINT_KEY, "1");
}

/** Test seam: forget the deferred prompt and go back to "unsupported". */
export function resetInstallForTests(): void {
  deferred = null;
  emit("unsupported");
}
