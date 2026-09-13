// The server-side Mindful pause (GAPS #90, ADR-084): its own app, because the marks it seeds would pause every later live test.
import { afterAll, beforeAll, describe, expect, it, type Mock, vi } from "vitest";
import type { LivePreview, MindfulPreview, Strategy } from "@hapiecoin/schema";
import { eq } from "drizzle-orm";
import { instrumentMarks, strategies, strategyPnl } from "./db/schema.js";
import { SEED } from "./db/seed.js";
import { DAY_BASIS, MindfulGate, PAUSE_STAMP_TTL_MS, dayKey, liveDayPnl, mindfulFor, startDayPnlWriter, writeDayPnlPoints } from "./day-pnl.js";
import type { AppDeps } from "./routes/shared.js";
import type { SessionUser } from "./security/context.js";
import { createTestApp, type TestApp } from "./test-support/harness.js";

let t: TestApp;
let alice: string;
let me: SessionUser;
const CALL = { kind: "call", side: "buy", strike: "80000", expiry: "2026-09-25", symbol: "C-BTC-80000-250926", lots: 10, price: "1200" };

beforeAll(async () => {
  t = await createTestApp();
  alice = (await t.signUp("alice-day@hapiecoin.test")).cookie;
  const who = (await (await t.request("/v1/me", { cookie: alice })).json()) as { id: string; email: string; name: string };
  me = { id: who.id, email: who.email, name: who.name, role: "user" };
  t.delta.accept("live-key");
  expect((await t.request("/v1/credentials", { cookie: alice, json: { brokerId: SEED.brokerId, apiKey: "live-key", apiSecret: "live-secret" } })).status).toBe(201);
  // the fake fills at 1201: (mark − 1201) × 10 lots × 0.001 per lot decides the day
  t.trading.product(CALL.symbol, 101, "0.001").markAt(CALL.symbol, "1200").fillAt(101, "1201");
  t.trading.setBalances([{ asset: "USD", balance: "5000", availableBalance: "4000" }]);
});
afterAll(() => t.close());

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
const draft = async (name: string) => json<Strategy>(await t.request("/v1/strategies", { cookie: alice, json: { name, asset: "BTC", legs: [CALL] } }));
const place = (id: string, key: string) => t.request(`/v1/strategies/${id}/live/place`, { cookie: alice, json: { confirm: "LIVE", brokerId: SEED.brokerId, idempotencyKey: key, expected: {} } });
const preview = (id: string) => t.request(`/v1/strategies/${id}/live/preview`, { cookie: alice, json: { brokerId: SEED.brokerId } });
const markAt = (symbol: string, mark: string) => t.db.insert(instrumentMarks).values({ asset: "BTC", symbol, ts: new Date(t.now.value), mark, venue: "delta_india" });
const body = async (res: Response) => (await res.json()) as { code: string; message: string; details?: { waitS?: number } };
/** Through the settings route: the row is created lazily, so a raw update would hit nothing. */
const setMindful = async (mindful: { enabled: boolean; thresholdUsd: string; pauseSeconds: number }) => {
  const current = await json<Record<string, unknown>>(await t.request("/v1/settings", { cookie: alice }));
  expect((await t.request("/v1/settings", { cookie: alice, method: "PUT", json: { ...current, mindful } })).status).toBe(200);
};

