// Saved Autopilot strategies (ADR-141, ADR-142; HC-TR-269..276): an admin saves, tests, publishes, versions, retires and
// deletes strategies beside the built-in list; the engine paper-trades the published ones for the traders allowed to
// use them and trades the built-in ones exactly as before. Nothing here places anything on a venue.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUTOPILOT_PLAYBOOKS, type PlaybookProposal } from "@hapiecoin/pricing";
import { AUTOPILOT_PAPER_ONLY_MESSAGE, type AutopilotView, type Instrument, type Quote, SAVED_REFUSALS, SavedDefinition, type SavedStrategy, type SavedStrategyList } from "@hapiecoin/schema";
import { asc, eq } from "drizzle-orm";
import { type AutopilotDeps, clockPlanFor, runAutopilot, savedPlanFor, savedPlanRefusal } from "./autopilot.js";
import { isSavedId, mayUseSaved, savedCatalogue, savedPlaybook, savedStillOnPaper, usableSavedIds } from "./autopilot-saved.js";
import { auditLog, autopilotRuns, autopilotSavedStrategies, autopilotSettings, strategies, strategyLegs, strategyRules } from "./db/schema.js";
import { SEED } from "./db/seed.js";
import { type MarketSource, snapshotOnce } from "./iv-snapshot.js";
import { createTestApp, type TestApp } from "./test-support/harness.js";

let t: TestApp;
let admin: string;
let elite: { cookie: string; id: string };
let free: { cookie: string; id: string };
const BASE = "/v1/admin/autopilot-strategies";
const MIN = 60_000;
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
const idOf = async (cookie: string) => (await json<{ id: string }>(await t.request("/v1/me", { cookie }))).id;

beforeAll(async () => {
  t = await createTestApp();
  admin = await t.adminCookie();
  const a = await t.signUp("saved-elite@hapiecoin.test");
  elite = { cookie: a.cookie, id: await idOf(a.cookie) };
  const b = await t.signUp("saved-free@hapiecoin.test", { plan: "free" });
  free = { cookie: b.cookie, id: await idOf(b.cookie) };
});
afterAll(() => t.close());

const sell = (kind: "call" | "put", value = 1) => ({ kind, side: "sell" as const, by: "pct" as const, value });
/** Sell the call and the put 1 % away each evening on the next expiry; stop at double, take half, buy back at 5. */
const DAILY = { assets: ["BTC"], venues: ["delta_india"], lots: 100, cadence: "daily", fromHourUtc: 16, toHourUtc: 17, oncePerExpiry: false, minDte: 0.5, maxDte: 1.5, legs: [sell("put"), sell("call")], exits: { legStop: 2, takeProfitOfCredit: 0.5, legBuyBackAt: 5 } };
const FIGURES = { mean: 12.4, per: "day", positivePct: 71, worst: -180, samples: 106, basis: "autopilot-study, 8 Aug to 21 Nov 2026, real fees" };
const post = (path: string, body?: unknown, cookie = admin) => t.request(path, { cookie, method: "POST", ...(body === undefined ? {} : { json: body }) });
const patch = (id: string, body: unknown, cookie = admin) => t.request(`${BASE}/${id}`, { cookie, method: "PATCH", json: body });
const create = async (name: string, definition: unknown = DAILY) => json<SavedStrategy>(await post(BASE, { name, summary: "Sell both sides each evening.", definition }));
const list = async () => (await json<SavedStrategyList>(await t.request(BASE, { cookie: admin }))).items;
const why = async (res: Response) => (await json<{ message: string }>(res)).message;
const put = (body: unknown, cookie: string) => t.request("/v1/autopilot", { cookie, method: "PUT", json: body });

function inst(symbol: string, kind: "call" | "put", strike: number, expiry: string): Instrument {
  return { id: `delta_india:${symbol}`, venue: "delta_india", symbol, underlying: "BTC", kind, strike: String(strike), expiry, contractSize: "0.001", tickSize: "0.1", quoteCurrency: "USD", venueProductId: 1, isActive: true };
}
/** A chain around 83,200 whose time value falls away from the money. */
function curveAt(ts: number, spot = 83_200): MarketSource {
  const products: Instrument[] = [];
  const quotes: Quote[] = [];
  for (const e of ["2026-09-25", "2026-09-26", "2026-10-20"])
    for (let i = -12; i <= 12; i++) {
      const k = 83_200 + i * 200;
      const code = e.slice(8, 10) + e.slice(5, 7) + e.slice(2, 4);
      const tv = 400 * Math.exp(-Math.abs(k - spot) / 1500);
      const c = `C-BTC-${k}-${code}`;
      const p = `P-BTC-${k}-${code}`;
      products.push(inst(c, "call", k, e), inst(p, "put", k, e));
      quotes.push({ instrumentId: `delta_india:${c}`, ts, mark: (Math.max(spot - k, 0) + tv).toFixed(1), oi: "1", spot: String(spot), markIv: 0.4 }, { instrumentId: `delta_india:${p}`, ts, mark: (Math.max(k - spot, 0) + tv).toFixed(1), oi: "1", spot: String(spot), markIv: 0.4 });
    }
  return { venue: "delta_india", products: () => Promise.resolve(products), tickers: (u) => Promise.resolve(u === "BTC" ? quotes : []) };
}
/** 21:35 IST on 25 Sep 2026: inside the evening window; that day's expiry settled four hours earlier. */
const W = Date.UTC(2026, 8, 25, 16, 5, 0);
const deps = (nowMs: number, over: Partial<AutopilotDeps> = {}): AutopilotDeps => ({ db: t.db, logger: t.deps.logger, now: () => nowMs, ...over });
const pass = async (at: number, over: Partial<AutopilotDeps> = {}) => {
  await snapshotOnce(t.deps, curveAt(at - MIN), () => at - MIN);
  return runAutopilot(deps(at, over), ["delta_india"]);
};
const tradesOf = (userId: string) => t.db.select().from(strategies).where(eq(strategies.userId, userId)).orderBy(asc(strategies.createdAt));
const lastLine = async (userId: string) => (await t.db.select().from(autopilotRuns).where(eq(autopilotRuns.userId, userId)).orderBy(asc(autopilotRuns.id))).at(-1);

