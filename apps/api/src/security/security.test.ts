import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { AUTH_BASE_PATH } from "../auth.js";
import { createLogger } from "../logger.js";
import { createTestApp, type TestApp } from "../test-support/harness.js";
import { type AppEnv, clientIp, currentUser } from "./context.js";
import { HttpError, errors, notFound, onError } from "./errors.js";
import { adminOnly, requireAdmin } from "./guards.js";
import { BODY_LIMIT_MESSAGE, DEFAULT_BODY_LIMIT_BYTES } from "./body-limit.js";
import { GLOBAL_LIMIT, GLOBAL_LIMIT_MESSAGE, ORDER_LIMIT, ORDER_LIMIT_MESSAGE, orderKey } from "./rate-limit.js";
import { MemoryRateStore } from "./rate-store.js";
import { requestContext } from "./request.js";

let t: TestApp;
let cookie: string;
beforeAll(async () => {
  t = await createTestApp();
  cookie = (await t.signUp("sec@hapiecoin.test")).cookie;
});
afterAll(() => t.close());

describe("[SEC] secure headers on every response", () => {
  it("sets the hardening headers on success, error, 404 and auth responses", async () => {
    const responses = await Promise.all([
      t.request("/healthz"),
      t.request("/v1/me"),
      t.request("/v1/nothing-here"),
      t.request("/v1/me", { cookie }),
      t.request(`${AUTH_BASE_PATH}/get-session`),
      t.request("/v1/openapi.json"),
    ]);
    for (const res of responses) {
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
      expect(res.headers.get("permissions-policy")).toContain("camera=()");
      expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.headers.get("strict-transport-security")).toBeNull(); // HSTS only in production
      expect(res.headers.get("x-powered-by")).toBeNull();
    }
    const docs = await t.request("/v1/docs");
    expect(docs.status).toBe(200);
    expect(docs.headers.get("content-security-policy")).toContain("script-src");
  });

  it("HSTS is on and Swagger UI is off in production", async () => {
    // Production config needs a real database URL and mail transport (GAPS #23/#25); the harness still
    // boots PGlite underneath because it ignores databaseUrl, which is fine for a headers test.
    const prod = await createTestApp({
      NODE_ENV: "production",
      DELTA_API_KEY: "",
      DATABASE_URL: "postgres://u:p@db:5432/hapiecoin",
      RESEND_API_KEY: "re_test",
    });
    try {
      const res = await prod.request("/healthz");
      expect(res.headers.get("strict-transport-security")).toContain("max-age=31536000");
      expect((await prod.request("/v1/docs")).status).toBe(404);
      const doc = (await (await prod.request("/v1/openapi.json")).json()) as {
        components: { securitySchemes: { cookieAuth: { name: string } } };
      };
      expect(doc.components.securitySchemes.cookieAuth.name).toBe("__Secure-better-auth.session_token");
    } finally {
      await prod.close();
    }
  });
});

