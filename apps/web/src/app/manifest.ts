// Web app manifest (ADR-082; HC-SH-134): HapieCoin installs to the home screen as a standalone app that opens on
// the workspace. Colours are the Obsidian Desk dark ground and header tone (ADR-003); the mark is amber. Served at /manifest.webmanifest.
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HapieCoin",
    short_name: "HapieCoin",
    description: "Crypto options strategy builder for Delta Exchange India: chain, payoff, greeks, paper and live trading.",
    id: "/analyse",
    start_url: "/analyse",
    scope: "/",
    display: "standalone",
    // splash ground = --background (220 23% 5%), chrome tone = --card / --header-bg (220 23% 8%); no orientation lock:
    // the chain is the one screen that gains from landscape
    background_color: "#0a0c10",
    theme_color: "#0f1219",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
