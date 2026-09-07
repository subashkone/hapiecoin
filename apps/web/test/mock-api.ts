// In-memory stand-in for apps/api used by unit tests (via app.request) and Playwright (via @hono/node-server).
// Implements the Better Auth routes the web client calls and the /v1 contract from the brief. State is
// deliberately simple: one OTP (123456), sessions in a Map, settings/brokers/credentials per user.
import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Broker, BrokerCredentialPublic, User, UserSettings } from "@hapiecoin/schema";
import { maskApiKey } from "@hapiecoin/schema";

export const SESSION_COOKIE = "better-auth.session_token";
export const TEST_OTP = "123456";
export const WHITELIST_IP = "172.236.179.136";

interface Account {
  user: User;
  password: string;
  emailVerified: boolean;
  settings: UserSettings;
  brokers: Broker[];
  credential: BrokerCredentialPublic | null;
  plan: PlanRecord;
  referredBy?: string;
}
interface PlanRecord {
  state: "free" | "active" | "expiring_soon" | "expired";
  planName?: string;
  expiresAt?: string;
  daysLeft?: number;
}

export interface MockState {
  accounts: Map<string, Account>;
  sessions: Map<string, string>; // token → email
  /** OTPs issued: `${email}:${type}` → code (always TEST_OTP, but recorded for assertions). */
  otps: Map<string, string>;
}

const GLOBAL_BROKER: Broker = {
  id: "brk_delta",
  name: "Delta Exchange India",
  feePct: "0.05",
  gstPct: "18",
  feeCapPct: "10",
  scope: "GLOBAL",
};

function defaultSettings(): UserSettings {
  return {
    currency: "USD",
    conversionRate: "83.5",
    pnlBasis: "mark",
    lotSizes: { BTC: "0.001", ETH: "0.01", XAUT: "0.001" },
    theme: "dark",
    density: "comfortable",
  };
}

