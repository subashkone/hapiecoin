// Roadmap item 27 (ADR-081): the logger hook, GET /metrics and the 500 → sink path, end to end through the app.
import { Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ErrorLogRecord, createLogger, toErrorLogRecord } from "./logger.js";
import { createTestApp, type TestApp } from "./test-support/harness.js";

describe("HC-SH-133 the logger hands error-level records to the sink (ADR-081)", () => {
  it("forwards error and fatal calls, child bindings included, before writing; never warn; a throwing hook does not break the log", () => {
    const records: ErrorLogRecord[] = [];
    const lines: string[] = [];
    const dest = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const log = createLogger({
      level: "info",
      destination: dest,
      onError: (r) => {
        records.push(r);
        if (r.msg === "explode") throw new Error("hook");
      },
    });
    const err = new Error("boom");
    log.error({ err, requestId: "r1" }, "unhandled error");
    log.child({ requestId: "r2" }).fatal("fatal text");
    log.error(err);
    log.warn({ err }, "not forwarded");
    log.info("not forwarded either");
    log.error("explode");
    log.error({ err: Object.assign(new Error("Failed query"), { params: ["123456"], query: "insert" }) }, "query failed");
    expect(records).toHaveLength(5);
    expect(records[0]).toMatchObject({ fields: { err, requestId: "r1" }, msg: "unhandled error", level: 50 });
    expect(records[1]).toMatchObject({ fields: { requestId: "r2" }, msg: "fatal text", level: 60 });
    expect(records[2]).toMatchObject({ fields: { err }, msg: "boom", level: 50 });
    expect(records[3]).toMatchObject({ fields: {}, msg: "explode", level: 50 });
    expect(lines.filter((l) => l.includes('"msg":"')).length).toBe(7);
    const queryLine = lines.find((l) => l.includes('"msg":"query failed"')) ?? "";
    expect(queryLine).toContain('"params":"[redacted]"');
    expect(queryLine).toContain('"query":"[redacted]"');
    expect(queryLine).not.toContain("123456");
    expect(lines.some((l) => l.includes('"level":"fatal"') && l.includes('"requestId":"r2"'))).toBe(true);
    expect(lines.some((l) => l.includes('"msg":"explode"'))).toBe(true);
  });

  it("toErrorLogRecord takes the three pino call shapes", () => {
    const err = new Error("e");
    expect(toErrorLogRecord([err], 50)).toEqual({ fields: { err }, msg: "e", level: 50 });
    expect(toErrorLogRecord([err, "said"], 50)).toEqual({ fields: { err }, msg: "said", level: 50 });
    expect(toErrorLogRecord([{ a: 1 }, "m"], 60)).toEqual({ fields: { a: 1 }, msg: "m", level: 60 });
    expect(toErrorLogRecord([{ a: 1 }], 50)).toEqual({ fields: { a: 1 }, msg: "", level: 50 });
    expect(toErrorLogRecord(["text"], 50)).toEqual({ fields: {}, msg: "text", level: 50 });
    expect(toErrorLogRecord([42], 50)).toEqual({ fields: {}, msg: "42", level: 50 });
  });

  it("without onError the logger is unchanged", () => {
    const lines: string[] = [];
    const log = createLogger({
      level: "error",
      destination: new Writable({
        write(chunk, _enc, cb) {
          lines.push(String(chunk));
          cb();
        },
      }),
    });
    log.error("plain");
    expect(lines).toHaveLength(1);
  });
});

describe("HC-SH-133 GET /metrics and the unhandled-error path (ADR-081)", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ METRICS_TOKEN: "scrape-secret" });
  });
  afterAll(() => t.close());

  it("refuses without the token, then serves Prometheus text counting requests by route pattern and status, the probes left out", async () => {
    const noauth = await t.request("/metrics");
    expect(noauth.status).toBe(401);
    expect(noauth.headers.get("www-authenticate")).toBe("Bearer");
    expect((await t.request("/metrics", { headers: { authorization: "Bearer wrong-token" } })).status).toBe(401);
    await t.request("/v1/me"); // 401
    const { cookie } = await t.signUp("metrics@hapiecoin.test");
    await t.request("/v1/me", { cookie });
    await t.request("/v1/nope");
    const res = await t.request("/metrics", { headers: { authorization: "Bearer scrape-secret" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain; version=0.0.4");
    const text = await res.text();
    expect(text).toMatch(/hapiecoin_api_requests_total\{method="GET",route="\/v1\/me",status="200"\} [1-9]/);
    expect(text).toContain('hapiecoin_api_requests_total{method="GET",route="/v1/me",status="401"} 1');
    expect(text).toContain('route="(other)",status="404"} 1');
    expect(text).not.toContain('route="/metrics"');
    expect(text).toMatch(/hapiecoin_api_request_duration_seconds_count\{route="\/v1\/me"\} [2-9]/);
    expect(text).toContain("hapiecoin_api_jobs_active 0");
    expect(text).toContain('hapiecoin_api_error_sink_events_total{outcome="sent"} 0');
    expect(text).toMatch(/process_resident_memory_bytes \d+/);
  });

  it("a route that throws answers 500 with the request id, and one event reaches the sink with the route, the scrubbed path and the request id", async () => {
    // its own app: a route can only be added before the first request builds the matcher
    const tb = await createTestApp();
    tb.app.get("/v1/boom", () => {
      throw new Error("kaboom");
    });
    try {
      await boomFlow(tb);
    } finally {
      await tb.close();
    }
  });
});

async function boomFlow(t: TestApp): Promise<void> {
  {
    const res = await t.request("/v1/boom?otp=123456");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string; details?: { requestId?: string } };
    expect(body.code).toBe("INTERNAL_ERROR");
    const requestId = body.details?.requestId;
    expect(requestId).toBeTruthy();
    const hit = t.errors.captured.find((c) => c.ctx.tags?.["requestId"] === requestId);
    expect(hit).toBeDefined();
    expect(hit!.error).toBeInstanceOf(Error);
    expect((hit!.error as Error).message).toBe("kaboom");
    expect(hit!.ctx).toMatchObject({ level: "error", handled: false, tags: { msg: "unhandled error", route: "/v1/boom", method: "GET", path: "/v1/boom" }, request: { method: "GET", url: "/v1/boom" } });
    expect(JSON.stringify(hit!.ctx)).not.toContain("123456");
    const metrics = await (await t.request("/metrics")).text();
    expect(metrics).toContain('hapiecoin_api_errors_total{kind="unhandled"} 1');
    expect(metrics).toContain('hapiecoin_api_requests_total{method="GET",route="/v1/boom",status="500"} 1');
  }
}
