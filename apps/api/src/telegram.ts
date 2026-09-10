/**
 * Telegram Bot API surface HapieCoin uses (ADR-057): getMe (bot username for the deep link), sendMessage
 * (alert delivery) and getUpdates (long-polled so no public webhook URL is needed). The bot token travels only
 * in the request URL to api.telegram.org and is never logged. Tests use `FakeTelegram`.
 */
import type { Logger } from "./logger.js";

export interface TelegramUpdate {
  updateId: number;
  chatId: string;
  text: string;
}

export interface TelegramClient {
  /** The bot's username, e.g. "HapieCoinAlertsBot". */
  getMe(): Promise<{ username: string }>;
  sendMessage(chatId: string, text: string): Promise<void>;
  /** Updates after `offset` (Telegram's own cursor semantics: pass the last update id + 1). */
  getUpdates(offset: number, timeoutSec?: number): Promise<TelegramUpdate[]>;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class TelegramBotClient implements TelegramClient {
  private username: string | null = null;
  constructor(
    private readonly token: string,
    private readonly opts: { nodeEnv: string; baseUrl?: string; fetch?: Fetch; logger?: Logger } = { nodeEnv: "development" },
  ) {
    if (opts.nodeEnv === "test") throw new Error("TelegramBotClient must not be used in tests");
  }

  private async call<T>(method: string, body?: Record<string, unknown>, timeoutMs = 10_000): Promise<T> {
    const doFetch = this.opts.fetch ?? ((input, init) => fetch(input, init));
    const res = await doFetch(`${this.opts.baseUrl ?? "https://api.telegram.org"}/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!res.ok || !json.ok) throw new Error(`telegram ${method} failed: ${json.description ?? res.status}`);
    return json.result as T;
  }

  async getMe(): Promise<{ username: string }> {
    if (this.username === null) this.username = (await this.call<{ username: string }>("getMe")).username;
    return { username: this.username };
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    await this.call("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
  }

  async getUpdates(offset: number, timeoutSec = 20): Promise<TelegramUpdate[]> {
    const raw = await this.call<{ update_id: number; message?: { text?: string; chat?: { id: number | string } } }[]>("getUpdates", { offset, timeout: timeoutSec, allowed_updates: ["message"] }, (timeoutSec + 5) * 1000);
    return raw.flatMap((u) => (u.message?.chat && typeof u.message.text === "string" ? [{ updateId: u.update_id, chatId: String(u.message.chat.id), text: u.message.text }] : []));
  }
}

/** Test double: records sends, serves queued updates once. */
export class FakeTelegram implements TelegramClient {
  readonly sent: { chatId: string; text: string }[] = [];
  private queue: TelegramUpdate[] = [];
  /** Chat ids that refuse delivery (a user who blocked the bot). */
  readonly blocked = new Set<string>();
  constructor(readonly username = "HapieCoinTestBot") {}
  getMe(): Promise<{ username: string }> {
    return Promise.resolve({ username: this.username });
  }
  sendMessage(chatId: string, text: string): Promise<void> {
    if (this.blocked.has(chatId)) return Promise.reject(new Error("telegram sendMessage failed: Forbidden: bot was blocked by the user"));
    this.sent.push({ chatId, text });
    return Promise.resolve();
  }
  getUpdates(offset: number): Promise<TelegramUpdate[]> {
    const out = this.queue.filter((u) => u.updateId >= offset);
    return Promise.resolve(out);
  }
  /** Simulate a person pressing Start (or typing) in the bot chat. */
  push(chatId: string, text: string, updateId?: number): void {
    this.queue.push({ updateId: updateId ?? (this.queue.at(-1)?.updateId ?? 0) + 1, chatId, text });
  }
}
