import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { API_VERSION } from "./app.js";
import { createTestApp, type TestApp } from "./test-support/harness.js";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  try {
    await t.close();
  } catch {
    // already closed by the last test
  }
});

describe("[OPS] health and API contract", () => {
  it("GET /healthz reports the database kind and version", async () => {
    const res = await t.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      db: "pglite",
      dbOk: true,
      uptimeSec: expect.any(Number) as number,
      version: API_VERSION,
      jobs: null,
    });
  });

  it("GET /v1/openapi.json documents every /v1 route with the cookie security scheme", async () => {
    const res = await t.request("/v1/openapi.json");
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      openapi: string;
      info: { title: string };
      paths: Record<string, unknown>;
      components: { securitySchemes: Record<string, unknown> };
    };
    expect(doc.openapi).toBe("3.0.0");
    expect(doc.info.title).toBe("HapieCoin API");
    for (const path of [
      "/healthz",
      "/v1/me",
      "/v1/settings",
      "/v1/brokers",
      "/v1/brokers/{id}",
      "/v1/credentials",
      "/v1/credentials/{id}",
      "/v1/credentials/whitelist-ip",
      "/v1/plan",
      "/v1/auth-options",
    ]) {
      expect(Object.keys(doc.paths), path).toContain(path);
    }
    expect(doc.components.securitySchemes["cookieAuth"]).toMatchObject({ type: "apiKey", in: "cookie" });
    const docs = await t.request("/v1/docs");
    expect(docs.status).toBe(200);
    expect(await docs.text()).toContain("swagger");
  });

  it("GET /healthz turns 503 when the database is unreachable", async () => {
    await t.handle.close();
    const res = await t.request("/healthz");
    expect(res.status).toBe(503);
    expect(((await res.json()) as { status: string; dbOk: boolean }).dbOk).toBe(false);
  });
});
