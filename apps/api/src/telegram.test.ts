// Telegram client, linker loop and the fire path's edge branches (ADR-057).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Alert, TelegramStatus } from "@hapiecoin/schema";
import { eq } from "drizzle-orm";
import { fireAlert } from "./alerts-fire.js";
import { alerts } from "./db/schema.js";
import { startIvSnapshotter, type MarketSource } from "./iv-snapshot.js";
import { handleTelegramUpdates, startTelegramLinker } from "./routes/telegram.js";
import { FakeTelegram, TelegramBotClient } from "./telegram.js";
import { createTestApp, type TestApp } from "./test-support/harness.js";

let t: TestApp;
let cookie: string;
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;

beforeAll(async () => {
  t = await createTestApp();
  cookie = (await t.signUp("tg-client@hapiecoin.test")).cookie;
});
afterAll(() => t.close());

describe("TelegramBotClient", () => {
  const calls: { url: string; body: unknown }[] = [];
  const answers = new Map<string, unknown>();
  const fakeFetch = (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(typeof init?.body === "string" ? init.body : "{}") });
    const method = url.slice(url.lastIndexOf("/") + 1);
    const answer = answers.get(method);
    if (answer === "http-500") return Promise.resolve(new Response(JSON.stringify({ ok: false, description: "boom" }), { status: 500 }));
    return Promise.resolve(new Response(JSON.stringify(answer ?? { ok: false, description: `no answer for ${method}` }), { status: 200 }));
  };
  const client = new TelegramBotClient("123:token-never-logged", { nodeEnv: "development", baseUrl: "https://tg.test", fetch: fakeFetch });

  it("refuses to exist in the test environment", () => {
    expect(() => new TelegramBotClient("x", { nodeEnv: "test" })).toThrow(/must not be used in tests/);
  });

  it("getMe caches the username; sendMessage posts JSON; getUpdates maps messages and skips frames without text", async () => {
    answers.set("getMe", { ok: true, result: { username: "HapieBot" } });
    expect(await client.getMe()).toEqual({ username: "HapieBot" });
    expect(await client.getMe()).toEqual({ username: "HapieBot" });
    expect(calls.filter((c) => c.url.endsWith("/getMe"))).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://tg.test/bot123:token-never-logged/getMe");
    answers.set("sendMessage", { ok: true, result: {} });
    await client.sendMessage("42", "hello");
    expect(calls.at(-1)!.body).toEqual({ chat_id: "42", text: "hello", disable_web_page_preview: true });
    answers.set("getUpdates", { ok: true, result: [{ update_id: 7, message: { text: "/start ABC", chat: { id: 42 } } }, { update_id: 8, message: { chat: { id: 43 } } }, { update_id: 9 }] });
    expect(await client.getUpdates(5, 1)).toEqual([{ updateId: 7, chatId: "42", text: "/start ABC" }]);
    expect(calls.at(-1)!.body).toEqual({ offset: 5, timeout: 1, allowed_updates: ["message"] });
  });

  it("throws on a Telegram error and on an HTTP failure", async () => {
    answers.set("sendMessage", { ok: false, description: "Forbidden: bot was blocked by the user" });
    await expect(client.sendMessage("42", "x")).rejects.toThrow(/Forbidden/);
    answers.set("sendMessage", "http-500");
    await expect(client.sendMessage("42", "x")).rejects.toThrow(/telegram sendMessage failed/);
    // a failure without a description reports the HTTP status; the default base URL and fetch are used when none are given
    const bare = new TelegramBotClient("t", { nodeEnv: "development", fetch: () => Promise.resolve(new Response(JSON.stringify({ ok: false }), { status: 503 })) });
    await expect(bare.getMe()).rejects.toThrow(/failed: 503/);
    expect(() => new TelegramBotClient("t", { nodeEnv: "development" })).not.toThrow();
  });
});

