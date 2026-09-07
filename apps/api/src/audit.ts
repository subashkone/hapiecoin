/**
 * Append-only audit log (spec "Trading safeguards": who, what, when, from where).
 * `before`/`after` snapshots pass through `scrub()` so a secret can never be persisted by mistake.
 */
import type { Context } from "hono";
import type { Db } from "./db/client.js";
import { auditLog } from "./db/schema.js";
import { scrub } from "./logger.js";
import type { AppEnv } from "./security/context.js";

export interface AuditEntry {
  actorId: string | null;
  action: string;
  target: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  ua?: string | null;
}

export async function writeAudit(db: Db, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    actorId: entry.actorId,
    action: entry.action,
    target: entry.target,
    before: entry.before === undefined ? null : scrub(entry.before),
    after: entry.after === undefined ? null : scrub(entry.after),
    ip: entry.ip ?? null,
    ua: entry.ua ?? null,
  });
}

/** Audit helper bound to the current request (actor, IP, user agent come from the context). */
export function auditFrom(c: Context<AppEnv>, db: Db) {
  return (entry: Omit<AuditEntry, "actorId" | "ip" | "ua">) =>
    writeAudit(db, {
      ...entry,
      actorId: c.get("user")?.id ?? null,
      ip: c.get("clientIp"),
      ua: c.req.header("user-agent") ?? null,
    });
}
