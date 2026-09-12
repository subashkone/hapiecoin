/** Minimal JSON-lines logger (one dependency fewer; pino can replace it behind the same interface). */
import type { LogLevel } from "./config.js";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

export type LogSink = (line: string) => void;

/** ADR-081: one error-level call as the error sink receives it (the raw fields, an Error kept whole). */
export interface ErrorLogRecord {
  fields: Record<string, unknown>;
  msg: string;
  /** 50, pino's number for error, so both apps hand the sink the same shape. */
  level: number;
}
export type ErrorHook = (record: ErrorLogRecord) => void;

const stdoutSink: LogSink = (line) => {
  process.stdout.write(`${line}\n`);
};

/**
 * Fields are spread after the standard keys; an Error field is rendered as `{ name, message }` (no secrets in stacks).
 * ADR-081: every enabled error-level call is also handed to `onError` (the error sink) before it is written; a throwing
 * hook never breaks the log call.
 */
export function createLogger(
  level: LogLevel,
  sink: LogSink = stdoutSink,
  now: () => number = Date.now,
  onError?: ErrorHook,
): Logger {
  const threshold = ORDER[level];
  const write = (lvl: Exclude<LogLevel, "silent">, msg: string, fields?: LogFields): void => {
    if (ORDER[lvl] < threshold) return;
    if (lvl === "error" && onError) {
      try {
        onError({ fields: { ...fields }, msg, level: 50 });
      } catch {
        // the sink never breaks the log call
      }
    }
    const record: LogFields = { ts: new Date(now()).toISOString(), level: lvl, msg };
    if (fields) {
      for (const [key, value] of Object.entries(fields)) {
        record[key] = value instanceof Error ? { name: value.name, message: value.message } : value;
      }
    }
    sink(JSON.stringify(record));
  };
  return {
    debug: (msg, fields) => write("debug", msg, fields),
    info: (msg, fields) => write("info", msg, fields),
    warn: (msg, fields) => write("warn", msg, fields),
    error: (msg, fields) => write("error", msg, fields),
  };
}

/** Drops everything (tests, and the default when no logger is injected). */
export const silentLogger: Logger = createLogger("silent");