describe("HC-TR-270 an admin saves, edits and copies a strategy", () => {
  it("HC-TR-270 needs an admin; creates a draft that reads back whole; refuses settings that cannot be; edits the name in place; copies as a new draft", async () => {
    expect((await t.request(BASE)).status).toBe(401);
    expect((await t.request(BASE, { cookie: elite.cookie })).status).toBe(403);
    expect((await post(BASE, { name: "x", summary: "x", definition: DAILY }, elite.cookie)).status).toBe(403);
    expect(await list()).toEqual([]);

    const made = await post(BASE, { name: " Evening strangle 1 % ", summary: "Sell both sides each evening.", definition: DAILY });
    expect(made.status).toBe(201);
    const s = await json<SavedStrategy>(made);
    expect(isSavedId(s.id)).toBe(true);
    expect(s).toMatchObject({ familyId: s.id, version: 1, name: "Evening strangle 1 %", stage: "draft", audience: "admins", userIds: [], planIds: [], backtest: null, backtestAt: null, traded: false, lossCapped: false, entryText: "every day, 9:30 to 10:30 PM IST, on the next expiry", publishedAt: null, retiredAt: null });
    expect(s.definition).toEqual(DAILY);
    expect(s.createdBy).toBe(await idOf(admin));
    expect((await post(BASE, { name: "x", summary: "x", definition: { ...DAILY, legs: [{ kind: "call", side: "buy", by: "pct", value: 2 }] } })).status).toBe(400);
    expect((await post(BASE, { name: "x", summary: "x", definition: { ...DAILY, exits: { legBuyBackAt: 5, legBuyBackShare: 0.2 } } })).status).toBe(400);

    const renamed = await json<SavedStrategy>(await patch(s.id, { name: "Evening strangle", summary: "The same, renamed." }));
    expect(renamed).toMatchObject({ id: s.id, name: "Evening strangle", summary: "The same, renamed.", stage: "draft" });
    expect((await patch(s.id, {})).status).toBe(400);
    expect((await patch("sv_nope", { name: "x" })).status).toBe(404);
    expect((await patch(s.id, { name: "x" }, elite.cookie)).status).toBe(403);

    const copy = await post(`${BASE}/${s.id}/duplicate`);
    expect(copy.status).toBe(201);
    const c = await json<SavedStrategy>(copy);
    expect(c).toMatchObject({ familyId: c.id, version: 1, name: "Evening strangle (copy)", stage: "draft", backtest: null });
    expect(c.id).not.toBe(s.id);
    expect((await post(`${BASE}/sv_nope/duplicate`)).status).toBe(404);
    expect((await list()).map((x) => x.id).sort()).toEqual([c.id, s.id].sort());
    const actions = (await t.db.select({ action: auditLog.action }).from(auditLog)).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["admin.autopilot_strategy.create", "admin.autopilot_strategy.update", "admin.autopilot_strategy.duplicate"]));
    for (const x of await list()) expect((await t.request(`${BASE}/${x.id}`, { cookie: admin, method: "DELETE" })).status).toBe(200);
  });
});

describe("HC-TR-271 from a draft to paper", () => {
  it("HC-TR-271 HC-TR-274 publishes only with backtest figures and somebody to use it; on paper neither can be emptied; new settings on one that never traded take it back to a draft", async () => {
    const s = await create("Stages");
    const first = await post(`${BASE}/${s.id}/publish`);
    expect(first.status).toBe(409);
    expect(await why(first)).toBe(SAVED_REFUSALS.needsBacktest);

    const tested = await json<SavedStrategy>(await patch(s.id, { backtest: FIGURES }));
    expect(tested).toMatchObject({ stage: "backtested", backtest: FIGURES });
    expect(tested.backtestAt).not.toBeNull();
    expect(await json<SavedStrategy>(await patch(s.id, { backtest: null }))).toMatchObject({ stage: "draft", backtest: null, backtestAt: null });
    await patch(s.id, { backtest: FIGURES });
    // a change that is not to the figures keeps them and their date
    const kept = await json<SavedStrategy>(await patch(s.id, { summary: "With figures." }));
    expect(kept).toMatchObject({ stage: "backtested", backtest: FIGURES });
    expect(kept.backtestAt).not.toBeNull();

    for (const audience of [{ audience: "users", userIds: [] }, { audience: "plans", planIds: [] }]) {
      expect((await patch(s.id, audience)).status).toBe(200);
      const refused = await post(`${BASE}/${s.id}/publish`);
      expect(refused.status).toBe(409);
      expect(await why(refused)).toBe(SAVED_REFUSALS.needsAudience);
    }
    await patch(s.id, { audience: "admins" });
    const live = await json<SavedStrategy>(await post(`${BASE}/${s.id}/publish`));
    expect(live.stage).toBe("paper");
    expect(live.publishedAt).not.toBeNull();
    const again = await post(`${BASE}/${s.id}/publish`);
    expect(again.status).toBe(409);
    expect(await why(again)).toBe(SAVED_REFUSALS.notDraft);
    expect((await post(`${BASE}/sv_nope/publish`)).status).toBe(404);
    expect((await post(`${BASE}/${s.id}/publish`, undefined, elite.cookie)).status).toBe(403);

    // on paper: the name changes, the figures and the audience cannot be emptied
    expect(await json<SavedStrategy>(await patch(s.id, { name: "Stages, on paper" }))).toMatchObject({ stage: "paper", name: "Stages, on paper", publishedAt: live.publishedAt });
    expect(await why(await patch(s.id, { backtest: null }))).toBe(SAVED_REFUSALS.needsBacktest);
    expect(await why(await patch(s.id, { audience: "users", userIds: [] }))).toBe(SAVED_REFUSALS.needsAudience);
    expect(await json<SavedStrategy>(await patch(s.id, { audience: "users", userIds: [elite.id] }))).toMatchObject({ stage: "paper", audience: "users", userIds: [elite.id] });
    // a mistyped id is not "somebody": it is refused by name
    const nobody = await patch(s.id, { userIds: [elite.id, "usr_typo"] });
    expect(nobody.status).toBe(400);
    expect(await why(nobody)).toBe(`${SAVED_REFUSALS.unknownUser}: usr_typo`);
    const noPlan = await patch(s.id, { planIds: [SEED.plans.elite, "pln_typo"] });
    expect(noPlan.status).toBe(400);
    expect(await why(noPlan)).toBe(`${SAVED_REFUSALS.unknownPlan}: pln_typo`);
    expect((await patch(s.id, { planIds: [SEED.plans.elite, SEED.plans.pro] })).status).toBe(200);
    // on paper it is retired, not deleted: a trader may have it switched on
    const held = await t.request(`${BASE}/${s.id}`, { cookie: admin, method: "DELETE" });
    expect(held.status).toBe(409);
    expect(await why(held)).toBe(SAVED_REFUSALS.onPaper);
    // the same settings sent again, in another key order, are no change
    const { exits, legs, ...rest } = DAILY;
    expect(await json<SavedStrategy>(await patch(s.id, { definition: { legs, exits, ...rest } }))).toMatchObject({ id: s.id, stage: "paper" });

    // new settings, never traded: the same row, no figures, a draft again
    const wider = { ...DAILY, legs: [sell("put", 2), sell("call", 2)] };
    const back = await json<SavedStrategy>(await patch(s.id, { definition: wider }));
    expect(back).toMatchObject({ id: s.id, version: 1, stage: "draft", backtest: null, backtestAt: null, publishedAt: null });
    expect(back.definition.legs.map((l) => l.value)).toEqual([2, 2]);
    // new settings with their figures in one step
    expect(await json<SavedStrategy>(await patch(s.id, { definition: DAILY, backtest: FIGURES }))).toMatchObject({ id: s.id, stage: "backtested", backtest: FIGURES });
    expect((await t.request(`${BASE}/${s.id}`, { cookie: admin, method: "DELETE" })).status).toBe(200);
  });
});

