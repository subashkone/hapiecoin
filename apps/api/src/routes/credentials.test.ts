import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BrokerCredentialPublic } from "@hapiecoin/schema";
import { eq } from "drizzle-orm";
import { auditLog, brokerCredentials } from "../db/schema.js";
import { SEED } from "../db/seed.js";
import { createTestApp, type TestApp } from "../test-support/harness.js";
import { deltaFailure } from "./credentials.js";

let t: TestApp;
let cookie: string;
const API_KEY = "delta-key-ABCD1a2b";
const API_SECRET = "delta-secret-SUPERSECRET-xyz";

beforeAll(async () => {
  t = await createTestApp();
  cookie = (await t.signUp("keys@hapiecoin.test")).cookie;
  t.delta
    .accept(API_KEY)
    .reject("bad-key-0000", "invalid_api_key")
    .reject("noip-key-0000", "ip_not_whitelisted_for_api_key")
    .reject("down-key-0000", "delta_unavailable");
});
afterAll(() => t.close());

describe("HC-SH-031..037 exchange API credentials", () => {
  it("HC-SH-031 starts disconnected; HC-SH-036 exposes the whitelist IP", async () => {
    expect(await (await t.request("/v1/credentials", { cookie })).json()).toEqual({ items: [] });
    expect(await (await t.request("/v1/credentials/whitelist-ip", { cookie })).json()).toEqual({
      ip: "172.236.179.136",
    });
  });

  it("HC-SH-034 Connect & Save: verifies with one read-only Delta call, stores encrypted, returns the masked key", async () => {
    const res = await t.request("/v1/credentials", {
      cookie,
      json: { brokerId: SEED.brokerId, apiKey: API_KEY, apiSecret: API_SECRET },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as BrokerCredentialPublic;
    expect(BrokerCredentialPublic.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({
      brokerId: SEED.brokerId,
      apiKeyMasked: "****1a2b",
      whitelistedIp: "172.236.179.136",
    });
    expect(t.delta.calls).toEqual([{ apiKey: API_KEY }]);

    const [row] = await t.db
      .select()
      .from(brokerCredentials)
      .where(eq(brokerCredentials.brokerId, SEED.brokerId));
    expect(row).toBeDefined();
    expect(JSON.stringify(row)).not.toContain(API_SECRET);
    expect(JSON.stringify(row)).not.toContain(API_KEY);
    expect(t.vault.open({ iv: row!.apiSecretIv, tag: row!.apiSecretTag, ct: row!.apiSecretCt })).toBe(
      API_SECRET,
    );
    expect(t.vault.open({ iv: row!.apiKeyIv, tag: row!.apiKeyTag, ct: row!.apiKeyCt })).toBe(API_KEY);
    expect(row!.apiKeyIv).not.toBe(row!.apiSecretIv);

    const list = (await (await t.request("/v1/credentials", { cookie })).json()) as {
      items: BrokerCredentialPublic[];
    };
    expect(list.items).toEqual([body]);
  });

  it("re-connecting the same exchange replaces the record and audits before/after (masked only)", async () => {
    const res = await t.request("/v1/credentials", {
      cookie,
      json: { brokerId: SEED.brokerId, apiKey: API_KEY, apiSecret: "rotated-secret" },
    });
    expect(res.status).toBe(201);
    const rows = await t.db
      .select()
      .from(brokerCredentials)
      .where(eq(brokerCredentials.brokerId, SEED.brokerId));
    expect(rows.length).toBe(1);
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.action, "credentials.connect"));
    expect(audits.length).toBe(2);
    expect(audits[0]?.before).toBeNull();
    expect(audits[0]?.after).toMatchObject({ apiKeyMasked: "****1a2b" });
    expect(audits[1]?.before).toMatchObject({ apiKeyMasked: "****1a2b" });
    for (const a of audits) {
      const text = JSON.stringify(a);
      expect(text).not.toContain(API_SECRET);
      expect(text).not.toContain("rotated-secret");
      expect(text).not.toContain(API_KEY);
    }
  });

  it("invalid key → 400 INVALID_API_KEY; IP not whitelisted → 400 IP_NOT_WHITELISTED_FOR_API_KEY; Delta down → 502", async () => {
    const bad = await t.request("/v1/credentials", {
      cookie,
      json: { brokerId: SEED.brokerId, apiKey: "bad-key-0000", apiSecret: "s" },
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({
      code: "INVALID_API_KEY",
      details: { deltaCode: "invalid_api_key" },
    });

    const noip = await t.request("/v1/credentials", {
      cookie,
      json: { brokerId: SEED.brokerId, apiKey: "noip-key-0000", apiSecret: "s" },
    });
    expect(noip.status).toBe(400);
    expect(await noip.json()).toMatchObject({
      code: "IP_NOT_WHITELISTED_FOR_API_KEY",
      details: { deltaCode: "ip_not_whitelisted_for_api_key" },
    });

    const down = await t.request("/v1/credentials", {
      cookie,
      json: { brokerId: SEED.brokerId, apiKey: "down-key-0000", apiSecret: "s" },
    });
    expect(down.status).toBe(502);
    expect(await down.json()).toMatchObject({ code: "DELTA_UNAVAILABLE" });
    expect(deltaFailure("signature_expired", "m").code).toBe("SIGNATURE_EXPIRED");

    // The stored (good) credential is untouched by failed attempts.
    const list = (await (await t.request("/v1/credentials", { cookie })).json()) as {
      items: BrokerCredentialPublic[];
    };
    expect(list.items.length).toBe(1);
  });

  it("validates format (non-empty, ≤ 128 chars) and the exchange must be visible", async () => {
    expect(
      (
        await t.request("/v1/credentials", {
          cookie,
          json: { brokerId: SEED.brokerId, apiKey: "", apiSecret: "s" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await t.request("/v1/credentials", {
          cookie,
          json: { brokerId: SEED.brokerId, apiKey: "k", apiSecret: "x".repeat(129) },
        })
      ).status,
    ).toBe(400);
    expect(
      (await t.request("/v1/credentials", { cookie, json: { brokerId: SEED.brokerId, apiKey: "k" } })).status,
    ).toBe(400);
    const missing = await t.request("/v1/credentials", {
      cookie,
      json: { brokerId: "brk_missing", apiKey: API_KEY, apiSecret: "s" },
    });
    expect(missing.status).toBe(404);
    expect(t.delta.calls.filter((c) => c.apiKey === API_KEY).length).toBe(2); // no Delta call for a missing broker
  });

  it("HC-SH-037 Disconnect removes the credentials and audits it; a second disconnect is 404", async () => {
    const { items } = (await (await t.request("/v1/credentials", { cookie })).json()) as { items: BrokerCredentialPublic[] };
    const del = await t.request(`/v1/credentials/${items[0]!.id}`, { method: "DELETE", cookie });
    expect(del.status).toBe(204);
    expect(await (await t.request("/v1/credentials", { cookie })).json()).toEqual({ items: [] });
    expect((await t.request(`/v1/credentials/${items[0]!.id}`, { method: "DELETE", cookie })).status).toBe(
      404,
    );
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.action, "credentials.disconnect"));
    expect(audits.length).toBe(1);
    expect(audits[0]?.after).toBeNull();
    expect(audits[0]?.before).toMatchObject({ apiKeyMasked: "****1a2b" });
  });
});

describe("HC-SH-123 accounts: several labelled keys per exchange (ADR-068)", () => {
  const connect = (c: string, label: string | undefined, apiKey: string) => t.request("/v1/credentials", { cookie: c, json: { brokerId: SEED.brokerId, ...(label ? { label } : {}), apiKey, apiSecret: "s" } });
  const list = async (c: string) => ((await (await t.request("/v1/credentials", { cookie: c })).json()) as { items: BrokerCredentialPublic[] }).items;

  it("a new label adds a key, a known one replaces it, the default label is Main, and the cap holds", async () => {
    const c = (await t.signUp("accounts@hapiecoin.test")).cookie;
    t.delta.accept("main-key-AAAA").accept("sub-key-BBBB").accept("sub-key-CCCC");
    expect((await connect(c, undefined, "main-key-AAAA")).status).toBe(201);
    const sub1 = (await (await connect(c, "Sub 1", "sub-key-BBBB")).json()) as BrokerCredentialPublic;
    expect(sub1).toMatchObject({ label: "Sub 1", apiKeyMasked: "****BBBB", brokerId: SEED.brokerId });
    expect((await list(c)).map((i) => [i.label, i.apiKeyMasked])).toEqual([["Main", "****AAAA"], ["Sub 1", "****BBBB"]]);
    // the same label again replaces that key and keeps its id
    const again = (await (await connect(c, "Sub 1", "sub-key-CCCC")).json()) as BrokerCredentialPublic;
    expect(again.id).toBe(sub1.id);
    expect((await list(c)).map((i) => [i.label, i.apiKeyMasked])).toEqual([["Main", "****AAAA"], ["Sub 1", "****CCCC"]]);
    for (const n of [2, 3, 4]) {
      t.delta.accept(`sub-key-${n}${n}${n}${n}`);
      expect((await connect(c, `Sub ${n}`, `sub-key-${n}${n}${n}${n}`)).status).toBe(201);
    }
    t.delta.accept("sub-key-5555");
    expect((await connect(c, "Sub 5", "sub-key-5555")).status).toBe(400); // five is the most
    expect((await connect(c, "   ", "sub-key-5555")).status).toBe(400); // an empty name
  });

  it("a key a live strategy trades through cannot be removed; once the strategy is stopped it can", async () => {
    const c = (await t.signUp("accounts2@hapiecoin.test")).cookie;
    t.delta.accept("live-main-DDDD");
    expect((await connect(c, "Main", "live-main-DDDD")).status).toBe(201);
    const [main] = await list(c);
    const legs = [{ kind: "call", side: "buy", strike: "80000", expiry: "2026-09-25", symbol: "C-BTC-80000-250926", lots: 1, price: "1200" }];
    const s = (await (await t.request("/v1/strategies", { cookie: c, json: { name: "Key holder", asset: "BTC", legs } })).json()) as { id: string; accountId: string | null };
    t.trading.product("C-BTC-80000-250926", 101, "0.001").markAt("C-BTC-80000-250926", "1200").fillAt(101, "1200");
    t.trading.setBalances([{ asset: "USD", balance: "5000", availableBalance: "4000" }]);
    const placed = await t.request(`/v1/strategies/${s.id}/live/place`, { cookie: c, json: { brokerId: SEED.brokerId, idempotencyKey: "key-holder-0001", expected: {} } });
    expect(placed.status).toBe(200);
    expect(((await placed.json()) as { accountId: string | null }).accountId).toBe(main!.id); // the only key is recorded on the strategy
    const refused = await t.request(`/v1/credentials/${main!.id}`, { method: "DELETE", cookie: c });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { message: string }).message).toContain("1 live strategy trades through this key");
    expect((await t.request(`/v1/strategies/${s.id}/close`, { cookie: c, json: { exits: {} } })).status).toBe(200); // live: exit orders through the key, filled by the fake venue
    expect((await t.request(`/v1/credentials/${main!.id}`, { method: "DELETE", cookie: c })).status).toBe(204);
  });
});

describe("HC-SH-033 the API secret never appears in any serialised response", () => {
  it("walks every route with a recorded credential and inspects every byte", async () => {
    const other = (await t.signUp("walker@hapiecoin.test")).cookie;
    const admin = await t.adminCookie();
    const SECRET = "WALKER-SECRET-9f8e7d6c5b4a";
    const KEY = "walker-key-Z9Y8";
    t.delta.accept(KEY);
    expect(
      (
        await t.request("/v1/credentials", {
          cookie: other,
          json: { brokerId: SEED.brokerId, apiKey: KEY, apiSecret: SECRET },
        })
      ).status,
    ).toBe(201);

    const routes: { method: string; path: string; json?: unknown }[] = [
      { method: "GET", path: "/healthz" },
      { method: "GET", path: "/v1/openapi.json" },
      { method: "GET", path: "/v1/auth-options" },
      { method: "GET", path: "/v1/me" },
      { method: "PATCH", path: "/v1/me", json: { name: "Walker" } },
      { method: "GET", path: "/v1/settings" },
      { method: "GET", path: "/v1/brokers" },
      { method: "GET", path: `/v1/brokers/${SEED.brokerId}` },
      { method: "GET", path: "/v1/credentials" },
      { method: "GET", path: `/v1/credentials/${SEED.brokerId}` },
      { method: "GET", path: "/v1/credentials/whitelist-ip" },
      {
        method: "POST",
        path: "/v1/credentials",
        json: { brokerId: SEED.brokerId, apiKey: KEY, apiSecret: SECRET },
      },
      {
        method: "POST",
        path: "/v1/credentials",
        json: { brokerId: SEED.brokerId, apiKey: "bad-key-0000", apiSecret: SECRET },
      },
      { method: "GET", path: "/v1/plan" },
      { method: "GET", path: "/v1/auth/get-session" },
      { method: "GET", path: "/v1/does-not-exist" },
    ];
    for (const cookieUnderTest of [other, admin, undefined]) {
      for (const r of routes) {
        const res = await t.request(r.path, {
          method: r.method,
          cookie: cookieUnderTest,
          ...(r.json !== undefined ? { json: r.json } : {}),
        });
        const text = await res.text();
        const headers = JSON.stringify([...res.headers.entries()]);
        expect(text, `${r.method} ${r.path}`).not.toContain(SECRET);
        expect(headers, `${r.method} ${r.path}`).not.toContain(SECRET);
        expect(text, `${r.method} ${r.path}`).not.toContain(KEY);
        // The OpenAPI document legitimately names the `apiSecret` *request* field; no response schema may carry it.
        if (r.path !== "/v1/openapi.json")
          expect(text.toLowerCase(), `${r.method} ${r.path}`).not.toContain("apisecret");
      }
    }
    const audits = await t.db.select().from(auditLog);
    expect(JSON.stringify(audits)).not.toContain(SECRET);
    // Response schemas in the OpenAPI document never declare a secret-carrying property.
    const doc = (await (await t.request("/v1/openapi.json")).json()) as {
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
    };
    const responses = JSON.stringify(
      Object.values(doc.paths).flatMap((ops) => Object.values(ops).map((op) => op.responses)),
    ).toLowerCase();
    expect(responses).not.toContain("apisecret");
    expect(responses).toContain("apikeymasked");
  });
});
