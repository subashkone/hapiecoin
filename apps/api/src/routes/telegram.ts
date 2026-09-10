/**
 * Telegram linking for alerts (ADR-057, GAPS #64).
 *
 *   GET    /v1/me/telegram        configured? bot username, linked?, pending link code
 *   POST   /v1/me/telegram/link   issue a fresh link code and the t.me deep link (replaces any pending code)
 *   DELETE /v1/me/telegram        unlink the chat
 *   POST   /v1/me/telegram/test   send a test message to the linked chat
 *
 * The linker (`startTelegramLinker`) long-polls the bot for "/start <code>" messages and stores the chat id.
 */
import { TELEGRAM_CODE_ALPHABET, TELEGRAM_CODE_LENGTH, TelegramStatus } from "@hapiecoin/schema";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import { auditFrom } from "../audit.js";
import { users } from "../db/schema.js";
import { type AppEnv, currentUser } from "../security/context.js";
import { HttpError, errors } from "../security/errors.js";
import { requireUser } from "../security/guards.js";
import type { TelegramClient } from "../telegram.js";
import { type AppDeps, cookieAuth, errorResponses, jsonContent } from "./shared.js";

export function newLinkCode(): string {
  let out = "";
  for (let i = 0; i < TELEGRAM_CODE_LENGTH; i++) out += TELEGRAM_CODE_ALPHABET[randomInt(TELEGRAM_CODE_ALPHABET.length)];
  return out;
}

async function botUsername(telegram: TelegramClient | null): Promise<string | null> {
  if (!telegram) return null;
  try {
    return (await telegram.getMe()).username;
  } catch {
    return null;
  }
}

export function registerTelegramRoutes(app: OpenAPIHono<AppEnv>, deps: AppDeps, now: () => Date = () => new Date()): void {
  const db = deps.db;
  const guard = requireUser(deps.sessions);

  async function status(userId: string): Promise<TelegramStatus> {
    const [row] = await db.select({ chatId: users.telegramChatId, code: users.telegramLinkCode, linkedAt: users.telegramLinkedAt }).from(users).where(eq(users.id, userId)).limit(1);
    const bot = await botUsername(deps.telegram);
    const linked = Boolean(row?.chatId);
    return {
      configured: deps.telegram !== null,
      bot,
      linked,
      linkedAt: row?.linkedAt ? row.linkedAt.toISOString() : null,
      pending: !linked && row?.code && bot ? { code: row.code, link: `https://t.me/${bot}?start=${row.code}` } : null,
    };
  }

  app.openapi(
    createRoute({ method: "get", path: "/v1/me/telegram", tags: ["alerts"], summary: "Telegram link status for alert delivery (ADR-057)", security: cookieAuth, middleware: [guard], responses: { 200: jsonContent(TelegramStatus, "Status"), 401: errorResponses[401] } }),
    async (c) => c.json(await status(currentUser(c).id), 200),
  );

  app.openapi(
    createRoute({ method: "post", path: "/v1/me/telegram/link", tags: ["alerts"], summary: "Issue a link code and the bot deep link", security: cookieAuth, middleware: [guard], responses: { 200: jsonContent(TelegramStatus, "Pending link"), 401: errorResponses[401], 503: errorResponses[503] } }),
    async (c) => {
      const me = currentUser(c);
      if (!deps.telegram) throw errors.unavailable("Telegram delivery is not configured on this server");
      const code = newLinkCode();
      await db.update(users).set({ telegramLinkCode: code }).where(eq(users.id, me.id));
      return c.json(await status(me.id), 200);
    },
  );

  app.openapi(
    createRoute({ method: "delete", path: "/v1/me/telegram", tags: ["alerts"], summary: "Unlink the Telegram chat", security: cookieAuth, middleware: [guard], responses: { 200: jsonContent(TelegramStatus, "Unlinked"), 401: errorResponses[401] } }),
    async (c) => {
      const me = currentUser(c);
      await db.update(users).set({ telegramChatId: null, telegramLinkCode: null, telegramLinkedAt: null }).where(eq(users.id, me.id));
      await auditFrom(c, db)({ action: "telegram.unlink", target: `user:${me.id}`, after: null });
      return c.json(await status(me.id), 200);
    },
  );

  app.openapi(
    createRoute({ method: "post", path: "/v1/me/telegram/test", tags: ["alerts"], summary: "Send a test message to the linked chat", security: cookieAuth, middleware: [guard], responses: { 200: jsonContent(z.object({ ok: z.literal(true) }), "Sent"), 401: errorResponses[401], 409: errorResponses[409], 502: errorResponses[502], 503: errorResponses[503] } }),
    async (c) => {
      const me = currentUser(c);
      if (!deps.telegram) throw errors.unavailable("Telegram delivery is not configured on this server");
      const [row] = await db.select({ chatId: users.telegramChatId }).from(users).where(eq(users.id, me.id)).limit(1);
      if (!row?.chatId) throw errors.conflict("Connect Telegram first");
      try {
        await deps.telegram.sendMessage(row.chatId, `HapieCoin · test message · ${now().toISOString()}\nAlerts on the telegram channel arrive here.`);
      } catch (e) {
        throw new HttpError(502, "TELEGRAM_FAILED", `Telegram did not accept the message: ${e instanceof Error ? e.message : String(e)}`);
      }
      return c.json({ ok: true as const }, 200);
    },
  );
}

