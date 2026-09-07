/**
 * Transport & browser hardening (spec "Transport & browser", "API hardening"):
 * secure headers on every response, CORS for the web app only, Origin check on state-changing requests.
 */
import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv } from "./context.js";
import { HttpError } from "./errors.js";

export interface HeaderOptions {
  isProd: boolean;
  webUrl: string;
  /** The API's own public origin (Better Auth callbacks, Swagger UI in dev). */
  selfUrl: string;
}

/** Path prefix of the Swagger UI (dev only); it is the one page that needs scripts and styles. */
export const DOCS_PATH = "/v1/docs";

/**
 * API responses are data, never documents: CSP default-src 'none', frame denial, no sniffing.
 * The Swagger UI page gets a CSP that allows its own scripts/styles from cdn.jsdelivr.net; everything else stays locked.
 */
export function apiSecureHeaders(opts: HeaderOptions): MiddlewareHandler<AppEnv> {
  const none: string[] = [];
  const common: Parameters<typeof secureHeaders>[0] = {
    strictTransportSecurity: opts.isProd ? "max-age=31536000; includeSubDomains" : false,
    xContentTypeOptions: "nosniff",
    referrerPolicy: "strict-origin-when-cross-origin",
    xFrameOptions: "DENY",
    permissionsPolicy: { camera: none, microphone: none, geolocation: none, payment: none, usb: none },
    crossOriginResourcePolicy: "same-site",
    removePoweredBy: true,
  };
  const strict = secureHeaders({
    ...common,
    contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
  });
  const docs = secureHeaders({
    ...common,
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  });
  return (c, next) => (c.req.path.startsWith(DOCS_PATH) && !opts.isProd ? docs(c, next) : strict(c, next));
}

export function apiCors(opts: HeaderOptions): MiddlewareHandler<AppEnv> {
  const allowed = new Set([normalise(opts.webUrl)]);
  return cors({
    origin: (origin) => (allowed.has(normalise(origin)) ? origin : null),
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "X-Request-Id"],
    exposeHeaders: ["X-Request-Id", "Retry-After"],
    maxAge: 600,
  });
}

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF defence in depth next to SameSite=Lax cookies: a browser always sends `Origin` on cross-site
 * state-changing requests, so an Origin that is neither the web app nor the API itself is refused.
 * Requests without an Origin (curl, server-to-server) pass; they carry no ambient browser credentials.
 */
export function originCheck(opts: HeaderOptions): MiddlewareHandler<AppEnv> {
  const allowed = new Set([normalise(opts.webUrl), normalise(opts.selfUrl)]);
  return async (c, next) => {
    if (STATE_CHANGING.has(c.req.method)) {
      const origin = c.req.header("origin");
      if (origin !== undefined && !allowed.has(normalise(origin))) {
        throw new HttpError(403, "FORBIDDEN_ORIGIN", "Cross-site request refused");
      }
    }
    await next();
  };
}

function normalise(origin: string): string {
  try {
    return new URL(origin).origin.toLowerCase();
  } catch {
    return origin.trim().toLowerCase().replace(/\/+$/, "");
  }
}