describe("linker loop, failure replies and status without a reachable bot", () => {
  it("startTelegramLinker links a pending code, survives a failing poll, and stops", async () => {
    const pending = await json<TelegramStatus>(await t.request("/v1/me/telegram/link", { cookie, json: {} }));
    let fail = true;
    const original = t.telegram.getUpdates.bind(t.telegram);
    t.telegram.getUpdates = (offset) => {
      if (fail) {
        fail = false;
        return Promise.reject(new Error("network down"));
      }
      return original(offset);
    };
    t.telegram.push("chat-9", `/start ${pending.pending!.code}`);
    const stop = startTelegramLinker(t.deps, 10, 10);
    await vi.waitFor(async () => expect((await json<TelegramStatus>(await t.request("/v1/me/telegram", { cookie }))).linked).toBe(true), { timeout: 3000 });
    stop();
    t.telegram.getUpdates = original;
    // a reply to a chat that blocked the bot is logged, not thrown
    t.telegram.blocked.add("chat-blocked");
    t.telegram.push("chat-blocked", "hello?");
    const offset = t.telegram.sent.length;
    await expect(handleTelegramUpdates(t.deps, 2)).resolves.toBeGreaterThan(2);
    expect(t.telegram.sent.length).toBe(offset); // nothing sent to the blocked chat
    t.telegram.blocked.delete("chat-blocked");
  });

  it("a bot whose getMe fails reads as configured with no username and no deep link", async () => {
    const broken = new FakeTelegram();
    broken.getMe = () => Promise.reject(new Error("unreachable"));
    const tg = t.deps.telegram;
    t.deps.telegram = broken;
    try {
      await t.request("/v1/me/telegram", { cookie, method: "DELETE" });
      await t.request("/v1/me/telegram/link", { cookie, json: {} });
      expect(await json<TelegramStatus>(await t.request("/v1/me/telegram", { cookie }))).toMatchObject({ configured: true, bot: null, linked: false, pending: null });
    } finally {
      t.deps.telegram = tg;
    }
  });

  it("fireAlert returns null for a row that is not armed; a telegram alert whose chat was unlinked logs and still fires", async () => {
    // link again so the telegram channel can be chosen, then unlink
    const pending = await json<TelegramStatus>(await t.request("/v1/me/telegram/link", { cookie, json: {} }));
    t.telegram.push("chat-9", `/start ${pending.pending!.code}`);
    await handleTelegramUpdates(t.deps, 0);
    const a = await json<Alert>(await t.request("/v1/alerts", { cookie, json: { kind: "price", asset: "BTC", op: ">=", value: "1", channels: ["telegram"] } }));
    await t.request("/v1/me/telegram", { cookie, method: "DELETE" });
    const sends = t.telegram.sent.length;
    const fired = await json<Alert>(await t.request(`/v1/alerts/${a.id}/trigger`, { cookie, json: { value: "2" } }));
    expect(fired.state).toBe("triggered");
    expect(t.telegram.sent.length).toBe(sends);
    const [row] = await t.db.select().from(alerts).where(eq(alerts.id, a.id));
    expect(await fireAlert(t.deps, row!, "3", { source: "server" })).toBeNull();
  });

  it("delivery failures during a fire are logged: a bounced mailbox and a blocked chat both leave the alert triggered", async () => {
    const pending = await json<TelegramStatus>(await t.request("/v1/me/telegram/link", { cookie, json: {} }));
    t.telegram.push("chat-9", `/start ${pending.pending!.code}`);
    await handleTelegramUpdates(t.deps, 0);
    const a = await json<Alert>(await t.request("/v1/alerts", { cookie, json: { kind: "price", asset: "BTC", op: ">=", value: "1", channels: ["email", "telegram"] } }));
    t.mail.bounce.add("tg-client@hapiecoin.test");
    t.telegram.blocked.add("chat-9");
    try {
      const fired = await json<Alert>(await t.request(`/v1/alerts/${a.id}/trigger`, { cookie, json: { value: "2" } }));
      expect(fired.state).toBe("triggered");
    } finally {
      t.mail.bounce.delete("tg-client@hapiecoin.test");
      t.telegram.blocked.delete("chat-9");
    }
  });

  it("a snapshot source that fails is logged and the runner keeps going", async () => {
    const src: MarketSource = { products: () => Promise.reject(new Error("venue down")), tickers: () => Promise.resolve([]) };
    let after = 0;
    const stop = startIvSnapshotter(t.deps, src, 20, () => {
      after += 1;
      return Promise.resolve();
    });
    await new Promise((r) => setTimeout(r, 80));
    stop();
    expect(after).toBe(0);
  });

  it("the snapshotter runs its after-hook once per completed snapshot", async () => {
    const src: MarketSource = { products: () => Promise.resolve([]), tickers: () => Promise.resolve([]) };
    let after = 0;
    const stop = startIvSnapshotter(t.deps, src, 20, () => {
      after += 1;
      return Promise.resolve();
    });
    await vi.waitFor(() => expect(after).toBeGreaterThanOrEqual(2), { timeout: 2000 });
    stop();
  });
});
