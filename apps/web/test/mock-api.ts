// In-memory stand-in for apps/api used by unit tests (via app.request) and Playwright (via @hono/node-server).
// Implements the Better Auth routes the web client calls and the /v1 contract from the brief. State is
// deliberately simple: one OTP (123456), sessions in a Map, settings/brokers/credentials per user.
import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AdminCommissionRow, BillingInterval, Broker, BrokerCredentialPublic, CommissionStatus, LimitKey, MenuItem, Plan, PlanLimits, ReferralRow, Strategy, StrategyLeg, StrategyLegInput, StrategyOrder, User, UserSettings } from "@hapiecoin/schema";
import { INTERVAL_MONTHS, LIMIT_KEYS, LIMIT_LABELS, commissionFor, maskApiKey, monthKey, priceBreakdown, realizedPnl, toDecimal } from "@hapiecoin/schema";

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
  /** Billing (ADR-030): the catalogue subscription behind the banner, admin toggles and overrides. */
  subscription: MockSubscription | null;
  /** Set by /__test/seed when a banner state was given: the banner follows that seed, not the catalogue (visual tests). */
  seededBanner: boolean;
  active: boolean;
  limitOverrides: PlanLimits;
  commissionPct: string;
  /** Last session created (HC-AD-109); null for an invited user who never signed in. */
  lastLoginAt: string | null;
  /** Every subscription ever held, for the admin drawer's history (ADR-032). */
  pastSubscriptions: MockSubscription[];
  /** Audit lines targeting this user, newest first (drawer History tab). */
  history: { id: number; action: string; target: string; actorId: string | null; actorEmail: string | null; at: string; after: unknown }[];
}
interface MockSubscription {
  id: string;
  planId: string;
  interval: BillingInterval;
  startsAt: string;
  expiresAt: string | null;
  priceInr: string;
  paidInr: string;
}
/** Referral commission (ADR-031): one per referred subscription, settled by an admin. */
interface MockCommission {
  id: string;
  referrerId: string;
  referredUserId: string;
  subscriptionId: string;
  planName: string;
  interval: BillingInterval | null;
  amountInr: string;
  commissionInr: string;
  commissionPct: string;
  status: CommissionStatus;
  paidAt: string | null;
  note: string | null;
  proofUrl: string | null;
  createdAt: string;
  updatedAt: string;
}
interface PlanRecord {
  state: "free" | "active" | "expiring_soon" | "expired";
  planName?: string;
  expiresAt?: string;
  daysLeft?: number;
}

export interface MockState {
  plans: Plan[];
  menuItems: MenuItem[];
  accounts: Map<string, Account>;
  commissions: MockCommission[];
  /** Invitations "sent" by POST /v1/admin/users/invite (the API mails them). */
  invites: { email: string; name: string; invitedBy: string; link: string }[];
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


function seedMenuItems(): MenuItem[] {
  const at = "2026-09-01T00:00:00.000Z";
  return [
    { id: "mnu_market_analytics", displayName: "Market Analytics", category: "Analytics", priceInr: "299", active: true, linkedPlans: 0, createdAt: at, updatedAt: at },
    { id: "mnu_reports_export", displayName: "Reports Export", category: "Data", priceInr: "199", active: true, linkedPlans: 0, createdAt: at, updatedAt: at },
    { id: "mnu_alerts", displayName: "Price & P&L Alerts", category: "Trading", priceInr: "149", active: true, linkedPlans: 0, createdAt: at, updatedAt: at },
  ];
}
function seedPlans(): Plan[] {
  const at = "2026-09-01T00:00:00.000Z";
  const tier = (monthly: number, quarterly: number, yearly: number, discount: number, limits: PlanLimits): Plan["intervals"] => {
    const one = (price: number) => ({ priceInr: String(price), discountPriceInr: discount > 0 && price > 0 ? String(Math.round(price * (1 - discount / 100))) : null, limits });
    return { monthly: one(monthly), quarterly: one(quarterly), yearly: one(yearly) };
  };
  return [
    { id: "pln_free", name: "Free", description: "Explore the chain, build strategies and paper trade a little.", features: ["Live options chain", "Strategy builder and 28 templates", "3 paper trades a month"], intervals: tier(0, 0, 0, 0, { paper_trading: 3, templates: 5 }), menuItemIds: [], active: true, sortOrder: 0, createdAt: at, updatedAt: at },
    { id: "pln_basic", name: "Basic", description: "For traders who paper trade every day.", features: ["Everything in Free", "25 paper trades a month", "Unlimited saved strategies", "Price alerts"], intervals: tier(499, 1299, 4499, 10, { paper_trading: 25, templates: 0, alerts: 10 }), menuItemIds: ["mnu_alerts"], active: true, sortOrder: 10, createdAt: at, updatedAt: at },
    { id: "pln_pro", name: "Pro", description: "Live trading on Delta Exchange India with analytics.", features: ["Everything in Basic", "Unlimited paper trades", "50 live trades a month", "Market analytics"], intervals: tier(999, 2699, 8999, 15, { paper_trading: 0, live_trading: 50, templates: 0, alerts: 50 }), menuItemIds: ["mnu_alerts", "mnu_market_analytics"], active: true, sortOrder: 20, createdAt: at, updatedAt: at },
    { id: "pln_elite", name: "Elite", description: "No limits, every module, priority support.", features: ["Everything in Pro", "Unlimited live trades", "Reports export", "Priority support"], intervals: tier(1999, 5399, 17999, 20, { paper_trading: 0, live_trading: 0, templates: 0, alerts: 0 }), menuItemIds: ["mnu_alerts", "mnu_market_analytics", "mnu_reports_export"], active: true, sortOrder: 30, createdAt: at, updatedAt: at },
  ];
}

export function createAccount(
  state: MockState,
  input: { email: string; password?: string; name?: string; mobile?: string; role?: "user" | "admin"; verified?: boolean; createdAt?: string },
): Account {
  const email = input.email.toLowerCase();
  const user: User = {
    id: id("usr"),
    email,
    name: input.name ?? "Asha Trader",
    role: input.role ?? "user",
    avatar: "rocket",
    referralCode: state.accounts.size === 0 ? "ASHA2026" : `ASHA${(state.accounts.size + 2026).toString(36).toUpperCase()}`,
    createdAt: input.createdAt ?? new Date("2026-09-01T10:00:00Z").toISOString(),
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
    // like the API test harness: accounts start on Elite (no limits) so trading tests stay about trading; billing tests clear it
    subscription: { id: id("sub"), planId: "pln_elite", interval: "yearly", startsAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), priceInr: "17999", paidInr: "0" },
    seededBanner: false,
    active: true,
    limitOverrides: {},
    commissionPct: "0",
    lastLoginAt: null,
    pastSubscriptions: [],
    history: [],
  };
  state.accounts.set(email, acc);
  return acc;
}

