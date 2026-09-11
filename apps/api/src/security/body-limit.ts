/**
 * Request body limit (spec "API hardening"; GAPS #70; ADR-061): every request body is capped at
 * `maxBytes` (env `API_BODY_LIMIT_BYTES`, 1 MB by default) except the routes that carry their own, larger
 * limit (the banner image upload, 5 MB in routes/banners.ts). Over the cap the answer is 413 in the
 * ApiError envelope, before any handler or validator has read the body.
 */
import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "./context.js";
import { errors } from "./errors.js";

export const DEFAULT_BODY_LIMIT_BYTES = 1_048_576;
export const BODY_LIMIT_MESSAGE = "Request body is too large.";

/** Route prefixes whose handlers set their own body limit; the global cap does not apply to them. */
export const BODY_LIMIT_EXEMPT_PREFIXES: readonly string[] = ["/v1/admin/banners"];

export function jsonBodyLimit(maxBytes: number, exempt: readonly string[] = BODY_LIMIT_EXEMPT_PREFIXES): MiddlewareHandler<AppEnv> {
  const limited = bodyLimit({
    maxSize: maxBytes,
    onError: () => {
      throw errors.payloadTooLarge(`${BODY_LIMIT_MESSAGE} The limit is ${Math.floor(maxBytes / 1024)} KB.`);
    },
  });
  return (c, next) => {
    if (exempt.some((p) => c.req.path.startsWith(p))) return next();
    return limited(c, next);
  };
}
