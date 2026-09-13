/**
 * Structured JSON logging (pino) with secret scrubbing (trading-safety rule 3).
 * `scrub()` is applied to everything the API logs or writes to the audit log; pino's own `redact`
 * is a second net for well-known paths.
 */
import pino from "pino";

export type Logger = pino.Logger;

/** Key names whose values are never logged. Matched case-insensitively on each object key. */
export const SECRET_KEY_RE =
  /(api[_-]?key|api[_-]?secret|secret|otp|password|cookie|authorization|token|signature)/i;
/** Keys that carry an already-public form (`apiKeyMasked`) are kept. */
const PUBLIC_KEY_RE = /masked$/i;

export const REDACTED = "[redacted]";

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_RE.test(key) && !PUBLIC_KEY_RE.test(key);
}

/**
 * Deep-copy `value` replacing every value under a secret-looking key with "[redacted]".
 * Arrays and nested objects are walked; cycles are cut; non-plain objects (Date, Buffer) are kept as-is.
 */
export function scrub<T>(value: T, seen = new WeakSet<object>()): T {
  if (Array.isArray(value)) {
    return value.map((v: unknown) => scrub(v, seen)) as T;
  }
  if (value !== null && typeof value === "object") {
    if (value instanceof Date || Buffer.isBuffer(value)) return value;
    if (seen.has(value)) return "[circular]" as T;
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSecretKey(k) ? REDACTED : scrub(v, seen);
    }
    return out as T;
  }
  return value;
}

/** Remove secret-looking query parameters from a URL path (for request logs). */
export function scrubPath(path: string): string {
  const q = path.indexOf("?");
  if (q === -1) return path;
  const params = new URLSearchParams(path.slice(q + 1));
  for (const key of [...params.keys()]) {
    if (isSecretKey(key)) params.set(key, REDACTED);
  }
  return `${path.slice(0, q)}?${params.toString()}`;
}

export interface CreateLoggerOptions {
  level: string;
  /** Extra base bindings (service name, env). */
  base?: Record<string, unknown>;
  /** Test hook: capture log lines instead of writing to stdout. */
  destination?: pino.DestinationStream;
  /**
   * ADR-081: every error- and fatal-level call (child loggers included) is handed over as one record before it is
   * written, so the error sink sees the same failures the log does; never throws into the caller.
   */
  onError?: ((record: ErrorLogRecord) => void) | undefined;
}

export interface ErrorLogRecord {
  fields: Record<string, unknown>;
  msg: string;
  /** pino numbers: 50 error, 60 fatal. */
  level: number;
}

/** pino's error level number; fatal is 60. */
export const ERROR_LEVEL = 50;

/** pino accepts (obj, msg, ...), (msg, ...) or (err); one shape for the hook. */
export function toErrorLogRecord(args: readonly unknown[], level: number): ErrorLogRecord {
  const [first, second] = args;
  if (first instanceof Error) return { fields: { err: first }, msg: typeof second === "string" ? second : first.message, level };
  if (first !== null && typeof first === "object") return { fields: { ...(first as Record<string, unknown>) }, msg: typeof second === "string" ? second : "", level };
  return { fields: {}, msg: typeof first === "string" ? first : String(first), level };
}

export function createLogger(opts: CreateLoggerOptions): Logger {
  const options: pino.LoggerOptions = {
    level: opts.level,
    base: { service: "hapiecoin-api", ...opts.base },
    redact: {
      paths: [
        "apiKey",
        "apiSecret",
        "api_key",
        "api_secret",
        "otp",
        "password",
        "secret",
        "cookie",
        "authorization",
        "*.apiKey",
        "*.apiSecret",
        "*.otp",
        "*.password",
        "*.secret",
        "*.cookie",
        "*.authorization",
        'headers["set-cookie"]',
        "req.headers.cookie",
        "req.headers.authorization",
        // ADR-081: a failed drizzle query carries its bound values (an OTP, a token) as `params`
        "err.params",
        "err.query",
        "error.params",
        "error.query",
      ],
      censor: REDACTED,
    },
    formatters: { level: (label) => ({ level: label }) },
  };
  const onError = opts.onError;
  if (onError) {
    options.hooks = {
      logMethod(args, method, level) {
        if (level >= ERROR_LEVEL) {
          try {
            // a child logger's bindings (the request id) travel with the record; the call's own fields win
            const record = toErrorLogRecord(args, level);
            const bound = typeof this.bindings === "function" ? this.bindings() : {};
            onError({ ...record, fields: { ...bound, ...record.fields } });
          } catch {
            // the sink never breaks the log call
          }
        }
        method.apply(this, args);
      },
    };
  }
  return opts.destination ? pino(options, opts.destination) : pino(options);
}
