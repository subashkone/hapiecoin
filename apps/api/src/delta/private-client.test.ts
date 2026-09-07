import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DeltaPrivateClientImpl,
  FakeDeltaPrivateClient,
  describe as describeCode,
  signDeltaRequest,
  type FetchLike,
} from "./private-client.js";

const CREDS = { apiKey: "key-abcdef1234", apiSecret: "secret-xyz" };

function fakeFetch(
  status: number,
  body: unknown,
  capture?: { url?: string; headers?: Record<string, string> },
): FetchLike {
  return (url, init) => {
    if (capture) {
      capture.url = url;
      capture.headers = init.headers;
    }
    return Promise.resolve({
      status,
      text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
    });
  };
}

describe("HC-SH-034 Delta private client signing", () => {
  it("signs method + timestamp + path + query + body with HMAC-SHA256 hex and sets the three headers", () => {
    const req = signDeltaRequest({
      baseUrl: "https://api.india.delta.exchange/",
      method: "GET",
      path: "/v2/wallet/balances",
      query: "asset=USD",
      body: "",
      apiKey: "k",
      apiSecret: "s",
      timestamp: 1_700_000_000,
    });
    const expected = createHmac("sha256", "s")
      .update("GET1700000000/v2/wallet/balances?asset=USD")
      .digest("hex");
    expect(req.url).toBe("https://api.india.delta.exchange/v2/wallet/balances?asset=USD");
    expect(req.headers["signature"]).toBe(expected);
    expect(req.headers["api-key"]).toBe("k");
    expect(req.headers["timestamp"]).toBe("1700000000");
    expect(req.headers["User-Agent"]).toBe("hapiecoin-api");
    const withQ = signDeltaRequest({
      baseUrl: "https://x",
      method: "POST",
      path: "/p",
      query: "?a=1",
      body: '{"b":1}',
      apiKey: "k",
      apiSecret: "s",
      timestamp: 1,
    });
    expect(withQ.url).toBe("https://x/p?a=1");
    expect(withQ.headers["signature"]).toBe(
      createHmac("sha256", "s").update('POST1/p?a=1{"b":1}').digest("hex"),
    );
  });

  it("returns balances on success and sends the signed GET", async () => {
    const capture: { url?: string; headers?: Record<string, string> } = {};
    const client = new DeltaPrivateClientImpl({
      baseUrl: "https://delta.test",
      fetch: fakeFetch(200, { success: true, result: [{ asset_symbol: "USD" }] }, capture),
      now: () => 42,
    });
    const r = await client.verifyCredentials(CREDS);
    expect(r).toEqual({ ok: true, balances: [{ asset_symbol: "USD" }] });
    expect(capture.url).toBe("https://delta.test/v2/wallet/balances");
    expect(capture.headers?.["api-key"]).toBe(CREDS.apiKey);
    expect(capture.headers?.["timestamp"]).toBe("42");
  });

  it("maps Delta error codes, falls back on 401/403 and reports other statuses as unavailable", async () => {
    const at = (status: number, body: unknown) =>
      new DeltaPrivateClientImpl({ baseUrl: "https://d", fetch: fakeFetch(status, body) }).verifyCredentials(
        CREDS,
      );
    expect(await at(401, { success: false, error: { code: "invalid_api_key" } })).toMatchObject({
      ok: false,
      code: "invalid_api_key",
    });
    expect(
      await at(401, { success: false, error: { code: "ip_not_whitelisted_for_api_key" } }),
    ).toMatchObject({ ok: false, code: "ip_not_whitelisted_for_api_key" });
    expect(await at(401, { success: false, error: { code: "signature_expired" } })).toMatchObject({
      ok: false,
      code: "signature_expired",
    });
    expect(await at(403, { success: false, error: { code: "something_else" } })).toMatchObject({
      ok: false,
      code: "unauthorized",
    });
    expect(await at(401, "not json")).toMatchObject({ ok: false, code: "unauthorized" });
    expect(await at(200, { success: false })).toMatchObject({ ok: false, code: "delta_unavailable" });
    expect(await at(200, [1, 2])).toMatchObject({ ok: false, code: "delta_unavailable" });
    expect(await at(503, { success: false, error: "string" })).toMatchObject({
      ok: false,
      code: "delta_unavailable",
      message: "Delta answered HTTP 503",
    });
    expect(await at(200, { success: true })).toEqual({ ok: true, balances: null });
  });

  it("reports timeouts and network errors without throwing", async () => {
    const hanging: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      });
    const slow = new DeltaPrivateClientImpl({ baseUrl: "https://d", fetch: hanging, timeoutMs: 5 });
    expect(await slow.verifyCredentials(CREDS)).toMatchObject({
      ok: false,
      code: "delta_unavailable",
      message: expect.stringContaining("timed out") as string,
    });
    const broken = new DeltaPrivateClientImpl({
      baseUrl: "https://d",
      fetch: () => Promise.reject(new Error("ECONNRESET")),
    });
    expect(await broken.verifyCredentials(CREDS)).toMatchObject({
      ok: false,
      message: expect.stringContaining("network error") as string,
    });
  });

  it("[TRADING-SAFETY] refuses to use real fetch when NODE_ENV=test", () => {
    expect(() => new DeltaPrivateClientImpl({ baseUrl: "https://d", nodeEnv: "test" })).toThrow(
      /trading safety/,
    );
    expect(() => new DeltaPrivateClientImpl({ baseUrl: "https://d" })).toThrow(/trading safety/);
    expect(new DeltaPrivateClientImpl({ baseUrl: "https://d", nodeEnv: "development" })).toBeInstanceOf(
      DeltaPrivateClientImpl,
    );
  });

  it("describes every code in plain language", () => {
    for (const code of [
      "invalid_api_key",
      "ip_not_whitelisted_for_api_key",
      "signature_expired",
      "unauthorized",
      "delta_unavailable",
    ] as const) {
      expect(describeCode(code).length).toBeGreaterThan(10);
    }
  });

  it("fake client records calls and defaults unknown keys to invalid_api_key", async () => {
    const fake = new FakeDeltaPrivateClient()
      .accept("good")
      .reject("blocked", "ip_not_whitelisted_for_api_key");
    expect((await fake.verifyCredentials({ apiKey: "good", apiSecret: "s" })).ok).toBe(true);
    expect(await fake.verifyCredentials({ apiKey: "blocked", apiSecret: "s" })).toMatchObject({
      ok: false,
      code: "ip_not_whitelisted_for_api_key",
    });
    expect(await fake.verifyCredentials({ apiKey: "nope", apiSecret: "s" })).toMatchObject({
      ok: false,
      code: "invalid_api_key",
    });
    expect(fake.calls.map((c) => c.apiKey)).toEqual(["good", "blocked", "nope"]);
  });
});
