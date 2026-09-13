import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { Providers } from "@/components/shell/Providers";
import { Pwa } from "@/components/shell/Pwa";
import { publicEnv } from "@/lib/env";
import { THEME_INIT_SCRIPT } from "@/lib/theme-init";
import "./globals.css";

/** Phones (ADR-080): device width, no forced zoom-out, the notch area painted. */
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export const metadata: Metadata = {
  title: { default: "HapieCoin", template: "%s · HapieCoin" },
  description: "Crypto options strategy builder for Delta Exchange India: chain, payoff, greeks, paper and live trading.",
  // home-screen app (ADR-082): the manifest, and Safari's standalone flags since it ignores the manifest's display
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "HapieCoin", statusBarStyle: "black" }, // opaque: nothing draws under the clock until a device check (GAPS #98)
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const env = publicEnv();
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* Theme class before first paint (no flash). Same string as @hapiecoin/ui themeInitScript(key, "dark"); guarded by theme-init.test.ts. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <Providers gatewayUrl={env.NEXT_PUBLIC_GATEWAY_URL}>
          {children}
          <Pwa />
        </Providers>
      </body>
    </html>
  );
}
