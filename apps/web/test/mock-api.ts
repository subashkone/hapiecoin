// In-memory stand-in for apps/api used by unit tests (via app.request) and Playwright (via @hono/node-server).
// Implements the Better Auth routes the web client calls and the /v1 contract from the brief. State is
// deliberately simple: one OTP (123456), sessions in a Map, settings/brokers/credentials per user.
import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Broker, BrokerCredentialPublic, Strategy, StrategyLeg, StrategyLegInput, StrategyOrder, User, UserSettings } from "@hapiecoin/schema";
import { maskApiKey, realizedPnl, toDecimal } from "@hapiecoin/schema";

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
  strategies: Strategy[];
  tradingDisabled: boolean;
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
    strategies: [],
    tradingDisabled: false,
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

  /* ---------------- strategies (Phase 3 item 1, mirrors apps/api/src/routes/strategies.ts) ---------------- */
  const nowIso = () => new Date().toISOString();
  const mkLeg = (input: StrategyLegInput, position: number, extra: Partial<StrategyLeg> = {}): StrategyLeg => ({
    id: id("leg"),
    kind: input.kind,
    side: input.side,
    strike: input.strike,
    expiry: input.expiry,
    symbol: input.symbol,
    lots: input.lots,
    price: input.price,
    entryPrice: null,
    exitPrice: null,
    iv: input.iv ?? null,
    status: "open",
    isAdjustment: false,
    position,
    openedAt: null,
    closedAt: null,
    orderId: null,
    ...extra,
  });
  const findStrategy = (c: Context): Strategy | undefined => current(c)!.strategies.find((s) => s.id === c.req.param("id"));
  const isActive = (s: Strategy) => s.status === "paper" || s.status === "live";
  const lotSizeOf = (c: Context, asset: string) => current(c)!.settings.lotSizes[asset as "BTC"] ?? "0.001";
  const touch = (s: Strategy) => {
    s.updatedAt = nowIso();
    return s;
  };
  const closeLeg = (s: Strategy, leg: StrategyLeg, exitPrice: string, lots: number | undefined, lotSize: string) => {
    const qty = lots ?? leg.lots;
    const realized = realizedPnl({ side: leg.side, lots: qty, entryPrice: leg.entryPrice ?? leg.price, exitPrice }, lotSize);
    const at = nowIso();
    if (qty < leg.lots) {
      leg.lots -= qty;
      const idx = s.legs.indexOf(leg);
      s.legs.splice(idx + 1, 0, { ...leg, id: id("leg"), lots: qty, exitPrice, status: "squared_off", closedAt: at });
    } else {
      leg.exitPrice = exitPrice;
      leg.status = "squared_off";
      leg.closedAt = at;
    }
    s.realizedPnl = toDecimal(Number(s.realizedPnl) + Number(realized));
  };
  v1.get("/strategies", (c) => {
    const status = c.req.query("status");
    const items = current(c)!.strategies.filter((s) => !status || s.status === status);
    return c.json({ items });
  });
  v1.post("/strategies", async (c) => {
    const acc = current(c)!;
    const body = await c.req.json<{ name: string; asset: Strategy["asset"]; templateName?: string; legs: StrategyLegInput[] }>();
    if (!body.name?.trim()) return err(c, 400, "VALIDATION", "Strategy name is required");
    if (!body.legs?.length || body.legs.length > 8) return err(c, 400, "VALIDATION", "1..8 legs");
    const at = nowIso();
    const s: Strategy = { id: id("strat"), name: body.name.trim(), asset: body.asset, status: "draft", tradingMode: null, templateName: body.templateName ?? "Custom", brokerId: null, legs: body.legs.map((l, i) => mkLeg(l, i)), realizedPnl: "0", pnlHistory: [], notes: "", tags: [], orderBatchId: null, orders: [], startedAt: null, closedAt: null, createdAt: at, updatedAt: at };
    acc.strategies.unshift(s);
    return c.json(s, 201);
  });
  v1.get("/strategies/:id", (c) => {
    const s = findStrategy(c);
    return s ? c.json(s) : err(c, 404, "NOT_FOUND", "Strategy not found");
  });
  v1.patch("/strategies/:id", async (c) => {
    const s = findStrategy(c);
    if (!s) return err(c, 404, "NOT_FOUND", "Strategy not found");
    const body = await c.req.json<{ name?: string; templateName?: string; legs?: StrategyLegInput[]; notes?: string; tags?: string[] }>();
    if (body.legs) {
      if (s.status !== "draft") return err(c, 409, "CONFLICT", "Legs can only be replaced on a draft");
      s.legs = body.legs.map((l, i) => mkLeg(l, i));
    }
    if (body.name !== undefined) s.name = body.name;
    if (body.templateName !== undefined) s.templateName = body.templateName;
    if (body.notes !== undefined) s.notes = body.notes;
    if (body.tags !== undefined) s.tags = body.tags;
    return c.json(touch(s));
  });
  v1.delete("/strategies/:id", (c) => {
    const acc = current(c)!;
    const i = acc.strategies.findIndex((s) => s.id === c.req.param("id"));
    if (i < 0) return err(c, 404, "NOT_FOUND", "Strategy not found");
    acc.strategies.splice(i, 1);
    return c.body(null, 204);
  });
  v1.post("/strategies/:id/start", async (c) => {
    const s = findStrategy(c);
    if (!s) return err(c, 404, "NOT_FOUND", "Strategy not found");
    const body = await c.req.json<{ mode: "paper" | "live"; brokerId: string; entries: Record<string, string> }>();
    if (s.status !== "draft") return err(c, 409, "CONFLICT", `Only a draft can be started; this strategy is ${s.status}`);
    if (body.mode === "live") return err(c, 409, "CONFLICT", "Live placement goes through /live/preview and /live/place (ADR-025)");
    if (!current(c)!.brokers.some((b) => b.id === body.brokerId)) return err(c, 400, "BAD_REQUEST", "Select an exchange...");
    const at = nowIso();
    for (const l of s.legs) {
      const entry = body.entries[l.id] ?? l.price;
      Object.assign(l, { entryPrice: entry, price: entry, exitPrice: null, status: "open", openedAt: at, closedAt: null });
    }
    Object.assign(s, { status: "paper", tradingMode: "paper", brokerId: body.brokerId, startedAt: at, closedAt: null, realizedPnl: "0", pnlHistory: [] });
    return c.json(touch(s));
  });
  v1.post("/strategies/:id/legs", async (c) => {
    const s = findStrategy(c);
    if (!s) return err(c, 404, "NOT_FOUND", "Strategy not found");
    if (!isActive(s)) return err(c, 409, "CONFLICT", "Adjustments apply to a paper or live strategy");
    const body = await c.req.json<{ legs: StrategyLegInput[] }>();
    const open = s.legs.filter((l) => l.status === "open").length;
    if (open + body.legs.length > 10) return err(c, 409, "CONFLICT", "Maximum 10 active legs allowed per strategy");
    const at = nowIso();
    const next = s.legs.reduce((m, l) => Math.max(m, l.position), -1) + 1;
    const added = body.legs.map((l, i) => mkLeg(l, next + i, { entryPrice: s.status === "live" ? null : l.price, isAdjustment: true, openedAt: s.status === "live" ? null : at }));
    s.legs.push(...added);
    if (s.status === "live") placeLive(c, s, `adj:${id("b")}`, "adjustment", added);
    return c.json(touch(s));
  });
  v1.post("/strategies/:id/legs/:legId/close", async (c) => {
    const s = findStrategy(c);
    if (!s) return err(c, 404, "NOT_FOUND", "Strategy not found");
    if (!isActive(s)) return err(c, 409, "CONFLICT", "Only legs of a paper or live strategy can be squared off");
    const leg = s.legs.find((l) => l.id === c.req.param("legId"));
    if (!leg) return err(c, 404, "NOT_FOUND", "Leg not found");
    if (leg.status !== "open") return err(c, 409, "CONFLICT", "This leg is already squared off");
    const body = await c.req.json<{ exitPrice: string; lots?: number }>();
    if (body.lots !== undefined && body.lots > leg.lots) return err(c, 400, "BAD_REQUEST", `Exit quantity exceeds the leg's ${leg.lots} lots`);
    const exitPrice = s.status === "live" ? exitLive(c, s, leg, body.lots ?? leg.lots) : body.exitPrice;
    closeLeg(s, leg, exitPrice, body.lots, lotSizeOf(c, s.asset));
    return c.json(touch(s));
  });
  v1.post("/strategies/:id/close", async (c) => {
    const s = findStrategy(c);
    if (!s) return err(c, 404, "NOT_FOUND", "Strategy not found");
    if (!isActive(s)) return err(c, 409, "CONFLICT", "Only a paper or live strategy can be squared off");
    const body = await c.req.json<{ exits: Record<string, string> }>();
    const open = s.legs.filter((l) => l.status === "open");
    if (!open.length) return err(c, 409, "CONFLICT", "Nothing to square off");
    if (s.status !== "live") for (const l of open) if (body.exits[l.id] === undefined) return err(c, 400, "BAD_REQUEST", `Missing exit price for leg ${l.id}`);
    for (const l of open) closeLeg(s, l, s.status === "live" ? exitLive(c, s, l, l.lots) : body.exits[l.id]!, undefined, lotSizeOf(c, s.asset));
    if (s.status === "live") Object.assign(s, { status: "archived", closedAt: nowIso() });
    return c.json(touch(s));
  });
  v1.post("/strategies/:id/stop", async (c) => {
    const s = findStrategy(c);
    if (!s) return err(c, 404, "NOT_FOUND", "Strategy not found");
    if (s.status !== "paper") return err(c, 409, "CONFLICT", "Only a paper strategy can be stopped");
    const body = await c.req.json<{ archive: boolean; exits?: Record<string, string> }>();
    const open = s.legs.filter((l) => l.status === "open");
    if (body.archive) {
      for (const l of open) if (body.exits?.[l.id] === undefined) return err(c, 400, "BAD_REQUEST", `Missing exit price for leg ${l.id}`);
      for (const l of open) closeLeg(s, l, body.exits![l.id]!, undefined, lotSizeOf(c, s.asset));
      Object.assign(s, { status: "archived", closedAt: nowIso() });
    } else {
      for (const l of open) Object.assign(l, { price: l.entryPrice ?? l.price, entryPrice: null, openedAt: null });
      Object.assign(s, { status: "draft", tradingMode: null, startedAt: null, closedAt: null });
    }
    return c.json(touch(s));
  });
  v1.post("/strategies/:id/archive", (c) => {
    const s = findStrategy(c);
    if (!s) return err(c, 404, "NOT_FOUND", "Strategy not found");
    if (s.status !== "draft") return err(c, 409, "CONFLICT", "Only a draft strategy can be archived");
    Object.assign(s, { status: "archived", closedAt: nowIso() });
    return c.json(touch(s));
  });
  v1.post("/strategies/:id/restore", (c) => {
    const s = findStrategy(c);
    if (!s) return err(c, 404, "NOT_FOUND", "Strategy not found");
    if (s.status !== "archived") return err(c, 409, "CONFLICT", "Only an archived strategy can be restored");
    Object.assign(s, { status: "draft", tradingMode: null, closedAt: null });
    return c.json(touch(s));
  });
  v1.post("/strategies/:id/pnl", async (c) => {
    const s = findStrategy(c);
    if (!s) return err(c, 404, "NOT_FOUND", "Strategy not found");
    if (!isActive(s)) return err(c, 409, "CONFLICT", "P&L history is recorded for paper and live strategies");
    const body = await c.req.json<{ day: string; pnl: string }>();
    const existing = s.pnlHistory.find((p) => p.day === body.day);
    if (existing) existing.pnl = body.pnl;
    else s.pnlHistory.push({ day: body.day, pnl: body.pnl });
    s.pnlHistory.sort((a, b) => (a.day < b.day ? -1 : 1));
    return c.json(touch(s));
  });

  /* ---------------- live trading (Phase 3 item 2, mirrors apps/api/src/routes/live.ts on a fake venue) ---------------- */
  const markOf = (l: StrategyLeg) => toDecimal(Number(l.price) * 1.001, 4);
  const contractsOf = (l: StrategyLeg, lotSize: string) => Math.round((l.lots * Number(lotSize)) / 0.001);
  const livePreview = (c: Context, s: Strategy, worstLoss: number | null) => {
    const acc = current(c)!;
    const reasons: string[] = [];
    if (acc.tradingDisabled) reasons.push("Live trading is disabled for this account");
    if (!acc.credential) reasons.push("Connect your exchange in Settings → API Settings to enable live trading");
    const open = s.legs.filter((l) => l.status === "open");
    if (!open.length) reasons.push("Add at least one leg to trade");
    const lotSize = lotSizeOf(c, s.asset);
    const legs = open.map((l) => ({ legId: l.id, symbol: l.symbol, side: l.side, lots: l.lots, contracts: contractsOf(l, lotSize), contractValue: "0.001", productState: "live", mark: markOf(l), notional: toDecimal(contractsOf(l, lotSize) * 0.001 * Number(markOf(l)), 2) }));
    const notional = legs.reduce((a, l) => a + Number(l.notional), 0);
    if (notional > 100_000) reasons.push(`Notional ${toDecimal(notional, 2)} USD exceeds the 100000 USD limit per placement`);
    if (worstLoss !== null && Math.abs(worstLoss) > 4000) reasons.push(`Available USD 4000 is below the worst-loss estimate ${toDecimal(Math.abs(worstLoss), 2)}`);
    return { ok: reasons.length === 0, reasons, legs, notional: toDecimal(notional, 2), available: acc.credential ? "4000" : null, availableAsset: acc.credential ? "USD" : null, limits: { maxLegs: 10, maxNotionalUsd: 100_000, markBandPct: 5 } };
  };
  const placeLive = (c: Context, s: Strategy, batchId: string, purpose: StrategyOrder["purpose"], legs: StrategyLeg[]) => {
    const at = nowIso();
    const lotSize = lotSizeOf(c, s.asset);
    for (const l of legs) {
      const attempt = s.orders.filter((o) => o.legId === l.id && o.purpose !== "exit").length + 1;
      const fail = l.symbol.includes("FAIL");
      const fill = markOf(l);
      s.orders.push({ id: id("ord"), legId: l.id, purpose, clientOrderId: `hc-${l.id}-${attempt}`, venueOrderId: fail ? null : String(700000 + s.orders.length), symbol: l.symbol, side: l.side, size: contractsOf(l, lotSize), state: fail ? "failed" : "filled", fillPrice: fail ? null : fill, error: fail ? "Not enough margin on the exchange for this order" : null, attempts: attempt, createdAt: at, updatedAt: at });
      if (!fail) Object.assign(l, { entryPrice: fill, price: fill, status: "open", openedAt: at, orderId: String(700000 + s.orders.length - 1) });
    }
  };
  const exitLive = (c: Context, s: Strategy, leg: StrategyLeg, lots: number) => {
    const at = nowIso();
    const fill = markOf(leg);
    s.orders.push({ id: id("ord"), legId: leg.id, purpose: "exit", clientOrderId: `hc-${leg.id}-x${s.orders.length + 1}`, venueOrderId: String(800000 + s.orders.length), symbol: leg.symbol, side: leg.side === "buy" ? "sell" : "buy", size: contractsOf({ ...leg, lots }, lotSizeOf(c, s.asset)), state: "closed", fillPrice: fill, error: null, attempts: 1, createdAt: at, updatedAt: at });
    return fill;
  };
  v1.post("/strategies/live/batch", async (c) => {
    const acc = current(c)!;
    const body = await c.req.json<{ ids: string[]; brokerId: string; idempotencyKey: string }>();
    if (acc.tradingDisabled) return err(c, 409, "CONFLICT", "Live trading is disabled for this account");
    if (!acc.credential) return err(c, 409, "CONFLICT", "Connect your exchange in Settings → API Settings to enable live trading");
    const placed: string[] = [];
    const skipped: string[] = [];
    let failed: { id: string; error: string } | null = null;
    for (const sid of body.ids) {
      const s = acc.strategies.find((x) => x.id === sid);
      if (!s || s.status !== "paper") {
        skipped.push(sid);
        continue;
      }
      const key = `${body.idempotencyKey}:${sid}`;
      if (s.orders.some((o) => o.clientOrderId.startsWith("hc-") && s.orderBatchId === key)) {
        placed.push(sid);
        continue;
      }
      const p = livePreview(c, s, null);
      if (!p.ok) {
        failed = { id: sid, error: p.reasons.join(" · ") };
        break;
      }
      Object.assign(s, { status: "live", tradingMode: "live", brokerId: body.brokerId, orderBatchId: key });
      placeLive(c, s, key, "entry", s.legs.filter((l) => l.status === "open"));
      touch(s);
      placed.push(sid);
      if (s.orders.some((o) => o.state === "failed")) {
        failed = { id: sid, error: s.orders.filter((o) => o.state === "failed").map((o) => `${o.symbol}: ${o.error ?? "failed"}`).join(" · ") };
        break;
      }
    }
    return c.json({ placed, failed, skipped });
  });
  v1.get("/strategies/live/positions", (c) => {
    const acc = current(c)!;
    if (!acc.credential) return err(c, 409, "CONFLICT", "Connect your exchange in Settings → API Settings to enable live trading");
    const positions = acc.strategies.filter((s) => s.status === "live").flatMap((s) => s.legs.filter((l) => l.status === "open" && l.entryPrice).map((l) => ({ productId: 100 + s.legs.indexOf(l), symbol: l.symbol, size: (l.side === "buy" ? 1 : -1) * contractsOf(l, lotSizeOf(c, s.asset)), entryPrice: l.entryPrice, realizedPnl: "0", margin: "12" })));
    return c.json({ positions, balances: [{ asset: "USD", balance: "5000", availableBalance: "4000" }] });
  });
  v1.post("/strategies/:id/live/preview", async (c) => {
    const s = findStrategy(c);
    if (!s) return err(c, 404, "NOT_FOUND", "Strategy not found");
    const body = await c.req.json<{ brokerId: string; worstLoss?: number }>();
    return c.json(livePreview(c, s, body.worstLoss ?? null));
  });
  v1.post("/strategies/:id/live/place", async (c) => {
    const s = findStrategy(c);
    if (!s) return err(c, 404, "NOT_FOUND", "Strategy not found");
    const body = await c.req.json<{ brokerId: string; idempotencyKey: string; expected?: Record<string, string> }>();
    if (s.orderBatchId === body.idempotencyKey) return c.json(s);
    if (s.status !== "draft" && s.status !== "paper") return err(c, 409, "CONFLICT", `Only a draft or paper strategy can go live; this strategy is ${s.status}`);
    const p = livePreview(c, s, null);
    if (!p.ok) return err(c, 409, "CONFLICT", p.reasons.join(" · "));
    Object.assign(s, { status: "live", tradingMode: "live", brokerId: body.brokerId, orderBatchId: body.idempotencyKey, startedAt: s.startedAt ?? nowIso(), closedAt: null });
    placeLive(c, s, body.idempotencyKey, "entry", s.legs.filter((l) => l.status === "open"));
    return c.json(touch(s));
  });
  v1.post("/strategies/:id/live/retry", (c) => {
    const s = findStrategy(c);
    if (!s) return err(c, 404, "NOT_FOUND", "Strategy not found");
    if (s.status !== "live") return err(c, 409, "CONFLICT", "Only a live strategy has orders to retry");
    for (const o of s.orders.filter((x) => x.state === "failed")) {
      const leg = s.legs.find((l) => l.id === o.legId);
      if (!leg) continue;
      leg.symbol = leg.symbol.replace("FAIL", "OK"); // the venue accepts on retry in the mock
      Object.assign(o, { state: "filled", venueOrderId: String(700000 + s.orders.length), fillPrice: markOf(leg), error: null, attempts: o.attempts + 1, updatedAt: nowIso() });
      Object.assign(leg, { entryPrice: markOf(leg), price: markOf(leg), openedAt: nowIso() });
    }
    return c.json(touch(s));
  });
  v1.post("/strategies/:id/live/sync", (c) => {
    const s = findStrategy(c);
    if (!s) return err(c, 404, "NOT_FOUND", "Strategy not found");
    return c.json(touch(s));
  });

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
