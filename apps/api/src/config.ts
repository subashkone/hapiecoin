/**
 * Environment configuration (Zod-validated, ADR-004 "validate every external boundary").
 *
 * - Secrets that are missing in development/test are generated per process with a warning so the
 *   API boots without a .env; in production they are required.
 * - Trading safety rule 2: live Delta keys must be absent when NODE_ENV=test. Boot throws otherwise.
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";

const NodeEnv = z.enum(["development", "test", "production"]);
export type NodeEnv = z.infer<typeof NodeEnv>;

/** Base64 string that decodes to exactly 32 bytes (AES-256 key). */
const Base64Key32 = z
  .string()
  .refine((v) => /^[A-Za-z0-9+/]+={0,2}$/.test(v) && Buffer.from(v, "base64").length === 32, {
    message: "expected a base64 string that decodes to 32 bytes",
  });

const RawEnv = z.object({
  NODE_ENV: NodeEnv.default("development"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.url().optional(),
  REDIS_URL: z.url().optional(),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters").optional(),
  /**
   * Public origin auth URLs are built from (OAuth callbacks, docs link). Defaults to WEB_URL because the
   * browser reaches the API through the web origin's `/v1/*` rewrite (ADR-018/019): a callback on the API
   * origin would set the session cookie where the web app never reads it.
   */
  BETTER_AUTH_URL: z.url().optional(),
  WEB_URL: z.url().default("http://localhost:3000"),
  /**
   * Peers whose `cf-connecting-ip` / `x-forwarded-for` / `x-real-ip` headers are believed (comma separated
   * socket addresses, or `*` to trust every peer, for local development behind the Next.js proxy only).
   * Unset: the socket address is the client IP and forwarded headers are ignored (ADR-019).
   */
  TRUSTED_PROXY_IPS: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(3).default("HapieCoin <no-reply@hapiecoin.com>"),
  CREDENTIALS_ENC_KEY: Base64Key32.optional(),
  DELTA_REST_URL: z.url().default("https://api.india.delta.exchange"),
  /** Egress IP users must whitelist at the exchange (HC-SH-036). Placeholder until the production egress is fixed. */
  EGRESS_IP: z.ipv4().default("172.236.179.136"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),
  /** Persistent PGlite directory for development (in-memory when unset). */
  PGLITE_DATA_DIR: z.string().min(1).optional(),
  // Read only for the trading-safety guard; the API never uses live keys itself.
  DELTA_API_KEY: z.string().optional(),
  DELTA_API_SECRET: z.string().optional(),
});

export interface Config {
  nodeEnv: NodeEnv;
  isProd: boolean;
  isDev: boolean;
  isTest: boolean;
  apiPort: number;
  databaseUrl: string | undefined;
  redisUrl: string | undefined;
  betterAuthSecret: string;
  betterAuthUrl: string;
  webUrl: string;
  /** Socket addresses allowed to set the client-IP headers; `["*"]` trusts every peer. */
  trustedProxyIps: string[];
  google: { clientId: string; clientSecret: string } | undefined;
  resendApiKey: string | undefined;
  emailFrom: string;
  /** 32-byte AES-256-GCM key for exchange credentials at rest. */
  credentialsEncKey: Buffer;
  deltaRestUrl: string;
  egressIp: string;
  logLevel: string;
  pgliteDataDir: string | undefined;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Drop empty strings so `GOOGLE_CLIENT_ID=` in .env behaves like "unset". */
function stripEmpty(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string" && v.trim() !== "") out[k] = v;
  }
  return out;
}

export interface LoadConfigOptions {
  /** Receives one line per generated ephemeral secret (default: console.warn). */
  warn?: (message: string) => void;
}

/**
 * Parse and validate the environment. Throws `ConfigError` with every issue listed when invalid.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  opts: LoadConfigOptions = {},
): Config {
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  const parsed = RawEnv.safeParse(stripEmpty(env));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new ConfigError(`invalid environment: ${issues.join("; ")}`);
  }
  const e = parsed.data;
  const isProd = e.NODE_ENV === "production";
  const isTest = e.NODE_ENV === "test";

  if (isTest && (e.DELTA_API_KEY !== undefined || e.DELTA_API_SECRET !== undefined)) {
    throw new ConfigError(
      "trading safety: DELTA_API_KEY / DELTA_API_SECRET must be absent when NODE_ENV=test (tests never touch live endpoints)",
    );
  }

  const trustedProxyIps = (e.TRUSTED_PROXY_IPS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  let betterAuthSecret = e.BETTER_AUTH_SECRET;
  if (betterAuthSecret === undefined) {
    if (isProd) throw new ConfigError("BETTER_AUTH_SECRET is required in production (32+ random characters)");
    betterAuthSecret = randomBytes(32).toString("base64url");
    warn(
      "[config] BETTER_AUTH_SECRET not set: using an ephemeral secret; sessions will not survive a restart",
    );
  }

  let credentialsEncKey: Buffer;
  if (e.CREDENTIALS_ENC_KEY === undefined) {
    if (isProd) throw new ConfigError("CREDENTIALS_ENC_KEY is required in production (32 bytes, base64)");
    credentialsEncKey = randomBytes(32);
    warn(
      "[config] CREDENTIALS_ENC_KEY not set: using an ephemeral key; stored exchange credentials will not decrypt after a restart",
    );
  } else {
    credentialsEncKey = Buffer.from(e.CREDENTIALS_ENC_KEY, "base64");
  }

  // Production must never fall back to the embedded database or the OTP-logging mailer (GAPS #23, #25).
  if (isProd && e.DATABASE_URL === undefined) {
    throw new ConfigError("DATABASE_URL is required in production (PGlite is for development and tests only)");
  }
  if (isProd && e.RESEND_API_KEY === undefined) {
    throw new ConfigError("RESEND_API_KEY is required in production (without it sign-in codes would be logged)");
  }
  if (isProd && e.REDIS_URL === undefined) {
    warn("[config] REDIS_URL not set: rate limits are per process and reset on restart");
  }

  const google =
    e.GOOGLE_CLIENT_ID !== undefined && e.GOOGLE_CLIENT_SECRET !== undefined
      ? { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET }
      : undefined;

  return {
    nodeEnv: e.NODE_ENV,
    isProd,
    isDev: e.NODE_ENV === "development",
    isTest,
    apiPort: e.API_PORT,
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    betterAuthSecret,
    betterAuthUrl: e.BETTER_AUTH_URL ?? e.WEB_URL,
    webUrl: e.WEB_URL,
    trustedProxyIps,
    google,
    resendApiKey: e.RESEND_API_KEY,
    emailFrom: e.EMAIL_FROM,
    credentialsEncKey,
    deltaRestUrl: e.DELTA_REST_URL,
    egressIp: e.EGRESS_IP,
    logLevel: e.LOG_LEVEL ?? (isTest ? "silent" : "info"),
    pgliteDataDir: e.PGLITE_DATA_DIR,
  };
}
