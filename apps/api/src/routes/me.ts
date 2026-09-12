/** Profile (HC-SH-027..030): read and edit name, mobile and avatar; email and referral code are read-only. */
import { Avatar, Mobile, User } from "@hapiecoin/schema";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { auditFrom } from "../audit.js";
import { users } from "../db/schema.js";
import { type AppEnv, currentUser } from "../security/context.js";
import { errors } from "../security/errors.js";
import { requireUser } from "../security/guards.js";
import { type AppDeps, cookieAuth, errorResponses, jsonContent } from "./shared.js";

export const MePatch = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    /** null clears the mobile number. */
    mobile: Mobile.nullable().optional(),
    avatar: Avatar.optional(),
  })
  .strict();
export type MePatch = z.infer<typeof MePatch>;

type UserRow = typeof users.$inferSelect;

export function toUser(row: UserRow): User {
  const user: User = {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    avatar: row.avatar,
    referralCode: row.referralCode,
    createdAt: row.createdAt.toISOString(),
    twoFactorEnabled: row.twoFactorEnabled, // ADR-078
  };
  if (row.mobile) user.mobile = row.mobile;
  return user;
}

export function registerMeRoutes(app: OpenAPIHono<AppEnv>, deps: AppDeps): void {
  const guard = requireUser(deps.sessions);

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/me",
      tags: ["me"],
      summary: "Your account details (HC-SH-027, HC-SH-029)",
      security: cookieAuth,
      middleware: [guard],
      responses: { 200: jsonContent(User, "Current user"), 401: errorResponses[401] },
    }),
    async (c) => {
      const me = currentUser(c);
      const [row] = await deps.db.select().from(users).where(eq(users.id, me.id)).limit(1);
      if (!row) throw errors.unauthenticated();
      return c.json(toUser(row), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/v1/me",
      tags: ["me"],
      summary: "Edit profile: name, mobile, avatar (HC-SH-028, HC-SH-030)",
      security: cookieAuth,
      middleware: [guard],
      request: { body: { content: { "application/json": { schema: MePatch } }, required: true } },
      responses: {
        200: jsonContent(User, "Updated user"),
        400: errorResponses[400],
        401: errorResponses[401],
      },
    }),
    async (c) => {
      const me = currentUser(c);
      const patch = c.req.valid("json");
      const [before] = await deps.db.select().from(users).where(eq(users.id, me.id)).limit(1);
      if (!before) throw errors.unauthenticated();
      const set: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
      if (patch.name !== undefined) set.name = patch.name;
      if (patch.mobile !== undefined) set.mobile = patch.mobile;
      if (patch.avatar !== undefined) set.avatar = patch.avatar;
      const [after] = await deps.db.update(users).set(set).where(eq(users.id, me.id)).returning();
      if (!after) throw errors.unauthenticated();
      await auditFrom(
        c,
        deps.db,
      )({
        action: "me.update",
        target: `user:${me.id}`,
        before: { name: before.name, mobile: before.mobile, avatar: before.avatar },
        after: { name: after.name, mobile: after.mobile, avatar: after.avatar },
      });
      return c.json(toUser(after), 200);
    },
  );
}