describe("HC-TR-276 a saved strategy as the playbook the engine runs", () => {
  it("HC-TR-276 by the clock or on market conditions, with every exit, strikes by strikes, per cent or premium, and the loss it can make", () => {
    const row = (definition: object, backtest: typeof FIGURES | null = null) => ({ id: "sv_x", name: "X", summary: "Sums it up.", definition: definition as never, backtest: backtest as never });
    const clock = savedPlaybook(row(DAILY));
    expect(clock).toMatchObject({ id: "sv_x", name: "X", summary: "Sums it up.", minDte: 0.5, lots: 100, assets: ["BTC"], control: false, conditions: undefined, evidence: { claim: "No backtest entered.", source: "none" } });
    expect(clock.template).toMatchObject({ name: "X", category: "Neutral", risk: "undefined", legs: [{ kind: "put", side: "sell", k: 0, pct: -1 }, { kind: "call", side: "sell", k: 0, pct: 1 }] });
    expect(clock.clock).toMatchObject({ fromHourUtc: 16, toHourUtc: 17, weekdayUtc: undefined, cadence: undefined, oncePerExpiry: undefined, window: "9:30 to 10:30 PM IST", describe: "every day, 9:30 to 10:30 PM IST, on the next expiry", maxDte: 1.5, venues: ["delta_india"], legStop: 2, takeProfitOfCredit: 0.5, legBuyBackAt: 5 });

    const trend = savedPlaybook(
      row(
        {
          ...DAILY,
          cadence: "monthly",
          oncePerExpiry: true,
          fromHourUtc: 0,
          toHourUtc: 24,
          minDte: 20,
          maxDte: 35,
          conditions: { sma: { days: 50, side: "above" }, ivRank: { min: 60, lookbackDays: 90 } },
          moveSide: { hours: 24, pct: 2 },
          legs: [{ kind: "put", side: "buy", by: "strikes", value: 8 }, { kind: "put", side: "sell", by: "strikes", value: 3 }, { kind: "call", side: "sell", by: "premium", value: 250 }, { kind: "call", side: "buy", by: "strikes", value: 8 }],
          exits: { ladder: [25, 50], lock: { at: 0.5, floor: 0.2 }, exitHourUtc: 10, trailRestPct: 50, legBuyBackShare: 0.2, takeProfitOfCredit: 0.9, takeTrailPct: 5 },
        },
        FIGURES,
      ),
    );
    expect(trend.conditions).toEqual({ sma: { days: 50, side: "above" }, ivRank: { min: 60, lookbackDays: 90 }, weekdays: undefined });
    expect(trend.template).toMatchObject({ risk: "defined", legs: [{ kind: "put", side: "buy", k: -8 }, { kind: "put", side: "sell", k: -3 }, { kind: "call", side: "sell", k: 0, premium: 250 }, { kind: "call", side: "buy", k: 8 }] });
    expect(trend.clock).toMatchObject({ fromHourUtc: 0, toHourUtc: 24, cadence: "monthly", oncePerExpiry: true, window: "any time from 5:30 AM IST to 5:30 the next morning", moveSide: { hours: 24, pct: 2 }, ladder: [25, 50], lock: { at: 0.5, floor: 0.2 }, exitHourUtc: 10, trailRestPct: 50, legBuyBackShare: 0.2, takeProfitOfCredit: 0.9, takeTrailPct: 5 });
    expect(trend.evidence).toEqual({ claim: "$12.4 a day on 106 trades, 71 % of them positive, worst -$180 (USD, figures entered by hand).", source: FIGURES.basis });
    // chosen weekdays alone are a condition too; a weekly strategy has its one day on the clock
    expect(savedPlaybook(row({ ...DAILY, weekdays: [1, 3] })).conditions).toEqual({ sma: undefined, ivRank: undefined, weekdays: [1, 3] });
    expect(savedPlaybook(row({ ...DAILY, conditions: { ivRank: { max: 40, lookbackDays: 90 } } })).conditions).toMatchObject({ ivRank: { max: 40, lookbackDays: 90 } });
    expect(savedPlaybook(row({ ...DAILY, cadence: "weekly", weekdayUtc: 5 })).clock).toMatchObject({ weekdayUtc: 5, cadence: undefined });
  });

  it("HC-TR-274 who may use a published strategy: an admin, a named user, or a holder of one of its plans", () => {
    const user = { userId: "u1", role: "user" as const };
    expect(mayUseSaved({ audience: "admins", userIds: ["u1"], planIds: ["p1"] }, user, "p1")).toBe(false);
    expect(mayUseSaved({ audience: "admins", userIds: [], planIds: [] }, { userId: "a", role: "admin" }, null)).toBe(true);
    expect(mayUseSaved({ audience: "users", userIds: ["u1"], planIds: [] }, user, null)).toBe(true);
    expect(mayUseSaved({ audience: "users", userIds: ["u2"], planIds: [] }, user, "p1")).toBe(false);
    expect(mayUseSaved({ audience: "plans", userIds: [], planIds: ["p1"] }, user, "p1")).toBe(true);
    expect(mayUseSaved({ audience: "plans", userIds: [], planIds: ["p1"] }, user, "p2")).toBe(false);
    expect(mayUseSaved({ audience: "plans", userIds: [], planIds: ["p1"] }, user, null)).toBe(false);
  });
});

