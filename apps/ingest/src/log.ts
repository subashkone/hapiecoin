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

const stdoutSink: LogSink = (line) => {
  process.stdout.write(`${line}\n`);
};

/** Fields are spread after the standard keys; an Error field is rendered as `{ name, message }` (no secrets in stacks). */
export function createLogger(
  level: LogLevel,
  sink: LogSink = stdoutSink,
  now: () => number = Date.now,
): Logger {
  const threshold = ORDER[level];
  const write = (lvl: Exclude<LogLevel, "silent">, msg: string, fields?: LogFields): void => {
    if (ORDER[lvl] < threshold) return;
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
