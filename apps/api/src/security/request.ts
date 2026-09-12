/**
 * Request id + structured access log. The id is echoed in `X-Request-Id` and in every error
 * envelope so support can find the log line; paths are scrubbed of secret-looking query params.
 */
import { randomUUID } from "node:crypto";
import { type ApiMetrics, routeLabel } from "../metrics.js";
import type { MiddlewareHandler } from "hono";
import { type Logger, scrubPath } from "../logger.js";
import { type AppEnv, clientIp } from "./context.js";

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,64}$/;

export function requestContext(logger: Logger, trustedProxies: readonly string[] = [], metrics?: ApiMetrics): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const incoming = c.req.header("x-request-id");
    const requestId = incoming !== undefined && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
    const ip = clientIp(c, trustedProxies);
    c.set("requestId", requestId);
    c.set("clientIp", ip);
    c.set("logger", logger.child({ requestId }));
    c.header("X-Request-Id", requestId);
    const started = performance.now();
    try {
      await next();
    } finally {
      const path = scrubPath(
        c.req.path + (c.req.url.includes("?") ? c.req.url.slice(c.req.url.indexOf("?")) : ""),
      );
      const elapsedMs = performance.now() - started;
      c.get("logger").info(
        {
          method: c.req.method,
          path,
          status: c.res.status,
          ms: Math.round(elapsedMs * 10) / 10,
          ip,
        },
        "request",
      );
      metrics?.request(c.req.method, routeLabel(c), c.res.status, elapsedMs / 1000); // ADR-081: by route pattern, never the raw path
    }
  };
}
