/**
 * Error sink (roadmap item 27, ADR-081): unhandled failures reach one error tracker. The tracker is any server that
 * speaks the Sentry envelope protocol (Sentry, GlitchTip, Bugsink), addressed by one DSN; there is no SDK. Every
 * field is scrubbed (trading-safety rule 3), no request body, cookie or authorization header ever travels, sends are
 * fire-and-forget with a timeout, and a burst is capped so an error storm never floods the tracker or the event loop.
 * Without ERROR_SINK_DSN every call is a no-op, so tests and a laptop run need nothing.
 *
 * The same file lives in apps/gateway/src/error-sink.ts (no shared server package yet, GAPS #97); keep them equal.
 */
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

export type ErrorLevel = "fatal" | "error" | "warning";

export interface ErrorContext {
  level?: ErrorLevel | undefined;
  /** Which part reported it: "http", "job:reconciler", "process", "browser:error"… */
  logger?: string | undefined;
  tags?: Record<string, string | number | boolean | null | undefined> | undefined;
  extra?: Record<string, unknown> | undefined;
  /** The request in flight: method and path (query scrubbed); the user agent is the only header that travels. */
  request?: { method: string; url: string; userAgent?: string | undefined } | undefined;
  /** The signed-in user's id only; never the email. */
  userId?: string | undefined;
  /** "node" (default) or "javascript" for an event relayed from the browser. */
  platform?: "node" | "javascript" | undefined;
  handled?: boolean | undefined;
  /** Overrides the process release for this event (a browser build's own version). */
  release?: string | undefined;
}

export interface ErrorSink {
  readonly enabled: boolean;
  /** Queue one event; returns its id, or null when the sink is off or the minute's cap is spent. Never throws. */
  capture(error: unknown, ctx?: ErrorContext): string | null;
  /** Wait for the in-flight sends (shutdown). */
  flush(): Promise<void>;
  stats(): SinkStats;
}

export interface SinkStats {
  sent: number;
  dropped: number;
  failed: number;
}

export interface ErrorSinkOptions {
  dsn: string | undefined;
  environment: string;
  release?: string | undefined;
  serverName?: string | undefined;
  /** The sentry_client name: "hapiecoin-api" or "hapiecoin-gateway". */
  client?: string | undefined;
  fetch?: typeof fetch | undefined;
  now?: (() => number) | undefined;
  /** Events accepted per minute; the rest are dropped and counted (default 60). */
  maxPerMinute?: number | undefined;
  timeoutMs?: number | undefined;
  /** A failed send is reported here (never thrown). */
  onFailure?: ((message: string) => void) | undefined;
}

export interface ParsedDsn {
  endpoint: string;
  publicKey: string;
  projectId: string;
}

/** `{PROTOCOL}://{PUBLIC_KEY}[:{SECRET}]@{HOST}{PATH}/{PROJECT_ID}` → the envelope endpoint and the public key. */
export function parseDsn(dsn: string): ParsedDsn {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    throw new Error("ERROR_SINK_DSN is not a URL");
  }
  const publicKey = url.username;
  const segments = url.pathname.split("/").filter((s) => s.length > 0);
  const projectId = segments.pop();
  if (!publicKey || projectId === undefined || !/^\d+$/.test(projectId) || (url.protocol !== "https:" && url.protocol !== "http:")) {
    throw new Error("ERROR_SINK_DSN must look like https://<public key>@<host>/<project id>");
  }
  const base = `${url.protocol}//${url.host}${segments.length ? `/${segments.join("/")}` : ""}`;
  return { endpoint: `${base}/api/${projectId}/envelope/`, publicKey, projectId };
}

export interface Frame {
  filename: string;
  function: string;
  abs_path: string;
  in_app: boolean;
  lineno?: number;
  colno?: number;
}

const V8_FRAME = /^\s*at (?:(.+?) \()?(.+?)(?::(\d+))?(?::(\d+))?\)?$/;
const GECKO_FRAME = /^(.*?)@(\S+?):(\d+)(?::(\d+))?$/;

