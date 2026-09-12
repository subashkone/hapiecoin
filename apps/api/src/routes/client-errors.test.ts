import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLIENT_ERRORS_PER_MINUTE } from "./client-errors.js";
import { createTestApp, type TestApp } from "../test-support/harness.js";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

describe("HC-SH-132 POST /v1/client-errors relays a browser error to the sink (ADR-081)", () => {
  it("accepts a report without a session, keeps only the user agent of the headers, tags it as a browser event and answers the event id", async () => {
    const res = await t.request("/v1/client-errors", {
      json: { message: "Cannot read properties of undefined", name: "TypeError", stack: "onClick@https://app/x.js:1:2", path: "/analyse?token=abc&tab=chain", release: "r1", kind: "unhandledrejection" },
      headers: { "user-agent": "Mozilla/5.0 test", cookie: "session=nope" },
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ eventId: "evt-1" });
    const hit = t.errors.captured.at(-1)!;
    expect(hit.error).toEqual({ name: "TypeError", message: "Cannot read properties of undefined", stack: "onClick@https://app/x.js:1:2" });
    // the path reaches the sink as sent; the sink scrubs its query before anything leaves (error-sink.test)
    expect(hit.ctx).toEqual({
      platform: "javascript",
      logger: "browser:unhandledrejection",
      handled: false,
      release: "r1",
      tags: { app: "web", kind: "unhandledrejection" },
      request: { method: "GET", url: "/analyse?token=abc&tab=chain", userAgent: "Mozilla/5.0 test" },
    });
    expect(JSON.stringify(hit)).not.toContain("nope");
    expect(await (await t.request("/metrics")).text()).toContain('hapiecoin_api_errors_total{kind="browser"} 1');
  });

  it("defaults the name and the kind, and marks a boundary report as handled", async () => {
    const res = await t.request("/v1/client-errors", { json: { message: "boundary caught it", kind: "boundary" } });
    expect(res.status).toBe(202);
    const hit = t.errors.captured.at(-1)!;
    expect(hit.error).toEqual({ name: "Error", message: "boundary caught it", stack: undefined });
    expect(hit.ctx).toMatchObject({ logger: "browser:boundary", handled: true, request: { method: "GET", url: "/" } });
    const plain = await t.request("/v1/client-errors", { json: { message: "plain" } });
    expect(plain.status).toBe(202);
    expect(t.errors.captured.at(-1)!.ctx).toMatchObject({ logger: "browser:error", handled: false });
  });

  it("refuses a body without a message, a stack over the cap and unknown fields", async () => {
    expect((await t.request("/v1/client-errors", { json: { name: "x" } })).status).toBe(400);
    expect((await t.request("/v1/client-errors", { json: { message: "m", stack: "x".repeat(4_001) } })).status).toBe(400);
    expect((await t.request("/v1/client-errors", { json: { message: "m", extra: 1 } })).status).toBe(400);
    expect((await t.request("/v1/client-errors", { json: { message: "   " } })).status).toBe(400);
  });

  it("rate-limits reports per address and opens again after a minute", async () => {
    const before = t.errors.captured.length;
    for (let i = 0; i < CLIENT_ERRORS_PER_MINUTE; i += 1) {
      expect((await t.request("/v1/client-errors", { json: { message: `m${i}` }, ip: "10.9.9.9" })).status).toBe(202);
    }
    const limited = await t.request("/v1/client-errors", { json: { message: "one more" }, ip: "10.9.9.9" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect(t.errors.captured.length - before).toBe(CLIENT_ERRORS_PER_MINUTE);
    t.now.value += 61_000;
    expect((await t.request("/v1/client-errors", { json: { message: "after a minute" }, ip: "10.9.9.9" })).status).toBe(202);
  });
});
