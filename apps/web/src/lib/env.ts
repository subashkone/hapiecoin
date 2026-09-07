// Environment boundary (typescript rule 2: parse env through Zod, trust inside).
import { z } from "zod";

const PublicEnv = z.object({
  /** WebSocket URL of the market-data gateway (apps/gateway). */
  NEXT_PUBLIC_GATEWAY_URL: z.string().min(1).default("ws://localhost:3002"),
  /** Shows the Google button on /auth only when the API has Google configured. */
  NEXT_PUBLIC_GOOGLE_ENABLED: z.enum(["true", "false"]).default("false"),
  /** Fallback expiry list (ISO dates, comma separated) used when the gateway exposes none (see chain/expiries.ts). */
  NEXT_PUBLIC_DEFAULT_EXPIRIES: z.string().default("2026-09-11,2026-09-18,2026-09-25,2026-10-30,2026-11-27"),
});

const ServerEnv = z.object({
  /** HTTP origin of apps/api; the web app proxies /api/auth/* and /v1/* to it (next.config.ts rewrites). */
  API_URL: z.string().url().default("http://localhost:3001"),
});

export type PublicEnv = z.infer<typeof PublicEnv>;
export type ServerEnv = z.infer<typeof ServerEnv>;

/** Client-safe values. Next inlines `process.env.NEXT_PUBLIC_*` at build time, hence the explicit reads. */
export function publicEnv(): PublicEnv {
  return PublicEnv.parse({
    NEXT_PUBLIC_GATEWAY_URL: process.env["NEXT_PUBLIC_GATEWAY_URL"] || undefined,
    NEXT_PUBLIC_GOOGLE_ENABLED: process.env["NEXT_PUBLIC_GOOGLE_ENABLED"] || undefined,
    NEXT_PUBLIC_DEFAULT_EXPIRIES: process.env["NEXT_PUBLIC_DEFAULT_EXPIRIES"] || undefined,
  });
}

/** Server-only values (never imported from a client component). */
export function serverEnv(): ServerEnv {
  return ServerEnv.parse({ API_URL: process.env["API_URL"] || undefined });
}

/** ws:// → http:// for the gateway's plain HTTP endpoints (e.g. /healthz). */
export function gatewayHttpUrl(wsUrl: string): string {
  return wsUrl.replace(/^ws(s?):\/\//, "http$1://").replace(/\/$/, "");
}

/** Default expiries parsed from env, validated as ISO dates, sorted ascending, de-duplicated. */
export function defaultExpiries(csv: string): string[] {
  const dates = csv
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
  return [...new Set(dates)].sort();
}
