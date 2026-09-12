// Server-side alerts (ADR-057, GAPS #64): the evaluator fires price / IV / P&L alerts from the snapshot rows with
// the app closed, the client and server share one guarded fire path, and Telegram links through /start and delivers.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Alert, Strategy, TelegramStatus } from "@hapiecoin/schema";
import { eq } from "drizzle-orm";
import { evaluateAlerts, strategyPnlFromMarks } from "./alerts-evaluate.js";
import { instrumentMarks, ivSnapshots, users } from "./db/schema.js";
import { SEED } from "./db/seed.js";
import { handleTelegramUpdates } from "./routes/telegram.js";
import { createTestApp, type TestApp } from "./test-support/harness.js";

let t: TestApp;
let cookie: string;
let userId: string;
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
const T0 = Date.UTC(2026, 8, 10, 6);
const CALL = { kind: "call", side: "buy", strike: "80000", expiry: "2026-09-25", symbol: "C-BTC-80000-250926", lots: 10, price: "1200", iv: 0.5 };
const PUT = { kind: "put", side: "sell", strike: "78000", expiry: "2026-09-25", symbol: "P-BTC-78000-250926", lots: 10, price: "900", iv: 0.55 };

async function snapshot(asset: "BTC" | "ETH", spot: number, atmIv: number, at: number, marks: Record<string, number> = {}) {
  const ts = new Date(at);
  await t.db.insert(ivSnapshots).values({ asset, expiry: "2026-09-25", ts, atmIv: String(atmIv), spot: String(spot), atmStrike: String(spot), front: true });
  const rows = Object.entries(marks).map(([symbol, mark]) => ({ asset, symbol, ts, mark: String(mark), markIv: "0.5" }));
  if (rows.length) await t.db.insert(instrumentMarks).values(rows);
}
const create = (body: Record<string, unknown>) => t.request("/v1/alerts", { cookie, json: body });
const alert = async (id: string) => (await json<{ items: Alert[] }>(await t.request("/v1/alerts", { cookie }))).items.find((a) => a.id === id)!;

beforeAll(async () => {
  t = await createTestApp();
  cookie = (await t.signUp("server-alerts@hapiecoin.test")).cookie;
  userId = (await json<{ id: string }>(await t.request("/v1/me", { cookie }))).id;
});
afterAll(() => t.close());

