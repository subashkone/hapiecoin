/**
 * Ingest environment, validated with Zod at boot (rule: validate every boundary, env included). Empty strings are
 * treated as unset. Every upstream here is public market data; the only optional secret is the CoinGecko Demo key,
 * which raises its rate limit and is read from the environment, never logged (ADR-038).
 */
import { AnalyticsSymbol } from "@hapiecoin/schema";
import { z } from "zod";

export const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const symbolList = (defaults: string) =>
  z
    .string()
    .default(defaults)
    .transform((s) => s.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean))
    .pipe(z.array(AnalyticsSymbol).min(1).max(50));
const Symbols = symbolList("BTC,ETH,SOL,XRP,BNB,DOGE,ADA,AVAX,LINK,LTC");

export const IngestEnv = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** TCP port for `/healthz`; 0 picks a free port (tests). */
  INGEST_PORT: z.coerce.number().int().min(0).max(65535).default(3003),
  INGEST_HOST: z.string().min(1).default("0.0.0.0"),
  /** Snapshots live in Redis when set; otherwise in memory (the API then cannot read them: dev-only). */
  REDIS_URL: z.url({ protocol: /^rediss?$/ }).optional(),
  /** Symbols to track for the per-symbol datasets (venue perpetuals are `${symbol}USDT`). */
  ANALYTICS_SYMBOLS: Symbols,
  BINANCE_FAPI_URL: z.url({ protocol: /^https?$/ }).default("https://fapi.binance.com"),
  BINANCE_FSTREAM_URL: z.url({ protocol: /^wss?$/ }).default("wss://fstream.binance.com/ws"),
  BYBIT_URL: z.url({ protocol: /^https?$/ }).default("https://api.bybit.com"),
  /** Bybit v5 public linear stream (allLiquidation.{symbol}); the liquidation fallback when Binance is unreachable (ADR-041). */
  BYBIT_WS_URL: z.url({ protocol: /^wss?$/ }).default("wss://stream.bybit.com/v5/public/linear"),
  OKX_URL: z.url({ protocol: /^https?$/ }).default("https://www.okx.com"),
  COINGECKO_URL: z.url({ protocol: /^https?$/ }).default("https://api.coingecko.com/api/v3"),
  DERIBIT_URL: z.url({ protocol: /^https?$/ }).default("https://www.deribit.com/api/v2"),
  DELTA_URL: z.url({ protocol: /^https?$/ }).default("https://api.india.delta.exchange"),
  /** Underlyings for the options dataset (Deribit + Delta list BTC and ETH options). */
  OPTIONS_SYMBOLS: symbolList("BTC,ETH"),
  /** CoinGecko Demo key (free, 10k calls/month). Optional: without it the markets job is skipped. */
  COINGECKO_API_KEY: z.string().min(8).optional(),
  FNG_URL: z.url({ protocol: /^https?$/ }).default("https://api.alternative.me/fng/"),
  /** Refresh intervals (ms). Defaults follow the research note: derivatives 60 s, spot 10 min, F&G hourly. */
  DERIVATIVES_REFRESH_MS: z.coerce.number().int().min(5_000).default(60_000),
  MARKETS_REFRESH_MS: z.coerce.number().int().min(60_000).default(600_000),
  FEAR_GREED_REFRESH_MS: z.coerce.number().int().min(60_000).default(3_600_000),
  LIQUIDATIONS_FLUSH_MS: z.coerce.number().int().min(1_000).default(15_000),
  OPTIONS_REFRESH_MS: z.coerce.number().int().min(60_000).default(300_000),
  RSI_REFRESH_MS: z.coerce.number().int().min(60_000).default(300_000),
  /** Cycle indicators are daily data; the premium history is hourly, both on the CoinGecko / Bybit budgets. */
  CYCLE_REFRESH_MS: z.coerce.number().int().min(300_000).default(3_600_000),
  PREMIUM_REFRESH_MS: z.coerce.number().int().min(300_000).default(3_600_000),
  /** Per-attempt HTTP timeout. */
  HTTP_TIMEOUT_MS: z.coerce.number().int().min(500).default(8_000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
});
export type IngestConfig = z.infer<typeof IngestEnv>;

export class ConfigError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`Invalid ingest environment:\n  ${issues.join("\n  ")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

/** Parse `env` (default `process.env`) into an IngestConfig; throws ConfigError listing every problem. */
export function loadConfig(env: Record<string, string | undefined> = process.env): IngestConfig {
  const input: Record<string, string> = {};
  for (const key of Object.keys(IngestEnv.shape)) {
    const value = env[key];
    if (value !== undefined && value !== "") input[key] = value;
  }
  const parsed = IngestEnv.safeParse(input);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  return parsed.data;
}