describe("HC-TR-275 the engine trades the published strategies beside the built-in ones", () => {
  const BUILT_IN = "evening-strangle-stop-2x";
  let saved: SavedStrategy;

  it("HC-TR-275 with nothing published the engine runs the built-in list alone and enters as it always has; a draft never trades", async () => {
    const draft = await create("Never published");
    expect((await savedCatalogue(t.db, new Date(W))).playbooks).toEqual([]);
    expect(await (await savedCatalogue(t.db, new Date(W))).mayUse(BUILT_IN, { userId: elite.id, role: "user" })).toBe(true);
    expect(await usableSavedIds(t.db, elite.id, new Date(W))).toEqual(new Set());
    // a draft's id in the settings is dropped, not refused, and never traded
    const view = await json<AutopilotView>(await put({ enabled: true, strategies: [{ playbookId: BUILT_IN, exit: "trail" }, { playbookId: draft.id, exit: "trail" }] }, elite.cookie));
    expect(view.settings.strategies).toEqual([{ playbookId: BUILT_IN, exit: "own" }]);
    const report = await pass(W);
    expect(report).toMatchObject({ entered: 1, failed: 0 });
    const trades = await tradesOf(elite.id);
    expect(trades.map((x) => x.autopilotPlaybookId)).toEqual([BUILT_IN]);
    expect(trades[0]).toMatchObject({ status: "paper", tradingMode: "paper", name: `${AUTOPILOT_PLAYBOOKS.find((p) => p.id === BUILT_IN)!.name} · Autopilot` });
    expect((await t.request(`${BASE}/${draft.id}`, { cookie: admin, method: "DELETE" })).status).toBe(200);
  });

  it("HC-TR-275 HC-TR-274 a published strategy is entered on paper for a trader whose plan has it, with its own exits; a trader without it is told so and is not entered", async () => {
    saved = await create("Evening strangle 1 %");
    await patch(saved.id, { backtest: FIGURES, audience: "plans", planIds: [SEED.plans.elite] });
    expect((await json<SavedStrategy>(await post(`${BASE}/${saved.id}/publish`))).stage).toBe("paper");
    const at = new Date(W);
    expect(await usableSavedIds(t.db, elite.id, at)).toEqual(new Set([saved.id]));
    expect(await usableSavedIds(t.db, free.id, at)).toEqual(new Set());
    expect(await usableSavedIds(t.db, await idOf(admin), at)).toEqual(new Set([saved.id]));
    expect(await usableSavedIds(t.db, "usr_nobody", at)).toEqual(new Set());
    // asked twice in a pass, the answer is the same (the plan is kept after the first read)
    const catalogue = await savedCatalogue(t.db, at);
    expect([await catalogue.mayUse(saved.id, { userId: elite.id, role: "user" }), await catalogue.mayUse(saved.id, { userId: elite.id, role: "user" })]).toEqual([true, true]);

    // its exits are its own whatever the card asks; a trader whose plan lacks it cannot switch it on; an unknown saved id is dropped
    const mine = await json<AutopilotView>(await put({ enabled: true, strategies: [{ playbookId: BUILT_IN, exit: "own" }, { playbookId: saved.id, exit: "trail" }, { playbookId: "sv_nope", exit: "trail" }] }, elite.cookie));
    expect(mine.settings.strategies).toEqual([{ playbookId: BUILT_IN, exit: "own" }, { playbookId: saved.id, exit: "own" }]);
    expect((await json<AutopilotView>(await put({ enabled: true, strategies: [{ playbookId: saved.id, exit: "own" }] }, free.cookie))).settings.strategies).toEqual([]);
    // a built-in id that does not exist is still refused by name
    expect((await put({ enabled: true, strategies: [{ playbookId: "nope", exit: "trail" }] }, elite.cookie)).status).toBe(400);
    // settings that still hold it after the plan changed: the engine says why and enters nothing
    await t.db.update(autopilotSettings).set({ enabled: true, strategies: [{ playbookId: saved.id, exit: "own" }] }).where(eq(autopilotSettings.userId, free.id));

    const report = await pass(W + MIN);
    expect(report).toMatchObject({ entered: 1, failed: 0 });
    const trade = (await tradesOf(elite.id)).find((x) => x.autopilotPlaybookId === saved.id)!;
    expect(trade).toMatchObject({ status: "paper", tradingMode: "paper", asset: "BTC", name: "Evening strangle 1 % · Autopilot", templateName: "Evening strangle 1 %" });
    // 1 % of 83,200 away, at the listed strikes nearest: 82,400 and 84,000, on tomorrow's expiry
    expect(trade.autopilotStructure).toBe("sell:put:82400:2026-09-26,sell:call:84000:2026-09-26");
    const rules = await t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, trade.id));
    expect(rules.map((r) => r.kind).sort()).toEqual(["leg_stop", "leg_stop", "leg_take", "leg_take", "target"]);
    expect(rules.every((r) => r.state === "armed")).toBe(true);
    expect(await tradesOf(free.id)).toEqual([]);
    expect(await lastLine(free.id)).toMatchObject({ kind: "skipped", playbookId: saved.id, reason: "This strategy is not available to you" });
    expect((await list()).find((x) => x.id === saved.id)!.traded).toBe(true);
    // HC-TR-279: the trader's view carries the strategy they may use, whole; a trader it is not for gets nothing of
    // it, not even when their settings and their log hold its id; a trader with none gets no list
    const mineNow = await json<AutopilotView>(await t.request("/v1/autopilot", { cookie: elite.cookie }));
    expect(mineNow.saved).toEqual([{ id: saved.id, version: 1, name: "Evening strangle 1 %", summary: "Sell both sides each evening.", definition: DAILY, backtest: FIGURES, usable: true }]);
    const notMine = await json<AutopilotView>(await t.request("/v1/autopilot", { cookie: free.cookie }));
    expect(notMine.settings.strategies).toEqual([{ playbookId: saved.id, exit: "own" }]);
    expect(notMine.runs.some((r) => r.playbookId === saved.id)).toBe(true);
    expect("saved" in notMine).toBe(false);
    const stranger = await t.signUp("saved-stranger@hapiecoin.test", { plan: "free" });
    expect("saved" in (await json<AutopilotView>(await t.request("/v1/autopilot", { cookie: stranger.cookie })))).toBe(false);
    // paper only: a trade a saved strategy opened is refused by Go live, alone and in a batch
    const single = await t.request(`/v1/strategies/${trade.id}/live/place`, { cookie: elite.cookie, json: { confirm: "LIVE", brokerId: SEED.brokerId, idempotencyKey: "saved-live-001", expected: {} } });
    expect(single.status).toBe(409);
    expect(JSON.stringify(await single.json())).toContain(AUTOPILOT_PAPER_ONLY_MESSAGE);
    const batch = await t.request("/v1/strategies/live/batch", { cookie: elite.cookie, json: { confirm: "LIVE", ids: [trade.id], brokerId: SEED.brokerId, idempotencyKey: "saved-live-002" } });
    expect(batch.status).toBe(409);
    // the check an entry makes with its own write: still published
    expect(await savedStillOnPaper(t.db, saved.id)).toBe(true);
    expect(await savedStillOnPaper(t.db, "sv_nope")).toBe(false);
  });

  it("HC-TR-275 a strategy withdrawn after the pass read it is not entered, and a row whose settings cannot be read is left out and said so; the others trade on", async () => {
    const late = await t.signUp("saved-late@hapiecoin.test");
    const lateId = await idOf(late.cookie);
    await put({ enabled: true, strategies: [{ playbookId: saved.id, exit: "own" }] }, late.cookie);
    // the pass reads the catalogue, then the strategy stops being published before the trade is written
    const warned: string[] = [];
    const logger = { info: () => undefined, warn: (_o: object, msg: string) => void warned.push(msg) };
    let armed = true;
    const withdrawing = new Proxy(t.db, {
      get(target, prop) {
        const value = Reflect.get(target, prop) as unknown;
        if (typeof value !== "function") return value;
        const bound = (value as (...a: unknown[]) => unknown).bind(target);
        if (prop !== "transaction") return bound;
        return async (...args: unknown[]) => {
          if (armed) {
            armed = false;
            await t.db.update(autopilotSavedStrategies).set({ stage: "backtested" }).where(eq(autopilotSavedStrategies.id, saved.id));
          }
          return bound(...args);
        };
      },
    });
    await snapshotOnce(t.deps, curveAt(W + 4 * MIN), () => W + 4 * MIN);
    const report = await runAutopilot({ db: withdrawing, logger, now: () => W + 5 * MIN }, ["delta_india"]);
    expect(report).toMatchObject({ entered: 0, failed: 0 });
    expect(await tradesOf(lateId)).toEqual([]);
    await t.db.update(autopilotSavedStrategies).set({ stage: "paper" }).where(eq(autopilotSavedStrategies.id, saved.id));

    // a row written past the schema
    await t.db.insert(autopilotSavedStrategies).values({ id: "sv_broken", familyId: "sv_broken", version: 1, name: "Broken", summary: "x", definition: { legs: [] } as never, stage: "paper" });
    const catalogue = await savedCatalogue(t.db, new Date(W));
    expect(catalogue.unreadable).toEqual(["sv_broken"]);
    expect(catalogue.playbooks.map((x) => x.id)).toEqual([saved.id]);
    await snapshotOnce(t.deps, curveAt(W + 6 * MIN), () => W + 6 * MIN);
    const after = await runAutopilot({ db: t.db, logger, now: () => W + 7 * MIN }, ["delta_india"]);
    expect(warned.filter((m) => m === "autopilot left out saved strategies whose settings cannot be read")).toHaveLength(1);
    expect(after.failed).toBe(0);
    expect((await tradesOf(lateId)).map((x) => x.autopilotPlaybookId)).toEqual([saved.id]);
    await t.db.delete(autopilotSavedStrategies).where(eq(autopilotSavedStrategies.id, "sv_broken"));
  });

  it("HC-TR-275 a failure to read the saved strategies is logged and the built-in ones still trade", async () => {
    const other = await t.signUp("saved-builtin@hapiecoin.test");
    const otherId = await idOf(other.cookie);
    await put({ enabled: true, strategies: [{ playbookId: BUILT_IN, exit: "own" }] }, other.cookie);
    const warned: string[] = [];
    const broken = new Proxy(t.db, {
      get(target, prop) {
        type Fn = (...a: unknown[]) => unknown;
        const value = Reflect.get(target, prop) as unknown;
        if (typeof value !== "function") return value;
        if (prop !== "select") return (value as Fn).bind(target) as unknown;
        return (...args: unknown[]) =>
          new Proxy((value as Fn).apply(target, args) as object, {
            get(q, p) {
              const v = Reflect.get(q, p) as unknown;
              if (typeof v !== "function") return v;
              if (p !== "from") return (v as Fn).bind(q) as unknown;
              return (table: unknown) => {
                if (table === autopilotSavedStrategies) throw new Error("saved strategies are unreadable");
                return (v as Fn).call(q, table);
              };
            },
          });
      },
    });
    await snapshotOnce(t.deps, curveAt(W + 2 * MIN), () => W + 2 * MIN);
    const report = await runAutopilot({ db: broken, logger: { info: () => undefined, warn: (_o, msg) => void warned.push(msg) }, now: () => W + 3 * MIN }, ["delta_india"]);
    expect(warned).toContain("autopilot could not read the saved strategies");
    expect(report.failed).toBe(1);
    expect((await tradesOf(otherId)).map((x) => x.autopilotPlaybookId)).toEqual([BUILT_IN]);
  });

  it("HC-TR-272 HC-TR-273 new settings on a strategy that has traded are its next version; publishing it retires the old one, whose open trade keeps its exits; a traded version is never changed or deleted", async () => {
    const wider = { ...DAILY, legs: [sell("put", 2), sell("call", 2)] };
    const v2 = await json<SavedStrategy>(await patch(saved.id, { definition: wider, name: "Evening strangle 2 %" }));
    expect(v2.id).not.toBe(saved.id);
    expect(v2).toMatchObject({ familyId: saved.id, version: 2, name: "Evening strangle 2 %", stage: "draft", backtest: null, backtestAt: null, traded: false, audience: "plans", planIds: [SEED.plans.elite] });
    const v3 = await json<SavedStrategy>(await patch(saved.id, { definition: wider, backtest: FIGURES }));
    expect(v3).toMatchObject({ familyId: saved.id, version: 3, stage: "backtested", backtest: FIGURES });
    expect((await t.db.select({ action: auditLog.action }).from(auditLog)).map((r) => r.action)).toContain("admin.autopilot_strategy.version");
    // the first version is as it was, on paper, with its trade
    expect((await list()).find((x) => x.id === saved.id)).toMatchObject({ version: 1, stage: "paper", traded: true, name: "Evening strangle 1 %" });
    const trade = (await tradesOf(elite.id)).find((x) => x.autopilotPlaybookId === saved.id)!;
    const rulesBefore = await t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, trade.id)).orderBy(asc(strategyRules.id));

    expect((await json<SavedStrategy>(await post(`${BASE}/${v3.id}/publish`))).stage).toBe("paper");
    // the traders who had the old version switched on and may use the new one have it, once; their other strategies
    // are as they were. A trader the new version is not for keeps the old id: the new one is not written into their
    // settings, and nothing of it reaches their view
    const carried = (await json<AutopilotView>(await t.request("/v1/autopilot", { cookie: elite.cookie }))).settings.strategies;
    expect(carried).toEqual([{ playbookId: BUILT_IN, exit: "own" }, { playbookId: v3.id, exit: "own" }]);
    const left = await json<AutopilotView>(await t.request("/v1/autopilot", { cookie: free.cookie }));
    expect(left.settings.strategies).toEqual([{ playbookId: saved.id, exit: "own" }]);
    expect("saved" in left).toBe(false);
    const old = (await list()).find((x) => x.id === saved.id)!;
    expect(old.stage).toBe("retired");
    expect(old.retiredAt).not.toBeNull();
    expect(await t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, trade.id)).orderBy(asc(strategyRules.id))).toEqual(rulesBefore);
    expect((await tradesOf(elite.id)).find((x) => x.id === trade.id)).toMatchObject({ status: "paper" });

    // retired: nothing changes it, it is not deleted, the engine no longer offers it, and saved settings let go of it
    expect(await why(await patch(saved.id, { name: "x" }))).toBe(SAVED_REFUSALS.retired);
    const kept = await t.request(`${BASE}/${saved.id}`, { cookie: admin, method: "DELETE" });
    expect(kept.status).toBe(409);
    expect(await why(kept)).toBe(SAVED_REFUSALS.traded);
    expect((await savedCatalogue(t.db, new Date(W))).playbooks.map((p) => p.id)).toEqual([v3.id]);
    // HC-TR-279: the retired version stays in the view of the trader who traded it, by name and without the switch
    const cards = (await json<AutopilotView>(await t.request("/v1/autopilot", { cookie: elite.cookie }))).saved!;
    expect(cards.map((c) => [c.id, c.version, c.usable])).toEqual([[saved.id, 1, false], [v3.id, 3, true]]);
    expect((await json<AutopilotView>(await put({ enabled: true, strategies: [{ playbookId: saved.id, exit: "own" }, { playbookId: v3.id, exit: "own" }] }, elite.cookie))).settings.strategies).toEqual([{ playbookId: v3.id, exit: "own" }]);

    // retire and delete
    expect(await why(await t.request(`${BASE}/${v3.id}`, { cookie: admin, method: "DELETE" }))).toBe(SAVED_REFUSALS.onPaper);
    expect(await why(await post(`${BASE}/${v2.id}/retire`))).toBe(SAVED_REFUSALS.notPaper);
    expect((await post(`${BASE}/sv_nope/retire`)).status).toBe(404);
    expect(await json<SavedStrategy>(await post(`${BASE}/${v3.id}/retire`))).toMatchObject({ stage: "retired", traded: false });
    expect((await savedCatalogue(t.db, new Date(W))).playbooks).toEqual([]);
    expect(await why(await post(`${BASE}/${v3.id}/publish`))).toBe(SAVED_REFUSALS.notDraft);
    expect((await t.request(`${BASE}/${v2.id}`, { cookie: admin, method: "DELETE" })).status).toBe(200);
    expect((await t.request(`${BASE}/${v2.id}`, { cookie: admin, method: "DELETE" })).status).toBe(404);
    expect((await t.request(`${BASE}/${v3.id}`, { cookie: elite.cookie, method: "DELETE" })).status).toBe(403);
    expect((await list()).map((x) => x.version).sort()).toEqual([1, 3]);
  });
});

