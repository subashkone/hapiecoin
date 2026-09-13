/**
 * POST /v1/client-errors (roadmap item 27, ADR-081; HC-SH-132): the browser reports an uncaught error and the API
 * relays it to the error sink as a `javascript` event. No session is needed (public pages break too), so the route
 * is rate-limited per address and the body is small and strict; the server scrubs the path and never keeps the report.
 */
import { type OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { ApiError, ClientErrorAck, ClientErrorBody } from "@hapiecoin/schema";
import type { AppEnv } from "../security/context.js";
import { errors } from "../security/errors.js";
import { type AppDeps, jsonContent } from "./shared.js";

/** Reports accepted per client address per minute. */
export const CLIENT_ERRORS_PER_MINUTE = 5;

export function registerClientErrorRoutes(app: OpenAPIHono<AppEnv>, deps: AppDeps): void {
  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/client-errors",
      tags: ["ops"],
      summary: "Report a browser error to the error sink",
      request: { body: { content: { "application/json": { schema: ClientErrorBody } } } },
      responses: {
        202: jsonContent(ClientErrorAck, "Accepted; eventId is null when no sink is configured"),
        400: jsonContent(ApiError, "Validation failed"),
        429: jsonContent(ApiError, "Too many reports from this address"),
      },
    }),
    async (c) => {
      const limit = await deps.rateStore.consume(`client-errors:${c.get("clientIp")}`, 60_000, CLIENT_ERRORS_PER_MINUTE);
      if (!limit.allowed) throw errors.rateLimited("Too many error reports; try again in a minute", Math.max(1, Math.ceil(limit.retryAfterMs / 1000)));
      const body = c.req.valid("json");
      const eventId = deps.errors.capture(
        { name: body.name ?? "Error", message: body.message, stack: body.stack },
        {
          platform: "javascript",
          logger: `browser:${body.kind}`,
          handled: body.kind === "boundary",
          release: body.release, // the event's release, never a tag (Sentry reserves the "release" tag key)
          tags: { app: "web", kind: body.kind },
          request: { method: "GET", url: body.path ?? "/", userAgent: c.req.header("user-agent") },
        },
      );
      deps.metrics.error("browser");
      return c.json({ eventId }, 202);
    },
  );
}
