// Offline page (ADR-082; HC-SH-135): precached by the service worker and shown for any navigation when the network is
// gone. No data, no client script: served from the cache its own chunks may be missing, so the retry is a plain
// link. Rendered per request like every route (the layout reads the CSP nonce), and the worker stores that response.
import type { Metadata } from "next";
import { Button } from "@/components/ui";
import { LogoMark } from "@/components/shell/Logo";

export const metadata: Metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center" data-testid="offline-page">
      <div>
        <LogoMark className="mx-auto size-10" />
        <p className="micro mt-6">HapieCoin</p>
        <h1 className="mt-2 font-display text-2xl font-semibold">You are offline</h1>
        <p className="mt-3 max-w-[36ch] text-muted-foreground">
          Prices, positions and orders need a connection. Nothing is cached, so what you see when you are back is live.
        </p>
        <Button asChild variant="outline" className="mt-6">
          <a href="/analyse" data-testid="offline-retry">Try again</a>
        </Button>
      </div>
    </main>
  );
}