describe("[SEC] CORS and Origin checks", () => {
  it("allows the web app with credentials and refuses a foreign origin", async () => {
    const ok = await t.request("/healthz", { headers: { origin: "http://localhost:3000" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    expect(ok.headers.get("access-control-allow-credentials")).toBe("true");
    expect(ok.headers.get("vary")).toContain("Origin");

    const foreign = await t.request("/healthz", { headers: { origin: "https://evil.example" } });
    expect(foreign.headers.get("access-control-allow-origin")).toBeNull();

    const preflight = await t.request("/v1/me", {
      method: "OPTIONS",
      origin: "https://evil.example",
      headers: { "access-control-request-method": "PATCH" },
    });
    expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
    const goodPreflight = await t.request("/v1/me", {
      method: "OPTIONS",
      origin: "http://localhost:3000",
      headers: { "access-control-request-method": "PATCH" },
    });
    expect(goodPreflight.status).toBe(204);
    expect(goodPreflight.headers.get("access-control-allow-methods")).toContain("PATCH");
  });

  it("refuses state-changing requests from a foreign Origin (CSRF) and allows same-site or absent Origin", async () => {
    const csrf = await t.request("/v1/me", {
      method: "PATCH",
      cookie,
      json: { name: "Evil" },
      origin: "https://evil.example",
    });
    expect(csrf.status).toBe(403);
    expect(await csrf.json()).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
    const fromApi = await t.request("/v1/me", {
      method: "PATCH",
      cookie,
      json: { name: "Self" },
      origin: "http://localhost:3001/",
    });
    expect(fromApi.status).toBe(200);
    const noOrigin = await t.request("/v1/me", {
      method: "PATCH",
      cookie,
      json: { name: "Curl" },
      origin: null,
    });
    expect(noOrigin.status).toBe(200);
    const weird = await t.request("/v1/me", {
      method: "PATCH",
      cookie,
      json: { name: "x" },
      origin: "not a url",
    });
    expect(weird.status).toBe(403);
    const getFromAnywhere = await t.request("/v1/me", { cookie, origin: "https://evil.example" });
    expect(getFromAnywhere.status).toBe(200);
  });
});

describe("[SEC] global rate limit 300/min per IP", () => {
  it("returns 429 with Retry-After after the budget and recovers when the window slides", async () => {
    const ip = "198.18.0.1";
    const spent = await t.rateStore.peek(`global:${ip}`, GLOBAL_LIMIT.windowMs);
    for (let i = spent; i < GLOBAL_LIMIT.max; i += 1) {
      const r = await t.request("/healthz", { ip });
      expect(r.status).toBe(200);
      expect(r.headers.get("x-ratelimit-remaining")).toBe(String(GLOBAL_LIMIT.max - i - 1));
    }
    const blocked = await t.request("/healthz", { ip });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toMatch(/^[0-9]+$/);
    expect(await blocked.json()).toMatchObject({ code: "RATE_LIMITED", message: GLOBAL_LIMIT_MESSAGE });
    const otherIp = await t.request("/healthz", { ip: "198.18.0.2" });
    expect(otherIp.status).toBe(200);
    t.now.value += GLOBAL_LIMIT.windowMs + 1;
    expect((await t.request("/healthz", { ip })).status).toBe(200);
  });
});

describe("[SEC] request body limit (GAPS #70, ADR-061)", () => {
  it("refuses a body over the cap with 413 in the envelope before any handler runs, lets smaller ones through, exempts the banner upload", async () => {
    const big = { name: "x".repeat(DEFAULT_BODY_LIMIT_BYTES + 1) };
    const r = await t.request("/v1/strategies", { cookie, json: big });
    expect(r.status).toBe(413);
    const refused = (await r.json()) as { code: string; message: string };
    expect(refused.code).toBe("PAYLOAD_TOO_LARGE");
    expect(refused.message).toContain(BODY_LIMIT_MESSAGE);
    // the same oversize body on the banner route is not cut by the global cap: the admin guard answers first (403), the route keeps its own 5 MB limit
    expect((await t.request("/v1/admin/banners", { cookie, json: big })).status).toBe(403);
    // under the cap the request reaches validation as before
    const small = await t.request("/v1/strategies", { cookie, json: { name: "x".repeat(4096) } });
    expect([200, 201, 400]).toContain(small.status);
    expect(small.status).not.toBe(413);
    // a signed-out oversize request is also refused with 413, not 401: the cap sits before the guards
    expect((await t.request("/v1/strategies", { json: big })).status).toBe(413);
  });
});

describe("[SEC] order routes 20/min per user (GAPS #70, ADR-061)", () => {
  it("budgets the live batch route per signed-in user with Retry-After, leaves another user alone, recovers when the window slides", async () => {
    const a = (await t.signUp("orders-a@hapiecoin.test")).cookie;
    const b = (await t.signUp("orders-b@hapiecoin.test")).cookie;
    const body = { ids: ["strat_nope"], brokerId: "brk_nope", idempotencyKey: "order-limit-test-1" };
    const me = (await (await t.request("/v1/me", { cookie: a })).json()) as { id: string };
    const spent = await t.rateStore.peek(orderKey(me.id), ORDER_LIMIT.windowMs);
    for (let i = spent; i < ORDER_LIMIT.max; i += 1) {
      const r = await t.request("/v1/strategies/live/batch", { cookie: a, json: body });
      expect(r.status, `request ${i + 1}`).not.toBe(429); // refused on business grounds (no credential / entitlement), never by the budget
      expect(r.headers.get("x-ratelimit-remaining")).toBe(String(ORDER_LIMIT.max - i - 1));
    }
    const blocked = await t.request("/v1/strategies/live/batch", { cookie: a, json: body });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toMatch(/^[0-9]+$/);
    expect(await blocked.json()).toMatchObject({ code: "ORDER_RATE_LIMITED", message: ORDER_LIMIT_MESSAGE });
    // the exit route shares the same per-user budget
    expect((await t.request("/v1/strategies/live/positions/exit", { cookie: a, json: { brokerId: "brk_nope", productIds: [1], idempotencyKey: "order-limit-test-2" } })).status).toBe(429);
    // another user is not affected; a read-only live route is not budgeted
    expect((await t.request("/v1/strategies/live/batch", { cookie: b, json: body })).status).not.toBe(429);
    expect((await t.request("/v1/strategies/live/positions?brokerId=brk_nope", { cookie: a })).status).not.toBe(429);
    t.now.value += ORDER_LIMIT.windowMs + 1;
    expect((await t.request("/v1/strategies/live/batch", { cookie: a, json: body })).status).not.toBe(429);
  });
});

describe("[SEC] request id, error envelope and client IP", () => {
  it("echoes a well-formed incoming X-Request-Id and replaces a malformed one", async () => {
    const good = await t.request("/healthz", { headers: { "x-request-id": "trace-abc-12345" } });
    expect(good.headers.get("x-request-id")).toBe("trace-abc-12345");
    const bad = await t.request("/healthz", { headers: { "x-request-id": "<script>" } });
    expect(bad.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("404 and unknown errors use the ApiError envelope without a stack trace", async () => {
    const missing = await t.request("/v1/missing");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ code: "NOT_FOUND", message: "Route not found" });

    const app = new Hono<AppEnv>();
    app.use("*", requestContext(createLogger({ level: "silent" })));
    app.get("/boom", () => {
      throw new Error("secret stack");
    });
    app.get("/http", () => {
      throw new HTTPException(413, { message: "too big" });
    });
    app.get("/http-plain", () => {
      throw new HTTPException(418);
    });
    app.get("/http-5xx", () => {
      throw new HTTPException(503, { message: "down" });
    });
    // zod 4's ZodError does not extend Error, so Hono would not route a thrown one to onError; call the mapper directly.
    app.get("/zod", (c) =>
      onError(
        new ZodError([{ code: "custom", path: ["a"], message: "bad a", input: 1 }]) as unknown as Error,
        c,
      ),
    );
    app.get("/custom", () => {
      throw new HttpError(402, "PAYMENT_REQUIRED", "pay", { plan: "pro" }, { "X-Extra": "1" });
    });
    app.get("/user", (c) => c.json({ id: currentUser(c).id }));
    app.get("/admin", adminOnly, (c) => c.json({ ok: true }));
    app.onError(onError);
    app.notFound(notFound);

    const boom = await app.request("/boom");
    expect(boom.status).toBe(500);
    const body = (await boom.json()) as { code: string; message: string; details: { requestId: string } };
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(body.message).not.toContain("secret stack");
    expect(body.details.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(body)).not.toContain("at ");

    expect(await (await app.request("/http")).json()).toEqual({
      code: "PAYLOAD_TOO_LARGE",
      message: "too big",
    });
    expect(((await (await app.request("/http-plain")).json()) as { code: string }).code).toBe(
      "REQUEST_FAILED",
    );
    expect(((await (await app.request("/http-5xx")).json()) as { code: string }).code).toBe("INTERNAL_ERROR");
    const zod = await app.request("/zod");
    expect(zod.status).toBe(400);
    expect(await zod.json()).toEqual({
      code: "VALIDATION_ERROR",
      message: "Request failed validation",
      details: { issues: [{ path: "a", message: "bad a" }] },
    });
    const custom = await app.request("/custom");
    expect(custom.status).toBe(402);
    expect(custom.headers.get("x-extra")).toBe("1");
    expect(await custom.json()).toEqual({
      code: "PAYMENT_REQUIRED",
      message: "pay",
      details: { plan: "pro" },
    });
    expect((await app.request("/user")).status).toBe(500);
    expect((await app.request("/admin")).status).toBe(401);
    expect((await app.request("/nowhere")).status).toBe(404);
    expect(errors.rateLimited("m", 3).headers).toEqual({ "Retry-After": "3" });
    for (const status of [400, 401, 403, 404]) {
      const local = new Hono<AppEnv>().use("*", requestContext(createLogger({ level: "silent" })));
      local.get("/", () => {
        throw new HTTPException(status as 400, { message: "m" });
      });
      local.onError(onError);
      expect(((await (await local.request("/")).json()) as { code: string }).code).toMatch(/^[A-Z_]+$/);
    }
  });

  it("resolves the client IP from proxy headers in order when every peer is trusted, else unknown", async () => {
    const app = new Hono<AppEnv>().get("/", (c) => c.text(clientIp(c, ["*"])));
    expect(
      await (
        await app.request("/", { headers: { "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" } })
      ).text(),
    ).toBe("1.1.1.1");
    expect(
      await (await app.request("/", { headers: { "x-forwarded-for": " 2.2.2.2 , 3.3.3.3" } })).text(),
    ).toBe("2.2.2.2");
    expect(
      await (
        await app.request("/", { headers: { "x-forwarded-for": " , 3.3.3.3", "x-real-ip": "4.4.4.4" } })
      ).text(),
    ).toBe("4.4.4.4");
    expect(await (await app.request("/", { headers: { "x-real-ip": "4.4.4.4" } })).text()).toBe("4.4.4.4");
    expect(await (await app.request("/")).text()).toBe("unknown");
  });

  it("[GAPS-24] ignores forwarded headers unless the socket peer is a trusted proxy (ADR-019)", async () => {
    const socket = (address: string) => ({ incoming: { socket: { remoteAddress: address, remotePort: 4000, remoteFamily: "IPv4" } } });
    const spoof = { headers: { "x-forwarded-for": "9.9.9.9", "cf-connecting-ip": "8.8.8.8" } };
    // Default (nothing trusted): the peer address wins and the headers are ignored.
    const strict = new Hono<AppEnv>().get("/", (c) => c.text(clientIp(c, [])));
    expect(await (await strict.request("/", spoof, socket("203.0.113.7"))).text()).toBe("203.0.113.7");
    expect(await (await strict.request("/", spoof)).text()).toBe("unknown");
    // A listed proxy: its headers are believed; any other peer is still taken at face value.
    const behindProxy = new Hono<AppEnv>().get("/", (c) => c.text(clientIp(c, ["127.0.0.1"])));
    expect(await (await behindProxy.request("/", spoof, socket("127.0.0.1"))).text()).toBe("8.8.8.8");
    expect(await (await behindProxy.request("/", spoof, socket("203.0.113.7"))).text()).toBe("203.0.113.7");
    expect(await (await behindProxy.request("/", {}, socket("127.0.0.1"))).text()).toBe("127.0.0.1");
    // The middleware threads the trusted list through and the harness trusts every peer for tests.
    const wired = new Hono<AppEnv>().use("*", requestContext(createLogger({ level: "silent" }), [])).get("/", (c) => c.text(c.get("clientIp")));
    expect(await (await wired.request("/", spoof, socket("203.0.113.7"))).text()).toBe("203.0.113.7");
    expect(t.config.trustedProxyIps).toEqual(["*"]);
  });

  it("[GAPS-24] hands Better Auth only the resolved IP, never a caller-supplied copy", async () => {
    // A spoofed x-hapiecoin-client-ip must not reach the auth handler; the trusted x-forwarded-for does.
    const seen: string[] = [];
    const original = t.auth.handler;
    t.auth.handler = (req: Request) => {
      seen.push(req.headers.get("x-hapiecoin-client-ip") ?? "(none)");
      return original(req);
    };
    try {
      await t.request(`${AUTH_BASE_PATH}/get-session`, {
        ip: "198.51.100.5",
        headers: { "x-hapiecoin-client-ip": "1.2.3.4" },
      });
      expect(seen).toEqual(["198.51.100.5"]);
    } finally {
      t.auth.handler = original;
    }
  });

  it("requireAdmin composes the user guard with the role check", async () => {
    const guards = requireAdmin({
      resolve: () => Promise.resolve({ id: "u1", email: "e", name: "n", role: "user" }),
    });
    const app = new Hono<AppEnv>()
      .use("*", requestContext(createLogger({ level: "silent" })))
      .use("/", ...guards)
      .get("/", (c) => c.json({ ok: true }));
    app.onError(onError);
    expect((await app.request("/")).status).toBe(403);
    const adminGuards = requireAdmin({
      resolve: () => Promise.resolve({ id: "a1", email: "e", name: "n", role: "admin" }),
    });
    const app2 = new Hono<AppEnv>()
      .use("*", requestContext(createLogger({ level: "silent" })))
      .use("/", ...adminGuards)
      .get("/", (c) => c.json({ ok: true }));
    expect((await app2.request("/")).status).toBe(200);
    expect(new MemoryRateStore()).toBeDefined();
  });
});
