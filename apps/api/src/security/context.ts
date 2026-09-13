/** Hono environment shared by every middleware and route. */
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import type { Logger } from "../logger.js";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
  /** The authenticator is on (ADR-078); sensitive changes then ask for the current code (ADR-086). The session resolver sets it; a user built without it (jobs, tests) is looked up, never assumed off. */
  twoFactorEnabled?: boolean;
}

export interface AppVariables {
  requestId: string;
  logger: Logger;
  /** Resolved client IP (Cloudflare / proxy headers first). */
  clientIp: string;
  /** Set by `requireUser`. */
  user?: SessionUser;
}

export type AppEnv = { Variables: AppVariables };

/** Header the resolved client IP is handed to Better Auth in (its own limiter reads it; see auth.ts). */
export const CLIENT_IP_HEADER = "x-hapiecoin-client-ip";

/** Socket peer address, or null when the request did not come over a Node socket (tests, edge runtimes). */
export function peerAddress(c: Context<AppEnv>): string | null {
  try {
    const address = getConnInfo(c).remote.address;
    return typeof address === "string" && address.length > 0 ? address : null;
  } catch {
    return null;
  }
}

/**
 * Client IP for rate limiting and audit (ADR-019). The socket peer is the truth; the proxy headers
 * (`cf-connecting-ip`, `x-forwarded-for`, `x-real-ip`) are believed only when the peer is one of
 * `trustedProxies` (or the list is `["*"]`). Otherwise a spoofed header would defeat every IP limit.
 * Falls back to "unknown" when there is no socket and no trusted header.
 */
export function clientIp(c: Context<AppEnv>, trustedProxies: readonly string[]): string {
  const peer = peerAddress(c);
  const trusted = trustedProxies.includes("*") || (peer !== null && trustedProxies.includes(peer));
  if (trusted) {
    const cf = c.req.header("cf-connecting-ip");
    if (cf) return cf.trim();
    const xff = c.req.header("x-forwarded-for");
    if (xff) {
      const first = xff.split(",")[0]?.trim();
      if (first) return first;
    }
    const real = c.req.header("x-real-ip");
    if (real) return real.trim();
  }
  return peer ?? "unknown";
}

/** The signed-in user; throws if a route forgot `requireUser`. */
export function currentUser(c: Context<AppEnv>): SessionUser {
  const user = c.get("user");
  if (!user) throw new Error("route is missing the requireUser guard");
  return user;
}
