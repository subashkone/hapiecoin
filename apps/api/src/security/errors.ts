/**
 * Uniform error envelope (`ApiError` from @hapiecoin/schema): `{ code, message, details? }`.
 * Stack traces never leave the process; unknown errors become 500 INTERNAL_ERROR and are logged with the request id.
 */
import type { ApiError } from "@hapiecoin/schema";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";
import type { AppEnv } from "./context.js";

export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "HttpError";
  }

  toBody(): ApiError {
    return this.details
      ? { code: this.code, message: this.message, details: this.details }
      : { code: this.code, message: this.message };
  }
}

export const errors = {
  unauthenticated: () => new HttpError(401, "UNAUTHENTICATED", "Sign in to continue"),
  forbidden: (message = "You do not have permission to do that") => new HttpError(403, "FORBIDDEN", message),
  notFound: (what = "Resource") => new HttpError(404, "NOT_FOUND", `${what} not found`),
  badRequest: (message: string) => new HttpError(400, "BAD_REQUEST", message),
  /** The request is well-formed but the resource is in the wrong state for it (e.g. starting a non-draft). */
  conflict: (message: string) => new HttpError(409, "CONFLICT", message),
  paymentRequired: (message: string) => new HttpError(402, "PAYMENT_REQUIRED", message),
  unavailable: (message: string) => new HttpError(503, "UNAVAILABLE", message),
  validation: (issues: unknown) =>
    new HttpError(400, "VALIDATION_ERROR", "Request failed validation", { issues }),
  rateLimited: (message: string, retryAfterSec: number, code = "RATE_LIMITED") =>
    new HttpError(429, code, message, { retryAfterSec }, { "Retry-After": String(retryAfterSec) }),
};

export function zodIssues(err: ZodError): { path: string; message: string }[] {
  return err.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
}

/** `app.onError` handler: converts anything thrown into the envelope. */
export function onError(err: Error, c: Context<AppEnv>): Response {
  if (err instanceof HttpError) {
    for (const [k, v] of Object.entries(err.headers ?? {})) c.header(k, v);
    return c.json(err.toBody(), err.status);
  }
  if (err instanceof ZodError) {
    return c.json(errors.validation(zodIssues(err)).toBody(), 400);
  }
  if (err instanceof HTTPException) {
    const body: ApiError = { code: codeForStatus(err.status), message: err.message || "Request failed" };
    return c.json(body, err.status);
  }
  c.get("logger")?.error({ err: { name: err.name, message: err.message } }, "unhandled error");
  const body: ApiError = {
    code: "INTERNAL_ERROR",
    message: "Something went wrong",
    details: { requestId: c.get("requestId") },
  };
  return c.json(body, 500);
}

export function notFound(c: Context<AppEnv>): Response {
  return c.json(errors.notFound("Route").toBody(), 404);
}

function codeForStatus(status: number): string {
  switch (status) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHENTICATED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 413:
      return "PAYLOAD_TOO_LARGE";
    default:
      return status >= 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED";
  }
}
