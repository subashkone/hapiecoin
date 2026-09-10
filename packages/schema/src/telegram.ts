// Telegram delivery for alerts (ADR-057, GAPS #64): a trader links their chat once through the bot's /start deep
// link; alerts on the telegram channel then reach that chat even with the app closed.
import { z } from "zod";
import { IsoDateTime } from "./primitives.js";

export const TelegramStatus = z.strictObject({
  /** False when the server has no bot token: the channel cannot be offered. */
  configured: z.boolean(),
  /** The bot's username (for the deep link), null when unconfigured. */
  bot: z.string().nullable(),
  linked: z.boolean(),
  linkedAt: IsoDateTime.nullable(),
  /** A pending link code with its deep link while the trader has not pressed Start yet. */
  pending: z.strictObject({ code: z.string(), link: z.string() }).nullable(),
});
export type TelegramStatus = z.infer<typeof TelegramStatus>;

/** Link codes are short, unambiguous and expire with the next request (one per user at a time). */
export const TELEGRAM_CODE_LENGTH = 8;
export const TELEGRAM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