describe("HC-TR-189 the server's live day P&L (ADR-084)", () => {
  it("values open live legs from the recorded marks against the day's baseline, counts live trades closed today, and is unknown without a fresh mark", async () => {
    t.now.value += 61_000;
    const s = await draft("first");
    expect((await place(s.id, "day-key-00")).status).toBe(200);
    // no mark yet: the figure is unknown and nothing is decided on it
    expect(await liveDayPnl(t.deps, me, t.now.value)).toEqual({ pnlUsd: 0, count: 1, closedCount: 0, known: false });
    expect((await mindfulFor(t.deps, me, t.now.value)).pause).toBeNull();
    await markAt(CALL.symbol, "1100"); // (1100 − 1201) × 10 × 0.001 = −1.01
    let d = await liveDayPnl(t.deps, me, t.now.value);
    expect(d).toMatchObject({ count: 1, closedCount: 0, known: true });
    expect(d.pnlUsd).toBeCloseTo(-1.01, 6);
    // yesterday's point is the baseline: the day is the total minus it
    await t.db.insert(strategyPnl).values({ strategyId: s.id, day: dayKey(t.now.value - 86_400_000), pnl: "-0.5" });
    d = await liveDayPnl(t.deps, me, t.now.value);
    expect(d.pnlUsd).toBeCloseTo(-0.51, 6);
    // a live trade closed today counts at its realised figure; closed yesterday it does not
    const s2 = await draft("closed today");
    await setMindful({ enabled: false, thresholdUsd: "0", pauseSeconds: 30 }); // the pause would now refuse this setup placement
    expect((await place(s2.id, "day-key-01")).status).toBe(200);
    await setMindful({ enabled: true, thresholdUsd: "0", pauseSeconds: 30 });
    await t.db.update(strategies).set({ status: "archived", closedAt: new Date(t.now.value), realizedPnl: "-3" }).where(eq(strategies.id, s2.id));
    d = await liveDayPnl(t.deps, me, t.now.value);
    expect(d).toMatchObject({ count: 2, closedCount: 1, known: true });
    expect(d.pnlUsd).toBeCloseTo(-3.51, 6);
    await t.db.update(strategies).set({ closedAt: new Date(t.now.value - 86_400_000) }).where(eq(strategies.id, s2.id));
    expect((await liveDayPnl(t.deps, me, t.now.value)).count).toBe(1);
    // a stale mark (older than 20 min) is no mark
    t.now.value += 21 * 60_000;
    expect((await liveDayPnl(t.deps, me, t.now.value)).known).toBe(false);
    await markAt(CALL.symbol, "1100");
    expect((await liveDayPnl(t.deps, me, t.now.value)).known).toBe(true);
  });

  it("the settings decide the pause: on below the threshold, off, or above it; the writer files today's point for every priced live strategy", async () => {
    const m = await mindfulFor(t.deps, me, t.now.value);
    expect(m.pause).toEqual({ seconds: 30, thresholdUsd: "0", basis: DAY_BASIS });
    expect(m.day).toMatchObject({ count: 1, closedCount: 0, known: true });
    expect(Number(m.day.pnlUsd)).toBeCloseTo(-0.51, 2);
    await setMindful({ enabled: true, thresholdUsd: "5", pauseSeconds: 45 });
    expect((await mindfulFor(t.deps, me, t.now.value)).pause).toBeNull(); // −0.51 is not below −5
    await setMindful({ enabled: false, thresholdUsd: "0", pauseSeconds: 45 });
    expect((await mindfulFor(t.deps, me, t.now.value)).pause).toBeNull();
    await setMindful({ enabled: true, thresholdUsd: "0", pauseSeconds: 45 });
    expect((await mindfulFor(t.deps, me, t.now.value)).pause?.seconds).toBe(45);
    // the writer
    const r = await writeDayPnlPoints(t.deps, t.now.value);
    expect(r).toEqual({ written: 1, skipped: 0 });
    const rows = await t.db.select().from(strategyPnl).where(eq(strategyPnl.day, dayKey(t.now.value)));
    expect(rows.map((x) => x.pnl)).toEqual(["-1.01"]);
    // a second pass updates the same point; a strategy without a fresh mark is skipped
    await markAt(CALL.symbol, "1150");
    expect(await writeDayPnlPoints(t.deps, t.now.value)).toEqual({ written: 1, skipped: 0 });
    expect((await t.db.select().from(strategyPnl).where(eq(strategyPnl.day, dayKey(t.now.value)))).map((x) => x.pnl)).toEqual(["-0.51"]);
    t.now.value += 21 * 60_000;
    expect(await writeDayPnlPoints(t.deps, t.now.value)).toEqual({ written: 0, skipped: 1 });
    await markAt(CALL.symbol, "1100");
  });

  it("startDayPnlWriter: a pass at once and again on the interval, a pass still in flight is not doubled, a failing pass is logged and never thrown", async () => {
    const logger = { debug: vi.fn(), warn: vi.fn() } as unknown as AppDeps["logger"];
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    // the live strategy above has a fresh mark, so every pass writes a point and logs it
    const stop = startDayPnlWriter({ ...t.deps, logger }, 40, () => t.now.value);
    await sleep(400);
    stop();
    const passes = (logger.debug as Mock).mock.calls.length;
    expect(passes).toBeGreaterThanOrEqual(2);
    await sleep(90);
    expect((logger.debug as Mock).mock.calls.length).toBe(passes);
    // a pass still in flight: the interval's ticks return without starting another
    let release: (rows: never[]) => void = () => {};
    const pending = new Promise<never[]>((r) => { release = r; });
    let selects = 0;
    const slow = { select: () => { selects += 1; return { from: () => ({ where: () => pending }) }; } } as unknown as AppDeps["db"];
    const stopSlow = startDayPnlWriter({ ...t.deps, db: slow, logger }, 10, () => t.now.value);
    await sleep(60);
    expect(selects).toBe(1);
    release([]);
    await sleep(40);
    stopSlow();
    expect(selects).toBeGreaterThanOrEqual(2);
    // a failing pass
    const down = { select: () => { throw new Error("db down"); } } as unknown as AppDeps["db"];
    const stopDown = startDayPnlWriter({ ...t.deps, db: down, logger }, 1000, () => t.now.value);
    await sleep(20);
    stopDown();
    expect(logger.warn).toHaveBeenCalledWith({ error: "db down" }, "day P&L writer failed");
  });

  it("the gate: the whole pause when never shown, what is left after it was, the whole pause again once the stamp is stale; a re-preview never restarts a running pause", () => {
    const clock = { value: 1_000_000 };
    const gate = new MindfulGate(() => clock.value);
    expect(gate.waitS("u1", "s1", 30)).toBe(30);
    gate.note("u1", "s1");
    expect(gate.waitS("u1", "s1", 30)).toBe(30);
    clock.value += 10_000;
    expect(gate.waitS("u1", "s1", 30)).toBe(20);
    gate.note("u1", "s1"); // a re-preview keeps the running pause
    expect(gate.waitS("u1", "s1", 30)).toBe(20);
    expect(gate.waitS("u1", "s2", 30)).toBe(30); // another strategy, its own pause
    clock.value += 20_000;
    expect(gate.waitS("u1", "s1", 30)).toBe(0);
    clock.value += PAUSE_STAMP_TTL_MS + 1;
    expect(gate.waitS("u1", "s1", 30)).toBe(30); // abandoned flow: shown too long ago
    gate.note("u1", "s1");
    expect(gate.waitS("u1", "s1", 30)).toBe(30);
    clock.value += PAUSE_STAMP_TTL_MS - 1_000;
    gate.note("u1", "s1"); // seen again just inside the TTL: the clock keeps its start and the stamp lives on
    clock.value += 2_000;
    expect(gate.waitS("u1", "s1", 30)).toBe(0); // not the whole pause again although the first stamp is older than the TTL
    gate.consume("u1", "s1"); // the entry went through
    expect(gate.waitS("u1", "s1", 30)).toBe(30);
  });
});

