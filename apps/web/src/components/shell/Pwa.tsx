"use client";
// The home-screen shell (ADR-082; HC-SH-134, HC-SH-135): registers the service worker after the page has loaded,
// keeps the install state live, and on a phone shows one hint, once, that the app can be installed. Mounted from the
// root layout so every route (including the public trader page) gets the worker; the hint's dialog is hosted here
// for the same reason (the settings dialogs exist only inside the app sections).
import { toast } from "@hapiecoin/ui";
import { useEffect, useState } from "react";
import { bindInstall, installHintSeen, markInstallHintSeen, useInstallState } from "@/lib/pwa/install";
import { useNarrow } from "@/lib/useMediaQuery";
import { InstallDialog } from "@/components/dialogs/InstallDialog";

export const SW_URL = "/sw.js";

/** Register once the page is idle; a missing API (old browser, some private modes) is simply no worker. */
export function registerServiceWorker(win: Window): void {
  const sw = win.navigator.serviceWorker;
  if (!sw) return;
  const go = () => {
    sw.register(SW_URL, { scope: "/" }).catch(() => undefined);
  };
  if (win.document.readyState === "complete") go();
  else win.addEventListener("load", go, { once: true });
}

export function Pwa() {
  const state = useInstallState();
  const narrow = useNarrow(768);
  const [hintOpen, setHintOpen] = useState(false);
  useEffect(() => {
    registerServiceWorker(window);
    return bindInstall(window);
  }, []);
  useEffect(() => {
    if (!narrow || (state !== "ready" && state !== "ios") || installHintSeen(localStorage)) return;
    markInstallHintSeen(localStorage);
    toast("Install HapieCoin", {
      id: "install-hint",
      description: "Add it to your home screen for a full-screen chain.",
      action: { label: "Install", onClick: () => setHintOpen(true) },
    });
  }, [narrow, state]);
  return <InstallDialog open={hintOpen} onOpenChange={setHintOpen} />;
}
