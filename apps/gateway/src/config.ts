/**
 * Gateway environment, validated with Zod at boot (rule: validate every boundary, env included).
 * Empty strings are treated as unset so an `.env` line such as `REDIS_URL=` means "no Redis".
 * The Delta endpoints are public market data and default to Delta Exchange India; nothing here is a secret.
 */
import { MAX_TOPICS_PER_MESSAGE } from "@hapiecoin/schema";
import { z } from "zod";

export const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const GatewayEnv = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** TCP port for HTTP (`/healthz`, `/metrics`) and the WebSocket upgrade; 0 picks a free port (tests). */
  GATEWAY_PORT: z.coerce.number().int().min(0).max(65535).default(3002),
  GATEWAY_HOST: z.string().min(1).default("0.0.0.0"),
  DELTA_REST_URL: z.url({ protocol: /^https?$/ }).default("https://api.india.delta.exchange"),
  DELTA_WS_URL: z.url({ protocol: /^wss?$/ }).default("wss://socket.india.delta.exchange"),
  /** "v2/ticker" (verbose, what the original site uses) or "ticker" (compact public endpoint). */
  DELTA_WS_CHANNEL: z.enum(["v2/ticker", "ticker"]).default("v2/ticker"),
  /** When set, frames fan out through Redis pub/sub so several gateway processes share one feed. */
  REDIS_URL: z.url({ protocol: /^rediss?$/ }).optional(),
  /** Browser origin allowed to open sockets (plus localhost outside production). */
  WEB_URL: z.url({ protocol: /^https?$/ }).default("http://localhost:3000"),
  /** Delta ticks are batched per topic and flushed at this interval. */
  COALESCE_MS: z.coerce.number().int().min(10).max(5_000).default(250),
  MAX_TOPICS_PER_CONN: z.coerce.number().int().min(1).max(MAX_TOPICS_PER_MESSAGE).default(50),
  /** Upstream Delta subscriptions for a topic are kept this long after its last client leaves. */
  UNSUBSCRIBE_GRACE_MS: z.coerce.number().int().min(0).default(30_000),
  /** Instrument list refresh interval (new expiries appear daily); 0 disables. */
  INSTRUMENT_REFRESH_MS: z.coerce.number().int().min(0).default(300_000),
  /** Per-connection send buffer above which coalesced frames are dropped until it drains. */
  MAX_BUFFERED_BYTES: z.coerce.number().int().min(1_024).default(1_048_576),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
});
export type GatewayConfig = z.infer<typeof GatewayEnv>;

export class ConfigError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`Invalid gateway environment:\n  ${issues.join("\n  ")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

/** Parse `env` (default `process.env`) into a GatewayConfig; throws ConfigError listing every problem. */
export function loadConfig(env: Record<string, string | undefined> = process.env): GatewayConfig {
  const input: Record<string, string> = {};
  for (const key of Object.keys(GatewayEnv.shape)) {
    const value = env[key];
    if (value !== undefined && value !== "") input[key] = value;
  }
  const parsed = GatewayEnv.safeParse(input);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`),
    );
  }
  return parsed.data;
}