export function createSession(state: MockState, email: string): string {
  const token = id("ses");
  state.sessions.set(token, email.toLowerCase());
  const acc = state.accounts.get(email.toLowerCase());
  if (acc) acc.lastLoginAt = new Date().toISOString();
  return token;
}

export function createMockApi(state: MockState = { plans: seedPlans(),
    menuItems: seedMenuItems(),
    accounts: new Map(), commissions: [], invites: [], sessions: new Map(), otps: new Map() }) {
  const app = new Hono();

  const err = (c: Context, status: 400 | 401 | 402 | 403 | 404 | 409, code: string, message: string) =>
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
    const blockedPaper = assertEntitled(c, current(c)!, "paper_trading");
    if (blockedPaper) return blockedPaper;
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
    return { ok: reasons.length === 0, reasons, legs, notional: toDecimal(notional, 2), available: acc.credential ? "4000" : null, availableAsset: acc.credential ? "USD" : null, marginUsed: acc.credential ? "12" : null, limits: { maxLegs: 10, maxNotionalUsd: 100_000, markBandPct: 5 } };
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
    const positions = acc.strategies.filter((s) => s.status === "live").flatMap((s) => s.legs.filter((l) => l.status === "open" && l.entryPrice).map((l) => ({ productId: 100 + s.legs.indexOf(l), symbol: l.symbol, size: (l.side === "buy" ? 1 : -1) * contractsOf(l, lotSizeOf(c, s.asset)), entryPrice: l.entryPrice, realizedPnl: "0", margin: "12", contractValue: lotSizeOf(c, s.asset), mark: markOf(l) })));
    return c.json({ positions, balances: [{ asset: "USD", balance: "5000", availableBalance: "4000" }] });
  });
  v1.post("/strategies/live/positions/exit", async (c) => {
    const acc = current(c)!;
    if (!acc.credential) return err(c, 409, "CONFLICT", "Connect your exchange in Settings → API Settings to enable live trading");
    const body = await c.req.json<{ brokerId: string; productIds: number[]; idempotencyKey: string }>();
    const closed: { productId: number; fillPrice: string | null; state: string }[] = [];
    const failed: { productId: number; error: string }[] = [];
    for (const productId of body.productIds) {
      let hit = false;
      for (const s of acc.strategies.filter((x) => x.status === "live")) {
        const leg = s.legs[productId - 100];
        if (!leg || leg.status !== "open" || !leg.entryPrice) continue;
        hit = true;
        if (leg.symbol.includes("FAIL")) {
          failed.push({ productId, error: "Not enough margin on the exchange for this order" });
          break;
        }
        const fill = exitLive(c, s, leg, leg.lots);
        closeLeg(s, leg, fill, undefined, lotSizeOf(c, s.asset));
        if (s.legs.every((l) => l.status !== "open")) Object.assign(s, { status: "archived", closedAt: nowIso() });
        touch(s);
        closed.push({ productId, fillPrice: fill, state: "closed" });
        break;
      }
      if (!hit) failed.push({ productId, error: "No open position for this product" });
    }
    return c.json({ closed, failed });
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
    const blockedLive = assertEntitled(c, current(c)!, "live_trading");
    if (blockedLive) return blockedLive;
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

  /* ---------------- billing (Phase 4 item 1, ADR-030; mirrors apps/api/src/routes/billing.ts) ---------------- */
  const planOf = (id: string) => state.plans.find((p) => p.id === id);
  const activeSub = (acc: Account) => {
    const s = acc.subscription;
    if (!s) return null;
    if (s.expiresAt && new Date(s.expiresAt).getTime() <= Date.now()) return null;
    return s;
  };
  const usageOf = (acc: Account) => {
    const since = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).getTime();
    const started = acc.strategies.filter((s) => s.startedAt && new Date(s.startedAt).getTime() >= since);
    return { paper_trading: started.filter((s) => s.tradingMode === "paper").length, live_trading: started.filter((s) => s.tradingMode === "live").length, alerts: 0, templates: acc.strategies.filter((s) => s.status === "draft").length };
  };
  const entitlementsOf = (acc: Account) => {
    const sub = activeSub(acc);
    const plan = (sub ? planOf(sub.planId) : undefined) ?? state.plans.find((p) => p.active && Number(p.intervals.monthly.priceInr) === 0);
    const limits = plan ? plan.intervals[sub?.interval ?? "monthly"].limits : {};
    const used = usageOf(acc);
    const entitlements = LIMIT_KEYS.map((key) => {
      const o = acc.limitOverrides[key];
      const l = limits[key];
      if (o !== undefined && o > 0) return { key, limit: o, included: true, used: used[key], overridden: true };
      if (l === undefined) return { key, limit: 0, included: false, used: used[key], overridden: false };
      return { key, limit: l === 0 ? null : l, included: true, used: used[key], overridden: false };
    });
    return { plan, sub, entitlements };
  };
  const planStateOf = (acc: Account): PlanRecord => {
    const sub = acc.subscription;
    if (acc.seededBanner) return acc.plan; // e2e seedUser fixed the banner text
    if (!sub) return { state: "free" };
    const plan = planOf(sub.planId);
    if (!sub.expiresAt) return { state: "active", planName: plan?.name ?? "Plan" };
    const daysLeft = Math.ceil((new Date(sub.expiresAt).getTime() - Date.now()) / 86_400_000);
    if (daysLeft <= 0) return { state: "expired", planName: plan?.name ?? "Plan", expiresAt: sub.expiresAt, daysLeft: 0 };
    return { state: daysLeft <= 7 ? "expiring_soon" : "active", planName: plan?.name ?? "Plan", expiresAt: sub.expiresAt, daysLeft };
  };
  const subscriptionView = (acc: Account) => {
    const { plan, sub, entitlements } = entitlementsOf(acc);
    return {
      plan: planStateOf(acc),
      current: sub ? { id: sub.id, planId: sub.planId, planName: planOf(sub.planId)?.name ?? "Plan", interval: sub.interval, status: "active", startsAt: sub.startsAt, expiresAt: sub.expiresAt, priceInr: sub.priceInr, paidInr: sub.paidInr, currency: "INR" } : null,
      effectivePlan: plan ?? null,
      entitlements,
      plans: state.plans.filter((p) => p.active).sort((a, b) => a.sortOrder - b.sortOrder),
      menuItems: plan ? state.menuItems.filter((m) => m.active && plan.menuItemIds.includes(m.id)).map((m) => m.displayName).sort() : [],
      accountActive: acc.active,
    };
  };
  /** 403 UPGRADE_REQUIRED like the API (HC-SH-054). */
  const assertEntitled = (c: Context, acc: Account, key: LimitKey): Response | null => {
    if (!acc.active) return err(c, 403, "ACCOUNT_DEACTIVATED", "Your account has been deactivated. Contact support.");
    const { plan, entitlements } = entitlementsOf(acc);
    const e = entitlements.find((x) => x.key === key)!;
    const name = plan?.name ?? "current";
    if (!e.included) return err(c, 403, "UPGRADE_REQUIRED", `${key === "live_trading" ? "Live trading" : key === "paper_trading" ? "Paper trading" : key} is not included in your ${name} plan. Upgrade to unlock it.`);
    if (e.limit !== null && e.used >= e.limit) return err(c, 403, "UPGRADE_REQUIRED", `Your ${name} plan allows ${e.limit} ${LIMIT_LABELS[key].toLowerCase()}; you have used ${e.used} this month. Upgrade for more.`);
    return null;
  };
  v1.get("/plans", (c) => c.json({ items: state.plans.filter((p) => p.active).sort((a, b) => a.sortOrder - b.sortOrder) }));
  v1.get("/subscription", (c) => c.json(subscriptionView(current(c)!)));
  /* ---------------- referrals and commissions (ADR-031) ---------------- */
  const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
  const accById = (uid: string) => [...state.accounts.values()].find((a) => a.user.id === uid);
  const referrerOf = (acc: Account) => (acc.referredBy ? [...state.accounts.values()].find((a) => a.user.referralCode === acc.referredBy) : undefined);
  const recordCommission = (acc: Account) => {
    const sub = acc.subscription;
    const referrer = referrerOf(acc);
    if (!sub || !referrer || referrer === acc) return;
    const at = nowIso();
    const commissionInr = commissionFor(sub.paidInr, referrer.commissionPct);
    const status: CommissionStatus = Number(commissionInr) > 0 ? "pending" : "not_paid";
    const planName = planOf(sub.planId)?.name ?? "";
    const existing = state.commissions.find((x) => x.subscriptionId === sub.id);
    if (existing) {
      if (existing.status !== "paid") Object.assign(existing, { amountInr: sub.paidInr, commissionInr, commissionPct: referrer.commissionPct, planName, interval: sub.interval, status, updatedAt: at });
      return;
    }
    state.commissions.push({ id: id("cms"), referrerId: referrer.user.id, referredUserId: acc.user.id, subscriptionId: sub.id, planName, interval: sub.interval, amountInr: sub.paidInr, commissionInr, commissionPct: referrer.commissionPct, status, paidAt: null, note: null, proofUrl: null, createdAt: at, updatedAt: at });
  };
  const latestByReferred = (referrerId: string) => {
    const m = new Map<string, MockCommission>();
    for (const x of [...state.commissions].filter((x) => x.referrerId === referrerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))) if (!m.has(x.referredUserId)) m.set(x.referredUserId, x);
    return m;
  };
  const referralRow = (u: Account, x: MockCommission | undefined): ReferralRow => ({ userId: u.user.id, name: u.user.name, email: u.user.email, joinedAt: u.user.createdAt, planName: x?.planName ?? null, interval: x?.interval ?? null, amountInr: x?.amountInr ?? "0", commissionInr: x?.commissionInr ?? "0", status: x?.status ?? "not_paid", month: monthKey(x?.createdAt ?? u.user.createdAt) });
  const referredOf = (acc: Account) => [...state.accounts.values()].filter((a) => a.referredBy === acc.user.referralCode && a !== acc).sort((a, b) => b.user.createdAt.localeCompare(a.user.createdAt));
  const byMonth = (rows: MockCommission[]) => {
    const m = new Map<string, { paid: number; pending: number }>();
    for (const r of rows) {
      const k = monthKey(r.createdAt);
      const b = m.get(k) ?? { paid: 0, pending: 0 };
      if (r.status === "paid") b.paid += Number(r.commissionInr);
      if (r.status === "pending") b.pending += Number(r.commissionInr);
      m.set(k, b);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12).map(([month, b]) => ({ month, paidInr: money(b.paid), pendingInr: money(b.pending) }));
  };
  const sumOf = (rows: MockCommission[], s: CommissionStatus) => rows.filter((r) => r.status === s).reduce((t, r) => t + Number(r.commissionInr), 0);
  v1.get("/referrals", (c) => {
    const acc = current(c)!;
    const latest = latestByReferred(acc.user.id);
    const all = state.commissions.filter((x) => x.referrerId === acc.user.id);
    const paid = sumOf(all, "paid");
    const pending = sumOf(all, "pending");
    const referred = referredOf(acc);
    return c.json({ code: acc.user.referralCode, link: `http://localhost:3000/auth?tab=signup&ref=${acc.user.referralCode}`, commissionPct: acc.commissionPct, stats: { referrals: referred.length, earnedInr: money(paid + pending), paidInr: money(paid), pendingInr: money(pending) }, rows: referred.map((u) => referralRow(u, latest.get(u.user.id))), byMonth: byMonth(all) });
  });
  const adminGate = (c: Context): Response | null => (current(c)!.user.role === "admin" ? null : err(c, 403, "FORBIDDEN", "Admin only"));
  v1.get("/admin/commissions", (c) => {
    const denied = adminGate(c);
    if (denied) return denied;
    const q = (c.req.query("q") ?? "").toLowerCase();
    const month = c.req.query("month") ?? "";
    if (month && !/^\d{4}-\d{2}$/.test(month)) return err(c, 400, "INVALID_BODY", "month must be YYYY-MM");
    const all = state.commissions;
    const months = [...new Set(all.map((r) => monthKey(r.createdAt)))].sort().reverse();
    const inMonth = month ? all.filter((r) => monthKey(r.createdAt) === month) : all;
    const rows: AdminCommissionRow[] = [...new Set(inMonth.map((r) => r.referrerId))]
      .map((rid) => ({ acc: accById(rid)!, mine: inMonth.filter((r) => r.referrerId === rid) }))
      .filter(({ acc }) => acc && (!q || acc.user.name.toLowerCase().includes(q) || acc.user.email.toLowerCase().includes(q)))
      .map(({ acc, mine }): AdminCommissionRow => {
        const paid = sumOf(mine, "paid");
        const pending = sumOf(mine, "pending");
        const lastNote = mine.filter((r) => r.note).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.note ?? null;
        return { referrerId: acc.user.id, name: acc.user.name, email: acc.user.email, referrals: new Set(mine.map((r) => r.referredUserId)).size, commissionPct: acc.commissionPct, totalInr: money(paid + pending), paidInr: money(paid), pendingInr: money(pending), status: pending > 0 ? "pending" : paid > 0 ? "paid" : "not_paid", lastNote };
      })
      .sort((a, b) => Number(b.pendingInr) - Number(a.pendingInr) || a.name.localeCompare(b.name));
    const tiles = rows.reduce((t, r) => ({ total: t.total + Number(r.totalInr), paid: t.paid + Number(r.paidInr), pending: t.pending + Number(r.pendingInr) }), { total: 0, paid: 0, pending: 0 });
    return c.json({ tiles: { totalInr: money(tiles.total), paidInr: money(tiles.paid), pendingInr: money(tiles.pending) }, rows, byMonth: byMonth(inMonth), months });
  });
  v1.get("/admin/commissions/:id", (c) => {
    const denied = adminGate(c);
    if (denied) return denied;
    const acc = accById(c.req.param("id"));
    if (!acc) return err(c, 404, "NOT_FOUND", "Referrer not found");
    const latest = latestByReferred(acc.user.id);
    return c.json({ referrer: { id: acc.user.id, name: acc.user.name, email: acc.user.email, commissionPct: acc.commissionPct }, rows: referredOf(acc).map((u) => referralRow(u, latest.get(u.user.id))) });
  });
  v1.post("/admin/commissions/:id/mark", async (c) => {
    const denied = adminGate(c);
    if (denied) return denied;
    const body = await c.req.json<{ status: "paid" | "not_paid"; note?: string; proofUrl?: string }>();
    if (body.status === "not_paid" && !body.note?.trim()) return err(c, 400, "INVALID_BODY", "A reason is required when marking Not Paid");
    const acc = accById(c.req.param("id"));
    if (!acc) return err(c, 404, "NOT_FOUND", "Referrer not found");
    const pending = state.commissions.filter((x) => x.referrerId === acc.user.id && x.status === "pending");
    if (pending.length === 0) return err(c, 409, "CONFLICT", "Nothing pending for this referrer");
    const at = nowIso();
    for (const x of pending) Object.assign(x, { status: body.status, paidAt: body.status === "paid" ? at : null, ...(body.note !== undefined ? { note: body.note } : {}), ...(body.proofUrl !== undefined ? { proofUrl: body.proofUrl } : {}), updatedAt: at });
    return c.json({ rows: pending.length, amountInr: money(pending.reduce((t, x) => t + Number(x.commissionInr), 0)) });
  });
  v1.post("/admin/commissions/bulk-pay", async (c) => {
    const denied = adminGate(c);
    if (denied) return denied;
    const body = await c.req.json<{ referrerIds?: string[] }>();
    const pending = state.commissions.filter((x) => x.status === "pending" && (!body.referrerIds || body.referrerIds.includes(x.referrerId)));
    const at = nowIso();
    for (const x of pending) Object.assign(x, { status: "paid", paidAt: at, note: "bulk pay", updatedAt: at });
    return c.json({ settledRows: pending.length, referrers: new Set(pending.map((x) => x.referrerId)).size, amountInr: money(pending.reduce((t, x) => t + Number(x.commissionInr), 0)) });
  });

  v1.post("/subscription/activate", async (c) => {
    const acc = current(c)!;
    const body = await c.req.json<{ planId: string; interval: BillingInterval }>();
    if (!acc.active) return err(c, 403, "FORBIDDEN", "Your account has been deactivated. Contact support.");
    const plan = planOf(body.planId);
    if (!plan || !plan.active) return err(c, 404, "NOT_FOUND", "Plan not found");
    const pricing = plan.intervals[body.interval];
    const total = priceBreakdown(pricing).total;
    if (total > 0) return err(c, 402, "PAYMENT_REQUIRED", `${plan.name} · ${body.interval} costs ₹${total.toFixed(2)}; checkout arrives with Razorpay in the next release`);
    const cur = activeSub(acc);
    if (cur && cur.planId === plan.id && cur.interval === body.interval) return err(c, 409, "CONFLICT", `You are already on ${plan.name} · ${body.interval}`);
    const startsAt = nowIso();
    acc.subscription = { id: id("sub"), planId: plan.id, interval: body.interval, startsAt, expiresAt: Number(pricing.priceInr) === 0 ? null : new Date(Date.now() + INTERVAL_MONTHS[body.interval] * 30 * 86_400_000).toISOString(), priceInr: pricing.priceInr, paidInr: "0" };
    acc.seededBanner = false; // the catalogue subscription now drives the banner
    acc.plan = planStateOf(acc);
    recordCommission(acc);
    return c.json(subscriptionView(acc));
  });
  const adminOnly = (c: Context): Response | null => (current(c)!.user.role === "admin" ? null : err(c, 403, "FORBIDDEN", "Admin only"));
  v1.get("/admin/plans", (c) => adminOnly(c) ?? c.json({ items: [...state.plans].sort((a, b) => a.sortOrder - b.sortOrder) }));
  v1.post("/admin/plans", async (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    const body = await c.req.json<Omit<Plan, "id" | "createdAt" | "updatedAt">>();
    if (!body.name) return err(c, 400, "VALIDATION", "Plan name is required");
    if (state.plans.some((p) => p.name.toLowerCase() === body.name.toLowerCase())) return err(c, 409, "CONFLICT", `A plan named ${body.name} already exists`);
    const at = nowIso();
    const plan: Plan = { id: id("pln"), ...body, createdAt: at, updatedAt: at };
    state.plans.push(plan);
    return c.json(plan, 201);
  });
  v1.patch("/admin/plans/:id", async (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    const plan = planOf(c.req.param("id"));
    if (!plan) return err(c, 404, "NOT_FOUND", "Plan not found");
    const body = await c.req.json<Partial<Plan>>();
    Object.assign(plan, body, { updatedAt: nowIso() });
    return c.json(plan);
  });
  v1.post("/admin/plans/bulk", async (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    const body = await c.req.json<{ ids: string[]; active: boolean }>();
    const items = state.plans.filter((p) => body.ids.includes(p.id));
    for (const p of items) Object.assign(p, { active: body.active, updatedAt: nowIso() });
    return c.json({ items });
  });
  const linked = (mid: string) => state.plans.filter((p) => p.menuItemIds.includes(mid)).length;
  v1.get("/admin/menu-items", (c) => adminOnly(c) ?? c.json({ items: state.menuItems.map((m) => ({ ...m, linkedPlans: linked(m.id) })) }));
  v1.post("/admin/menu-items", async (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    const body = await c.req.json<{ displayName: string; category: string; priceInr: string; active?: boolean }>();
    if (!body.displayName) return err(c, 400, "VALIDATION", "Display Name is required");
    const at = nowIso();
    const item: MenuItem = { id: id("mnu"), displayName: body.displayName, category: body.category, priceInr: body.priceInr, active: body.active ?? true, linkedPlans: 0, createdAt: at, updatedAt: at };
    state.menuItems.push(item);
    return c.json(item, 201);
  });
  v1.patch("/admin/menu-items/:id", async (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    const item = state.menuItems.find((m) => m.id === c.req.param("id"));
    if (!item) return err(c, 404, "NOT_FOUND", "Menu item not found");
    Object.assign(item, await c.req.json<Partial<MenuItem>>(), { updatedAt: nowIso() });
    return c.json({ ...item, linkedPlans: linked(item.id) });
  });
  v1.post("/admin/menu-items/bulk", async (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    const body = await c.req.json<{ ids: string[]; active: boolean }>();
    const items = state.menuItems.filter((m) => body.ids.includes(m.id));
    for (const m of items) Object.assign(m, { active: body.active, updatedAt: nowIso() });
    return c.json({ items: items.map((m) => ({ ...m, linkedPlans: linked(m.id) })) });
  });
  const adminRow = (acc: Account) => {
    const sub = activeSub(acc);
    const plan = sub ? planOf(sub.planId) : undefined;
    return {
      id: acc.user.id,
      email: acc.user.email,
      name: acc.user.name,
      role: acc.user.role,
      active: acc.active,
      planName: plan?.name ?? (acc.plan.planName ?? null),
      planId: sub?.planId ?? null,
      interval: sub?.interval ?? null,
      startsAt: sub?.startsAt ?? null,
      expiresAt: sub?.expiresAt ?? acc.plan.expiresAt ?? null,
      validityDays: sub && sub.expiresAt ? Math.max(1, Math.round((new Date(sub.expiresAt).getTime() - new Date(sub.startsAt).getTime()) / 86_400_000)) : null,
      referrals: [...state.accounts.values()].filter((a) => a.referredBy === acc.user.referralCode).length,
      commissionPct: acc.commissionPct,
      limitOverrides: acc.limitOverrides,
      lotSizes: acc.settings.lotSizes,
      createdAt: acc.user.createdAt,
      mobile: acc.user.mobile ?? null,
      referralCode: acc.user.referralCode,
      paidInr: money([...acc.pastSubscriptions, ...(acc.subscription ? [acc.subscription] : [])].reduce((t, s) => t + Number(s.paidInr), 0)),
      lastLoginAt: acc.lastLoginAt,
    };
  };
  const accByUserId = (uid: string) => [...state.accounts.values()].find((a) => a.user.id === uid);
  const rowStatus = (r: ReturnType<typeof adminRow>, status: string) => {
    if (status === "all") return true;
    if (status === "deactivated") return !r.active;
    if (status === "free") return r.planName === null;
    if (status === "active") return r.planName !== null && (r.expiresAt === null || new Date(r.expiresAt).getTime() > Date.now());
    return r.planName !== null && r.expiresAt !== null && new Date(r.expiresAt).getTime() <= Date.now();
  };
  /** Comped plan change (ADR-032): the current subscription moves to history, the new one starts now at ₹0. */
  const setPlanFor = (acc: Account, plan: Plan, interval: BillingInterval) => {
    if (acc.subscription) acc.pastSubscriptions.push({ ...acc.subscription });
    const pricing = plan.intervals[interval];
    acc.subscription = { id: id("sub"), planId: plan.id, interval, startsAt: nowIso(), expiresAt: Number(pricing.priceInr) === 0 ? null : new Date(Date.now() + INTERVAL_MONTHS[interval] * 30 * 86_400_000).toISOString(), priceInr: pricing.priceInr, paidInr: "0" };
    acc.seededBanner = false;
    acc.plan = planStateOf(acc);
    recordCommission(acc);
  };
  const subView = (s: MockSubscription, active: boolean) => ({
    id: s.id,
    planId: s.planId,
    planName: planOf(s.planId)?.name ?? "",
    interval: s.interval,
    status: active ? (s.expiresAt !== null && new Date(s.expiresAt).getTime() <= Date.now() ? "expired" : "active") : "cancelled",
    startsAt: s.startsAt,
    expiresAt: s.expiresAt,
    validityDays: s.expiresAt ? Math.max(1, Math.round((new Date(s.expiresAt).getTime() - new Date(s.startsAt).getTime()) / 86_400_000)) : null,
    daysLeft: active && s.expiresAt ? Math.max(0, Math.round((new Date(s.expiresAt).getTime() - Date.now()) / 86_400_000)) : null,
    priceInr: s.priceInr,
    paidInr: s.paidInr,
  });
  v1.get("/admin/users/:id", (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    const acc = accByUserId(c.req.param("id"));
    if (!acc) return err(c, 404, "NOT_FOUND", "User not found");
    const sub = activeSub(acc);
    const plan = sub ? planOf(sub.planId) : state.plans.find((p) => Number(p.intervals.monthly.priceInr) === 0);
    const latest = latestByReferred(acc.user.id);
    const all = state.commissions.filter((x) => x.referrerId === acc.user.id);
    const referred = referredOf(acc);
    return c.json({
      user: adminRow(acc),
      subscription: sub ? subView(sub, true) : null,
      subscriptions: [...(acc.subscription ? [subView(acc.subscription, true)] : []), ...[...acc.pastSubscriptions].reverse().map((s) => subView(s, false))],
      planDefaults: { planName: plan?.name ?? "Free", limits: plan?.intervals[sub?.interval ?? "monthly"].limits ?? {} },
      referrals: { code: acc.user.referralCode, commissionPct: acc.commissionPct, count: referred.length, earnedInr: money(sumOf(all, "paid") + sumOf(all, "pending")), paidInr: money(sumOf(all, "paid")), pendingInr: money(sumOf(all, "pending")), rows: referred.map((u) => referralRow(u, latest.get(u.user.id))) },
      history: acc.history,
    });
  });
  v1.post("/admin/users/:id/plan", async (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    const acc = accByUserId(c.req.param("id"));
    if (!acc) return err(c, 404, "NOT_FOUND", "User not found");
    const body = await c.req.json<{ planId: string; interval: BillingInterval }>();
    const plan = planOf(body.planId);
    if (!plan || !plan.active) return err(c, 404, "NOT_FOUND", "Plan not found");
    setPlanFor(acc, plan, body.interval);
    acc.history.unshift({ id: acc.history.length + 1, action: "admin.user.set_plan", target: `user:${acc.user.id}`, actorId: current(c)!.user.id, actorEmail: current(c)!.user.email, at: nowIso(), after: { planName: plan.name, interval: body.interval, paidInr: "0" } });
    return c.json(adminRow(acc));
  });
  v1.post("/admin/users/bulk-plan", async (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    const body = await c.req.json<{ ids: string[]; planId: string; interval: BillingInterval }>();
    const plan = planOf(body.planId);
    if (!plan || !plan.active) return err(c, 404, "NOT_FOUND", "Plan not found");
    let updated = 0;
    for (const acc of state.accounts.values()) if (body.ids.includes(acc.user.id)) { setPlanFor(acc, plan, body.interval); updated += 1; }
    return c.json({ updated, planName: updated ? plan.name : "" });
  });
  v1.post("/admin/users/invite", async (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    const body = await c.req.json<{ name: string; email: string; mobile?: string; planId?: string; interval?: BillingInterval }>();
    if (!body.name?.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email ?? "")) return err(c, 400, "VALIDATION", "name and a valid email are required");
    if (state.accounts.has(body.email.toLowerCase())) return err(c, 409, "CONFLICT", `${body.email.toLowerCase()} already has an account`);
    const acc = createAccount(state, { email: body.email, name: body.name.trim(), ...(body.mobile ? { mobile: body.mobile } : {}), verified: false });
    acc.subscription = null; // invited users start without a plan unless one is comped below
    acc.plan = planStateOf(acc);
    if (body.planId && body.interval) {
      const plan = planOf(body.planId);
      if (!plan) return err(c, 404, "NOT_FOUND", "Plan not found");
      setPlanFor(acc, plan, body.interval);
    }
    state.invites.push({ email: acc.user.email, name: acc.user.name, invitedBy: current(c)!.user.name, link: `http://localhost:3000/auth?tab=login&email=${encodeURIComponent(acc.user.email)}` });
    acc.history.unshift({ id: 1, action: "admin.user.invite", target: `user:${acc.user.id}`, actorId: current(c)!.user.id, actorEmail: current(c)!.user.email, at: nowIso(), after: { email: acc.user.email } });
    return c.json(adminRow(acc), 201);
  });
  v1.get("/admin/users", (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    const q = (c.req.query("q") ?? "").toLowerCase();
    const status = c.req.query("status") ?? "all";
    const planFilter = c.req.query("plan") ?? "all";
    const sort = (c.req.query("sort") ?? "createdAt") as keyof ReturnType<typeof adminRow>;
    const dir = c.req.query("dir") === "asc" ? 1 : -1;
    const page = Number(c.req.query("page") ?? "1");
    const rows = [...state.accounts.values()]
      .map(adminRow)
      .filter((r) => !q || r.email.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))
      .filter((r) => rowStatus(r, status))
      .filter((r) => planFilter === "all" || (planFilter === "free" ? r.planId === null : r.planId === planFilter))
      .sort((a, b) => {
        const av = a[sort] as string | number | null;
        const bv = b[sort] as string | number | null;
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        const cmp = sort === "paidInr" ? Number(av) - Number(bv) : String(av).localeCompare(String(bv));
        return cmp * dir || a.id.localeCompare(b.id);
      });
    return c.json({ items: rows.slice((page - 1) * 10, page * 10), total: rows.length, page, pageSize: 10 });
  });
  v1.patch("/admin/users/:id", async (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    const acc = [...state.accounts.values()].find((a) => a.user.id === c.req.param("id"));
    if (!acc) return err(c, 404, "NOT_FOUND", "User not found");
    const body = await c.req.json<{ validityDays?: number; active?: boolean; commissionPct?: string; limitOverrides?: PlanLimits; lotSizes?: Record<string, string>; name?: string; mobile?: string | null; role?: "user" | "admin" }>();
    const me = current(c)!;
    if (body.active === false && acc === me) return err(c, 409, "CONFLICT", "You cannot deactivate your own account");
    if (body.role !== undefined) {
      if (acc === me) return err(c, 409, "CONFLICT", "You cannot change your own role");
      if (body.role === "admin" && !acc.active) return err(c, 409, "CONFLICT", "Activate the account before making it an admin");
      if (body.role === "user" && acc.user.role === "admin" && [...state.accounts.values()].filter((a) => a.user.role === "admin" && a.active).length <= 1) return err(c, 409, "CONFLICT", "HapieCoin needs at least one active admin");
      acc.user.role = body.role;
    }
    if (body.name !== undefined) acc.user.name = body.name;
    if (body.mobile !== undefined) {
      if (body.mobile === null) delete acc.user.mobile;
      else acc.user.mobile = body.mobile;
    }
    if (body.validityDays !== undefined) {
      const sub = activeSub(acc);
      if (!sub) return err(c, 409, "CONFLICT", "This user has no active subscription to extend");
      sub.expiresAt = new Date(new Date(sub.startsAt).getTime() + body.validityDays * 86_400_000).toISOString();
      acc.plan = planStateOf(acc);
    }
    if (body.active !== undefined) acc.active = body.active;
    if (body.commissionPct !== undefined) acc.commissionPct = body.commissionPct;
    if (body.limitOverrides !== undefined) acc.limitOverrides = body.limitOverrides;
    if (body.lotSizes !== undefined) acc.settings.lotSizes = { ...acc.settings.lotSizes, ...body.lotSizes };
    acc.history.unshift({ id: acc.history.length + 1, action: "admin.user.update", target: `user:${acc.user.id}`, actorId: me.user.id, actorEmail: me.user.email, at: nowIso(), after: { patch: body } });
    return c.json(adminRow(acc));
  });
  v1.post("/admin/users/bulk", async (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    const me = current(c)!;
    const body = await c.req.json<{ ids: string[]; active: boolean }>();
    let updated = 0;
    for (const acc of state.accounts.values()) if (body.ids.includes(acc.user.id) && acc.user.id !== me.user.id) { acc.active = body.active; updated += 1; }
    return c.json({ updated });
  });

  app.route("/v1", v1);

  /* ---------------- test hooks ---------------- */
  app.post("/__test/reset", (c) => {
    state.accounts.clear();
    state.commissions.length = 0;
    state.invites.length = 0;
    state.sessions.clear();
    state.otps.clear();
    return c.json({ ok: true });
  });
  app.post("/__test/seed", async (c) => {
    const body = await c.req.json<{ email: string; password?: string; role?: "user" | "admin"; plan?: PlanRecord; connected?: boolean; referrals?: number }>();
    const acc = createAccount(state, body);
    if (body.referrals) {
      // n referred traders on rotating plans, joined over the last months; every third commission already settled
      acc.commissionPct = "20";
      const names = ["Priya Sharma", "Rahul Verma", "Anita Desai", "Vikram Singh", "Neha Gupta", "Arjun Mehta", "Kavya Nair", "Rohan Iyer"];
      const plans = ["pln_pro", "pln_free", "pln_basic", "pln_elite"];
      for (let i = 0; i < body.referrals; i += 1) {
        const joined = new Date(Date.UTC(2026, 8 - (i % 4), 3 + i, 9)).toISOString();
        const ref = createAccount(state, { email: `${acc.user.email.split("@")[0]}.ref${i + 1}@example.com`, name: names[i % names.length]!, createdAt: joined });
        ref.referredBy = acc.user.referralCode;
        const plan = planOf(plans[i % plans.length]!)!;
        const paid = plan.intervals.monthly.priceInr;
        ref.subscription = { id: id("sub"), planId: plan.id, interval: "monthly", startsAt: joined, expiresAt: null, priceInr: paid, paidInr: paid };
        recordCommission(ref);
        const x = state.commissions.find((y) => y.referredUserId === ref.user.id);
        if (x) {
          x.createdAt = joined;
          x.updatedAt = joined;
          if (i % 3 === 2 && x.status === "pending") Object.assign(x, { status: "paid", paidAt: joined, note: "NEFT ref 4471" });
        }
      }
    }
    if (body.plan) {
      acc.plan = body.plan;
      acc.seededBanner = true;
      if (body.plan.state === "free") acc.subscription = null;
    }
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
