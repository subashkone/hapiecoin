import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEED } from "./db/seed.js";
import { createTestApp, type TestApp } from "./test-support/harness.js";

let t: TestApp;
let userCookie: string;
let adminCookie: string;
let userBrokerId: string;

beforeAll(async () => {
  t = await createTestApp();
  userCookie = (await t.signUp("matrix@hapiecoin.test")).cookie;
  adminCookie = await t.adminCookie();
  const created = await t.request("/v1/brokers", {
    cookie: userCookie,
    json: { name: "Mine", feePct: "0.1", gstPct: "18", feeCapPct: "10" },
  });
  userBrokerId = ((await created.json()) as { id: string }).id;
  t.delta.accept("matrix-key-0001");
});
afterAll(() => t.close());

type Role = "anonymous" | "user" | "admin";
interface Case {
  method: string;
  path: string;
  json?: unknown;
  expect: Record<Role, number>;
}

const SETTINGS = {
  currency: "USD",
  conversionRate: "83.5",
  pnlBasis: "mark",
  lotSizes: { BTC: "0.001", ETH: "0.01", XAUT: "0.001" },
  theme: "dark",
  density: "compact",
};

describe("[SEC] authorisation matrix (server-side, never trusting the client)", () => {
  const cases: Case[] = [
    { method: "GET", path: "/healthz", expect: { anonymous: 200, user: 200, admin: 200 } },
    { method: "GET", path: "/v1/openapi.json", expect: { anonymous: 200, user: 200, admin: 200 } },
    { method: "GET", path: "/v1/docs", expect: { anonymous: 200, user: 200, admin: 200 } },
    { method: "GET", path: "/v1/auth-options", expect: { anonymous: 200, user: 200, admin: 200 } },
    { method: "GET", path: "/v1/me", expect: { anonymous: 401, user: 200, admin: 200 } },
    {
      method: "PATCH",
      path: "/v1/me",
      json: { name: "Renamed" },
      expect: { anonymous: 401, user: 200, admin: 200 },
    },
    { method: "GET", path: "/v1/settings", expect: { anonymous: 401, user: 200, admin: 200 } },
    {
      method: "PUT",
      path: "/v1/settings",
      json: SETTINGS,
      expect: { anonymous: 401, user: 200, admin: 200 },
    },
    { method: "GET", path: "/v1/brokers", expect: { anonymous: 401, user: 200, admin: 200 } },
    {
      method: "POST",
      path: "/v1/brokers",
      json: { name: "Own", feePct: "0.05", gstPct: "18", feeCapPct: "10" },
      expect: { anonymous: 401, user: 201, admin: 201 },
    },
    {
      method: "POST",
      path: "/v1/brokers",
      json: { name: "Global", feePct: "0.05", gstPct: "18", feeCapPct: "10", scope: "GLOBAL" },
      expect: { anonymous: 401, user: 403, admin: 201 },
    },
    {
      method: "PATCH",
      path: `/v1/brokers/${SEED.brokerId}`,
      json: { name: "Delta India" },
      expect: { anonymous: 401, user: 403, admin: 200 },
    },
    {
      method: "PATCH",
      path: "/v1/brokers/__user__",
      json: { name: "Mine 2" },
      expect: { anonymous: 401, user: 200, admin: 404 },
    },
    {
      method: "DELETE",
      path: "/v1/brokers/does-not-exist",
      expect: { anonymous: 401, user: 404, admin: 404 },
    },
    { method: "GET", path: "/v1/credentials", expect: { anonymous: 401, user: 200, admin: 200 } },
    {
      method: "GET",
      path: "/v1/credentials/whitelist-ip",
      expect: { anonymous: 401, user: 200, admin: 200 },
    },
    {
      method: "POST",
      path: "/v1/credentials",
      json: { brokerId: SEED.brokerId, apiKey: "matrix-key-0001", apiSecret: "s" },
      expect: { anonymous: 401, user: 201, admin: 201 },
    },
    {
      method: "DELETE",
      path: `/v1/credentials/${SEED.brokerId}`,
      expect: { anonymous: 401, user: 204, admin: 204 },
    },
    { method: "GET", path: "/v1/plan", expect: { anonymous: 401, user: 200, admin: 200 } },
    { method: "GET", path: "/v1/nope", expect: { anonymous: 404, user: 404, admin: 404 } },
  ];

  for (const kase of cases) {
    for (const role of ["anonymous", "user", "admin"] as const) {
      it(`${role} ${kase.method} ${kase.path} → ${kase.expect[role]}`, async () => {
        const cookie = role === "anonymous" ? undefined : role === "user" ? userCookie : adminCookie;
        const path = kase.path.replace("__user__", userBrokerId);
        const res = await t.request(path, {
          method: kase.method,
          cookie,
          ...(kase.json !== undefined ? { json: kase.json } : {}),
        });
        expect(res.status).toBe(kase.expect[role]);
        if (res.status >= 400) {
          const body = (await res.json()) as { code: string; message: string };
          expect(body.code).toMatch(/^[A-Z][A-Z0-9_]*$/);
          expect(body.message.length).toBeGreaterThan(0);
        }
      });
    }
  }

  it("a forged role in the request body or header does not escalate", async () => {
    const res = await t.request("/v1/brokers", {
      cookie: userCookie,
      headers: { "x-role": "admin" },
      json: { name: "G", feePct: "0", gstPct: "0", feeCapPct: "0", scope: "GLOBAL", role: "admin" },
    });
    expect(res.status).toBe(400); // strict body: unknown key "role" fails validation before any role check
    const res2 = await t.request("/v1/brokers", {
      cookie: userCookie,
      headers: { "x-role": "admin" },
      json: { name: "G", feePct: "0", gstPct: "0", feeCapPct: "0", scope: "GLOBAL" },
    });
    expect(res2.status).toBe(403);
  });
});
