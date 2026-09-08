/**
 * HTTP application factory. Pure with respect to its dependencies so tests can boot it on PGlite
 * with a fake Delta client and a capturing mailer.
 *
 * Middleware order: request id/log → secure headers → CORS → Origin check → global rate limit →
 * OTP rate limits → Better Auth at /v1/auth/* → typed /v1 routes → uniform error envelope.
 */
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { registerBrokerRoutes } from "./routes/brokers.js";
import { registerCredentialRoutes } from "./routes/credentials.js";
import { registerMeRoutes } from "./routes/me.js";
import { registerPlanRoutes } from "./routes/plan.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerStrategyRoutes } from "./routes/strategies.js";
import { type AppDeps, jsonContent } from "./routes/shared.js";
import { type AppEnv, CLIENT_IP_HEADER } from "./security/context.js";
import { errors, notFound, onError, zodIssues } from "./security/errors.js";
import { DOCS_PATH, apiCors, apiSecureHeaders, originCheck } from "./security/headers.js";
import { globalRateLimit, otpRateLimit } from "./security/rate-limit.js";
import { requestContext } from "./security/request.js";

export const API_VERSION = "0.1.0";

const Health = z.object({
  status: z.enum(["ok", "degraded"]),
  db: z.enum(["pglite", "postgres"]),
  dbOk: z.boolean(),
  uptimeSec: z.number().int().nonnegative(),
  version: z.string(),
});

const AuthOptions = z.object({ emailOtp: z.literal(true), passkey: z.literal(true), google: z.boolean() });

export function createApp(deps: AppDeps): OpenAPIHono<AppEnv> {
  const { config } = deps;
  const startedAt = Date.now();
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) return c.json(errors.validation(zodIssues(result.error)).toBody(), 400);
      return undefined;
    },
  });
  const headerOpts = { isProd: config.isProd, webUrl: config.webUrl, selfUrl: config.betterAuthUrl };

  app.use("*", requestContext(deps.logger, config.trustedProxyIps));
  app.use("*", apiSecureHeaders(headerOpts));
  app.use("*", apiCors(headerOpts));
  app.use("*", originCheck(headerOpts));
  app.use("*", globalRateLimit(deps.rateStore));
  app.use("*", otpRateLimit(deps.rateStore, deps.authBasePath));

  // Better Auth's limiter reads the client IP from CLIENT_IP_HEADER only, which is set here from the
  // proxy-aware resolution above (never from the caller: an incoming copy is dropped).
  app.on(["GET", "POST"], `${deps.authBasePath}/*`, (c) => {
    const headers = new Headers(c.req.raw.headers);
    headers.delete(CLIENT_IP_HEADER);
    const ip = c.get("clientIp");
    if (ip !== "unknown") headers.set(CLIENT_IP_HEADER, ip);
    return deps.auth.handler(new Request(c.req.raw, { headers }));
  });

  app.openapi(
    createRoute({
      method: "get",
      path: "/healthz",
      tags: ["ops"],
      summary: "Liveness and database check",
      responses: { 200: jsonContent(Health, "Healthy"), 503: jsonContent(Health, "Database unreachable") },
    }),
    async (c) => {
      const dbOk = await deps.ping();
      const body = {
        status: dbOk ? ("ok" as const) : ("degraded" as const),
        db: deps.dbKind,
        dbOk,
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
        version: API_VERSION,
      };
      return dbOk ? c.json(body, 200) : c.json(body, 503);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/auth-options",
      tags: ["auth"],
      summary: "Sign-in methods available; the web app hides the Google button when false",
      responses: { 200: jsonContent(AuthOptions, "Options") },
    }),
    (c) => c.json(deps.authOptions, 200),
  );

  registerMeRoutes(app, deps);
  registerSettingsRoutes(app, deps);
  registerBrokerRoutes(app, deps);
  registerCredentialRoutes(app, deps);
  registerPlanRoutes(app, deps);
  registerStrategyRoutes(app, deps);

  app.openAPIRegistry.registerComponent("securitySchemes", "cookieAuth", {
    type: "apiKey",
    in: "cookie",
    name: config.isProd ? "__Secure-better-auth.session_token" : "better-auth.session_token",
  });
  app.doc("/v1/openapi.json", {
    openapi: "3.0.0",
    info: {
      title: "HapieCoin API",
      version: API_VERSION,
      description:
        "Auth, profile, settings, exchanges, encrypted exchange credentials and plan state. Auth endpoints live under /v1/auth (Better Auth).",
    },
    servers: [{ url: config.betterAuthUrl }],
  });
  if (!config.isProd) {
    app.get(DOCS_PATH, swaggerUI({ url: "/v1/openapi.json" }));
  }

  app.onError(onError);
  app.notFound(notFound);
  return app;
}