describe("ADR-057 evaluateAlerts", () => {
  it("fires price and IV alerts from the latest front snapshot, skips alerts without a reading, never fires twice", async () => {
    const price = await json<Alert>(await create({ kind: "price", asset: "BTC", op: ">=", value: "80000", channels: ["email"] }));
    const iv = await json<Alert>(await create({ kind: "iv", asset: "BTC", op: "<=", value: "35", channels: ["push"] }));
    const eth = await json<Alert>(await create({ kind: "price", asset: "ETH", op: ">=", value: "1", channels: ["push"] }));
    // nothing recorded yet: everything is skipped
    expect(await evaluateAlerts(t.deps, () => T0)).toEqual({ checked: 3, fired: [], skipped: 3 });
    await snapshot("BTC", 79_000, 0.42, T0);
    expect(await evaluateAlerts(t.deps, () => T0 + 1000)).toEqual({ checked: 3, fired: [], skipped: 1 });
    await snapshot("BTC", 80_250.5, 0.3, T0 + 300_000);
    const mails = t.mail.alerts.length;
    const report = await evaluateAlerts(t.deps, () => T0 + 301_000);
    expect(report.fired.sort()).toEqual([price.id, iv.id].sort());
    expect(report.skipped).toBe(1); // ETH still has no snapshot
    expect(await alert(price.id)).toMatchObject({ state: "triggered", lastValue: "80250.5" });
    expect(await alert(iv.id)).toMatchObject({ state: "triggered", lastValue: "30" });
    expect(await alert(eth.id)).toMatchObject({ state: "armed" });
    // the email channel was delivered by the server, with the "server" source in the audit
    expect(t.mail.alerts.length).toBe(mails + 1);
    expect(t.mail.alerts.at(-1)!.subject).toBe("HapieCoin alert · BTC ≥ 80,000");
    // a second pass does nothing (the rows are triggered); the client trigger on a fired row answers 409
    expect((await evaluateAlerts(t.deps, () => T0 + 302_000)).fired).toEqual([]);
    expect((await t.request(`/v1/alerts/${price.id}/trigger`, { cookie, json: { value: "80300" } })).status).toBe(409);
    // re-armed, the next snapshot fires it again
    await t.request(`/v1/alerts/${price.id}`, { cookie, method: "PATCH", json: { state: "armed" } });
    expect((await evaluateAlerts(t.deps, () => T0 + 303_000)).fired).toEqual([price.id]);
  });

  it("HC-SH-125 values a Deribit paper strategy with the Deribit lot from Deribit marks (ADR-070)", async () => {
    const broker = await json<{ id: string }>(await t.request("/v1/brokers", { cookie, json: { name: "Deribit alerts", feePct: "0", gstPct: "0", feeCapPct: "0", venue: "deribit" } }));
    const s = await json<Strategy>(await t.request("/v1/strategies", { cookie, json: { name: "Deribit P&L", asset: "BTC", venue: "deribit", templateName: "Custom", legs: [{ ...CALL, symbol: "BTC-25SEP26-80000-C" }] } }));
    expect((await json<Strategy>(await t.request(`/v1/strategies/${s.id}/start`, { cookie, json: { mode: "paper", brokerId: broker.id, entries: { [s.legs[0]!.id]: "1200" } } }))).status).toBe("paper");
    const at = T0 + 7_200_000;
    await t.db.insert(instrumentMarks).values({ asset: "BTC", venue: "delta_india", symbol: "BTC-25SEP26-80000-C", ts: new Date(at), mark: "1300", markIv: "0.5" });
    expect(await strategyPnlFromMarks(t.deps, s.id, at)).toBeNull(); // a Delta row never values a Deribit leg
    await t.db.insert(instrumentMarks).values({ asset: "BTC", venue: "deribit", symbol: "BTC-25SEP26-80000-C", ts: new Date(at), mark: "1300", markIv: "0.5" });
    expect(await strategyPnlFromMarks(t.deps, s.id, at)).toBeCloseTo(100, 9); // +100 × 10 lots × 0.1 BTC
  });

  it("values a paper strategy from the latest marks and fires its P&L alert; a leg without a fresh mark is skipped", async () => {
    const s = await json<Strategy>(await t.request("/v1/strategies", { cookie, json: { name: "Server RR", asset: "BTC", templateName: "Custom", legs: [CALL, PUT] } }));
    const started = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/start`, { cookie, json: { mode: "paper", brokerId: SEED.brokerId, entries: { [s.legs[0]!.id]: "1200", [s.legs[1]!.id]: "900" } } }));
    expect(started.status).toBe("paper");
    const pnl = await json<Alert>(await create({ kind: "pnl", asset: "BTC", strategyId: s.id, op: ">=", value: "1.5", channels: ["push"] }));
    const at = T0 + 3_600_000;
    // only the call has a mark: no reading
    await snapshot("BTC", 80_000, 0.4, at, { "C-BTC-80000-250926": 1300 });
    expect(await strategyPnlFromMarks(t.deps, s.id, at)).toBeNull();
    expect((await evaluateAlerts(t.deps, () => at)).skipped).toBeGreaterThanOrEqual(1);
    // both legs marked: call +100 × 10 × 0.001 = +1.00, put sold at 900 now 850 → +0.50 → total +1.50 ≥ 1.5
    await snapshot("BTC", 80_000, 0.4, at + 300_000, { "C-BTC-80000-250926": 1300, "P-BTC-78000-250926": 850 });
    expect(await strategyPnlFromMarks(t.deps, s.id, at + 300_000)).toBeCloseTo(1.5, 9);
    const report = await evaluateAlerts(t.deps, () => at + 301_000);
    expect(report.fired).toContain(pnl.id);
    expect(await alert(pnl.id)).toMatchObject({ state: "triggered", lastValue: "1.5" });
    // a stale mark (older than 20 minutes) is not a reading
    expect(await strategyPnlFromMarks(t.deps, s.id, at + 300_000 + 25 * 60_000)).toBeNull();
    expect(await strategyPnlFromMarks(t.deps, "strat_none", at)).toBeNull();
  });
});

describe("ADR-057 Telegram linking and delivery", () => {
  it("status → link code → /start links the chat → test message → alerts on the telegram channel arrive", async () => {
    const before = await json<TelegramStatus>(await t.request("/v1/me/telegram", { cookie }));
    expect(before).toEqual({ configured: true, bot: "HapieCoinTestBot", linked: false, linkedAt: null, pending: null });
    // the channel needs a linked chat
    expect((await create({ kind: "price", asset: "BTC", op: ">=", value: "1", channels: ["telegram"] })).status).toBe(400);
    expect((await t.request("/v1/me/telegram/test", { cookie, json: {} })).status).toBe(409);
    const pending = await json<TelegramStatus>(await t.request("/v1/me/telegram/link", { cookie, json: {} }));
    expect(pending.linked).toBe(false);
    expect(pending.pending!.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(pending.pending!.link).toBe(`https://t.me/HapieCoinTestBot?start=${pending.pending!.code}`);
    // an unrelated message and a wrong code get replies; the right code links
    t.telegram.push("chat-1", "hello");
    t.telegram.push("chat-1", "/start NOPE1234");
    t.telegram.push("chat-1", `/start ${pending.pending!.code.toLowerCase()}`);
    const next = await handleTelegramUpdates(t.deps, 0, () => new Date(T0));
    expect(next).toBe(4);
    expect(t.telegram.sent.map((m) => m.text.split(" ·")[0])).toEqual(["HapieCoin alerts bot", "That link code is not recognised", "Connected"]);
    const linked = await json<TelegramStatus>(await t.request("/v1/me/telegram", { cookie }));
    expect(linked).toMatchObject({ linked: true, linkedAt: new Date(T0).toISOString(), pending: null });
    // the same offset again does nothing new
    expect(await handleTelegramUpdates(t.deps, next)).toBe(next);
    // test message
    expect((await t.request("/v1/me/telegram/test", { cookie, json: {} })).status).toBe(200);
    expect(t.telegram.sent.at(-1)).toMatchObject({ chatId: "chat-1" });
    // an alert on telegram (plus email) delivered by the server and by the client trigger alike
    const a = await json<Alert>(await create({ kind: "price", asset: "ETH", op: ">=", value: "4000", channels: ["telegram", "email"] }));
    await snapshot("ETH", 4_100, 0.6, T0 + 7_200_000);
    expect((await evaluateAlerts(t.deps, () => T0 + 7_201_000)).fired).toContain(a.id);
    expect(t.telegram.sent.at(-1)).toMatchObject({ chatId: "chat-1", text: expect.stringContaining("ETH ≥ 4,000") as string });
    const sends = t.telegram.sent.length;
    await t.request(`/v1/alerts/${a.id}`, { cookie, method: "PATCH", json: { state: "armed" } });
    expect((await t.request(`/v1/alerts/${a.id}/trigger`, { cookie, json: { value: "4200" } })).status).toBe(200);
    expect(t.telegram.sent.length).toBe(sends + 1);
    // a blocked chat is logged, the alert stays triggered
    t.telegram.blocked.add("chat-1");
    await t.request(`/v1/alerts/${a.id}`, { cookie, method: "PATCH", json: { state: "armed" } });
    expect((await t.request(`/v1/alerts/${a.id}/trigger`, { cookie, json: { value: "4300" } })).status).toBe(200);
    expect((await t.request("/v1/me/telegram/test", { cookie, json: {} })).status).toBe(502);
    t.telegram.blocked.delete("chat-1");
    // unlink clears the chat; the channel is refused again
    const off = await json<TelegramStatus>(await t.request("/v1/me/telegram", { cookie, method: "DELETE" }));
    expect(off).toMatchObject({ linked: false, pending: null });
    expect((await t.db.select({ chatId: users.telegramChatId }).from(users).where(eq(users.id, userId)))[0]!.chatId).toBeNull();
    expect((await t.request(`/v1/alerts/${a.id}`, { cookie, method: "PATCH", json: { channels: ["telegram"] } })).status).toBe(400);
  });

  it("without a bot token the channel is unconfigured: status says so, link answers 503, create refuses telegram", async () => {
    const telegram = t.deps.telegram;
    t.deps.telegram = null;
    try {
      expect(await json<TelegramStatus>(await t.request("/v1/me/telegram", { cookie }))).toMatchObject({ configured: false, bot: null, linked: false });
      expect((await t.request("/v1/me/telegram/link", { cookie, json: {} })).status).toBe(503);
      expect((await t.request("/v1/me/telegram/test", { cookie, json: {} })).status).toBe(503);
      expect((await create({ kind: "price", asset: "BTC", op: ">=", value: "1", channels: ["telegram"] })).status).toBe(400);
      expect(await handleTelegramUpdates(t.deps, 7)).toBe(7);
    } finally {
      t.deps.telegram = telegram;
    }
  });
});