let counter = 0;
function id(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter.toString(36)}${Date.now().toString(36)}`;
}

export function createAccount(
  state: MockState,
  input: { email: string; password?: string; name?: string; mobile?: string; role?: "user" | "admin"; verified?: boolean },
): Account {
  const email = input.email.toLowerCase();
  const user: User = {
    id: id("usr"),
    email,
    name: input.name ?? "Asha Trader",
    role: input.role ?? "user",
    avatar: "rocket",
    referralCode: "ASHA2026",
    createdAt: new Date("2026-09-01T10:00:00Z").toISOString(),
    ...(input.mobile ? { mobile: input.mobile } : {}),
  };
  const acc: Account = {
    user,
    password: input.password ?? "Passw0rd!",
    emailVerified: input.verified ?? true,
    settings: defaultSettings(),
    brokers: [GLOBAL_BROKER],
    credential: null,
    plan: { state: "free" },
  };
  state.accounts.set(email, acc);
  return acc;
}

export function createSession(state: MockState, email: string): string {
  const token = id("ses");
  state.sessions.set(token, email.toLowerCase());
  return token;
}

export function createMockApi(state: MockState = { accounts: new Map(), sessions: new Map(), otps: new Map() }) {
  const app = new Hono();

  const err = (c: Context, status: 400 | 401 | 403 | 404 | 409, code: string, message: string) =>
    c.json({ code, message }, status);

  const current = (c: Context): Account | null => {
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) return null;
    const email = state.sessions.get(token);
    return email ? (state.accounts.get(email) ?? null) : null;
  };

  const setSession = (c: Context, email: string) => {
    const token = createSession(state, email);
    setCookie(c, SESSION_COOKIE, token, { path: "/", httpOnly: true, sameSite: "Lax" });
    return token;
  };

  const sessionBody = (acc: Account, token: string) => ({
    session: { id: token, userId: acc.user.id, token, expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString() },
    user: { id: acc.user.id, email: acc.user.email, name: acc.user.name, emailVerified: acc.emailVerified, image: null },
  });

  /* ---------------- Better Auth ---------------- */
  // apps/api mounts Better Auth at /v1/auth; the browser calls /api/auth on the web origin and Next rewrites it.
  // Serve both prefixes so unit tests (hitting this mock directly) and e2e (through the rewrite) agree.
  app.all("/v1/auth/*", (c) => {
    const url = new URL(c.req.url);
    url.pathname = url.pathname.replace(/^\/v1\/auth\//, "/api/auth/");
    return app.fetch(new Request(url, c.req.raw));
  });
  app.get("/api/auth/get-session", (c) => {
    const acc = current(c);
    if (!acc) return c.json(null);
    return c.json(sessionBody(acc, getCookie(c, SESSION_COOKIE) ?? ""));
  });

  app.post("/api/auth/sign-up/email", async (c) => {
    const body = await c.req.json<{ email?: string; password?: string; name?: string; mobile?: string; ref?: string }>();
    if (!body.email || !body.password || !body.name) return err(c, 400, "INVALID_BODY", "email, password and name are required");
    if (state.accounts.has(body.email.toLowerCase())) return err(c, 409, "USER_ALREADY_EXISTS", "User already exists");
    const acc = createAccount(state, { ...body, email: body.email, password: body.password, name: body.name, verified: false });
    if (body.ref) acc.referredBy = body.ref.toUpperCase();
    // apps/api: emailOTP({ sendVerificationOnSignUp: true }) — the OTP goes out with the sign-up itself.
    state.otps.set(`${acc.user.email}:email-verification`, TEST_OTP);
    return c.json({ token: null, user: sessionBody(acc, "").user });
  });

  app.post("/api/auth/sign-in/email", async (c) => {
    const body = await c.req.json<{ email?: string; password?: string }>();
    const acc = body.email ? state.accounts.get(body.email.toLowerCase()) : undefined;
    if (!acc || acc.password !== body.password) return err(c, 401, "INVALID_EMAIL_OR_PASSWORD", "Invalid email or password");
    if (!acc.emailVerified) return err(c, 403, "EMAIL_NOT_VERIFIED", "Email not verified");
    const token = setSession(c, acc.user.email);
    return c.json({ redirect: false, token, user: sessionBody(acc, token).user });
  });

  // Google sign-in the way production is wired (ADR-019): the client posts to sign-in/social and navigates
  // to `url`; the provider callback is served under /v1/auth on the web origin (Next rewrite), so the
  // session cookie is first-party. The "provider" here signs in a fixed Google account without leaving.
  app.post("/api/auth/sign-in/social", async (c) => {
    const body = await c.req.json<{ provider?: string; callbackURL?: string }>();
    if (body.provider !== "google") return err(c, 400, "PROVIDER_NOT_FOUND", "Provider not found");
    const callbackURL = body.callbackURL && body.callbackURL.startsWith("/") ? body.callbackURL : "/analyse";
    return c.json({ url: `/v1/auth/callback/google?state=e2e&callbackURL=${encodeURIComponent(callbackURL)}`, redirect: true });
  });
  app.get("/api/auth/callback/google", (c) => {
    const callbackURL = c.req.query("callbackURL") ?? "/analyse";
    const email = "google.user@hapiecoin.test";
    if (!state.accounts.has(email)) createAccount(state, { email, name: "Google User", verified: true });
    setSession(c, email);
    return c.redirect(callbackURL.startsWith("/") ? callbackURL : "/analyse", 302);
  });

  app.post("/api/auth/sign-out", (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) state.sessions.delete(token);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ success: true });
  });

  app.post("/api/auth/email-otp/send-verification-otp", async (c) => {
    const body = await c.req.json<{ email?: string; type?: string }>();
    if (!body.email || !body.type) return err(c, 400, "INVALID_BODY", "email and type are required");
    state.otps.set(`${body.email.toLowerCase()}:${body.type}`, TEST_OTP);
    return c.json({ success: true });
  });

  app.post("/api/auth/sign-in/email-otp", async (c) => {
    const body = await c.req.json<{ email?: string; otp?: string }>();
    const email = body.email?.toLowerCase() ?? "";
    if (state.otps.get(`${email}:sign-in`) !== body.otp) return err(c, 400, "INVALID_OTP", "Invalid OTP");
    let acc = state.accounts.get(email);
    if (!acc) acc = createAccount(state, { email, name: email.split("@")[0] ?? "Trader" });
    acc.emailVerified = true;
    state.otps.delete(`${email}:sign-in`);
    const token = setSession(c, email);
    return c.json({ token, user: sessionBody(acc, token).user });
  });

  app.post("/api/auth/email-otp/verify-email", async (c) => {
    const body = await c.req.json<{ email?: string; otp?: string }>();
    const email = body.email?.toLowerCase() ?? "";
    const acc = state.accounts.get(email);
    if (!acc) return err(c, 404, "USER_NOT_FOUND", "User not found");
    if (state.otps.get(`${email}:email-verification`) !== body.otp) return err(c, 400, "INVALID_OTP", "Invalid OTP");
    acc.emailVerified = true;
    state.otps.delete(`${email}:email-verification`);
    // Mirrors emailOTP({ autoSignInAfterVerification: true }) expected of apps/api.
    const token = setSession(c, email);
    return c.json({ status: true, token, user: sessionBody(acc, token).user });
  });

  app.post("/api/auth/email-otp/reset-password", async (c) => {
    const body = await c.req.json<{ email?: string; otp?: string; password?: string }>();
    const email = body.email?.toLowerCase() ?? "";
    const acc = state.accounts.get(email);
    if (!acc) return err(c, 404, "USER_NOT_FOUND", "User not found");
    if (state.otps.get(`${email}:forget-password`) !== body.otp) return err(c, 400, "INVALID_OTP", "Invalid OTP");
    if (!body.password) return err(c, 400, "INVALID_BODY", "password is required");
    acc.password = body.password;
    state.otps.delete(`${email}:forget-password`);
    return c.json({ success: true });
  });

  /* ---------------- /v1 ---------------- */
  const v1 = new Hono();
  v1.use("*", async (c: Context, next) => {
    if (!current(c)) return err(c, 401, "UNAUTHORIZED", "Sign in required");
    await next();
  });
  v1.get("/me", (c) => c.json(current(c)!.user));
  v1.patch("/me", async (c) => {
    const acc = current(c)!;
    const body = await c.req.json<{ name?: string; mobile?: string; avatar?: User["avatar"] }>();
    if (body.name !== undefined) acc.user.name = body.name;
    if (body.mobile !== undefined) acc.user.mobile = body.mobile;
    if (body.avatar !== undefined) acc.user.avatar = body.avatar;
    return c.json(acc.user);
  });
  v1.get("/settings", (c) => c.json(current(c)!.settings));
  v1.put("/settings", async (c) => {
    const acc = current(c)!;
    const patch = await c.req.json<Partial<UserSettings>>();
    acc.settings = { ...acc.settings, ...patch };
    return c.json(acc.settings);
  });
  v1.get("/brokers", (c) => c.json({ items: current(c)!.brokers, nextCursor: null }));
  v1.post("/brokers", async (c) => {
    const acc = current(c)!;
    const body = await c.req.json<Omit<Broker, "id" | "scope">>();
    if (!body.name) return err(c, 400, "VALIDATION", "name is required");
    const broker: Broker = { id: id("brk"), scope: "USER", ...body };
    acc.brokers.push(broker);
    return c.json(broker, 201);
  });
  v1.patch("/brokers/:id", async (c) => {
    const acc = current(c)!;
    const b = acc.brokers.find((x) => x.id === c.req.param("id"));
    if (!b) return err(c, 404, "NOT_FOUND", "broker not found");
    Object.assign(b, await c.req.json<Partial<Broker>>());
    return c.json(b);
  });
  v1.delete("/brokers/:id", (c) => {
    const acc = current(c)!;
    const i = acc.brokers.findIndex((x) => x.id === c.req.param("id"));
    if (i < 0) return err(c, 404, "NOT_FOUND", "broker not found");
    if (acc.brokers[i]?.scope === "GLOBAL") return err(c, 403, "FORBIDDEN", "global brokers cannot be deleted");
    acc.brokers.splice(i, 1);
    return c.body(null, 204);
  });
  v1.get("/credentials", (c) => {
    const cred = current(c)!.credential;
    return c.json({ items: cred ? [cred] : [] });
  });
  v1.post("/credentials", async (c) => {
    const acc = current(c)!;
    const body = await c.req.json<{ brokerId?: string; apiKey?: string; apiSecret?: string }>();
    if (!body.brokerId || !body.apiKey || !body.apiSecret) return err(c, 400, "VALIDATION", "brokerId, apiKey and apiSecret are required");
    acc.credential = {
      brokerId: body.brokerId,
      apiKeyMasked: maskApiKey(body.apiKey),
      connectedAt: new Date().toISOString(),
      whitelistedIp: WHITELIST_IP,
    };
    return c.json(acc.credential, 201);
  });
  v1.delete("/credentials/:brokerId", (c) => {
    const acc = current(c)!;
    if (!acc.credential || acc.credential.brokerId !== c.req.param("brokerId")) {
      return err(c, 404, "NOT_FOUND", "no credential for that broker");
    }
    acc.credential = null;
    return c.body(null, 204);
  });
  v1.get("/credentials/whitelist-ip", (c) => c.json({ ip: WHITELIST_IP }));
  v1.get("/plan", (c) => c.json(current(c)!.plan));
  app.route("/v1", v1);

  /* ---------------- test hooks ---------------- */
  app.post("/__test/reset", (c) => {
    state.accounts.clear();
    state.sessions.clear();
    state.otps.clear();
    return c.json({ ok: true });
  });
  app.post("/__test/seed", async (c) => {
    const body = await c.req.json<{ email: string; password?: string; role?: "user" | "admin"; plan?: PlanRecord; connected?: boolean }>();
    const acc = createAccount(state, body);
    if (body.plan) acc.plan = body.plan;
    if (body.connected) {
      acc.credential = { brokerId: "brk_delta", apiKeyMasked: "****ab12", connectedAt: new Date().toISOString(), whitelistedIp: WHITELIST_IP };
    }
    return c.json({ ok: true, user: acc.user });
  });
  app.post("/__test/login", async (c) => {
    const body = await c.req.json<{ email: string }>();
    if (!state.accounts.has(body.email.toLowerCase())) createAccount(state, { email: body.email });
    const token = setSession(c, body.email);
    return c.json({ ok: true, token });
  });
  app.get("/__test/otp", (c) => c.json({ otp: TEST_OTP, issued: [...state.otps.keys()] }));

  return { app, state };
}