describe("HC-TR-189 / HC-TR-190 the pause delays a live entry, a batch and a live add until the preview's pause has elapsed", () => {
  it("place: 409 MINDFUL_PAUSE without a preview and the refusal starts the clock, the preview carries the pause and keeps it, the order goes through once it has elapsed", async () => {
    t.now.value += 61_000;
    await setMindful({ enabled: true, thresholdUsd: "0", pauseSeconds: 30 });
    const s = await draft("third");
    const refused = await place(s.id, "day-key-02");
    expect(refused.status).toBe(409);
    const r = await body(refused);
    expect(r.code).toBe("MINDFUL_PAUSE");
    expect(r.details?.waitS).toBe(30);
    expect(r.message).toContain("30 s");
    expect((await json<Strategy>(await t.request(`/v1/strategies/${s.id}`, { cookie: alice }))).status).toBe("draft"); // nothing moved
    t.now.value += 10_000;
    expect((await body(await place(s.id, "day-key-02"))).details?.waitS).toBe(20); // the refusal started the clock; a script waits the same pause once
    const p = await json<LivePreview>(await preview(s.id));
    expect(p.mindful?.pause).toEqual({ seconds: 30, thresholdUsd: "0", basis: DAY_BASIS });
    expect(p.mindful?.day.known).toBe(true);
    t.now.value += 10_000;
    const early = await place(s.id, "day-key-02");
    expect(early.status).toBe(409);
    expect((await body(early)).details?.waitS).toBe(10); // the preview kept the running clock
    t.now.value += 11_000;
    expect((await place(s.id, "day-key-02")).status).toBe(200);
  });

  it("batch: refused as a whole before any placement until GET /v1/me/day-pnl showed the pause and it elapsed; a live add through /adjust waits too", async () => {
    t.now.value += 61_000;
    const a = await draft("batch a");
    await t.request(`/v1/strategies/${a.id}/start`, { cookie: alice, json: { mode: "paper", brokerId: SEED.brokerId, entries: {} } });
    const batch = () => t.request("/v1/strategies/live/batch", { cookie: alice, json: { confirm: "LIVE", ids: [a.id], brokerId: SEED.brokerId, idempotencyKey: "day-batch-1" } });
    // the paper run's figures are not the live run's: a paper day at +500 and a paper trim at −400 must not read as today's live loss
    const yesterday = dayKey(t.now.value - 86_400_000);
    await t.db.insert(strategyPnl).values({ strategyId: a.id, day: yesterday, pnl: "500" });
    await t.db.update(strategies).set({ realizedPnl: "-400" }).where(eq(strategies.id, a.id));
    const b1 = await batch();
    expect(b1.status).toBe(409);
    expect((await body(b1)).code).toBe("MINDFUL_PAUSE");
    expect((await json<Strategy>(await t.request(`/v1/strategies/${a.id}`, { cookie: alice }))).status).toBe("paper");
    const day = await json<MindfulPreview>(await t.request("/v1/me/day-pnl", { cookie: alice }));
    expect(day.pause?.seconds).toBe(30);
    expect(day.day.known).toBe(true);
    t.now.value += 31_000;
    const b2 = await json<{ placed: string[]; failed: unknown }>(await batch());
    expect(b2.placed).toEqual([a.id]);
    expect(await t.db.select().from(strategyPnl).where(eq(strategyPnl.strategyId, a.id))).toEqual([]); // the paper points went with the transition
    expect((await json<Strategy>(await t.request(`/v1/strategies/${a.id}`, { cookie: alice }))).realizedPnl).toBe("0"); // and the paper realised figure
    const after = await json<MindfulPreview>(await t.request("/v1/me/day-pnl", { cookie: alice }));
    expect(after.day.known).toBe(true);
    expect(Number(after.day.pnlUsd)).toBeGreaterThan(-5); // the marks' small loss, no paper +500 subtracted
    // a live add is a new bet: the workbench preview shows the pause, the adjust waits for it; a trim needs none
    const PUT = { kind: "put", side: "sell", strike: "78000", expiry: "2026-09-25", symbol: "P-BTC-78000-250926", lots: 5, price: "900" };
    t.trading.product(PUT.symbol, 102, "0.001").markAt(PUT.symbol, "900").fillAt(102, "899");
    const add = () => t.request(`/v1/strategies/${a.id}/adjust`, { cookie: alice, json: { confirm: "LIVE", adds: [PUT], expected: { [PUT.symbol]: "900" }, idempotencyKey: "day-adj-1" } });
    const refusedAdd = await add();
    expect(refusedAdd.status).toBe(409);
    expect((await body(refusedAdd)).code).toBe("MINDFUL_PAUSE");
    // while the add still waits: a body mixing a trim with the add waits as a whole, a trim alone goes through (it reduces exposure)
    const open = (await json<Strategy>(await t.request(`/v1/strategies/${a.id}`, { cookie: alice }))).legs.filter((l) => l.status === "open");
    const trimOf = (key: string, adds: object[]) => t.request(`/v1/strategies/${a.id}/adjust`, { cookie: alice, json: { ...(adds.length ? { confirm: "LIVE", adds, expected: { [PUT.symbol]: "900" } } : { expected: {} }), changes: [{ legId: open[0]!.id, lotsAfter: open[0]!.lots - 1, price: "1100" }], idempotencyKey: key } });
    const mixed = await trimOf("day-adj-3", [PUT]);
    expect(mixed.status).toBe(409);
    expect((await body(mixed)).code).toBe("MINDFUL_PAUSE");
    const trim = await trimOf("day-adj-2", []);
    expect(trim.status).toBe(200);
    const wp = await json<LivePreview>(await t.request(`/v1/strategies/${a.id}/live/preview`, { cookie: alice, json: { brokerId: SEED.brokerId, adds: [PUT], changes: [] } }));
    expect(wp.mindful?.pause?.seconds).toBe(30);
    t.now.value += 31_000;
    expect((await add()).status).toBe(200);
    // POST /legs is a live entry path too: the add consumed its stamp, so it waits its own pause, and no leg is written while it does
    await markAt(CALL.symbol, "1100");
    await markAt(PUT.symbol, "900");
    const CALL2 = { ...CALL, strike: "82000", symbol: "C-BTC-82000-250926" };
    t.trading.product(CALL2.symbol, 103, "0.001").markAt(CALL2.symbol, "700").fillAt(103, "701");
    const legsCall = () => t.request(`/v1/strategies/${a.id}/legs`, { cookie: alice, json: { confirm: "LIVE", legs: [CALL2] } });
    const legsBefore = (await json<Strategy>(await t.request(`/v1/strategies/${a.id}`, { cookie: alice }))).legs.length;
    const refusedLegs = await legsCall();
    expect(refusedLegs.status).toBe(409);
    expect((await body(refusedLegs)).code).toBe("MINDFUL_PAUSE");
    expect((await json<Strategy>(await t.request(`/v1/strategies/${a.id}`, { cookie: alice }))).legs).toHaveLength(legsBefore);
    t.now.value += 31_000;
    expect((await legsCall()).status).toBe(200);
  });
});