/** V8 ("    at fn (file:1:2)") and Firefox ("fn@file:1:2") stacks → frames oldest-first, as the protocol wants. */
export function parseStack(stack: string | undefined, max = 50): Frame[] {
  if (!stack) return [];
  const frames: Frame[] = [];
  for (const line of stack.split("\n")) {
    const m = V8_FRAME.exec(line) ?? GECKO_FRAME.exec(line);
    if (!m) continue;
    const abs = (m[2] ?? "").trim(); // group 2 always takes part in a match: both patterns need at least one character there
    const frame: Frame = {
      function: (m[1] ?? "").trim() || "<anonymous>",
      filename: abs.split(/[\\/]/).pop() ?? abs,
      abs_path: abs,
      in_app: !/node_modules|^node:|^internal\//.test(abs),
    };
    if (m[3] !== undefined) frame.lineno = Number(m[3]);
    if (m[4] !== undefined) frame.colno = Number(m[4]);
    frames.push(frame);
    if (frames.length >= max) break;
  }
  return frames.reverse();
}

/** Same rule as logger.ts (trading-safety rule 3); the API test proves the two agree on a key list. */
const SECRET_KEY_RE = /(api[_-]?key|api[_-]?secret|secret|otp|password|cookie|authorization|token|signature)/i;
const PUBLIC_KEY_RE = /masked$/i;
export const REDACTED = "[redacted]";

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_RE.test(key) && !PUBLIC_KEY_RE.test(key);
}

/** Deep copy with every value under a secret-looking key replaced; cycles cut; Dates and Buffers kept. */
export function redact<T>(value: T, seen = new WeakSet<object>()): T {
  if (Array.isArray(value)) return value.map((v: unknown) => redact(v, seen)) as T;
  if (value !== null && typeof value === "object") {
    if (value instanceof Date || Buffer.isBuffer(value)) return value;
    if (value instanceof Error) return { name: value.name, message: value.message } as T;
    if (seen.has(value)) return "[circular]" as T;
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = isSecretKey(k) ? REDACTED : redact(v, seen);
    return out as T;
  }
  return value;
}

/** Secret-looking query parameters are replaced in a path (`/x?token=…` → `/x?token=[redacted]`). */
export function redactPath(path: string): string {
  const q = path.indexOf("?");
  if (q === -1) return path;
  const params = new URLSearchParams(path.slice(q + 1));
  for (const key of [...params.keys()]) if (isSecretKey(key)) params.set(key, REDACTED);
  return `${path.slice(0, q)}?${params.toString()}`;
}

interface Described {
  type: string;
  value: string;
  stack: string | undefined;
}

/** A database driver's query error quotes the bound values after "params:" (an OTP, a token); the SQL text alone is kept. */
function cutParams(message: string): string {
  return message.split("\nparams:")[0] ?? message;
}

/** An Error, a plain record of one (a browser report, a log field), or anything else (stringified after redaction). */
function describe(error: unknown): Described {
  if (error instanceof Error) return { type: error.name || "Error", value: cutParams(error.message), stack: error.stack };
  if (error !== null && typeof error === "object") {
    const r = error as Record<string, unknown>;
    if (typeof r["message"] === "string") {
      return {
        type: typeof r["name"] === "string" && r["name"] !== "" ? r["name"] : "Error",
        value: cutParams(r["message"]),
        stack: typeof r["stack"] === "string" ? r["stack"] : undefined,
      };
    }
    return { type: "Error", value: JSON.stringify(redact(error)), stack: undefined };
  }
  return { type: "Error", value: String(error), stack: undefined };
}

function stringTags(tags: ErrorContext["tags"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tags ?? {})) {
    if (v === undefined || v === null) continue;
    out[k] = String(v).slice(0, 200);
  }
  return redact(out);
}

const OFF: ErrorSink = { enabled: false, capture: () => null, flush: () => Promise.resolve(), stats: () => ({ sent: 0, dropped: 0, failed: 0 }) };

