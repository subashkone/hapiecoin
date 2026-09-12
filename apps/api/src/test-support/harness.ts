/**
 * Test harness: boots the real app on an in-memory PGlite with a capturing mailer, a fake Delta
 * client and an in-memory rate store. Each test file creates its own instance (isolated database).
 */
import { eq } from "drizzle-orm";
import { Writable } from "node:stream";
import { type ErrorContext, type ErrorSink, captureFromLog } from "../error-sink.js";
import { type ApiMetrics, createApiMetrics } from "../metrics.js";
import { createApp } from "../app.js";
import type { AppDeps } from "../routes/shared.js";
import { AUTH_BASE_PATH, authOptionsPublic, createAuth, sessionResolver, type Auth } from "../auth.js";
import { type Config, loadConfig } from "../config.js";
import { createDb, type Db, type DbHandle } from "../db/client.js";
import { plans, subscriptions } from "../db/schema.js";
import { SEED, seed } from "../db/seed.js";
import { DEFAULT_VENUE, FakeDeltaTradingClient, VenueCapabilityError } from "@hapiecoin/venues";
import { FakeDeltaPrivateClient } from "../delta/private-client.js";
import { createLogger } from "../logger.js";
import { MailCapture } from "../mailer.js";
import { FakeRazorpay } from "../razorpay.js";
import { MemoryRateStore } from "../security/rate-store.js";
import { createKeyring, type Vault } from "../vault.js";
import { FakeTelegram } from "../telegram.js";
import { MemoryAnalyticsReader } from "../analytics.js";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../security/context.js";

export const TEST_ENV: Record<string, string> = {
  NODE_ENV: "test",
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123456789",
  BETTER_AUTH_URL: "http://localhost:3001",
  WEB_URL: "http://localhost:3000",
  // app.request() has no socket, so tests pass the client IP in x-forwarded-for and trust every peer.
  TRUSTED_PROXY_IPS: "*",
  CREDENTIALS_ENC_KEY: Buffer.alloc(32, 7).toString("base64"),
  EGRESS_IP: "172.236.179.136",
};

export interface RequestOptions {
  method?: string;
  cookie?: string | undefined;
  json?: unknown;
  /** Raw body (webhooks); sets no content type. */
  body?: string;
  headers?: Record<string, string>;
  /** Defaults to the web app origin for state-changing requests (a browser always sends it). */
  origin?: string | null;
  ip?: string;
}

export interface TestApp {
  app: OpenAPIHono<AppEnv>;
  config: Config;
  db: Db;
  handle: DbHandle;
  auth: Auth;
  mail: MailCapture;
  razorpay: FakeRazorpay;
  delta: FakeDeltaPrivateClient;
  trading: FakeDeltaTradingClient;
  /** The app's dependency bag, for tests that drive background jobs directly (reconcilePending). */
  deps: AppDeps;
  rateStore: MemoryRateStore;
  vault: Vault;
  /** Seed analytics snapshots for /v1/analytics tests. */
  analytics: MemoryAnalyticsReader;
  /** Telegram bot double (ADR-057): sends recorded, /start messages pushed by tests. */
  telegram: FakeTelegram;
  /** ADR-081: every error-level log and relayed browser report lands here (the logger runs at "error" in tests). */
  errors: FakeErrorSink;
  metrics: ApiMetrics;
  now: { value: number };
  request(path: string, opts?: RequestOptions): Promise<Response>;
  /** Sign up through Better Auth (email + password, then OTP verification). Returns the session cookie. */
  signUp(
    email: string,
    opts?: {
      /** Plan for the new user (ADR-030): tests default to Elite (no limits) so trading tests stay about trading; billing tests ask for "free". */
      plan?: "free" | "elite"; name?: string; password?: string; mobile?: string; ref?: string },
  ): Promise<{ cookie: string }>;
  /** OTP sign-in for an existing user (the seeded admin, or someone created with signUp). */
  signInOtp(email: string): Promise<{ cookie: string }>;
  adminCookie(): Promise<string>;
  close(): Promise<void>;
}

/** Records every capture; ids are "evt-1", "evt-2"… */
export class FakeErrorSink implements ErrorSink {
  readonly enabled = true;
  readonly captured: { error: unknown; ctx: ErrorContext }[] = [];
  capture(error: unknown, ctx: ErrorContext = {}): string {
    this.captured.push({ error, ctx });
    return `evt-${this.captured.length}`;
  }
  flush(): Promise<void> {
    return Promise.resolve();
  }
  stats(): { sent: number; dropped: number; failed: number } {
    return { sent: this.captured.length, dropped: 0, failed: 0 };
  }
}

