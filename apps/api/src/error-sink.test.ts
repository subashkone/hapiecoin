import { describe, expect, it, vi } from "vitest";
import { REDACTED, captureFromLog, createErrorSink, isSecretKey, parseDsn, parseStack, redact, redactPath, type ErrorContext } from "./error-sink.js";
import { isSecretKey as loggerIsSecretKey } from "./logger.js";

interface Sent {
  url: string;
  init: RequestInit;
}

function fakeFetch(status = 200) {
  const calls: Sent[] = [];
  const fn = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url, init: init ?? {} });
    return Promise.resolve(new Response(null, { status }));
  });
  return { calls, fetch: fn as unknown as typeof fetch };
}

interface Envelope {
  header: Record<string, unknown>;
  item: Record<string, unknown>;
  event: Record<string, unknown> & { exception: { values: Record<string, unknown>[] } };
}

function envelopeOf(call: Sent): Envelope {
  const [header, item, payload] = (call.init.body as string).split("\n");
  return { header: JSON.parse(header!) as Envelope["header"], item: JSON.parse(item!) as Envelope["item"], event: JSON.parse(payload!) as Envelope["event"] };
}

const DSN = "https://pub@t.example/1";

describe("HC-SH-133 the error sink speaks the Sentry envelope protocol without an SDK (ADR-081)", () => {
  it("parses a DSN into the envelope endpoint and the public key, with a path prefix, and refuses the rest", () => {
    expect(parseDsn("https://abc@sentry.example.com/12")).toEqual({ endpoint: "https://sentry.example.com/api/12/envelope/", publicKey: "abc", projectId: "12" });
    expect(parseDsn("http://k:s@glitchtip.local:8000/prefix/7").endpoint).toBe("http://glitchtip.local:8000/prefix/api/7/envelope/");
    expect(() => parseDsn("not a url")).toThrow(/not a URL/);
    expect(() => parseDsn("https://sentry.example.com/12")).toThrow(/public key/);
    expect(() => parseDsn("https://abc@sentry.example.com/notanumber")).toThrow(/project id/);
    expect(() => parseDsn("ftp://abc@sentry.example.com/1")).toThrow(/project id/);
  });

  it("turns V8 and Firefox stacks into frames oldest-first and marks node internals and dependencies out of app", () => {
    const v8 = [
      "Error: boom",
      "    at /srv/api/dist/main.js:5:1",
      "    at placeEntries (E:\\app\\src\\routes\\live-exec.ts:120:15)",
      "    at async Promise.all (index 0)",
      "    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)",
      "    at Object.<anonymous> (/srv/api/node_modules/hono/dist/index.js:1:2)",
    ].join("\n");
    const frames = parseStack(v8);
    expect(frames.map((f) => f.function)).toEqual(["Object.<anonymous>", "process.processTicksAndRejections", "async Promise.all", "placeEntries", "<anonymous>"]);
    expect(frames[4]).toMatchObject({ function: "<anonymous>", filename: "main.js", lineno: 5, colno: 1, in_app: true });
    expect(frames[3]).toEqual({ function: "placeEntries", filename: "live-exec.ts", abs_path: "E:\\app\\src\\routes\\live-exec.ts", in_app: true, lineno: 120, colno: 15 });
    expect(frames[1]!.in_app).toBe(false);
    expect(frames[0]!.in_app).toBe(false);
    const gecko = parseStack("render@https://app.hapiecoin.com/_next/static/chunks/main.js:10:200\nonClick@https://app.hapiecoin.com/_next/static/chunks/page.js:3:4");
    expect(gecko.map((f) => [f.function, f.filename, f.lineno, f.colno])).toEqual([
      ["onClick", "page.js", 3, 4],
      ["render", "main.js", 10, 200],
    ]);
    expect(parseStack(undefined)).toEqual([]);
    expect(parseStack("Error: only a message")).toEqual([]);
    expect(parseStack(Array.from({ length: 80 }, (_, i) => `    at f${i} (x.js:${i}:1)`).join("\n"))).toHaveLength(50);
  });

  it("redacts the same keys the logger does, cuts cycles, keeps dates and renders errors as name + message", () => {
    for (const key of ["apiKey", "api_secret", "otp", "password", "cookie", "authorization", "token", "signature", "apiKeyMasked", "email", "requestId"]) {
      expect(isSecretKey(key)).toBe(loggerIsSecretKey(key));
    }
    const cyc: Record<string, unknown> = { token: "t", nested: { password: "p", ok: 1 }, when: new Date(0), err: new Error("e"), list: [{ otp: "1" }] };
    cyc["self"] = cyc;
    const out = redact(cyc);
    expect(out["token"]).toBe(REDACTED);
    expect(out["nested"]).toEqual({ password: REDACTED, ok: 1 });
    expect(out["when"]).toBeInstanceOf(Date);
    expect(out["err"]).toEqual({ name: "Error", message: "e" });
    expect(out["list"]).toEqual([{ otp: REDACTED }]);
    expect(out["self"]).toBe("[circular]");
    expect(redactPath("/v1/x?token=abc&page=2")).toBe("/v1/x?token=%5Bredacted%5D&page=2");
    expect(redactPath("/v1/x")).toBe("/v1/x");
  });

  it("is off without a DSN: captures answer null and nothing is fetched", async () => {
    const f = fakeFetch();
    const sink = createErrorSink({ dsn: undefined, environment: "test", fetch: f.fetch });
    expect(sink.enabled).toBe(false);
    expect(sink.capture(new Error("x"))).toBeNull();
    await sink.flush();
    expect(f.calls).toHaveLength(0);
    expect(sink.stats()).toEqual({ sent: 0, dropped: 0, failed: 0 });
  });

  it("sends one scrubbed envelope per capture: auth header, three lines, frames, the request without body or cookies, the user id only", async () => {
    const f = fakeFetch();
    const now = { value: Date.UTC(2026, 8, 12, 10, 0, 0) };
    const sink = createErrorSink({ dsn: "https://pub@track.hapiecoin.com/3", environment: "production", release: "abc123", client: "hapiecoin-api", serverName: "api-1", fetch: f.fetch, now: () => now.value });
    const err = new TypeError("cannot read x");
    const id = sink.capture(err, {
      logger: "http",
      tags: { requestId: "r1", route: "/v1/strategies/:id", token: "secret-tag", empty: undefined },
      extra: { apiKey: "k", lots: 2 },
      request: { method: "POST", url: "/v1/strategies/s1/live?token=t", userAgent: "UA/1" },
      userId: "u1",
      handled: false,
    });
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    await sink.flush();
    expect(f.calls).toHaveLength(1);
    const call = f.calls[0]!;
    expect(call.url).toBe("https://track.hapiecoin.com/api/3/envelope/");
    const headers = call.init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/x-sentry-envelope");
    expect(headers["x-sentry-auth"]).toBe("Sentry sentry_version=7, sentry_client=hapiecoin-api/abc123, sentry_key=pub");
    const { header, item, event } = envelopeOf(call);
    expect(header).toEqual({ event_id: id, sent_at: "2026-09-12T10:00:00.000Z", dsn: "https://pub@track.hapiecoin.com/3" });
    expect(item).toEqual({ type: "event", content_type: "application/json", length: Buffer.byteLength((call.init.body as string).split("\n")[2]!) });
    expect(event).toMatchObject({
      event_id: id,
      timestamp: "2026-09-12T10:00:00.000Z",
      platform: "node",
      level: "error",
      logger: "http",
      environment: "production",
      release: "abc123",
      server_name: "api-1",
      tags: { requestId: "r1", route: "/v1/strategies/:id", token: REDACTED },
      extra: { apiKey: REDACTED, lots: 2 },
      request: { method: "POST", url: "/v1/strategies/s1/live?token=%5Bredacted%5D", headers: { "user-agent": "UA/1" } },
      user: { id: "u1" },
    });
    expect(event["tags"]).not.toHaveProperty("empty");
    expect(event.exception.values[0]).toMatchObject({ type: "TypeError", value: "cannot read x", mechanism: { type: "generic", handled: false } });
    expect((event.exception.values[0]!["stacktrace"] as { frames: unknown[] }).frames.length).toBeGreaterThan(0);
    expect(JSON.stringify(event)).not.toContain("secret-tag");
    expect(sink.stats()).toEqual({ sent: 1, dropped: 0, failed: 0 });
  });

  it("describes a plain record (a browser report), a bare string and an object without a message; stamps javascript events", async () => {
    const f = fakeFetch();
    const sink = createErrorSink({ dsn: DSN, environment: "test", fetch: f.fetch });
    sink.capture({ name: "RangeError", message: "bad range", stack: "onClick@https://h/x.js:1:2" }, { platform: "javascript", handled: true });
    sink.capture("just text");
    sink.capture({ code: 7, password: "p" });
    sink.capture(null);
    await sink.flush();
    const [a, b, c, d] = f.calls.map(envelopeOf);
    expect(a!.event["platform"]).toBe("javascript");
    expect(a!.event["release"]).toBeUndefined();
    expect(a!.event.exception.values[0]).toMatchObject({ type: "RangeError", value: "bad range", mechanism: { handled: true } });
    expect((a!.event.exception.values[0]!["stacktrace"] as { frames: unknown[] }).frames).toEqual([{ function: "onClick", filename: "x.js", abs_path: "https://h/x.js", in_app: true, lineno: 1, colno: 2 }]);
    expect(b!.event.exception.values[0]).toMatchObject({ type: "Error", value: "just text" });
    expect(b!.event.exception.values[0]).not.toHaveProperty("stacktrace"); // no frames, no stacktrace block
    expect(c!.event.exception.values[0]!["value"]).toBe(JSON.stringify({ code: 7, password: REDACTED }));
    expect(d!.event.exception.values[0]!["value"]).toBe("null");
    expect(a!.event["request"]).toBeUndefined();
    expect(a!.event["user"]).toBeUndefined();
  });

  it("cuts a query error's bound values off the message, takes the context's release over the process one, and drops personal data from a log record", async () => {
    const f = fakeFetch();
    const sink = createErrorSink({ dsn: DSN, environment: "test", release: "api-1", fetch: f.fetch });
    sink.capture(new Error("Failed query: insert into verifications (identifier, value) values ($1, $2)\nparams: otp@x.test,123456"));
    sink.capture({ name: "TypeError", message: "boom\nparams: secret" }, { release: "web-9" });
    await sink.flush();
    const [a, b] = f.calls.map(envelopeOf);
    expect(a!.event.exception.values[0]!["value"]).toBe("Failed query: insert into verifications (identifier, value) values ($1, $2)");
    expect(a!.event["release"]).toBe("api-1");
    expect(JSON.stringify(a!.event)).not.toContain("123456");
    expect(b!.event.exception.values[0]!["value"]).toBe("boom");
    expect(b!.event["release"]).toBe("web-9");
    const captured: { error: unknown; ctx: ErrorContext }[] = [];
    const fake = { enabled: true, capture: (error: unknown, ctx: ErrorContext = {}) => (captured.push({ error, ctx }), "id"), flush: () => Promise.resolve(), stats: () => ({ sent: 0, dropped: 0, failed: 0 }) };
    captureFromLog(fake, { fields: { to: "trader@x.test", email: "trader@x.test", name: "A Trader", phone: "9", mobile: "9", user: { id: "u" }, userId: "u1", lots: 1 }, msg: "mail failed", level: 50 });
    expect(captured[0]!.ctx.extra).toEqual({ lots: 1 });
    expect(captured[0]!.ctx.userId).toBe("u1");
    expect(JSON.stringify(captured[0]!.ctx)).not.toContain("trader@x.test");
  });

  it("caps events per minute, counts the dropped ones and opens a new window after 60 s", async () => {
    const f = fakeFetch();
    const now = { value: 1_000_000 };
    const sink = createErrorSink({ dsn: DSN, environment: "test", fetch: f.fetch, now: () => now.value, maxPerMinute: 2 });
    expect(sink.capture(new Error("1"))).not.toBeNull();
    expect(sink.capture(new Error("2"))).not.toBeNull();
    expect(sink.capture(new Error("3"))).toBeNull();
    now.value += 60_000;
    expect(sink.capture(new Error("4"))).not.toBeNull();
    await sink.flush();
    expect(f.calls).toHaveLength(3);
    expect(sink.stats()).toEqual({ sent: 3, dropped: 1, failed: 0 });
  });

  it("a refused or failed send is counted and reported, never thrown; a hung send is cut by the timeout", async () => {
    const failures: string[] = [];
    const refused = createErrorSink({ dsn: DSN, environment: "test", fetch: fakeFetch(429).fetch, onFailure: (m) => failures.push(m) });
    refused.capture(new Error("x"));
    await refused.flush();
    expect(refused.stats()).toEqual({ sent: 0, dropped: 0, failed: 1 });
    const down = createErrorSink({ dsn: DSN, environment: "test", fetch: () => Promise.reject(new Error("ECONNREFUSED")), onFailure: (m) => failures.push(m) });
    down.capture(new Error("x"));
    await down.flush();
    expect(down.stats().failed).toBe(1);
    const hung = createErrorSink({
      dsn: DSN,
      environment: "test",
      timeoutMs: 20,
      fetch: (_url, init) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
      onFailure: (m) => failures.push(m),
    });
    hung.capture(new Error("x"));
    await hung.flush();
    expect(hung.stats().failed).toBe(1);
    expect(failures).toEqual(["error sink answered 429", "error sink send failed: ECONNREFUSED", "error sink send failed: aborted"]);
    // silent without onFailure
    const quiet = createErrorSink({ dsn: DSN, environment: "test", fetch: fakeFetch(500).fetch });
    quiet.capture("x");
    await quiet.flush();
    expect(quiet.stats().failed).toBe(1);
  });

  it("captureFromLog maps a log record: the err field, known keys as tags, the rest as extra, the user and the request", () => {
    const captured: { error: unknown; ctx: ErrorContext }[] = [];
    const sink = {
      enabled: true,
      capture: (error: unknown, ctx: ErrorContext = {}) => {
        captured.push({ error, ctx });
        return "id";
      },
      flush: () => Promise.resolve(),
      stats: () => ({ sent: 0, dropped: 0, failed: 0 }),
    };
    const err = new Error("boom");
    captureFromLog(sink, { fields: { err, requestId: "r1", route: "/v1/me", method: "GET", path: "/v1/me?otp=1", userId: "u1", lots: 3 }, msg: "unhandled error", level: 50 });
    expect(captured[0]).toEqual({
      error: err,
      ctx: {
        level: "error",
        logger: "log",
        tags: { msg: "unhandled error", requestId: "r1", route: "/v1/me", method: "GET", path: "/v1/me?otp=1" },
        handled: false,
        extra: { lots: 3 },
        userId: "u1",
        request: { method: "GET", url: "/v1/me?otp=1" },
      },
    });
    captureFromLog(sink, { fields: { job: "reconciler", error: "lease lost" }, msg: "job failed", level: 60 });
    expect(captured[1]).toEqual({ error: "lease lost", ctx: { level: "fatal", logger: "job:reconciler", tags: { msg: "job failed", job: "reconciler" }, handled: false } });
    captureFromLog(sink, { fields: {}, msg: "plain", level: 50 });
    expect(captured[2]).toEqual({ error: "plain", ctx: { level: "error", logger: "log", tags: { msg: "plain" }, handled: true } });
  });
});
