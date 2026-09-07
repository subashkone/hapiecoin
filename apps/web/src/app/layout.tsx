import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { Providers } from "@/components/shell/Providers";
import { publicEnv } from "@/lib/env";
import { THEME_INIT_SCRIPT } from "@/lib/theme-init";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "HapieCoin", template: "%s · HapieCoin" },
  description: "Crypto options strategy builder for Delta Exchange India: chain, payoff, greeks, paper and live trading.",
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
        <Providers gatewayUrl={env.NEXT_PUBLIC_GATEWAY_URL}>{children}</Providers>
      </body>
    </html>
  );
}