describe("HC-TR-282 the plan of a saved strategy with whole-trade exits (ADR-143)", () => {
  const fees = { optionPct: 0.0001, optionCapOfPremium: 0.035, futurePct: 0.0005, gstPct: 0.18, settlementFee: true };
  const leg = (kind: "call" | "put", side: "buy" | "sell", value: number) => ({ kind, side, by: "strikes" as const, value });
  /** Entered two to thirty days out, so that an exit a day before expiry has a trade to close. */
  const LONGER = { ...DAILY, minDte: 2, maxDte: 30 };
  const SPREAD = { ...LONGER, legs: [leg("call", "buy", 0), leg("call", "sell", 2)] };
  const playbook = (definition: object) => savedPlaybook({ id: "sv_x", name: "X", summary: "s", definition: SavedDefinition.parse(definition), backtest: null });
  /** A bought call spread of 100 lots: 9.4 paid, 30.6 the most to make, 9.4 the most to lose. */
  const paid = (over: Partial<PlaybookProposal> = {}): PlaybookProposal => ({
    day: "2026-09-25",
    spot: 83_200,
    expiry: "2026-10-20",
    legs: [
      { asset: "BTC", kind: "call", side: "buy", strike: "83200", expiry: "2026-10-20", lots: 100, price: "400" },
      { asset: "BTC", kind: "call", side: "sell", strike: "83600", expiry: "2026-10-20", lots: 100, price: "306" },
    ],
    entryCost: 9.4,
    maxProfit: 30.6,
    maxLoss: -9.4,
    ...over,
  });
  const collected = (over: Partial<PlaybookProposal> = {}): PlaybookProposal => paid({ entryCost: -53.6, maxProfit: 53.6, maxLoss: -Infinity, ...over });
  const NONE = { legStop: null, trailRestPct: null, ladder: null, lock: null, exitHourUtc: null, takeTrailPct: null, legBuyBackAt: null, legBuyBackShare: null };
  const why = (p: ReturnType<typeof playbook>, proposal: PlaybookProposal, rule: typeof fees | null = null) => {
    expect(savedPlanFor(p, proposal, 0.001, rule)).toBeNull();
    return savedPlanRefusal(p, proposal, 0.001, rule);
  };

  it("HC-TR-282 without whole-trade exits it is the plan of a playbook entered by the clock, to the figure", () => {
    const p = playbook(DAILY);
    expect(savedPlanFor(p, collected(), 0.001, fees)).toEqual(clockPlanFor(p, collected(), 0.001, fees));
    expect(savedPlanRefusal(p, collected(), 0.001, fees)).toBeNull();
    expect(why(p, paid(), fees)).toBe("The premium collected is smaller than the fees"); // nothing collected: not this trade
  });

  it("HC-TR-282 a structure that pays premium: a target on the most it can make, after the fees of both fills; a stop on the most it can lose; an exit before expiry", () => {
    const p = playbook({ ...SPREAD, exits: { targetOfMax: 0.5, stopOfMax: 0.5, timeStopDte: 1, takeTrailPct: 10 } });
    expect(savedPlanFor(p, paid(), 0.001, null)).toEqual({ ...NONE, fees: 0, targetUsd: 15.3, stopUsd: 4.7, timeStopDte: 1, takeTrailPct: 10 });
    // with fees the level is half of the most it can make plus the fees: reaching it is that half after both fills
    const withFees = savedPlanFor(p, paid(), 0.001, fees)!;
    expect(withFees.fees).toBeGreaterThan(0);
    expect(withFees.targetUsd).toBeCloseTo(15.3 + withFees.fees, 8);
    expect(withFees.stopUsd).toBe(4.7);
    // the fees leave nothing of the trade above its target
    expect(why(p, paid({ maxProfit: 5 }), fees)).toBe("The fees are larger than what is left of the trade above its target");
    // the most it can make or lose is not a number, or a level rounds to nothing
    expect(why(p, paid({ maxProfit: Infinity }))).toBe("The most it can make is not a number above zero");
    expect(why(p, paid({ maxProfit: 0 }))).toBe("The most it can make is not a number above zero");
    expect(why(p, paid({ maxLoss: -Infinity }))).toBe("The most it can lose is not a number above zero");
    expect(why(p, paid({ maxProfit: 0.01 }))).toBe("Its profit level rounds to nothing");
    expect(why(p, paid({ maxLoss: -0.01 }))).toBe("Its stop rounds to nothing");
    // a target alone
    expect(savedPlanFor(playbook({ ...SPREAD, exits: { targetOfMax: 0.2 } }), paid(), 0.001, null)).toEqual({ ...NONE, fees: 0, targetUsd: expect.closeTo(6.12, 6) as number, stopUsd: null, timeStopDte: null });
    // the same structure a cent the other side of zero is the same trade: its target decides, not the sign of the premium
    expect(savedPlanFor(p, paid({ entryCost: -0.01 }), 0.001, fees)).not.toBeNull();
    expect(savedPlanFor(p, paid({ entryCost: 0.01 }), 0.001, fees)).not.toBeNull();
    // a structure that pays premium and names no target has nowhere to take its profit
    expect(why(playbook({ ...SPREAD, exits: { stopOfMax: 0.5 } }), paid())).toBe("It pays premium and has no target on the most it can make");
    // steps are measured on the premium collected: a structure that pays has none
    expect(why(playbook({ ...SPREAD, exits: { targetOfMax: 0.5, ladder: [25, 50] } }), paid())).toBe("The premium collected is smaller than the fees");
  });

  it("HC-TR-282 a structure that collects premium keeps its premium rules and may add the time exit and a stop on the whole trade", () => {
    const wings = { ...LONGER, legs: [{ kind: "put", side: "buy", by: "pct", value: 4 }, sell("put"), sell("call"), { kind: "call", side: "buy", by: "pct", value: 4 }] };
    const p = playbook({ ...wings, exits: { legStop: 2, takeProfitOfCredit: 0.5, timeStopDte: 1, stopOfMax: 0.5, lock: { at: 0.5, floor: 0.2 } } });
    const capped = collected({ maxLoss: -100 });
    expect(savedPlanFor(p, capped, 0.001, null)).toEqual({ ...NONE, fees: 0, targetUsd: 26.8, stopUsd: 50, timeStopDte: 1, legStop: 2, lock: { atUsd: 26.8, floorUsd: 10.72 } });
    // collects less than the fills cost; a profit level on a premium that was not collected; a floor that rounds to nothing
    expect(why(p, collected({ entryCost: -3.9, maxLoss: -100 }), fees)).toBe("The premium collected is smaller than the fees");
    expect(why(p, paid())).toBe("It pays premium and has no target on the most it can make");
    expect(why(p, collected({ entryCost: -0.04, maxLoss: -100 }))).toBe("Its floor rounds to nothing");
    // the time exit alone on a sold strangle: the plan of the clock with the exit added
    expect(savedPlanFor(playbook({ ...LONGER, exits: { legStop: 2, timeStopDte: 1 } }), collected(), 0.001, null)).toEqual({ ...NONE, fees: 0, targetUsd: null, stopUsd: null, timeStopDte: 1, legStop: 2 });
    // a level on the premium that rounds to nothing
    expect(why(playbook({ ...LONGER, exits: { takeProfitOfCredit: 0.5, timeStopDte: 1 } }), collected({ entryCost: -0.015 }))).toBe("Its profit level rounds to nothing");
    // a target on the most a sold strangle can make is a share of its premium, with a profit level on the premium refused beside it by the settings
    expect(savedPlanFor(playbook({ ...LONGER, exits: { targetOfMax: 0.5 } }), collected(), 0.001, null)).toMatchObject({ targetUsd: 26.8, stopUsd: null });
  });
});

