/**
 * Server-side authorisation (spec "API hardening": RBAC enforced on the server; the UI hiding a
 * menu is never the control). `requireUser` resolves the session cookie; `requireAdmin` adds the role check.
 */
import type { MiddlewareHandler } from "hono";
import type { AppEnv, SessionUser } from "./context.js";
import { errors } from "./errors.js";

export interface SessionResolver {
  /** The user behind the request's session cookie, or null. */
  resolve(headers: Headers): Promise<SessionUser | null>;
}

export function requireUser(sessions: SessionResolver): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = await sessions.resolve(c.req.raw.headers);
    if (!user) throw errors.unauthenticated();
    c.set("user", user);
    c.set("logger", c.get("logger").child({ userId: user.id }));
    await next();
  };
}

export const adminOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get("user");
  if (!user) throw errors.unauthenticated();
  if (user.role !== "admin") throw errors.forbidden("Admin access required");
  await next();
};

export function requireAdmin(sessions: SessionResolver): MiddlewareHandler<AppEnv>[] {
  return [requireUser(sessions), adminOnly];
}
