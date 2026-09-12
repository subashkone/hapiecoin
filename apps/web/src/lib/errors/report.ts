// Browser error reporting (roadmap item 27, ADR-081; HC-SH-132): uncaught errors, unhandled rejections and render
// errors go to the API's POST /v1/client-errors, which relays them to the error tracker, so no DSN ever ships to the
// browser and the server scrubs before anything leaves. One report per message per minute; a failed report is
// swallowed (a second error about the first would help no one).
import { ClientErrorAck, type ClientErrorBody } from "@hapiecoin/schema";
import { api } from "@/lib/api/client";

export const REPORT_WINDOW_MS = 60_000;
export const MAX_STACK = 4_000;

export interface Described {
  name: string;
  message: string;
  stack?: string;
}

/** An Error, a string, a record with a message, or anything a promise rejected with. */
export function describeError(reason: unknown): Described {
  if (reason instanceof Error) {
    return { name: reason.name || "Error", message: reason.message || "Error", ...(reason.stack ? { stack: reason.stack.slice(0, MAX_STACK) } : {}) };
  }
  if (typeof reason === "string") return { name: "Error", message: reason || "Error" };
  if (reason !== null && typeof reason === "object" && typeof (reason as { message?: unknown }).message === "string") {
    const r = reason as { name?: unknown; message: string; stack?: unknown };
    return { name: typeof r.name === "string" && r.name !== "" ? r.name : "Error", message: r.message, ...(typeof r.stack === "string" ? { stack: r.stack.slice(0, MAX_STACK) } : {}) };
  }
  let text: string;
  try {
    text = JSON.stringify(reason) ?? String(reason);
  } catch {
    text = String(reason);
  }
  return { name: "Error", message: text };
}

export interface ReportOptions {
  /** Test seam; the default posts through the API client. */
  post?: ((body: ClientErrorBody) => Promise<{ eventId: string | null }>) | undefined;
  now?: (() => number) | undefined;
  /** The page path; the default reads `location.pathname + location.search`. */
  path?: string | undefined;
}

const lastSent = new Map<string, { t: number; result: Promise<string | null> }>();

/** Test seam: forget the messages sent in the last minute. */
export function resetErrorReporting(): void {
  lastSent.clear();
}

/**
 * Report one error; resolves the tracker's event id, or null when the sink is off or the report failed. A repeat of
 * the same message within a minute is not sent again and answers the first report's id (the error screen mounts
 * twice under StrictMode and must show one reference).
 */
export function reportError(reason: unknown, kind: ClientErrorBody["kind"], opts: ReportOptions = {}): Promise<string | null> {
  const now = opts.now ?? Date.now;
  const described = describeError(reason);
  const message = described.message.slice(0, 500).trim() || "Error";
  const key = `${kind}:${described.name}:${message}`;
  const t = now();
  const last = lastSent.get(key);
  if (last !== undefined && t - last.t < REPORT_WINDOW_MS) return last.result;
  const result = send(described, message, kind, opts);
  lastSent.set(key, { t, result });
  return result;
}

async function send(described: Described, message: string, kind: ClientErrorBody["kind"], opts: ReportOptions): Promise<string | null> {
  const path = opts.path ?? (typeof window === "undefined" ? undefined : `${window.location.pathname}${window.location.search}`);
  const body: ClientErrorBody = {
    message,
    name: described.name.slice(0, 80),
    kind,
    ...(described.stack !== undefined ? { stack: described.stack } : {}),
    ...(path !== undefined ? { path: path.slice(0, 300) } : {}),
  };
  const post = opts.post ?? ((b: ClientErrorBody) => api.post("/v1/client-errors", b, ClientErrorAck));
  try {
    const ack = await post(body);
    return ack.eventId;
  } catch {
    return null;
  }
}

/** Listen for uncaught errors and unhandled rejections on the window; returns the remover. */
export function installErrorReporting(opts: ReportOptions = {}): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onError = (event: ErrorEvent) => {
    void reportError(event.error ?? event.message, "error", opts);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    void reportError(event.reason, "unhandledrejection", opts);
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