describe("HC-TR-283 the engine enters a published bought structure on paper", () => {
  const leg = (kind: "call" | "put", side: "buy" | "sell", value: number, over: object = {}) => ({ kind, side, by: "strikes", value, ...over });
  /** Two to thirty days out: on the test chain that is the expiry of 20 October. */
  const LONGER = { ...DAILY, minDte: 2, maxDte: 30 };
  const publishFor = async (name: string, definition: object) => {
    const made = await create(name, definition);
    await patch(made.id, { backtest: FIGURES, audience: "plans", planIds: [SEED.plans.elite] });
    expect((await json<SavedStrategy>(await post(`${BASE}/${made.id}/publish`))).stage).toBe("paper");
    return made;
  };
  const entryOf = async (strategyId: string) => (await t.db.select().from(autopilotRuns).where(eq(autopilotRuns.strategyId, strategyId)))[0]!;

  it("HC-TR-283 a bought call spread is entered with its target (after fees), its stop and its exit before expiry as rules, to the cent; a built-in strategy beside it is entered as before", async () => {
    const made = await publishFor("Evening call spread", { ...LONGER, legs: [leg("call", "buy", 0), leg("call", "sell", 2)], exits: { targetOfMax: 0.5, stopOfMax: 0.5, timeStopDte: 1 } });
    const buyer = await t.signUp("saved-bought@hapiecoin.test");
    const buyerId = await idOf(buyer.cookie);
    const builtIn = "evening-strangle-stop-3x";
    expect((await json<AutopilotView>(await put({ enabled: true, strategies: [{ playbookId: made.id, exit: "own" }, { playbookId: builtIn, exit: "own" }] }, buyer.cookie))).settings.strategies).toHaveLength(2);
    const report = await pass(W + 20 * MIN);
    expect(report.failed).toBe(0);
    const trades = await tradesOf(buyerId);
    expect(trades.map((x) => x.autopilotPlaybookId).sort()).toEqual([builtIn, made.id].sort());
    // the built-in strangle beside it: on the next expiry, with its stop on each sold option and nothing else
    const strangle = trades.find((x) => x.autopilotPlaybookId === builtIn)!;
    expect((await t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, strangle.id))).map((r) => `${r.kind}:${r.value}`).sort()).toEqual(["leg_stop:3", "leg_stop:3"]);
    const trade = trades.find((x) => x.autopilotPlaybookId === made.id)!;
    expect(trade).toMatchObject({ status: "paper", tradingMode: "paper", name: "Evening call spread · Autopilot" });
    // the listed strike at the spot (83,200) bought, two listed strikes out (83,600) sold, on the first expiry two days out
    expect(trade.autopilotStructure).toBe("buy:call:83200:2026-10-20,sell:call:83600:2026-10-20");
    // marks 400.0 and 306.4 on 100 lots of 0.001: 9.36 paid, 30.64 the most to make, 9.36 the most to lose
    const detail = (await entryOf(trade.id)).detail;
    expect(detail).toMatchObject({ entryCost: "9.36", maxProfit: "30.64", maxLoss: "-9.36" });
    const fee = Number(detail.fees);
    expect(fee).toBeGreaterThan(0);
    const rules = await t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, trade.id));
    expect(rules.map((r) => `${r.kind}:${r.trigger}`).sort()).toEqual(["stop:money", "target:money", "time:dte"]);
    expect(rules.every((r) => r.state === "armed")).toBe(true);
    // half of the most it can make, plus the fees; a loss of half of the most it can lose; a day before expiry
    expect(rules.find((r) => r.kind === "target")).toMatchObject({ thresholdUsd: (15.32 + fee).toFixed(2), trailTrigger: null });
    expect(rules.find((r) => r.kind === "stop")).toMatchObject({ thresholdUsd: "-4.68" });
    expect(rules.find((r) => r.kind === "time")).toMatchObject({ value: "1" });
    // paper only: Go live refuses it
    const live = await t.request(`/v1/strategies/${trade.id}/live/place`, { cookie: buyer.cookie, json: { confirm: "LIVE", brokerId: SEED.brokerId, idempotencyKey: "saved-bought-live-1", expected: {} } });
    expect(live.status).toBe(409);
  });

  it("HC-TR-283 a butterfly with a leg in the money and a double leg at the money is entered with its lots and a trailing target; a structure with nothing left above its target says so in the log", async () => {
    const fly = await publishFor("Evening butterfly", { ...LONGER, legs: [leg("call", "buy", 2, { itm: true }), leg("call", "sell", 0, { ratio: 2 }), leg("call", "buy", 2)], exits: { targetOfMax: 0.3, takeTrailPct: 10 } });
    const thin = await publishFor("Thin spread", { ...LONGER, legs: [leg("call", "buy", 0), leg("call", "sell", 2)], exits: { targetOfMax: 0.99 } });
    const buyer = await t.signUp("saved-fly@hapiecoin.test");
    const buyerId = await idOf(buyer.cookie);
    await put({ enabled: true, strategies: [{ playbookId: fly.id, exit: "own" }, { playbookId: thin.id, exit: "own" }] }, buyer.cookie);
    const report = await pass(W + 24 * MIN);
    expect(report.failed).toBe(0);
    const trades = await tradesOf(buyerId);
    expect(trades.map((x) => x.autopilotPlaybookId)).toEqual([fly.id]);
    const trade = trades[0]!;
    expect(trade.autopilotStructure).toBe("buy:call:82800:2026-10-20,sell:call:83200:2026-10-20,buy:call:83600:2026-10-20");
    const legs = await t.db.select().from(strategyLegs).where(eq(strategyLegs.strategyId, trade.id)).orderBy(asc(strategyLegs.position));
    expect(legs.map((l) => `${l.side}:${l.strike}:${l.lots}`)).toEqual(["buy:82800:100", "sell:83200:200", "buy:83600:100"]);
    // marks 706.4, 400.0 twice and 306.4: 21.28 paid, 18.72 the most to make
    const detail = (await entryOf(trade.id)).detail;
    expect(detail).toMatchObject({ entryCost: "21.28", maxProfit: "18.72", takeTrailPct: 10 });
    const rules = await t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, trade.id));
    expect(rules.map((r) => r.kind)).toEqual(["target"]);
    // a third of the most it can make, plus the fees, and from there a trail that gives back a tenth
    expect(rules[0]).toMatchObject({ thresholdUsd: (18.72 * 0.3 + Number(detail.fees)).toFixed(2), trailTrigger: "pct", trailValue: "10" });
    // the spread whose target is 99 % of the most it can make: the fees leave nothing above it
    expect((await t.db.select().from(autopilotRuns).where(eq(autopilotRuns.userId, buyerId))).find((r) => r.playbookId === thin.id)).toMatchObject({ kind: "skipped", reason: "The fees are larger than what is left of the trade above its target" });
  });
});