/** Handle one batch of bot updates: "/start <code>" links the chat; anything else gets a short reply. Returns the next offset. */
export async function handleTelegramUpdates(deps: AppDeps, offset: number, now: () => Date = () => new Date()): Promise<number> {
  if (!deps.telegram) return offset;
  const updates = await deps.telegram.getUpdates(offset);
  let next = offset;
  for (const u of updates) {
    next = Math.max(next, u.updateId + 1);
    const m = /^\/start\s+([A-Z0-9]{6,12})\s*$/i.exec(u.text.trim());
    const reply = async (text: string) => {
      try {
        await deps.telegram?.sendMessage(u.chatId, text);
      } catch (e) {
        deps.logger.warn({ chatId: u.chatId, reason: e instanceof Error ? e.message : String(e) }, "telegram reply failed");
      }
    };
    if (!m) {
      await reply("HapieCoin alerts bot · open HapieCoin → Alerts → Connect Telegram and press Start on the link it gives you.");
      continue;
    }
    const code = m[1]!.toUpperCase();
    const [user] = await deps.db.select({ id: users.id }).from(users).where(eq(users.telegramLinkCode, code)).limit(1);
    if (!user) {
      await reply("That link code is not recognised · open HapieCoin → Alerts → Connect Telegram for a fresh one.");
      continue;
    }
    await deps.db.update(users).set({ telegramChatId: u.chatId, telegramLinkCode: null, telegramLinkedAt: now() }).where(eq(users.id, user.id));
    deps.logger.info({ userId: user.id }, "telegram chat linked");
    await reply("Connected · HapieCoin alerts on the telegram channel will arrive here.");
  }
  return next;
}

/** Long-poll the bot for /start messages; returns the stop function. `errorMs` is the pause after a failed poll. */
export function startTelegramLinker(deps: AppDeps, idleMs = 2_000, errorMs = 10_000): () => void {
  let offset = 0;
  let stopped = false;
  const loop = async () => {
    while (!stopped) {
      try {
        offset = await handleTelegramUpdates(deps, offset);
      } catch (e) {
        deps.logger.warn({ reason: e instanceof Error ? e.message : String(e) }, "telegram poll failed");
        await new Promise((r) => setTimeout(r, errorMs));
      }
      await new Promise((r) => setTimeout(r, idleMs));
    }
  };
  void loop();
  return () => {
    stopped = true;
  };
}