export function createErrorSink(options: ErrorSinkOptions): ErrorSink {
  if (options.dsn === undefined) return OFF;
  const dsn = parseDsn(options.dsn);
  const now = options.now ?? Date.now;
  const doFetch = options.fetch ?? fetch;
  const maxPerMinute = options.maxPerMinute ?? 60;
  const timeoutMs = options.timeoutMs ?? 3_000;
  const client = `${options.client ?? "hapiecoin"}/${options.release ?? "0"}`;
  const serverName = options.serverName ?? hostname();
  const stats: SinkStats = { sent: 0, dropped: 0, failed: 0 };
  const inFlight = new Set<Promise<void>>();
  let windowStart = now();
  let windowCount = 0;

  const capture = (error: unknown, ctx: ErrorContext = {}): string | null => {
    const t = now();
    if (t - windowStart >= 60_000) {
      windowStart = t;
      windowCount = 0;
    }
    if (windowCount >= maxPerMinute) {
      stats.dropped += 1;
      return null;
    }
    windowCount += 1;
    const eventId = randomUUID().replace(/-/g, "");
    const at = new Date(t).toISOString();
    const { type, value, stack } = describe(error);
    const frames = parseStack(stack);
    const exception: Record<string, unknown> = { type, value: value.slice(0, 2_000), mechanism: { type: "generic", handled: ctx.handled ?? false } };
    if (frames.length > 0) exception["stacktrace"] = { frames }; // an empty frame list is left out, as the SDKs do
    const release = ctx.release ?? options.release;
    const event: Record<string, unknown> = {
      event_id: eventId,
      timestamp: at,
      platform: ctx.platform ?? "node",
      level: ctx.level ?? "error",
      logger: ctx.logger ?? "app",
      environment: options.environment,
      server_name: serverName,
      tags: stringTags(ctx.tags),
      exception: { values: [exception] },
    };
    if (release !== undefined) event["release"] = release;
    if (ctx.extra !== undefined) event["extra"] = redact(ctx.extra);
    if (ctx.request !== undefined) {
      const request: Record<string, unknown> = { method: ctx.request.method, url: redactPath(ctx.request.url) };
      if (ctx.request.userAgent !== undefined) request["headers"] = { "user-agent": ctx.request.userAgent.slice(0, 300) };
      event["request"] = request;
    }
    if (ctx.userId !== undefined) event["user"] = { id: ctx.userId };
    const payload = JSON.stringify(event);
    const envelope = `${JSON.stringify({ event_id: eventId, sent_at: at, dsn: options.dsn })}\n${JSON.stringify({ type: "event", content_type: "application/json", length: Buffer.byteLength(payload) })}\n${payload}\n`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref();
    const send: Promise<void> = doFetch(dsn.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_client=${client}, sentry_key=${dsn.publicKey}`,
      },
      body: envelope,
      signal: controller.signal,
    })
      .then((res) => {
        if (res.ok) stats.sent += 1;
        else {
          stats.failed += 1;
          options.onFailure?.(`error sink answered ${res.status}`);
        }
      })
      .catch((e: unknown) => {
        stats.failed += 1;
        options.onFailure?.(`error sink send failed: ${e instanceof Error ? e.message : String(e)}`);
      })
      .finally(() => {
        clearTimeout(timer);
        inFlight.delete(send);
      });
    inFlight.add(send);
    return eventId;
  };

  return {
    enabled: true,
    capture,
    flush: async () => {
      await Promise.allSettled([...inFlight]);
    },
    stats: () => ({ ...stats }),
  };
}

/** One error-level log record as the logger hooks hand it over. */
export interface LogRecord {
  fields: Record<string, unknown>;
  msg: string;
  /** pino numbers: 50 error, 60 fatal. */
  level: number;
}

const TAG_KEYS = new Set(["requestId", "route", "method", "path", "job", "venue", "status", "kind", "signal"]);
/** Personal data that log lines may carry (a mail's recipient, a name): never forwarded, even to `extra`. */
const PII_KEYS = new Set(["to", "email", "name", "phone", "mobile", "user"]);

/**
 * The capture seam: every error-level log becomes an event (the log's `err` / `error` field, else the message). Known
 * keys become tags, `userId` the user, method + path the request, personal data keys are dropped, the rest goes to
 * `extra` (redacted by the sink).
 */
export function captureFromLog(sink: ErrorSink, record: LogRecord): string | null {
  const { fields, msg, level } = record;
  const error = fields["err"] ?? fields["error"] ?? msg;
  const tags: Record<string, string> = { msg };
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (k === "err" || k === "error" || k === "userId" || PII_KEYS.has(k)) continue;
    if (TAG_KEYS.has(k) && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) tags[k] = String(v);
    else extra[k] = v;
  }
  const ctx: ErrorContext = {
    level: level >= 60 ? "fatal" : "error",
    logger: typeof fields["job"] === "string" ? `job:${fields["job"]}` : "log",
    tags,
    handled: fields["err"] === undefined && fields["error"] === undefined,
  };
  if (Object.keys(extra).length > 0) ctx.extra = extra;
  if (typeof fields["userId"] === "string") ctx.userId = fields["userId"];
  if (typeof fields["method"] === "string" && typeof fields["path"] === "string") ctx.request = { method: fields["method"], url: fields["path"] };
  return sink.capture(error, ctx);
}