export function cookieHeaderFrom(res: Response, previous = ""): string {
  const jar = new Map<string, string>();
  for (const part of previous.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k) jar.set(k, v.join("="));
  }
  for (const line of res.headers.getSetCookie()) {
    const first = line.split(";")[0] ?? "";
    const eq = first.indexOf("=");
    if (eq === -1) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (value === "") jar.delete(name);
    else jar.set(name, value);
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

export async function createTestApp(envOverrides: Record<string, string> = {}): Promise<TestApp> {
  const config = loadConfig({ ...TEST_ENV, ...envOverrides }, { warn: () => undefined });
  const errors = new FakeErrorSink();
  // "error" not "silent": the ADR-081 logger hook only runs for enabled levels; the lines themselves go nowhere
  const logger = createLogger({ level: "error", destination: new Writable({ write: (_chunk, _enc, cb) => cb() }), onError: (record) => captureFromLog(errors, record) });
  const handle = await createDb();
  await handle.migrate();
  await seed(handle.db);
  const mail = new MailCapture();
  const razorpay = new FakeRazorpay();
  const delta = new FakeDeltaPrivateClient();
  const trading = new FakeDeltaTradingClient();
  const now = { value: Date.now() };
  const metrics = createApiMetrics({ now: () => now.value });
  const rateStore = new MemoryRateStore({ now: () => now.value });
  const vault = createKeyring(config.credentialsEncKey, config.credentialsPrevKeys);
  const analytics = new MemoryAnalyticsReader();
  const telegram = new FakeTelegram();
  const auth = createAuth({ config, db: handle.db, mailer: mail, rateStore, logger });
  const deps: AppDeps = {
    config,
    db: handle.db,
    dbKind: handle.kind,
    ping: () => handle.ping(),
    auth,
    authBasePath: AUTH_BASE_PATH,
    sessions: sessionResolver(auth),
    mailer: mail,
    razorpay,
    rateStore,
    logger,
    vault,
    delta,
    trading,
    // ADR-070: the one fake stands for the default venue; a data-only venue has no client, as in production
    tradingFor: (venue) => {
      if (venue === DEFAULT_VENUE) return trading;
      throw new VenueCapabilityError(venue, "trading client");
    },
    authOptions: authOptionsPublic(config),
    errors,
    metrics,
    analytics,
    telegram,
  };
  const app = createApp(deps);

  const request = (path: string, opts: RequestOptions = {}): Promise<Response> => {
    const method = opts.method ?? (opts.json !== undefined || opts.body !== undefined ? "POST" : "GET");
    const headers: Record<string, string> = { "x-forwarded-for": opts.ip ?? "203.0.113.10", ...opts.headers };
    if (opts.cookie) headers["cookie"] = opts.cookie;
    if (opts.json !== undefined) headers["content-type"] = "application/json";
    const origin = opts.origin === undefined ? (method === "GET" ? undefined : config.webUrl) : opts.origin;
    if (origin !== undefined && origin !== null) headers["origin"] = origin;
    const init: RequestInit = { method, headers };
    if (opts.json !== undefined) init.body = JSON.stringify(opts.json);
    else if (opts.body !== undefined) init.body = opts.body;
    return Promise.resolve(app.request(`http://localhost:3001${path}`, init));
  };

  const signInOtp = async (email: string): Promise<{ cookie: string }> => {
    const send = await request(`${AUTH_BASE_PATH}/email-otp/send-verification-otp`, {
      json: { email, type: "sign-in" },
      ip: nextIp(),
    });
    if (send.status !== 200) throw new Error(`send OTP failed: ${send.status} ${await send.text()}`);
    const otp = mail.last(email, "sign-in")?.otp;
    if (!otp) throw new Error(`no sign-in OTP captured for ${email}`);
    const res = await request(`${AUTH_BASE_PATH}/sign-in/email-otp`, { json: { email, otp } });
    if (res.status !== 200) throw new Error(`OTP sign-in failed: ${res.status} ${await res.text()}`);
    return { cookie: cookieHeaderFrom(res) };
  };

  // Helpers use a fresh client IP per call so the per-IP OTP limit (5 / 15 min) never trips inside a test file.
  let ipCounter = 0;
  const nextIp = (): string => {
    ipCounter += 1;
    return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
  };

  const verifyEmail = async (email: string, cookie: string): Promise<{ cookie: string }> => {
    const otp = mail.last(email, "email-verification")?.otp;
    if (!otp) throw new Error(`no verification OTP captured for ${email}`);
    const res = await request(`${AUTH_BASE_PATH}/email-otp/verify-email`, {
      json: { email, otp },
      cookie,
      ip: nextIp(),
    });
    if (res.status !== 200) throw new Error(`verify-email failed: ${res.status} ${await res.text()}`);
    return { cookie: cookieHeaderFrom(res, cookie) };
  };

  return {
    app,
    deps,
    trading,
    config,
    db: handle.db,
    handle,
    auth,
    mail,
    razorpay,
    delta,
    rateStore,
    vault,
    analytics,
    telegram,
    errors,
    metrics,
    now,
    request,
    async signUp(email, opts = {}) {
      const body: Record<string, unknown> = {
        email,
        name: opts.name ?? "Test Trader",
        password: opts.password ?? "correct horse battery",
      };
      if (opts.mobile !== undefined) body["mobile"] = opts.mobile;
      if (opts.ref !== undefined) body["ref"] = opts.ref;
      const res = await request(`${AUTH_BASE_PATH}/sign-up/email`, { json: body, ip: nextIp() });
      if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
      const session = await verifyEmail(email, cookieHeaderFrom(res));
      if (opts.plan !== "free") {
        const me = (await (await request("/v1/me", { cookie: session.cookie })).json()) as { id: string };
        const [elite] = await handle.db.select().from(plans).where(eq(plans.id, SEED.plans.elite)).limit(1);
        if (elite) {
          const startsAt = new Date(now.value);
          await handle.db.insert(subscriptions).values({ id: `sub_test_${me.id}`, userId: me.id, planName: elite.name, planId: elite.id, interval: "yearly", priceInr: elite.intervals.yearly.priceInr, paidInr: "0", currency: "INR", status: "active", startsAt, expiresAt: new Date(startsAt.getTime() + 365 * 86_400_000), featureLimits: elite.intervals.yearly.limits });
        }
      }
      return session;
    },
    signInOtp,
    adminCookie: () => signInOtp(SEED.adminEmail).then((r) => r.cookie),
    close: () => handle.close(),
  };
}
