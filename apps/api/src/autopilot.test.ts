// Autopilot (ADR-108; HC-TR-216, HC-TR-217, HC-TR-218): on the marks of the newest snapshot the engine opens a PAPER
// strategy for every trader who switched an entering playbook on, with its exits armed and a log line; one open trade
// per trader, playbook, venue and asset; a cool-down after a trade ends; a better entry while one is open is noted;
// every reason not to enter is logged once. Nothing here places anything on a venue.
import type { MarginParams } from "./margin.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUTOPILOT_PLAYBOOKS, CLOCK_PLAYBOOKS, PLAYBOOKS, WEEKLY_PLAYBOOKS, type PlaybookProposal, autopilotPlaybookById, playbookById } from "@hapiecoin/pricing";
import { type Strategy, toDecimal, AUTOPILOT_COOLDOWN_MINUTES, AUTOPILOT_KEEP_MESSAGE, AUTOPILOT_MAX_STRATEGIES, MAX_STRATEGY_NAME, StrategyList, AUTOPILOT_PAPER_ONLY_MESSAGE, AUTOPILOT_RUNS_RETENTION_DAYS, type AutopilotResults, type AutopilotRunDetail, type AutopilotView, type Instrument, type Quote, type SubscriptionView } from "@hapiecoin/schema";
import { and, asc, eq } from "drizzle-orm";
import { AUTOPILOT_MAX_MARK_AGE_MS, AUTOPILOT_NAME_SUFFIX, type AutopilotDeps, betterEntry, clockPlanFor, inWindow, liveDay, nextHourUtc, planFor, runAutopilot, SPOT_NEAR_MS, spotNear, skipText, structureKey } from "./autopilot.js";
import { clearEodMemo } from "./chain-eod.js";
import { autopilotRuns, instrumentMarks, ivSnapshots, plans, strategies, subscriptions, strategyLegs, strategyRules, userSettings, users } from "./db/schema.js";
import { SEED } from "./db/seed.js";
import { type RulesTickSource, evaluateRules } from "./rules-engine.js";
import { settleExpired } from "./settlement.js";
import { snapshotOnce, type MarketSource } from "./iv-snapshot.js";
import { createTestApp, type TestApp } from "./test-support/harness.js";

let t: TestApp;
let cookie: string;
let userId: string;
const EMAIL = "autopilot@hapiecoin.test";
beforeAll(async () => {
  t = await createTestApp();
  cookie = (await t.signUp(EMAIL)).cookie;
  userId = ((await (await t.request("/v1/me", { cookie })).json()) as { id: string }).id;
});
afterAll(() => t.close());

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN = 60_000;
const T0 = Date.UTC(2026, 8, 1, 12, 0, 0);
/** The newest pass: day 8 at 10:00 UTC, two hours before the settlement write, so day 8 has marks and no recorded chain. */
const LIVE = T0 + 8 * DAY - 2 * HOUR;
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
function inst(symbol: string, kind: "call" | "put", strike: number, expiry: string): Instrument {
  return { id: `delta_india:${symbol}`, venue: "delta_india", symbol, underlying: "BTC", kind, strike: String(strike), expiry, contractSize: "0.001", tickSize: "0.1", quoteCurrency: "USD", venueProductId: 1, isActive: true };
}
/** Ten strikes on two expiries. `timeValue` is what every option carries over its intrinsic value. */
const STRIKES = [79_000, 80_000, 81_000, 82_000, 83_000, 84_000, 85_000, 86_000, 87_000, 88_000];
function sourceAt(ts: number, spot: number, timeValue = 400, strikes: readonly number[] = STRIKES): MarketSource {
  const expiries = ["2026-09-15", "2026-10-20"];
  const products: Instrument[] = [];
  const quotes: Quote[] = [];
  for (const e of expiries)
    for (const k of strikes) {
      const code = e.slice(8, 10) + e.slice(5, 7) + e.slice(2, 4);
      const c = `C-BTC-${k}-${code}`;
      const p = `P-BTC-${k}-${code}`;
      products.push(inst(c, "call", k, e), inst(p, "put", k, e));
      quotes.push({ instrumentId: `delta_india:${c}`, ts, mark: String(Math.max(spot - k, 0) + timeValue), oi: "1", spot: String(spot), markIv: 0.4 }, { instrumentId: `delta_india:${p}`, ts, mark: String(Math.max(k - spot, 0) + timeValue), oi: "1", spot: String(spot), markIv: 0.4 });
    }
  return { venue: "delta_india", products: () => Promise.resolve(products), tickers: (u) => Promise.resolve(u === "BTC" ? quotes : []) };
}
const spotOn = (dayIndex: number) => 80_000 + dayIndex * 400;
// the ladder of ADR-110 is still built and tested: these tests ask for it (the product default is one trade, ADR-112)
const deps = (nowMs: number, over: Partial<AutopilotDeps> = {}): AutopilotDeps => ({ db: t.db, logger: t.deps.logger, now: () => nowMs, maxOpen: LADDER, ...over });
const LADDER = 5;
const put = (body: unknown, c = cookie) => t.request("/v1/autopilot", { cookie: c, method: "PUT", json: body });
const view = async (c = cookie) => json<AutopilotView>(await t.request("/v1/autopilot", { cookie: c }));
const mine = () => t.db.select().from(strategies).where(eq(strategies.userId, userId));
const BUTTERFLY = "pin-butterfly"; // no entry condition, 1 day out: enters on any chain it fits

describe("HC-TR-216 the trader's Autopilot settings", () => {
  it("HC-TR-216 off and empty by default; saves the switch and the playbooks; refuses the control, an unknown playbook and a repeat; needs a session", async () => {
    expect((await t.request("/v1/autopilot")).status).toBe(401);
    expect((await t.request("/v1/autopilot", { method: "PUT", json: { enabled: true, strategies: [] } })).status).toBe(401);
    expect(await view()).toEqual({ settings: { enabled: false, strategies: [] }, runs: [] });
    const control = PLAYBOOKS.find((p) => p.control)!;
    const refused = await put({ enabled: true, strategies: [{ playbookId: control.id, exit: "trail" }] });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(await refused.json())).toContain(`${control.id} is not a playbook Autopilot can trade`);
    expect((await put({ enabled: true, strategies: [{ playbookId: "nope", exit: "trail" }] })).status).toBe(400);
    expect((await put({ enabled: true, strategies: [{ playbookId: BUTTERFLY, exit: "trail" }, { playbookId: BUTTERFLY, exit: "target" }] })).status).toBe(400);
    expect((await put({ enabled: true, strategies: [{ playbookId: BUTTERFLY, exit: "sometimes" }] })).status).toBe(400);
    const saved = await json<AutopilotView>(await put({ enabled: false, strategies: [{ playbookId: BUTTERFLY, exit: "trail" }] }));
    expect(saved.settings).toEqual({ enabled: false, strategies: [{ playbookId: BUTTERFLY, exit: "trail" }] });
    expect((await view()).settings).toEqual(saved.settings);
  });
});

describe("HC-TR-217 the pieces an entry is decided on", () => {
  const butterfly = playbookById(BUTTERFLY)!;
  const proposal = (over: Partial<PlaybookProposal> = {}): PlaybookProposal => ({
    day: "2026-09-09",
    spot: 80_000,
    expiry: "2026-09-15",
    legs: [
      { asset: "BTC", kind: "call", side: "buy", strike: "79000", expiry: "2026-09-15", lots: 10, price: "1400" },
      { asset: "BTC", kind: "call", side: "sell", strike: "80000", expiry: "2026-09-15", lots: 10, price: "400" },
    ],
    entryCost: 10,
    maxProfit: 0,
    maxLoss: -10, // the expiry extremes give the loss as a negative P&L
    ...over,
  });
  const rule = { optionPct: 0.0001, optionCapOfPremium: 0.035, futurePct: 0.0005, gstPct: 0.18, settlementFee: true };

  it("HC-TR-217 the target is ten per cent of the most the trade can make plus the entry and exit fees; the stop and the time exit come from the playbook", () => {
    // two legs of 10 lots x 0.001: notional 800 each, fee 0.08 each (far under the 3.5 % premium cap), 18 % GST
    const p = planFor({ ...butterfly, exits: { stopPct: 0.5, timeStopDte: 2 } }, proposal({ maxProfit: 40 }), 0.001, rule)!;
    expect(p.fees).toBeCloseTo(2 * 2 * 0.08 * 1.18, 10);
    expect(p.targetUsd).toBeCloseTo(4 + p.fees, 10);
    expect(p.stopUsd).toBe(5);
    expect(p.timeStopDte).toBe(2);
    // no fee rule on the venue: no fees; a playbook with no stop and no time exit arms neither
    expect(planFor({ ...butterfly, exits: undefined }, proposal({ maxProfit: 40 }), 0.001, null)).toEqual({ fees: 0, targetUsd: 4, stopUsd: null, timeStopDte: null, legStop: null, trailRestPct: null, ladder: null, lock: null, exitHourUtc: null, takeTrailPct: null, legBuyBackAt: null, legBuyBackShare: null });
  });

  it("HC-TR-217 no plan when the fees eat the trade (small premiums close to expiry) or the structure has no defined maximum", () => {
    expect(planFor(butterfly, proposal({ maxProfit: 0.4 }), 0.001, rule)).toBeNull(); // 0.04 + 0.38 of fees is not below 0.40
    expect(planFor(butterfly, proposal({ maxProfit: Infinity }), 0.001, rule)).toBeNull();
    expect(planFor(butterfly, proposal({ maxProfit: 40, maxLoss: -Infinity }), 0.001, rule)).toBeNull();
    expect(planFor(butterfly, proposal({ maxProfit: 0 }), 0.001, rule)).toBeNull();
    expect(planFor(butterfly, proposal({ maxProfit: 40, maxLoss: 0 }), 0.001, rule)).toBeNull();
    // a level that rounds to nothing would fire on the first tick
    expect(planFor(butterfly, proposal({ maxProfit: 0.05 }), 0.001, null)).toBeNull();
    expect(planFor({ ...butterfly, exits: { stopPct: 0.0001 } }, proposal({ maxProfit: 40 }), 0.001, null)).toBeNull();
  });

  it("HC-TR-218 a better entry is ten per cent more credit or ten per cent less debit than the open trade's", () => {
    expect(betterEntry(-110, -100)).toBe(true);
    expect(betterEntry(-109, -100)).toBe(false);
    expect(betterEntry(90, 100)).toBe(true);
    expect(betterEntry(91, 100)).toBe(false);
    expect(betterEntry(-5, 0)).toBe(false);
    expect(betterEntry(0.04, 0.04)).toBe(false); // a few cents: the same price is not a better one
    expect(betterEntry(0.03, 0.04)).toBe(true);
    expect(skipText("noSignal")).toBe("Its entry conditions are not met");
  });
});

describe("HC-TR-217 the entry engine", () => {
  it("HC-TR-217 does nothing while nobody has Autopilot on; a pass without a fresh snapshot is a logged reason, written once", async () => {
    clearEodMemo();
    expect(await runAutopilot(deps(LIVE), ["delta_india"])).toEqual({ entered: 0, skipped: 0, noted: 0, failed: 0 });
    await put({ enabled: true, strategies: [{ playbookId: BUTTERFLY, exit: "trail" }, { playbookId: "trend-calls", exit: "target" }, { playbookId: "covered-call", exit: "target" }] });
    expect(await liveDay(t.db, "delta_india", "BTC", LIVE, AUTOPILOT_MAX_MARK_AGE_MS)).toBeNull(); // no marks yet
    // three playbooks on the two underlyings Autopilot trades
    expect(await runAutopilot(deps(LIVE), ["delta_india"])).toEqual({ entered: 0, skipped: 6, noted: 0, failed: 0 });
    expect(await runAutopilot(deps(LIVE + MIN), ["delta_india"])).toEqual({ entered: 0, skipped: 0, noted: 0, failed: 0 });
    const runs = (await view()).runs;
    expect(runs).toHaveLength(6);
    expect(new Set(runs.map((r) => r.reason))).toEqual(new Set(["No fresh prices: the newest market snapshot is missing or too old"]));
    expect(await mine()).toHaveLength(0);
  });

  it("HC-TR-217 enters the playbook whose plan enters, on paper at the snapshot's marks with its exits armed; the others say why not; nothing twice", async () => {
    clearEodMemo();
    for (let d = 0; d <= 7; d++) await snapshotOnce(t.deps, sourceAt(T0 + d * DAY + HOUR, spotOn(d)), () => T0 + d * DAY + HOUR);
    await snapshotOnce(t.deps, sourceAt(LIVE, spotOn(8)), () => LIVE);
    const day = (await liveDay(t.db, "delta_india", "BTC", LIVE + MIN, AUTOPILOT_MAX_MARK_AGE_MS))!;
    expect(day).toMatchObject({ day: "2026-09-09", spot: spotOn(8), source: "snapshot" });
    expect(day.expiries.map((e) => e.expiry)).toEqual(["2026-09-15", "2026-10-20"]);
    expect(day.expiries[0]!.rows.map((r) => r.strike)).toEqual([79_000, 80_000, 81_000, 82_000, 83_000, 84_000, 85_000, 86_000, 87_000, 88_000]);
    expect(await liveDay(t.db, "delta_india", "BTC", LIVE + AUTOPILOT_MAX_MARK_AGE_MS + 1, AUTOPILOT_MAX_MARK_AGE_MS)).toBeNull(); // too old to enter on

    const pass = await runAutopilot(deps(LIVE + MIN), ["delta_india"]);
    expect(pass).toEqual({ entered: 1, skipped: 2, noted: 0, failed: 0 });
    const [s] = await mine();
    expect(s).toMatchObject({ name: `${playbookById(BUTTERFLY)!.name} · Autopilot`, status: "paper", tradingMode: "paper", asset: "BTC", venue: "delta_india", autopilotPlaybookId: BUTTERFLY, tags: ["autopilot"], realizedPnl: "0" });
    expect(s!.startedAt!.getTime()).toBe(LIVE + MIN);
    expect(s!.brokerId).not.toBeNull();
    const legs = await t.db.select().from(strategyLegs).where(eq(strategyLegs.strategyId, s!.id));
    expect(legs).toHaveLength(3);
    for (const l of legs) {
      expect(l).toMatchObject({ kind: "call", status: "open", expiry: "2026-09-15", entryPrice: l.price });
      expect(l.symbol).toBe(`C-BTC-${l.strike}-150926`);
      // the fill is that strike's mark in the snapshot: intrinsic value plus 400
      expect(Number(l.price)).toBe(Math.max(spotOn(8) - Number(l.strike), 0) + 400);
    }
    const entered = (await view()).runs.find((r) => r.kind === "entered")!;
    expect(entered).toMatchObject({ playbookId: BUTTERFLY, venue: "delta_india", asset: "BTC", strategyId: s!.id, reason: "Its entry conditions were met on the latest prices" });
    expect(entered.detail).toMatchObject({ spot: "83200", expiry: "2026-09-15", dte: 6, exit: "trail", stopUsd: null });
    expect(entered.detail.legs).toHaveLength(3);
    expect(Number(entered.detail.capital)).toBe(-Number(entered.detail.maxLoss)); // the capital is the most it can lose
    // ten per cent of the most it can make, plus both fees
    const d = entered.detail;
    expect(Number(d.targetUsd)).toBeCloseTo(Number(d.maxProfit) * 0.1 + Number(d.fees), 1);
    expect(Number(d.fees)).toBeGreaterThan(0);
    const rules = await t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, s!.id));
    expect(rules).toHaveLength(1); // the butterfly's playbook has no stop and no time exit: its risk is the debit paid
    expect(rules[0]).toMatchObject({ kind: "target", trigger: "money", value: d.targetUsd, thresholdUsd: d.targetUsd, trailTrigger: "pct", trailValue: "10", state: "armed", scope: "strategy", channels: ["push", "telegram"] });

    const reasons = new Map((await view()).runs.filter((r) => r.asset === "BTC" && r.kind === "skipped" && r.reason !== "No fresh prices: the newest market snapshot is missing or too old").map((r) => [r.playbookId, r.reason]));
    expect(reasons.get("trend-calls")).toBe("Its entry conditions are not met"); // eight recorded days are not a 50-day average
    expect(reasons.get("covered-call")).toBe("A futures leg needs a margin figure Autopilot does not have yet");

    // the next pass: the trade is open, the reasons have not changed
    expect(await runAutopilot(deps(LIVE + 2 * MIN), ["delta_india"])).toEqual({ entered: 0, skipped: 0, noted: 0, failed: 0 });
    expect(await mine()).toHaveLength(1);
  });

  it("HC-TR-217 Autopilot's paper trades do not use the trader's monthly paper allowance", async () => {
    const sub = await json<SubscriptionView>(await t.request("/v1/subscription", { cookie }));
    expect(sub.entitlements.find((e) => e.key === "paper_trading")!.used).toBe(0);
  });

  it("HC-TR-218 while a trade is open, a clearly better price for the same structure is noted, once per cool-down", async () => {
    // the same spot with far less time value in every option: the butterfly's debit does not move, so nothing is noted
    await snapshotOnce(t.deps, sourceAt(LIVE + 5 * MIN, spotOn(8), 100), () => LIVE + 5 * MIN);
    expect((await runAutopilot(deps(LIVE + 6 * MIN), ["delta_india"])).noted).toBe(0);
    // the open trade's entry is rewritten dearer in the log, as if the market had since become cheaper by a quarter
    const [entry] = await t.db.select().from(autopilotRuns).where(and(eq(autopilotRuns.userId, userId), eq(autopilotRuns.kind, "entered")));
    const fresh = Number(entry!.detail.entryCost);
    expect(fresh).toBeGreaterThan(0); // a debit structure
    await t.db.update(autopilotRuns).set({ detail: { ...entry!.detail, entryCost: (fresh * 1.25).toFixed(2) } }).where(eq(autopilotRuns.id, entry!.id));
    expect((await runAutopilot(deps(LIVE + 7 * MIN), ["delta_india"])).noted).toBe(1);
    expect((await runAutopilot(deps(LIVE + 8 * MIN), ["delta_india"])).noted).toBe(0);
    const note = (await view()).runs.find((r) => r.kind === "noted")!;
    expect(note).toMatchObject({ playbookId: BUTTERFLY, strategyId: entry!.strategyId, reason: "A better entry than the open trade's: not taken, these strikes are held already" });
    expect(Number(note.detail.openEntryCost)).toBe(fresh * 1.25);
    expect(await mine()).toHaveLength(1);
  });

  it("HC-TR-217 after the trade ends the playbook waits the cool-down, says so once, then enters again with the trader's other exit style", async () => {
    const [open] = await mine();
    const closedAt = LIVE + 9 * MIN;
    await t.db.update(strategies).set({ status: "archived", closedAt: new Date(closedAt), closeReason: "target" }).where(eq(strategies.id, open!.id));
    await put({ enabled: true, strategies: [{ playbookId: BUTTERFLY, exit: "target" }] });
    await snapshotOnce(t.deps, sourceAt(LIVE + 10 * MIN, spotOn(8)), () => LIVE + 10 * MIN);
    expect(await runAutopilot(deps(LIVE + 11 * MIN), ["delta_india"])).toEqual({ entered: 0, skipped: 1, noted: 0, failed: 0 });
    expect((await view()).runs[0]).toMatchObject({ kind: "skipped", reason: `Waiting ${AUTOPILOT_COOLDOWN_MINUTES} minutes after its last trade` });
    expect(await runAutopilot(deps(LIVE + 12 * MIN), ["delta_india"])).toEqual({ entered: 0, skipped: 0, noted: 0, failed: 0 });
    // one minute short of the cool-down, then at it
    await snapshotOnce(t.deps, sourceAt(closedAt + AUTOPILOT_COOLDOWN_MINUTES * MIN - MIN, spotOn(8)), () => closedAt + AUTOPILOT_COOLDOWN_MINUTES * MIN - MIN);
    expect((await runAutopilot(deps(closedAt + AUTOPILOT_COOLDOWN_MINUTES * MIN - 1), ["delta_india"])).entered).toBe(0);
    expect((await runAutopilot(deps(closedAt + AUTOPILOT_COOLDOWN_MINUTES * MIN), ["delta_india"])).entered).toBe(1);
    const all = await mine();
    expect(all).toHaveLength(2);
    const second = all.find((x) => x.status === "paper")!;
    const rules = await t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, second.id));
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ kind: "target", trailTrigger: null, trailValue: null }); // closes at the level, no trail
    expect((await view()).runs[0]!.detail.exit).toBe("target");
  });

  it("HC-TR-217 a trader who switches Autopilot off, or whose account is deactivated, gets no entry; one trader's failure does not stop the pass", async () => {
    const [open] = await t.db.select().from(strategies).where(and(eq(strategies.userId, userId), eq(strategies.status, "paper")));
    const later = LIVE + 3 * HOUR;
    await t.db.update(strategies).set({ status: "archived", closedAt: new Date(LIVE + HOUR) }).where(eq(strategies.id, open!.id));
    await snapshotOnce(t.deps, sourceAt(later, spotOn(8)), () => later);
    await t.db.update(users).set({ active: false }).where(eq(users.id, userId));
    expect(await runAutopilot(deps(later + MIN), ["delta_india"])).toEqual({ entered: 0, skipped: 0, noted: 0, failed: 0 });
    await t.db.update(users).set({ active: true }).where(eq(users.id, userId));
    await put({ enabled: false, strategies: [{ playbookId: BUTTERFLY, exit: "trail" }] });
    expect(await runAutopilot(deps(later + MIN), ["delta_india"])).toEqual({ entered: 0, skipped: 0, noted: 0, failed: 0 });
    // two traders on the same playbook; the first write of the pass fails: that trader is logged and left, the other enters
    await put({ enabled: true, strategies: [{ playbookId: BUTTERFLY, exit: "trail" }] });
    const other = await t.signUp("autopilot-2@hapiecoin.test");
    await put({ enabled: true, strategies: [{ playbookId: BUTTERFLY, exit: "target" }] }, other.cookie);
    let thrown = false;
    const flaky = new Proxy(t.db, {
      get(target, prop) {
        if (prop === "transaction" && !thrown) {
          thrown = true;
          return () => Promise.reject(new Error("the database said no"));
        }
        const v: unknown = Reflect.get(target, prop);
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    const warned: object[] = [];
    const pass = await runAutopilot(deps(later + MIN, { db: flaky, logger: { info: () => undefined, warn: (o) => void warned.push(o) } }), ["delta_india"]);
    expect(pass).toMatchObject({ entered: 1, failed: 1 });
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatchObject({ playbookId: BUTTERFLY, asset: "BTC", reason: "the database said no" });
    // the trader left out enters on the next pass; nobody holds two
    expect((await runAutopilot(deps(later + 2 * MIN), ["delta_india"])).entered).toBe(1);
    const openNow = await t.db.select({ userId: strategies.userId }).from(strategies).where(and(eq(strategies.autopilotPlaybookId, BUTTERFLY), eq(strategies.status, "paper")));
    expect(openNow).toHaveLength(2);
    expect(new Set(openNow.map((x) => x.userId)).size).toBe(2);
  });

  it("HC-TR-217 a leg with no price, a venue with no paper exchange, and a snapshot with no spot or no options are reasons, never a trade", async () => {
    // every option at its intrinsic value: the butterfly's far wing is worth nothing, so there is no price to enter it at
    const [open] = await t.db.select().from(strategies).where(and(eq(strategies.userId, userId), eq(strategies.status, "paper")));
    const later = LIVE + 6 * HOUR;
    await t.db.update(strategies).set({ status: "archived", closedAt: new Date(later - HOUR) }).where(eq(strategies.id, open!.id));
    await snapshotOnce(t.deps, sourceAt(later, spotOn(8), 0), () => later);
    const pass = await runAutopilot(deps(later + MIN), ["delta_india"]);
    expect(pass).toMatchObject({ entered: 0, failed: 0 });
    expect((await view()).runs[0]).toMatchObject({ kind: "skipped", playbookId: BUTTERFLY, asset: "BTC", reason: "A leg of the structure has no price" });
    // Deribit has no paper exchange row: a reason per switched-on playbook and underlying
    const deribit = await runAutopilot(deps(later + 2 * MIN), ["deribit"]);
    expect(deribit).toMatchObject({ entered: 0, failed: 0 });
    expect((await view()).runs.filter((r) => r.venue === "deribit").map((r) => r.reason)).toEqual(["No paper exchange is set up for this venue", "No paper exchange is set up for this venue"]);
    // ETH: marks of a pass with no spot stored for it, then with a spot but nothing that is an option
    const ts = new Date(later);
    await t.db.insert(instrumentMarks).values({ venue: "delta_india", asset: "ETH", symbol: "ETHUSD", ts, mark: "3000", markIv: null });
    expect(await liveDay(t.db, "delta_india", "ETH", later + MIN, AUTOPILOT_MAX_MARK_AGE_MS)).toBeNull();
    await t.db.insert(ivSnapshots).values({ venue: "delta_india", asset: "ETH", expiry: "2026-09-15", ts, atmIv: "0.5", spot: "3000", atmStrike: "3000", front: true });
    expect(await liveDay(t.db, "delta_india", "ETH", later + MIN, AUTOPILOT_MAX_MARK_AGE_MS)).toBeNull();
  });

  it("HC-TR-217 a playbook with a stop and a time exit arms all three rules; a structure with nothing left to make is a reason", async () => {
    // fifty-two earlier recorded days of a rising spot give the trend playbook its 50-day average
    for (let d = -52; d <= -1; d++) await snapshotOnce(t.deps, sourceAt(T0 + d * DAY + HOUR, spotOn(d)), () => T0 + d * DAY + HOUR);
    const later = LIVE + 9 * HOUR;
    await snapshotOnce(t.deps, sourceAt(later, spotOn(8)), () => later);
    await put({ enabled: true, strategies: [{ playbookId: "trend-calls", exit: "target" }] });
    expect((await runAutopilot(deps(later + MIN), ["delta_india"])).entered).toBe(1);
    const [s] = await t.db.select().from(strategies).where(and(eq(strategies.userId, userId), eq(strategies.autopilotPlaybookId, "trend-calls")));
    expect(s).toMatchObject({ status: "paper", name: `${playbookById("trend-calls")!.name} · Autopilot`, templateName: "Bull Call Spread" });
    const entered = (await view()).runs.find((r) => r.kind === "entered" && r.playbookId === "trend-calls")!;
    const d = entered.detail;
    expect(d.expiry).toBe("2026-10-20"); // at least 14 days out
    const rules = new Map((await t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, s!.id))).map((r) => [r.kind, r]));
    expect([...rules.keys()].sort()).toEqual(["stop", "target", "time"]);
    expect(rules.get("target")).toMatchObject({ trigger: "money", thresholdUsd: d.targetUsd, trailTrigger: null });
    // the playbook stops at half of the most it can lose: the level is that loss as a negative P&L
    expect(Number(d.stopUsd)).toBeCloseTo(-Number(d.maxLoss) * 0.5, 1);
    expect(rules.get("stop")).toMatchObject({ trigger: "money", value: d.stopUsd, state: "armed" });
    expect(Number(rules.get("stop")!.thresholdUsd)).toBe(-Number(d.stopUsd));
    expect(rules.get("time")).toMatchObject({ trigger: "dte", value: "2", thresholdUsd: "2" });

    // strikes 100 apart: the butterfly costs as much as it can ever pay, so there is no profit to aim at
    const narrow = Array.from({ length: 10 }, (_, i) => 82_800 + i * 100);
    await snapshotOnce(t.deps, sourceAt(later + 5 * MIN, spotOn(8), 400, narrow), () => later + 5 * MIN);
    await put({ enabled: true, strategies: [{ playbookId: BUTTERFLY, exit: "trail" }] });
    expect(await runAutopilot(deps(later + 6 * MIN), ["delta_india"])).toMatchObject({ entered: 0, failed: 0 });
    const last = (await view()).runs.find((r) => r.playbookId === BUTTERFLY && r.asset === "BTC")!;
    expect(last).toMatchObject({ kind: "skipped", reason: "The fees are larger than the profit target, or the structure has no defined maximum" });
    expect(last.detail.maxProfit).toBe("0");
  });
});

describe("HC-TR-217 an Autopilot trade from its exit to the next entry", () => {
  const X = LIVE + 12 * HOUR; // 22:00 UTC on day 8
  const ticks = (m: Record<string, number>): RulesTickSource => ({ tick: () => Promise.resolve({ marks: new Map(Object.entries(m)), spot: null }) });
  const paper = () => t.db.select().from(strategies).where(and(eq(strategies.userId, userId), eq(strategies.autopilotPlaybookId, BUTTERFLY), eq(strategies.status, "paper")));
  const lastButterfly = async () => (await view()).runs.find((r) => r.playbookId === BUTTERFLY && r.asset === "BTC")!;

  it("HC-TR-217 the levels use the trader's own lot size; the rules engine fires the target on paper and the close starts the cool-down", async () => {
    await t.db.insert(userSettings).values({ userId, lotSizes: { BTC: "0.002", ETH: "0.01", XAUT: "0.001" } }).onConflictDoUpdate({ target: userSettings.userId, set: { lotSizes: { BTC: "0.002", ETH: "0.01", XAUT: "0.001" } } });
    await put({ enabled: true, strategies: [{ playbookId: BUTTERFLY, exit: "target" }] });
    await snapshotOnce(t.deps, sourceAt(X, spotOn(8)), () => X);
    expect((await runAutopilot(deps(X + MIN), ["delta_india"])).entered).toBe(1);
    const [s] = await paper();
    const entered = await lastButterfly();
    expect(entered).toMatchObject({ kind: "entered", strategyId: s!.id });
    expect(entered.detail.maxProfit).toBe("4"); // twice the 2 of a 0.001 lot
    expect(entered.detail.maxLoss).toBe("-36");
    // the bought 81000 call gains 600: 600 x 10 lots x 0.002 = 12 USD, past the target
    const fired = await evaluateRules(t.deps, ticks({ "C-BTC-81000-150926": 3200, "C-BTC-83000-150926": 600, "C-BTC-85000-150926": 400 }), () => X + 2 * MIN);
    expect(fired.fired.length).toBeGreaterThanOrEqual(1);
    const [after] = await t.db.select().from(strategies).where(eq(strategies.id, s!.id));
    expect(after).toMatchObject({ status: "archived", closeReason: "target" });
    expect(Number(after!.realizedPnl)).toBe(12);
    expect(after!.closedAt!.getTime()).toBe(X + 2 * MIN);
    expect(await runAutopilot(deps(X + 3 * MIN), ["delta_india"])).toMatchObject({ entered: 0, failed: 0 });
    expect(await lastButterfly()).toMatchObject({ kind: "skipped", reason: `Waiting ${AUTOPILOT_COOLDOWN_MINUTES} minutes after its last trade` });
    expect(await paper()).toHaveLength(0);
  });

  it("HC-TR-217 a trade the trader squares off by hand is closed out, starts the cool-down, and does not block the playbook", async () => {
    const at = X + 20 * MIN;
    await snapshotOnce(t.deps, sourceAt(at, spotOn(8)), () => at);
    await runAutopilot(deps(at + MIN), ["delta_india"]); // the second trader's butterfly re-enters on the same passes
    expect(await paper()).toHaveLength(1);
    const [s] = await paper();
    // every leg closed by hand: the row itself stays "paper" (only a rule or the settler archives)
    await t.db.update(strategyLegs).set({ status: "squared_off", exitPrice: "1", closedAt: new Date(at + 2 * MIN), closeReason: "squared_off" }).where(eq(strategyLegs.strategyId, s!.id));
    expect(await runAutopilot(deps(at + 3 * MIN), ["delta_india"])).toMatchObject({ entered: 0, noted: 0, failed: 0 });
    const [closed] = await t.db.select().from(strategies).where(eq(strategies.id, s!.id));
    expect(closed).toMatchObject({ status: "archived", closeReason: "squared_off" });
    expect(closed!.closedAt!.getTime()).toBe(at + 2 * MIN);
    expect((await t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, s!.id))).map((r) => r.state)).toEqual(["disarmed"]);
    expect(await lastButterfly()).toMatchObject({ kind: "skipped", reason: `Waiting ${AUTOPILOT_COOLDOWN_MINUTES} minutes after its last trade` });
    // a row with no leg at all is closed out as of the pass
    const bare = "strat_autopilot_bare";
    await t.db.insert(strategies).values({ id: bare, userId, name: "bare", asset: "BTC", venue: "delta_india", status: "paper", tradingMode: "paper", autopilotPlaybookId: "expiry-week-credit", startedAt: new Date(at) });
    await put({ enabled: true, strategies: [{ playbookId: BUTTERFLY, exit: "target" }, { playbookId: "expiry-week-credit", exit: "trail" }] });
    await runAutopilot(deps(at + 4 * MIN), ["delta_india"]);
    const [gone] = await t.db.select().from(strategies).where(eq(strategies.id, bare));
    expect(gone!.status).toBe("archived");
    expect(gone!.closedAt!.getTime()).toBe(at + 4 * MIN);
    await put({ enabled: true, strategies: [{ playbookId: BUTTERFLY, exit: "target" }] });
  });

  it("HC-TR-217 an Autopilot trade cannot go live, alone or in a batch, and the database holds one open trade per playbook and structure", async () => {
    const at = X + 40 * MIN;
    await snapshotOnce(t.deps, sourceAt(at, spotOn(8)), () => at);
    await runAutopilot(deps(at + MIN), ["delta_india"]); // the second trader's butterfly re-enters on the same passes
    expect(await paper()).toHaveLength(1);
    const [s] = await paper();
    const single = await t.request(`/v1/strategies/${s!.id}/live/place`, { cookie, json: { confirm: "LIVE", brokerId: SEED.brokerId, idempotencyKey: "autopilot-live-001", expected: {} } });
    expect(single.status).toBe(409);
    expect(JSON.stringify(await single.json())).toContain(AUTOPILOT_PAPER_ONLY_MESSAGE);
    const batch = await t.request("/v1/strategies/live/batch", { cookie, json: { confirm: "LIVE", ids: [s!.id], brokerId: SEED.brokerId, idempotencyKey: "autopilot-live-002" } });
    expect(batch.status).toBe(409);
    expect(JSON.stringify(await batch.json())).toContain(AUTOPILOT_PAPER_ONLY_MESSAGE);
    expect((await paper())[0]).toMatchObject({ status: "paper", tradingMode: "paper" });
    // nor be parked as a draft: it is closed or it stays (ADR-109)
    const draft = await t.request(`/v1/strategies/${s!.id}/stop`, { cookie, json: { archive: false, exits: {} } });
    expect(draft.status).toBe(409);
    expect(JSON.stringify(await draft.json())).toContain("can only be closed");
    expect((await paper())[0]).toMatchObject({ status: "paper" });
    // a second open row for the same trader, playbook, venue, asset and structure is refused by the index
    expect(s!.autopilotStructure).toBe(structureKey(await t.db.select().from(strategyLegs).where(eq(strategyLegs.strategyId, s!.id)).orderBy(asc(strategyLegs.position))));
    const second = { id: "strat_autopilot_twin", userId, name: "twin", asset: "BTC" as const, venue: "delta_india" as const, status: "paper" as const, tradingMode: "paper" as const, autopilotPlaybookId: BUTTERFLY as string | null, autopilotStructure: s!.autopilotStructure };
    await expect(t.db.insert(strategies).values(second)).rejects.toThrow();
    // the trader's own paper trades are not held to it
    await t.db.insert(strategies).values([{ ...second, id: "strat_own_1", autopilotPlaybookId: null }, { ...second, id: "strat_own_2", autopilotPlaybookId: null }]);
    await t.db.delete(strategies).where(eq(strategies.name, "twin"));
  });

  it("HC-TR-221 the playbook's entry on other strikes is a new trade beside the open one, one per cool-down and five at most; the same strikes are never held twice", async () => {
    const first = (await paper())[0]!;
    // the key's newest entry is dated just before this test, whatever the tests above did
    const entered = X + 44 * MIN;
    await t.db.update(strategies).set({ startedAt: new Date(entered) }).where(eq(strategies.id, first.id));
    const grid = (step: number) => Array.from({ length: 10 }, (_, i) => 83_000 + (i - 4) * step); // 83,000 is always listed, the wings move with the step
    const [entry] = await t.db.select().from(autopilotRuns).where(and(eq(autopilotRuns.userId, userId), eq(autopilotRuns.kind, "entered"), eq(autopilotRuns.strategyId, first.id)));
    await t.db.update(autopilotRuns).set({ detail: { ...entry!.detail, entryCost: "500" } }).where(eq(autopilotRuns.id, entry!.id));
    // strikes 100 apart: wings that narrow make less than the fees, so that structure is a reason and not a trade
    let at = entered + 2 * MIN;
    await snapshotOnce(t.deps, sourceAt(at, spotOn(8), 400, grid(100)), () => at);
    await runAutopilot(deps(at + MIN), ["delta_india"]);
    expect(await lastButterfly()).toMatchObject({ kind: "skipped", reason: "The fees are larger than the profit target, or the structure has no defined maximum" });
    // strikes 2,000 apart: the butterfly now sits on other strikes, but the key entered a few minutes ago
    at = entered + 4 * MIN;
    await snapshotOnce(t.deps, sourceAt(at, spotOn(8), 400, grid(2000)), () => at);
    expect(await runAutopilot(deps(at + MIN), ["delta_india"])).toMatchObject({ noted: 0, failed: 0 });
    expect(await paper()).toHaveLength(1);
    expect(await lastButterfly()).toMatchObject({ kind: "skipped", reason: `Waiting ${AUTOPILOT_COOLDOWN_MINUTES} minutes after its last trade` });
    // the cool-down over: the other strikes are entered as a second trade, the first stays
    at = entered + AUTOPILOT_COOLDOWN_MINUTES * MIN;
    await snapshotOnce(t.deps, sourceAt(at, spotOn(8), 400, grid(2000)), () => at);
    await runAutopilot(deps(at + MIN), ["delta_india"]);
    const two = await paper();
    expect(two).toHaveLength(2);
    const second = two.find((x) => x.id !== first.id)!;
    expect(second.autopilotPlaybookId).toBe(BUTTERFLY);
    expect(second.autopilotStructure).not.toBe(first.autopilotStructure);
    expect((await t.db.select().from(strategyRules).where(and(eq(strategyRules.strategyId, second.id), eq(strategyRules.state, "armed")))).length).toBeGreaterThan(0);
    // the same pass again: the second trade's strikes are held, nothing is entered twice
    await runAutopilot(deps(at + 2 * MIN), ["delta_india"]);
    expect(await paper()).toHaveLength(2);
    // a row from before the structure was stored is known by its legs, and gets it written once
    await t.db.update(strategies).set({ autopilotStructure: null }).where(eq(strategies.id, second.id));
    expect((await runAutopilot(deps(at + 3 * MIN), ["delta_india"])).failed).toBe(0);
    expect(await paper()).toHaveLength(2);
    expect((await paper()).find((x) => x.id === second.id)!.autopilotStructure).toBe(second.autopilotStructure);
    // a leg the trader added by hand does not make it another trade: the structure it was entered on still holds the place
    await t.db.insert(strategyLegs).values({ id: "leg_added_by_hand", strategyId: second.id, kind: "put", side: "buy", strike: "70000", expiry: "2026-09-15", symbol: "P-BTC-70000-150926", lots: 1, price: "1", entryPrice: "1", status: "open", position: 9 });
    expect((await runAutopilot(deps(at + 4 * MIN), ["delta_india"])).failed).toBe(0);
    expect(await paper()).toHaveLength(2);
    await t.db.delete(strategyLegs).where(eq(strategyLegs.id, "leg_added_by_hand"));
    // an Autopilot trade is part of its results: it cannot be deleted
    const gone = await t.request(`/v1/strategies/${second.id}`, { cookie, method: "DELETE" });
    expect(gone.status).toBe(409);
    expect(JSON.stringify(await gone.json())).toContain(AUTOPILOT_KEEP_MESSAGE);
    expect(await paper()).toHaveLength(2);
    // the first trade's strikes again, cheaper than its (rewritten) entry: a note on that trade, not a third trade
    await snapshotOnce(t.deps, sourceAt(at + 5 * MIN, spotOn(8)), () => at + 5 * MIN);
    expect((await runAutopilot(deps(at + 6 * MIN), ["delta_india"])).noted).toBe(1);
    expect((await view()).runs.find((r) => r.kind === "noted")!.strategyId).toBe(first.id);
    expect(await paper()).toHaveLength(2);
    // five held: a sixth structure is a reason, not a trade, however long the key has waited
    const fill = Array.from({ length: LADDER - 2 }, (_, i) => `strat_autopilot_fill_${i}`);
    await t.db.insert(strategies).values(fill.map((id) => ({ id, userId, name: "fill", asset: "BTC" as const, venue: "delta_india" as const, status: "paper" as const, tradingMode: "paper" as const, autopilotPlaybookId: BUTTERFLY, autopilotStructure: id, startedAt: new Date(at) })));
    await t.db.insert(strategyLegs).values(fill.map((id, i) => ({ id: `leg_fill_${i}`, strategyId: id, kind: "call" as const, side: "buy" as const, strike: String(1000 + i), expiry: "2026-09-15", symbol: `C-BTC-${1000 + i}-150926`, lots: 1, price: "1", entryPrice: "1", status: "open" as const, position: 0 })));
    at += 2 * HOUR;
    await snapshotOnce(t.deps, sourceAt(at, spotOn(8), 400, grid(3000)), () => at);
    await runAutopilot(deps(at + MIN), ["delta_india"]); // the second trader holds fewer and may enter on the same pass
    expect(await paper()).toHaveLength(LADDER);
    expect(await lastButterfly()).toMatchObject({ kind: "skipped", reason: `Holds ${LADDER} trades already, the most for one strategy and coin` });
    // one fewer held: the sixth structure enters
    await t.db.delete(strategies).where(eq(strategies.id, fill[0]!));
    expect((await runAutopilot(deps(at + 2 * MIN), ["delta_india"])).entered).toBeGreaterThanOrEqual(1);
    expect(await paper()).toHaveLength(LADDER);
    // leave the first trade alone for the tests that follow
    for (const x of await paper()) if (x.id !== first.id) await t.db.delete(strategies).where(eq(strategies.id, x.id));
    expect(await paper()).toHaveLength(1);
  });

  it("HC-TR-217 no plan, no trade: with no Free plan on offer a trader without a subscription is told so; an admin still trades", async () => {
    const at = X + 3 * HOUR;
    const [open] = await paper();
    await t.db.update(strategies).set({ status: "archived", closedAt: new Date(at - HOUR) }).where(eq(strategies.id, open!.id));
    await snapshotOnce(t.deps, sourceAt(at, spotOn(8)), () => at);
    await t.db.update(plans).set({ active: false }).where(eq(plans.id, SEED.plans.free));
    await t.db.update(subscriptions).set({ status: "cancelled" }).where(eq(subscriptions.userId, userId));
    try {
      expect((await runAutopilot(deps(at + MIN), ["delta_india"])).failed).toBe(0);
      expect(await paper()).toHaveLength(0);
      expect(await lastButterfly()).toMatchObject({ kind: "skipped", reason: "No active plan: choose a plan to let Autopilot trade" });
      await t.db.update(users).set({ role: "admin" }).where(eq(users.id, userId));
      await runAutopilot(deps(at + 2 * MIN), ["delta_india"]);
      expect(await paper()).toHaveLength(1);
    } finally {
      await t.db.update(plans).set({ active: true }).where(eq(plans.id, SEED.plans.free));
      await t.db.update(users).set({ role: "user" }).where(eq(users.id, userId));
    }
  });

  it("HC-TR-217 another pass that got there first is not a failure; a failure on one underlying leaves the other; old log lines are dropped", async () => {
    const at = X + 5 * HOUR;
    const [open] = await paper();
    await t.db.update(strategies).set({ status: "archived", closedAt: new Date(at - HOUR) }).where(eq(strategies.id, open!.id));
    await snapshotOnce(t.deps, sourceAt(at, spotOn(8)), () => at);
    const bound = (target: object, prop: string | symbol) => {
      const v: unknown = Reflect.get(target, prop);
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    };
    // the open-trade index refuses the write: the key was taken a moment ago
    const raced = new Proxy(t.db, { get: (target, prop) => (prop === "transaction" ? () => Promise.reject(new Error("insert failed", { cause: new Error('duplicate key value violates unique constraint "strategies_autopilot_open_uq"') })) : bound(target, prop)) });
    const warned: object[] = [];
    const logger = { info: () => undefined, warn: (o: object) => void warned.push(o) };
    const pass = await runAutopilot(deps(at + MIN, { db: raced, logger }), ["delta_india"]);
    expect(pass.entered).toBe(0);
    expect(warned.filter((w) => JSON.stringify(w).includes(userId))).toHaveLength(0);
    // the third read of a pass is the first underlying's exchange lookup: it fails, the pass goes on to the next underlying
    let reads = 0;
    const broken = new Proxy(t.db, {
      get(target, prop) {
        if (prop === "select" && ++reads === 3) throw new Error("the read failed");
        return bound(target, prop);
      },
    });
    const after = await runAutopilot(deps(at + 2 * MIN, { db: broken, logger }), ["delta_india"]);
    expect(after.failed).toBe(1);
    expect(warned.at(-1)).toMatchObject({ venue: "delta_india", asset: "BTC", reason: "the read failed" });
    // a log line older than the retention is dropped by the next pass
    await t.db.insert(autopilotRuns).values({ userId, playbookId: BUTTERFLY, venue: "delta_india", asset: "BTC", kind: "skipped", reason: "ancient", at: new Date(at - (AUTOPILOT_RUNS_RETENTION_DAYS + 1) * DAY) });
    await runAutopilot(deps(at + 3 * MIN), ["delta_india"]);
    expect((await t.db.select().from(autopilotRuns).where(eq(autopilotRuns.reason, "ancient"))).length).toBe(0);
  });
});

describe("HC-TR-223 what the trades Autopilot opened came to", () => {
  it("HC-TR-223 counts open trades, nets closed ones of the fees estimated at entry, and groups by playbook, asset, exit style and days to expiry; needs a session", async () => {
    expect((await t.request("/v1/autopilot/results")).status).toBe(401);
    const me = await t.signUp("autopilot-results@hapiecoin.test");
    const id = ((await (await t.request("/v1/me", { cookie: me.cookie })).json()) as { id: string }).id;
    const read = async () => json<AutopilotResults>(await t.request("/v1/autopilot/results", { cookie: me.cookie }));
    // nothing entered yet
    expect(await read()).toMatchObject({ since: null, total: { open: 0, closed: 0, wins: 0, grossUsd: "0.00", feesUsd: "0.00", netUsd: "0.00" }, rows: [], trades: [] });
    expect((await read()).byDte.map((b) => b.band)).toEqual(["0-1", "2-7", "8-30", "31+"]);

    const B = Date.UTC(2026, 8, 20, 6, 0, 0);
    const row = (sid: string, over: Partial<typeof strategies.$inferInsert>) => ({ id: sid, userId: id, name: sid, asset: "BTC" as const, venue: "delta_india" as const, status: "archived" as const, tradingMode: "paper" as const, autopilotPlaybookId: BUTTERFLY, ...over });
    await t.db.insert(strategies).values([
      row("res_1", { realizedPnl: "5.00", startedAt: new Date(B), closedAt: new Date(B + 30 * MIN), closeReason: "target" }),
      row("res_2", { realizedPnl: "-2.00", startedAt: new Date(B + HOUR), closedAt: new Date(B + 2 * HOUR), closeReason: "stopped" }),
      row("res_3", { status: "paper", asset: "ETH", autopilotPlaybookId: "trend-puts", startedAt: new Date(B + 3 * HOUR) }),
      // a small gross profit the fees eat: not a win; no start time and no close reason on the row
      row("res_4", { realizedPnl: "0.30", asset: "ETH", autopilotPlaybookId: "trend-puts", closedAt: new Date(B + 4 * HOUR + 10 * MIN) }),
      // an entry logged with no figures at all
      row("res_5", { realizedPnl: "1", startedAt: new Date(B + 5 * HOUR), closedAt: new Date(B + 5 * HOUR + 30 * MIN), closeReason: "squared_off" }),
    ]);
    const legs = [{ side: "buy" as const, kind: "call" as const, strike: "82000", price: "1" }, { side: "sell" as const, kind: "call" as const, strike: "83000", price: "1" }];
    const line = (sid: string, at: number, playbookId: string, asset: "BTC" | "ETH", detail: AutopilotRunDetail) => ({ userId: id, playbookId, venue: "delta_india" as const, asset, kind: "entered" as const, reason: "entered", strategyId: sid, detail, at: new Date(at) });
    const [other] = await mine(); // the first trader's strategy: a line pointing at it is not this trader's result
    await t.db.insert(autopilotRuns).values([
      line("res_1", B, BUTTERFLY, "BTC", { exit: "trail", dte: 1, fees: "0.40", expiry: "2026-09-21", legs }),
      line("res_2", B + HOUR, BUTTERFLY, "BTC", { exit: "trail", dte: 0, fees: "0.40" }),
      line("res_3", B + 3 * HOUR, "trend-puts", "ETH", { exit: "target", dte: 20, fees: "0.50" }),
      line("res_4", B + 4 * HOUR, "trend-puts", "ETH", { exit: "target", dte: 20, fees: "0.50" }),
      line("res_5", B + 5 * HOUR, BUTTERFLY, "BTC", {}),
      line(other!.id, B + 6 * HOUR, BUTTERFLY, "BTC", { exit: "trail", dte: 1, fees: "9" }),
      { ...line("res_1", B + 7 * HOUR, BUTTERFLY, "BTC", {}), kind: "noted" as const }, // a note is not an entry
    ]);

    const r = await read();
    expect(r.since).toBe(new Date(B).toISOString());
    expect(r.total).toEqual({ open: 1, closed: 4, wins: 2, grossUsd: "4.30", feesUsd: "1.30", netUsd: "3.00" });
    expect(r.rows).toHaveLength(2);
    expect(r.rows.find((x) => x.playbookId === BUTTERFLY)).toEqual({ playbookId: BUTTERFLY, asset: "BTC", exit: "trail", open: 0, closed: 3, wins: 2, grossUsd: "4.00", feesUsd: "0.80", netUsd: "3.20", bestNetUsd: "4.60", worstNetUsd: "-2.40", avgHoldMinutes: 40, reasons: { target: 1, stopped: 1, squared_off: 1 } });
    expect(r.rows.find((x) => x.playbookId === "trend-puts")).toEqual({ playbookId: "trend-puts", asset: "ETH", exit: "target", open: 1, closed: 1, wins: 0, grossUsd: "0.30", feesUsd: "0.50", netUsd: "-0.20", bestNetUsd: "-0.20", worstNetUsd: "-0.20", avgHoldMinutes: 10, reasons: { unknown: 1 } });
    expect(r.byDte).toEqual([
      { band: "0-1", open: 0, closed: 2, wins: 1, grossUsd: "3.00", feesUsd: "0.80", netUsd: "2.20" },
      { band: "2-7", open: 0, closed: 0, wins: 0, grossUsd: "0.00", feesUsd: "0.00", netUsd: "0.00" },
      { band: "8-30", open: 1, closed: 1, wins: 0, grossUsd: "0.30", feesUsd: "0.50", netUsd: "-0.20" },
      { band: "31+", open: 0, closed: 0, wins: 0, grossUsd: "0.00", feesUsd: "0.00", netUsd: "0.00" },
    ]);
    expect(r.trades.map((x) => x.strategyId)).toEqual(["res_5", "res_4", "res_2", "res_1"]); // newest close first
    expect(r.trades[3]).toEqual({ strategyId: "res_1", playbookId: BUTTERFLY, asset: "BTC", exit: "trail", strikes: ["82000", "83000"], expiry: "2026-09-21", dte: 1, openedAt: new Date(B).toISOString(), closedAt: new Date(B + 30 * MIN).toISOString(), closeReason: "target", grossUsd: "5.00", feesUsd: "0.40", netUsd: "4.60" });
    expect(r.trades[0]).toMatchObject({ exit: "trail", strikes: [], expiry: null, dte: null, feesUsd: "0.00", netUsd: "1.00" });
    expect(r.trades[1]).toMatchObject({ openedAt: new Date(B + 4 * HOUR).toISOString(), closeReason: null });
    // every leg squared off by hand while the row still says paper: closed in the results, dated by its last leg
    await t.db.insert(strategies).values(row("res_7", { status: "paper", realizedPnl: "2.00", startedAt: new Date(B + 9 * HOUR) }));
    await t.db.insert(strategyLegs).values({ id: "leg_res_7", strategyId: "res_7", kind: "call", side: "buy", strike: "82000", expiry: "2026-09-21", symbol: "C-BTC-82000-210926", lots: 1, price: "1", entryPrice: "1", exitPrice: "3", status: "squared_off", position: 0, closedAt: new Date(B + 9 * HOUR + 20 * MIN) });
    await t.db.insert(autopilotRuns).values(line("res_7", B + 9 * HOUR, BUTTERFLY, "BTC", { exit: "target", dte: 1, fees: "0.50" }));
    const hand = await read();
    expect(hand.total).toMatchObject({ open: 1, closed: 5, wins: 3, netUsd: "4.50" });
    expect(hand.trades[0]).toMatchObject({ strategyId: "res_7", closeReason: "squared_off", closedAt: new Date(B + 9 * HOUR + 20 * MIN).toISOString(), netUsd: "1.50" });
    expect(hand.rows.find((x) => x.exit === "target" && x.playbookId === BUTTERFLY)).toMatchObject({ closed: 1, avgHoldMinutes: 20, reasons: { squared_off: 1 } });
    // a trade more than a month out lands in the last band
    await t.db.insert(strategies).values(row("res_6", { status: "paper", startedAt: new Date(B + 8 * HOUR) }));
    await t.db.insert(autopilotRuns).values([line("res_6", B + 8 * HOUR, "premium-harvest", "BTC", { exit: "trail", dte: 34 }), line("res_6", B + 8 * HOUR, "premium-harvest", "BTC", { exit: "trail", dte: 5 })]);
    const again = await read();
    expect(again.byDte.find((b) => b.band === "31+")!.open).toBe(1);
    expect(again.byDte.find((b) => b.band === "2-7")!.open).toBe(1);
  });
});

describe("HC-TR-225 playbooks entered by the clock: the evening strangles", () => {
  const wings = autopilotPlaybookById("evening-strangle-wings-3")!;
  const twice = autopilotPlaybookById("evening-strangle-stop-2x")!;
  const fees = { optionPct: 0.0001, optionCapOfPremium: 0.035, futurePct: 0.0005, gstPct: 0.18, settlementFee: true };
  const sold = (entryCost: number): PlaybookProposal => ({
    day: "2026-09-25",
    spot: 83_200,
    expiry: "2026-09-26",
    legs: [
      { asset: "BTC", kind: "put", side: "sell", strike: "82600", expiry: "2026-09-26", lots: 100, price: "268" },
      { asset: "BTC", kind: "call", side: "sell", strike: "83800", expiry: "2026-09-26", lots: 100, price: "268" },
    ],
    entryCost,
    maxProfit: -entryCost,
    maxLoss: -Infinity,
  });

  it("HC-TR-225 six playbooks are entered by the clock, on BTC, in the evening window; Autopilot trades them beside the recorded ones and never the control", () => {
    expect(CLOCK_PLAYBOOKS.map((p) => p.id)).toEqual(["evening-strangle-wings-3", "evening-strangle-wings-5", "evening-strangle-stop-2x", "evening-strangle-stop-3x", "evening-strangle-take-half", "evening-strangle-trail-rest"]);
    for (const p of CLOCK_PLAYBOOKS) expect(p).toMatchObject({ assets: ["BTC"], minDte: 0.5, lots: 100, control: false, clock: { fromHourUtc: 16, toHourUtc: 17, window: "9:30 to 10:30 PM IST", maxDte: 1.5, venues: ["delta_india"] } });
    expect(CLOCK_PLAYBOOKS.map((p) => p.clock!.legStop)).toEqual([undefined, undefined, 2, 3, 2, 2]);
    expect(AUTOPILOT_PLAYBOOKS.map((p) => p.id)).toEqual(expect.arrayContaining([...PLAYBOOKS.filter((p) => !p.control), ...CLOCK_PLAYBOOKS, ...WEEKLY_PLAYBOOKS].map((p) => p.id)));
    expect(PLAYBOOKS.some((p) => p.clock)).toBe(false); // the daily record and the proposals do not see them
    expect(autopilotPlaybookById("hero-or-zero")).toBeUndefined();
  });

  it("HC-TR-225 the plan has no profit level and no strategy stop, only the stop on each sold option; a premium smaller than the fees is no plan", () => {
    // two fills of 0.1 BTC at 83,200: 0.832 each, 18 % GST, both ways
    const p = clockPlanFor(twice, sold(-53.6), 0.001, fees)!;
    expect(p).toMatchObject({ targetUsd: null, stopUsd: null, timeStopDte: null, legStop: 2, trailRestPct: null, ladder: null, lock: null, exitHourUtc: null, takeTrailPct: null, legBuyBackAt: null, legBuyBackShare: null });
    expect(p.fees).toBeCloseTo(2 * 2 * 0.832 * 1.18, 6);
    expect(clockPlanFor(wings, sold(-53.6), 0.001, null)).toEqual({ fees: 0, targetUsd: null, stopUsd: null, timeStopDte: null, legStop: null, trailRestPct: null, ladder: null, lock: null, exitHourUtc: null, takeTrailPct: null, legBuyBackAt: null, legBuyBackShare: null });
    expect(clockPlanFor(twice, sold(-3.9), 0.001, fees)).toBeNull(); // collects less than the fills cost
    expect(clockPlanFor(twice, sold(2), 0.001, null)).toBeNull(); // a debit is not this trade
    // HC-TR-227: the take-half version has the same stops and a profit level at half the premium collected
    expect(clockPlanFor(autopilotPlaybookById("evening-strangle-take-half")!, sold(-53.6), 0.001, null)).toEqual({ fees: 0, targetUsd: 26.8, stopUsd: null, timeStopDte: null, legStop: 2, trailRestPct: null, ladder: null, lock: null, exitHourUtc: null, takeTrailPct: null, legBuyBackAt: null, legBuyBackShare: null });
    // HC-TR-228: the trail-the-rest version has the same stops, which start a trail with a give-back of half
    expect(clockPlanFor(autopilotPlaybookById("evening-strangle-trail-rest")!, sold(-53.6), 0.001, null)).toEqual({ fees: 0, targetUsd: null, stopUsd: null, timeStopDte: null, legStop: 2, trailRestPct: 50, ladder: null, lock: null, exitHourUtc: null, takeTrailPct: null, legBuyBackAt: null, legBuyBackShare: null });
    expect(clockPlanFor(autopilotPlaybookById("evening-strangle-take-half")!, sold(-0.015), 0.001, null)).toBeNull(); // half of it rounds to nothing
    // the window is from its first hour and before its second, in UTC
    const c = twice.clock!;
    const utc = (h: number, m: number, sec = 0) => Date.UTC(2026, 8, 25, h, m, sec);
    expect([utc(15, 59, 59), utc(16, 0), utc(16, 59, 59), utc(17, 0)].map((ms) => inWindow(c, ms))).toEqual([false, true, true, false]);
  });

  it("HC-TR-225 HC-TR-257 enters once in its evening window on the nearest expiry with its own exits and the margin estimated at entry; outside the window, holding a trade, or already entered are reasons", async () => {
    const me = await t.signUp("autopilot-clock@hapiecoin.test");
    const id = ((await (await t.request("/v1/me", { cookie: me.cookie })).json()) as { id: string }).id;
    // the card's style is not this playbook's to choose: it is saved as its own exits; no other playbook may ask for them
    const saved = await json<AutopilotView>(await put({ enabled: true, strategies: CLOCK_PLAYBOOKS.map((p) => ({ playbookId: p.id, exit: "trail" })) }, me.cookie));
    expect(saved.settings.strategies.map((x) => x.exit)).toEqual(CLOCK_PLAYBOOKS.map(() => "own"));
    const refused = await put({ enabled: true, strategies: [{ playbookId: BUTTERFLY, exit: "own" }] }, me.cookie);
    expect(refused.status).toBe(400);
    expect(JSON.stringify(await refused.json())).toContain("takes Autopilot's profit exit: choose trail or target");
    const strangles = () => t.db.select().from(strategies).where(eq(strategies.userId, id));
    const lines = async () => (await view(me.cookie)).runs;
    /** A chain whose time value falls away from the money, so a bought wing costs less than the option sold inside it. */
    const curveAt = (ts: number, spot: number, expiries: readonly string[]): MarketSource => {
      const products: Instrument[] = [];
      const quotes: Quote[] = [];
      for (const e of expiries)
        for (let i = -12; i <= 12; i++) {
          const k = 83_200 + i * 200;
          const code = e.slice(8, 10) + e.slice(5, 7) + e.slice(2, 4);
          const tv = 400 * Math.exp(-Math.abs(k - spot) / 1500);
          const c = `C-BTC-${k}-${code}`;
          const pt = `P-BTC-${k}-${code}`;
          products.push(inst(c, "call", k, e), inst(pt, "put", k, e));
          quotes.push({ instrumentId: `delta_india:${c}`, ts, mark: (Math.max(spot - k, 0) + tv).toFixed(1), oi: "1", spot: String(spot), markIv: 0.4 }, { instrumentId: `delta_india:${pt}`, ts, mark: (Math.max(k - spot, 0) + tv).toFixed(1), oi: "1", spot: String(spot), markIv: 0.4 });
        }
      return { venue: "delta_india", products: () => Promise.resolve(products), tickers: (u) => Promise.resolve(u === "BTC" ? quotes : []) };
    };
    const marginSpots: (number | undefined)[] = [];
    const W = Date.UTC(2026, 8, 25, 16, 5, 0); // 21:35 IST: inside the window; today's expiry settled four hours ago
    const LISTED = ["2026-09-25", "2026-09-26", "2026-10-20"];
    const pass = async (at: number, spot = 83_200, expiries: readonly string[] = LISTED) => {
      const curve = curveAt(at - MIN, spot, expiries);
      await snapshotOnce(t.deps, curve, () => at - MIN);
      // HC-TR-257: the venue's list as it is keyed, by venue symbol, every contract at a margin percent of 0.5; the
      // source's own spot (1) must not be the one used, and the snapshot's must be handed to it
      const params: ReadonlyMap<string, MarginParams> = new Map((await curve.products()).map((i) => [i.symbol, { contractValue: "0.001", initialMarginPct: "0.5", initialMarginScalingFactor: "0.000002", maxLeverageNotional: "200000" }]));
      const marginInputs = (_a: string, _v: string, given?: number) => {
        marginSpots.push(given);
        return Promise.resolve({ spot: 1, params });
      };
      return runAutopilot(deps(at, { maxOpen: undefined, marginInputs }), ["delta_india"]); // the product's own limit: one trade at a time
    };

    // an hour early: the reason is logged, nothing is entered
    await pass(W - HOUR);
    expect(await strangles()).toHaveLength(0);
    expect((await lines()).filter((r) => r.asset === "BTC").map((r) => r.reason)).toEqual(Array(CLOCK_PLAYBOOKS.length).fill("Outside its entry hours (9:30 to 10:30 PM IST)"));

    await pass(W);
    const all = await strangles();
    expect(all.map((x) => x.autopilotPlaybookId).sort()).toEqual(CLOCK_PLAYBOOKS.map((p) => p.id).sort());
    const legsOf = (sid: string) => t.db.select().from(strategyLegs).where(eq(strategyLegs.strategyId, sid)).orderBy(asc(strategyLegs.position));
    const rulesOf = (sid: string) => t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, sid));
    const of = (playbookId: string) => all.find((x) => x.autopilotPlaybookId === playbookId)!;
    const entry = async (sid: string) => (await lines()).find((r) => r.kind === "entered" && r.strategyId === sid)!;

    // with wings: sold three strikes out, bought eight out, on tomorrow's expiry (not today's, which has settled); held to settlement, so no rule
    const w = of("evening-strangle-wings-3");
    expect(w).toMatchObject({ status: "paper", tradingMode: "paper", asset: "BTC", name: "Evening strangle with wings · Autopilot" });
    expect((await legsOf(w.id)).map((l) => `${l.side} ${l.kind} ${l.strike} ${l.expiry} x${l.lots}`)).toEqual(["buy put 81600 2026-09-26 x100", "sell put 82600 2026-09-26 x100", "sell call 83800 2026-09-26 x100", "buy call 84800 2026-09-26 x100"]);
    expect(await rulesOf(w.id)).toHaveLength(0);
    const wd = (await entry(w.id)).detail;
    expect(wd).toMatchObject({ exit: "own", expiry: "2026-09-26", dte: 1, stopUsd: null });
    expect(wd.targetUsd).toBeUndefined();
    expect(wd.legStop).toBeUndefined();
    expect(Number(wd.entryCost)).toBeLessThan(0); // a credit
    expect(Number(wd.capital)).toBeGreaterThan(0); // the wings give it a maximum loss

    // stop at double: nothing bought, each sold option has its own stop at twice the price it was sold at
    const x2 = of("evening-strangle-stop-2x");
    const x2legs = await legsOf(x2.id);
    expect(x2legs.map((l) => `${l.side} ${l.kind} ${l.strike}`)).toEqual(["sell put 82600", "sell call 83800"]);
    const x2rules = await rulesOf(x2.id);
    expect(x2rules).toHaveLength(2);
    for (const l of x2legs) expect(x2rules.find((r) => r.legId === l.id)).toMatchObject({ kind: "leg_stop", trigger: "multiple", value: "2", scope: "leg", state: "armed", thresholdUsd: (2 * Number(l.price)).toFixed(1).replace(/\.0$/, "") });
    const x2d = (await entry(x2.id)).detail;
    expect(x2d).toMatchObject({ exit: "own", legStop: 2, capital: null, maxLoss: null }); // no maximum loss: no capital figure
    // HC-TR-257: the trade carries the margin estimated at entry: each sold option at the snapshot's spot (83 200) and its own entry price, 100 contracts
    const shortMargin = (price: string) => (0.5 / 100) * 83_200 * 0.001 * 100 + Number(price) * 0.001 * 100; // far under the threshold: the listed percent alone
    expect(Number(x2.marginEstimate)).toBeCloseTo(x2legs.reduce((sum, l) => sum + shortMargin(l.price), 0), 1);
    expect(Number(x2.marginEstimate)).toBeGreaterThan(83); // two sold options: 41.6 each before their premium
    expect(marginSpots.length).toBeGreaterThan(0);
    expect(new Set(marginSpots)).toEqual(new Set([83_200])); // every read was handed the snapshot's spot: no ticker is read for it
    // with wings: the two sold options alone (no relief for the wings; a credit adds nothing)
    expect(Number(w.marginEstimate)).toBeCloseTo((await legsOf(w.id)).filter((l) => l.side === "sell").reduce((sum, l) => sum + shortMargin(l.price), 0), 1);
    expect((await rulesOf(of("evening-strangle-stop-3x").id)).map((r) => r.value)).toEqual(["3", "3"]);
    // HC-TR-227 take half: the two stops of the stop-at-double one, and a target at half the premium collected that closes the whole trade
    const half = of("evening-strangle-take-half");
    const halfRules = await rulesOf(half.id);
    expect(halfRules.map((r) => r.kind).sort()).toEqual(["leg_stop", "leg_stop", "target"]);
    const halfDetail = (await entry(half.id)).detail;
    expect(halfRules.find((r) => r.kind === "target")).toMatchObject({ trigger: "money", scope: "strategy", trailTrigger: null, state: "armed", thresholdUsd: halfDetail.targetUsd });
    expect(Number(halfDetail.targetUsd)).toBeCloseTo(-Number(halfDetail.entryCost) / 2, 1);
    expect(halfDetail).toMatchObject({ exit: "own", legStop: 2 });
    // HC-TR-228 trail the rest: the same two stops, each set to trail what is left with a give-back of half; the others trail nothing
    expect((await rulesOf(of("evening-strangle-trail-rest").id)).map((r) => [r.kind, r.value, r.trailTrigger, r.trailValue])).toEqual([["leg_stop", "2", "pct", "50"], ["leg_stop", "2", "pct", "50"]]);
    expect(x2rules.every((r) => r.trailTrigger === null)).toBe(true);
    expect((await entry(of("evening-strangle-trail-rest").id)).detail).toMatchObject({ legStop: 2, trailRestPct: 50 });
    expect(x2d.trailRestPct).toBeUndefined();

    // five minutes on, the same strikes: held, nothing twice and nothing noted
    expect(await pass(W + 5 * MIN)).toMatchObject({ noted: 0, failed: 0 });
    expect(await strangles()).toHaveLength(CLOCK_PLAYBOOKS.length);
    // the price moves two strikes inside the window: other strikes, but one trade at a time
    await pass(W + 10 * MIN, 83_600);
    expect(await strangles()).toHaveLength(CLOCK_PLAYBOOKS.length);
    expect((await lines()).find((r) => r.playbookId === "evening-strangle-stop-2x")).toMatchObject({ kind: "skipped", reason: "Holds a trade already: one at a time for a strategy and coin" });
    // stopped out on both sides within the window: not entered again this evening
    await t.db.update(strategies).set({ status: "archived", closedAt: new Date(W + 12 * MIN), closeReason: "stopped" }).where(eq(strategies.id, x2.id));
    await pass(W + 20 * MIN, 83_600);
    expect(await strangles()).toHaveLength(CLOCK_PLAYBOOKS.length);
    expect((await lines()).find((r) => r.playbookId === "evening-strangle-stop-2x")).toMatchObject({ kind: "skipped", reason: "Already entered in this window" });
    // just short of six hours after the entry it still counts as this evening
    expect(inWindow(twice.clock!, W + 6 * HOUR - MIN)).toBe(false); // (and the window is long over by then)

    // HC-TR-227: the take-half trade, with both options at a third of their price, is up by more than half the premium: closed whole (before the tick below, which moves the same strikes the other way)
    const halfLegs = await legsOf(half.id);
    await evaluateRules(t.deps, { tick: () => Promise.resolve({ marks: new Map(halfLegs.map((l) => [l.symbol, Number(l.price) / 3])), spot: null }) }, () => W + HOUR);
    expect((await strangles()).find((x) => x.id === half.id)).toMatchObject({ status: "archived", closeReason: "target" });
    expect((await legsOf(half.id)).every((l) => l.status === "squared_off")).toBe(true);

    // the rules engine on the row the job made: the put of the 3x trade reaches three times its price and is bought back alone
    const x3 = of("evening-strangle-stop-3x");
    const [put3, call3] = await legsOf(x3.id);
    const ticks = (m: Record<string, number>): RulesTickSource => ({ tick: () => Promise.resolve({ marks: new Map(Object.entries(m)), spot: null }) });
    await evaluateRules(t.deps, ticks({ [put3!.symbol]: 3 * Number(put3!.price), [call3!.symbol]: Number(call3!.price) }), () => W + 2 * HOUR);
    const after = await legsOf(x3.id);
    expect(after.map((l) => l.status)).toEqual(["squared_off", "open"]);
    expect(Number(after[0]!.exitPrice)).toBeCloseTo(3 * Number(put3!.price), 6);
    expect((await strangles()).find((x) => x.id === x3.id)!.status).toBe("paper"); // the call is still held
    expect((await rulesOf(x3.id)).map((r) => r.state).sort()).toEqual(["armed", "fired"]);

    // settlement the next day at 12:00 UTC, spot between the sold strikes: the settler closes what is left, with no rule to tell it
    const settle = Date.UTC(2026, 8, 26, 12, 0, 0);
    const report = await settleExpired(t.deps, { spotAt: () => Promise.resolve(83_300) }, () => settle + 3 * MIN);
    expect(report.archived).toBeGreaterThanOrEqual(3);
    const done = await strangles();
    const winged = done.find((x) => x.id === w.id)!;
    expect(winged).toMatchObject({ status: "archived", closeReason: "expired" });
    expect(Number(winged.realizedPnl)).toBeCloseTo(-Number(wd.entryCost), 1); // every option expired worthless: the credit is kept
    expect(done.find((x) => x.id === x3.id)).toMatchObject({ status: "archived" });
    expect((await rulesOf(x3.id)).some((r) => r.state === "armed")).toBe(false);

    // the next evening every key is free again and enters on the new nearest expiry
    await pass(W + 24 * HOUR, 83_200, ["2026-09-26", "2026-09-27", "2026-10-20"]);
    const next = (await strangles()).filter((x) => x.status === "paper");
    expect(next.map((x) => x.autopilotPlaybookId).sort()).toEqual(CLOCK_PLAYBOOKS.map((p) => p.id).sort());
    for (const x of next) expect((await legsOf(x.id)).every((l) => l.expiry === "2026-09-27")).toBe(true);

    // HC-TR-227: the target counts the whole trade. The put of the new take-half trade is stopped at twice its price; the
    // call then falling to a fifth of its price is a gain on the call alone, not half the premium on the trade: no fire.
    const half2 = next.find((x) => x.autopilotPlaybookId === "evening-strangle-take-half")!;
    const [hp, hc] = await legsOf(half2.id);
    const at2 = W + 26 * HOUR;
    await evaluateRules(t.deps, ticks({ [hp!.symbol]: 2 * Number(hp!.price), [hc!.symbol]: Number(hc!.price) }), () => at2);
    expect((await legsOf(half2.id)).map((l) => l.status)).toEqual(["squared_off", "open"]);
    await evaluateRules(t.deps, ticks({ [hc!.symbol]: Number(hc!.price) / 5 }), () => at2 + MIN);
    expect((await strangles()).find((x) => x.id === half2.id)!.status).toBe("paper");
    expect((await rulesOf(half2.id)).find((r) => r.kind === "target")!.state).toBe("armed");

    // HC-TR-228: the two ticks above moved the same strikes for the trail-the-rest trade: its put was stopped at twice its
    // price, which started a trail on the call, whose best so far is four fifths of its premium. The call rising back to
    // seven tenths of its price leaves three tenths: more than half of the best is given back, so the call is closed too.
    const trail = next.find((x) => x.autopilotPlaybookId === "evening-strangle-trail-rest")!;
    expect((await legsOf(trail.id)).map((l) => l.status)).toEqual(["squared_off", "open"]);
    expect((await rulesOf(trail.id)).filter((r) => r.kind === "trail" && r.state === "armed")).toHaveLength(1);
    // (first back to half its price: three eighths of the best given back, under half, so it is still held)
    await evaluateRules(t.deps, ticks({ [hc!.symbol]: 0.5 * Number(hc!.price) }), () => at2 + 2 * MIN);
    expect((await strangles()).find((x) => x.id === trail.id)!.status).toBe("paper");
    await evaluateRules(t.deps, ticks({ [hc!.symbol]: 0.7 * Number(hc!.price) }), () => at2 + 3 * MIN);
    expect((await strangles()).find((x) => x.id === trail.id)).toMatchObject({ status: "archived", closeReason: "stopped" });
    expect((await legsOf(trail.id)).every((l) => l.status === "squared_off")).toBe(true);
    // the stop-at-double trade on the same strikes kept its call: no trail, still held
    const kept = next.find((x) => x.autopilotPlaybookId === "evening-strangle-stop-2x")!;
    expect((await legsOf(kept.id)).map((l) => l.status)).toEqual(["squared_off", "open"]);
    expect((await strangles()).find((x) => x.id === kept.id)!.status).toBe("paper");

    // tomorrow's expiry missing from the snapshot: the monthly is not "the next expiry", so nothing is entered
    for (const x of next) await t.db.update(strategies).set({ status: "archived", closedAt: new Date(W + 30 * HOUR) }).where(eq(strategies.id, x.id));
    await pass(W + 48 * HOUR, 83_200, ["2026-09-27", "2026-10-20"]);
    expect((await strangles()).filter((x) => x.status === "paper")).toHaveLength(0);
    expect((await lines()).find((r) => r.playbookId === "evening-strangle-wings-3")).toMatchObject({ kind: "skipped", reason: "The next expiry has no prices yet" });
  });
});

describe("HC-TR-229 the weekly strangles: entered on their day for the Friday expiry", () => {
  const fri3x = autopilotPlaybookById("weekly-fri-strangle-stop-3x")!;
  const tue3x = autopilotPlaybookById("weekly-tue-strangle-stop-3x")!;
  const FRIDAY = Date.UTC(2026, 9, 9, 16, 5, 0); // Friday 9 October 2026, 21:35 IST

  it("HC-TR-229 a weekly window is open on its day of the week only", () => {
    expect(new Date(FRIDAY).getUTCDay()).toBe(5);
    expect([inWindow(fri3x.clock!, FRIDAY), inWindow(fri3x.clock!, FRIDAY - DAY), inWindow(fri3x.clock!, FRIDAY + HOUR), inWindow(fri3x.clock!, FRIDAY + 7 * DAY)]).toEqual([true, false, false, true]);
    expect([inWindow(tue3x.clock!, FRIDAY), inWindow(tue3x.clock!, FRIDAY + 4 * DAY), inWindow(tue3x.clock!, FRIDAY + 4 * DAY - HOUR)]).toEqual([false, true, false]);
    expect(WEEKLY_PLAYBOOKS).toHaveLength(10);
    // the hour's edges on the day, and the same hour the day after
    const f = (h: number, m: number, sec = 0, dayOfMonth = 9) => inWindow(fri3x.clock!, Date.UTC(2026, 9, dayOfMonth, h, m, sec));
    expect([f(15, 59, 59), f(16, 0), f(16, 59, 59), f(17, 0), f(16, 5, 0, 10)]).toEqual([false, true, true, false, false]);
  });

  it("HC-TR-229 enters on its day on the Friday expiry a week out, at the listed strikes nearest 3 % away, with its stops; another day, or no such expiry, is a reason", async () => {
    const me = await t.signUp("autopilot-weekly@hapiecoin.test");
    const id = ((await (await t.request("/v1/me", { cookie: me.cookie })).json()) as { id: string }).id;
    await put({ enabled: true, strategies: [{ playbookId: fri3x.id, exit: "own" }, { playbookId: tue3x.id, exit: "own" }, { playbookId: "weekly-fri-strangle-wings", exit: "own" }] }, me.cookie);
    const mineNow = () => t.db.select().from(strategies).where(eq(strategies.userId, id));
    const reasons = async () => new Map((await view(me.cookie)).runs.filter((r) => r.asset === "BTC").reverse().map((r) => [r.playbookId, r.reason]));
    /** A weekly ladder 500 apart; time value falling away from the money. */
    const weekAt = (ts: number, spot: number, expiries: readonly string[]): MarketSource => {
      const products: Instrument[] = [];
      const quotes: Quote[] = [];
      for (const e of expiries)
        for (let i = -20; i <= 20; i++) {
          const k = 83_000 + i * 500;
          const code = e.slice(8, 10) + e.slice(5, 7) + e.slice(2, 4);
          const tv = 1500 * Math.exp(-Math.abs(k - spot) / 2500);
          const c = `C-BTC-${k}-${code}`;
          const pt = `P-BTC-${k}-${code}`;
          products.push(inst(c, "call", k, e), inst(pt, "put", k, e));
          quotes.push({ instrumentId: `delta_india:${c}`, ts, mark: (Math.max(spot - k, 0) + tv).toFixed(1), oi: "1", spot: String(spot), markIv: 0.5 }, { instrumentId: `delta_india:${pt}`, ts, mark: (Math.max(k - spot, 0) + tv).toFixed(1), oi: "1", spot: String(spot), markIv: 0.5 });
        }
      return { venue: "delta_india", products: () => Promise.resolve(products), tickers: (u) => Promise.resolve(u === "BTC" ? quotes : []) };
    };
    const LISTED = ["2026-10-10", "2026-10-11", "2026-10-16", "2026-10-23"];
    const pass = async (at: number, expiries: readonly string[] = LISTED) => {
      await snapshotOnce(t.deps, weekAt(at - MIN, 83_200, expiries), () => at - MIN);
      return runAutopilot(deps(at, { maxOpen: undefined }), ["delta_india"]);
    };

    // Thursday, same hour: not its day
    await pass(FRIDAY - DAY);
    expect(await mineNow()).toHaveLength(0);
    expect((await reasons()).get(fri3x.id)).toBe("Outside its entry hours (Fridays, 9:30 to 10:30 PM IST)");

    // Friday with next Friday's expiry missing: the one after is not this trade
    await pass(FRIDAY, ["2026-10-10", "2026-10-11", "2026-10-23"]);
    expect(await mineNow()).toHaveLength(0);
    expect((await reasons()).get(fri3x.id)).toBe("Its Friday expiry has no prices yet");

    // Friday, a snapshot later: the Friday playbooks enter on 16 October, the Tuesday one waits for its day
    await pass(FRIDAY + 5 * MIN);
    const all = await mineNow();
    expect(all.map((x) => x.autopilotPlaybookId).sort()).toEqual([fri3x.id, "weekly-fri-strangle-wings"].sort());
    expect((await reasons()).get(tue3x.id)).toBe("Outside its entry hours (Tuesdays, 9:30 to 10:30 PM IST)");
    const legsOf = (sid: string) => t.db.select().from(strategyLegs).where(eq(strategyLegs.strategyId, sid)).orderBy(asc(strategyLegs.position));
    // 3 % of 83,200 is 2,496: 80,704 and 85,696, nearest listed 80,500 and 85,500; 7 % is 5,824: 77,376 and 89,024, nearest 77,500 and 89,000
    const naked = all.find((x) => x.autopilotPlaybookId === fri3x.id)!;
    expect(naked.name).toBe("Friday weekly strangle, stop at triple · Autopilot");
    expect((await legsOf(naked.id)).map((l) => `${l.side} ${l.kind} ${l.strike} ${l.expiry} x${l.lots}`)).toEqual(["sell put 80500 2026-10-16 x100", "sell call 85500 2026-10-16 x100"]);
    expect((await t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, naked.id))).map((r) => [r.kind, r.value, r.scope])).toEqual([["leg_stop", "3", "leg"], ["leg_stop", "3", "leg"]]);
    const winged = all.find((x) => x.autopilotPlaybookId === "weekly-fri-strangle-wings")!;
    expect((await legsOf(winged.id)).map((l) => `${l.side} ${l.kind} ${l.strike}`)).toEqual(["buy put 77500", "sell put 80500", "sell call 85500", "buy call 89000"]);
    expect(await t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, winged.id))).toHaveLength(0);
    const line = (await view(me.cookie)).runs.find((r) => r.kind === "entered" && r.strategyId === naked.id)!;
    expect(line.detail).toMatchObject({ exit: "own", expiry: "2026-10-16", dte: 7, legStop: 3 });

    // the rules engine and the settler on the rows the job made: the naked put is bought back at three times its price,
    // the call stays; at Friday's settlement between the strikes the rest is closed and both trades are archived
    const [put1, call1] = await legsOf(naked.id);
    await evaluateRules(t.deps, { tick: () => Promise.resolve({ marks: new Map([[put1!.symbol, 3.01 * Number(put1!.price)], [call1!.symbol, Number(call1!.price)]]), spot: null }) }, () => FRIDAY + DAY);
    expect((await legsOf(naked.id)).map((l) => l.status)).toEqual(["squared_off", "open"]);
    expect((await mineNow()).find((x) => x.id === naked.id)!.status).toBe("paper");

    // the Tuesday after: the Tuesday playbook enters on the same Friday expiry, three days out; the Friday trades are still held
    await pass(FRIDAY + 4 * DAY, ["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-23"]);
    const tue = (await mineNow()).find((x) => x.autopilotPlaybookId === tue3x.id)!;
    expect((await legsOf(tue.id)).every((l) => l.expiry === "2026-10-16")).toBe(true);
    expect(await mineNow()).toHaveLength(3);
    await settleExpired(t.deps, { spotAt: () => Promise.resolve(83_000) }, () => Date.UTC(2026, 9, 16, 12, 3, 0));
    const done = await mineNow();
    expect(done.map((x) => x.status)).toEqual(["archived", "archived", "archived"]);
    expect(done.find((x) => x.id === winged.id)).toMatchObject({ closeReason: "expired" });
    // the next Friday evening the key is free: it enters for the Friday after
    await pass(FRIDAY + 7 * DAY, ["2026-10-17", "2026-10-18", "2026-10-23", "2026-10-30"]);
    const again = (await mineNow()).filter((x) => x.status === "paper");
    expect(again.map((x) => x.autopilotPlaybookId).sort()).toEqual([fri3x.id, "weekly-fri-strangle-wings"].sort());
    for (const x of again) expect((await legsOf(x.id)).every((l) => l.expiry === "2026-10-23")).toBe(true);
  });
});

describe("HC-TR-233 the monthly strangles: once per expiry, in their range of days", () => {
  it("HC-TR-233 enters when a month-end expiry is in its range, with stops and the take at half the premium; no expiry in range, and an expiry already traded, are reasons", async () => {
    const near = autopilotPlaybookById("monthly-strangle-12pct-near")!;
    const me = await t.signUp("autopilot-monthly@hapiecoin.test");
    const id = ((await (await t.request("/v1/me", { cookie: me.cookie })).json()) as { id: string }).id;
    await put({ enabled: true, strategies: [{ playbookId: near.id, exit: "own" }] }, me.cookie);
    const mineNow = () => t.db.select().from(strategies).where(eq(strategies.userId, id));
    const last = async () => (await view(me.cookie)).runs.find((r) => r.playbookId === near.id)!;
    /** A monthly ladder 1,000 apart; time value falling away from the money. */
    const monthAt = (ts: number, expiries: readonly string[]): MarketSource => {
      const products: Instrument[] = [];
      const quotes: Quote[] = [];
      for (const e of expiries)
        for (let k = 65_000; k <= 101_000; k += 1000) {
          const code = e.slice(8, 10) + e.slice(5, 7) + e.slice(2, 4);
          const tv = 3000 * Math.exp(-Math.abs(k - 83_200) / 5000);
          const c = `C-BTC-${k}-${code}`;
          const pt = `P-BTC-${k}-${code}`;
          products.push(inst(c, "call", k, e), inst(pt, "put", k, e));
          quotes.push({ instrumentId: `delta_india:${c}`, ts, mark: (Math.max(83_200 - k, 0) + tv).toFixed(1), oi: "1", spot: "83200", markIv: 0.5 }, { instrumentId: `delta_india:${pt}`, ts, mark: (Math.max(k - 83_200, 0) + tv).toFixed(1), oi: "1", spot: "83200", markIv: 0.5 });
        }
      return { venue: "delta_india", products: () => Promise.resolve(products), tickers: (u) => Promise.resolve(u === "BTC" ? quotes : []) };
    };
    const pass = async (at: number, expiries: readonly string[]) => {
      await snapshotOnce(t.deps, monthAt(at - MIN, expiries), () => at - MIN);
      return runAutopilot(deps(at, { maxOpen: undefined }), ["delta_india"]);
    };
    const NOV1 = Date.UTC(2026, 10, 1, 16, 5, 0);
    // 1 November: November's month-end is 26 days out (too near), December's 54 (too far)
    await pass(NOV1, ["2026-11-02", "2026-11-27", "2026-12-25"]);
    expect(await mineNow()).toHaveLength(0);
    expect(await last()).toMatchObject({ kind: "skipped", reason: "No month-end expiry in its range yet" });

    // 15 November: December's month-end is 40 days out
    const NOV15 = NOV1 + 14 * DAY;
    await pass(NOV15, ["2026-11-16", "2026-11-27", "2026-12-25"]);
    const [first] = await mineNow();
    expect(first).toMatchObject({ status: "paper", name: "Monthly strangle, 12 % away, one month out · Autopilot" });
    const legs = await t.db.select().from(strategyLegs).where(eq(strategyLegs.strategyId, first!.id)).orderBy(asc(strategyLegs.position));
    // 12 % of 83,200 is 9,984: 73,216 and 93,184, nearest listed 73,000 and 93,000
    expect(legs.map((l) => `${l.side} ${l.kind} ${l.strike} ${l.expiry} x${l.lots}`)).toEqual(["sell put 73000 2026-12-25 x100", "sell call 93000 2026-12-25 x100"]);
    const rules = await t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, first!.id));
    expect(rules.map((r) => `${r.kind} ${r.kind === "leg_stop" ? r.value : ""}`.trim()).sort()).toEqual(["leg_stop 2", "leg_stop 2", "target"]);
    const entry = (await view(me.cookie)).runs.find((r) => r.kind === "entered" && r.strategyId === first!.id)!;
    expect(Number(rules.find((r) => r.kind === "target")!.thresholdUsd)).toBeCloseTo(-Number(entry.detail.entryCost) / 2, 1);
    expect(entry.detail).toMatchObject({ exit: "own", expiry: "2026-12-25", dte: 40, legStop: 2 });

    // the take closes it two days later; the next evenings the same expiry is still in range and is not taken again
    await t.db.update(strategies).set({ status: "archived", closedAt: new Date(NOV15 + 2 * DAY), closeReason: "target" }).where(eq(strategies.id, first!.id));
    await t.db.update(strategyLegs).set({ status: "squared_off", closedAt: new Date(NOV15 + 2 * DAY) }).where(eq(strategyLegs.strategyId, first!.id));
    await pass(NOV15 + 3 * DAY, ["2026-11-19", "2026-11-27", "2026-12-25"]);
    expect((await mineNow()).filter((x) => x.status === "paper")).toHaveLength(0);
    expect(await last()).toMatchObject({ kind: "skipped", reason: "Already traded this expiry" });

    // 20 December: January's month-end comes into range, a new expiry and a new trade
    await pass(Date.UTC(2026, 11, 20, 16, 5, 0), ["2026-12-21", "2026-12-25", "2027-01-29"]);
    const open = (await mineNow()).filter((x) => x.status === "paper");
    expect(open).toHaveLength(1);
    expect((await t.db.select().from(strategyLegs).where(eq(strategyLegs.strategyId, open[0]!.id))).every((l) => l.expiry === "2027-01-29")).toBe(true);
  });
});

describe("HC-TR-235 the evening strangles on ETH and XAUT", () => {
  it("HC-TR-235 an ETH and a Gold playbook enter on their own coin only, at the listed strikes a percentage of its spot away, sized by its lot, with their exits", async () => {
    const me = await t.signUp("autopilot-alts@hapiecoin.test");
    const id = ((await (await t.request("/v1/me", { cookie: me.cookie })).json()) as { id: string }).id;
    const ETH3 = "eth-evening-strangle-stop-3x";
    const ETHW = "eth-evening-strangle-wings";
    const GOLD = "xaut-evening-strangle-take-half";
    await put({ enabled: true, strategies: [ETH3, ETHW, GOLD].map((playbookId) => ({ playbookId, exit: "own" })) }, me.cookie);
    const mineNow = () => t.db.select().from(strategies).where(eq(strategies.userId, id));
    const EVENING = Date.UTC(2026, 9, 9, 16, 5, 0); // 21:35 IST
    /** Strikes every 10 on each coin; time value falling away from the money. BTC is listed too and must be left alone. */
    const coins = { BTC: { spot: 83_200, centre: 83_200, step: 200, tv: 600, width: 900, size: "0.001" }, ETH: { spot: 2304, centre: 2300, step: 10, tv: 30, width: 40, size: "0.01" }, XAUT: { spot: 4203, centre: 4200, step: 10, tv: 12, width: 30, size: "0.001" } } as const;
    const market = (ts: number): MarketSource => {
      const products: Instrument[] = [];
      const quotes: Record<string, Quote[]> = { BTC: [], ETH: [], XAUT: [] };
      for (const [u, c] of Object.entries(coins))
        for (const e of ["2026-10-10", "2026-10-11"])
          for (let i = -30; i <= 30; i++) {
            const k = c.centre + i * c.step;
            const code = e.slice(8, 10) + e.slice(5, 7) + e.slice(2, 4);
            const tv = c.tv * Math.exp(-Math.abs(k - c.spot) / c.width);
            for (const [kind, letter, intrinsic] of [["call", "C", Math.max(c.spot - k, 0)], ["put", "P", Math.max(k - c.spot, 0)]] as const) {
              const symbol = `${letter}-${u}-${k}-${code}`;
              products.push({ ...inst(symbol, kind, k, e), underlying: u as "BTC" | "ETH" | "XAUT", contractSize: c.size });
              quotes[u]!.push({ instrumentId: `delta_india:${symbol}`, ts, mark: (intrinsic + tv).toFixed(2), oi: "1", spot: String(c.spot), markIv: 0.5 });
            }
          }
      return { venue: "delta_india", products: () => Promise.resolve(products), tickers: (u) => Promise.resolve(quotes[u] ?? []) };
    };
    await snapshotOnce(t.deps, market(EVENING - MIN), () => EVENING - MIN);
    await runAutopilot(deps(EVENING, { maxOpen: undefined }), ["delta_india"]);

    const all = await mineNow();
    expect(all.map((x) => `${x.autopilotPlaybookId} ${x.asset}`).sort()).toEqual([`${ETH3} ETH`, `${ETHW} ETH`, `${GOLD} XAUT`].sort());
    const legsOf = (sid: string) => t.db.select().from(strategyLegs).where(eq(strategyLegs.strategyId, sid)).orderBy(asc(strategyLegs.position));
    const of = (pb: string) => all.find((x) => x.autopilotPlaybookId === pb)!;
    // ETH at 2,304: 1 % is 23.04, so 2,280.96 and 2,327.04, nearest listed 2,280 and 2,330
    expect(of(ETH3).name).toBe("ETH evening strangle, stop at triple · Autopilot");
    expect((await legsOf(of(ETH3).id)).map((l) => `${l.side} ${l.kind} ${l.strike} ${l.expiry} x${l.lots}`)).toEqual(["sell put 2280 2026-10-10 x100", "sell call 2330 2026-10-10 x100"]);
    expect((await t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, of(ETH3).id))).map((r) => [r.kind, r.value, r.scope])).toEqual([["leg_stop", "3", "leg"], ["leg_stop", "3", "leg"]]);
    // 1.5 % and 3.75 %: 2,270 and 2,340 sold, 2,220 and 2,390 bought; bounded, so no rule
    expect((await legsOf(of(ETHW).id)).map((l) => `${l.side} ${l.kind} ${l.strike}`)).toEqual(["buy put 2220", "sell put 2270", "sell call 2340", "buy call 2390"]);
    expect(await t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, of(ETHW).id))).toHaveLength(0);
    // Gold at 4,203: 1 % is 42.03, so 4,160.97 and 4,245.03, nearest listed 4,160 and 4,250; a stop on each and the take
    expect(of(GOLD).name).toBe("Gold evening strangle, take half · Autopilot");
    expect((await legsOf(of(GOLD).id)).map((l) => `${l.side} ${l.kind} ${l.strike} x${l.lots}`)).toEqual(["sell put 4160 x100", "sell call 4250 x100"]);
    expect((await t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, of(GOLD).id))).map((r) => r.kind).sort()).toEqual(["leg_stop", "leg_stop", "target"]);
    // what was written is what the screens can read
    const list = await t.request("/v1/strategies", { cookie: me.cookie });
    expect(list.status).toBe(200);
  });

  it("HC-TR-235 Gold has no Sunday expiry: on a Saturday evening the playbook waits and says so, on the Sunday evening it enters for Monday; today's expiry, settled minutes before, is never taken", async () => {
    const me = await t.signUp("autopilot-gold-weekend@hapiecoin.test");
    const id = ((await (await t.request("/v1/me", { cookie: me.cookie })).json()) as { id: string }).id;
    const GOLD = "xaut-evening-strangle-stop-2x";
    await put({ enabled: true, strategies: [{ playbookId: GOLD, exit: "own" }] }, me.cookie);
    const mineNow = () => t.db.select().from(strategies).where(eq(strategies.userId, id));
    const gold = (ts: number, expiries: readonly string[]): MarketSource => {
      const products: Instrument[] = [];
      const quotes: Quote[] = [];
      for (const e of expiries)
        for (let i = -30; i <= 30; i++) {
          const k = 4200 + i * 10;
          const code = e.slice(8, 10) + e.slice(5, 7) + e.slice(2, 4);
          const tv = 12 * Math.exp(-Math.abs(k - 4203) / 30);
          for (const [kind, letter, intrinsic] of [["call", "C", Math.max(4203 - k, 0)], ["put", "P", Math.max(k - 4203, 0)]] as const) {
            const symbol = `${letter}-XAUT-${k}-${code}`;
            products.push({ ...inst(symbol, kind, k, e), underlying: "XAUT" });
            quotes.push({ instrumentId: `delta_india:${symbol}`, ts, mark: (intrinsic + tv).toFixed(2), oi: "1", spot: "4203", markIv: 0.5 });
          }
        }
      return { venue: "delta_india", products: () => Promise.resolve(products), tickers: (u) => Promise.resolve(u === "XAUT" ? quotes : []) };
    };
    const pass = async (at: number, expiries: readonly string[]) => {
      await snapshotOnce(t.deps, gold(at - MIN, expiries), () => at - MIN);
      return runAutopilot(deps(at, { maxOpen: undefined }), ["delta_india"]);
    };
    const SATURDAY = Date.UTC(2026, 9, 17, 16, 5, 0); // Saturday 17 October 2026, 21:35 IST: today's expiry settled five minutes ago

    await pass(SATURDAY, ["2026-10-17", "2026-10-19", "2026-10-20"]);
    expect(await mineNow()).toHaveLength(0);
    const said = (await view(me.cookie)).runs.find((r) => r.playbookId === GOLD && r.asset === "XAUT")!;
    expect(said).toMatchObject({ kind: "skipped", reason: "The next expiry has no prices yet" });

    await pass(SATURDAY + DAY, ["2026-10-19", "2026-10-20"]);
    const [trade] = await mineNow();
    expect(trade).toMatchObject({ autopilotPlaybookId: GOLD, asset: "XAUT", status: "paper" });
    expect((await t.db.select().from(strategyLegs).where(eq(strategyLegs.strategyId, trade!.id))).map((l) => l.expiry)).toEqual(["2026-10-19", "2026-10-19"]);

    // Monday evening with Monday's expiry still listed and the trade still open: held, never a second one, never today's
    await pass(SATURDAY + 2 * DAY, ["2026-10-19", "2026-10-20", "2026-10-21"]);
    expect(await mineNow()).toHaveLength(1);
  });
});

describe("HC-TR-239 an Autopilot strategy with a profit ladder (ADR-120)", () => {
  it("HC-TR-239 enters with a step at each level, each an equal part of what is left, beside the stop on each sold option; the engine then takes the first step on paper and keeps the rest", async () => {
    const me = await t.signUp("autopilot-ladder@hapiecoin.test");
    const id = ((await (await t.request("/v1/me", { cookie: me.cookie })).json()) as { id: string }).id;
    const STEPS = "evening-strangle-steps";
    await put({ enabled: true, strategies: [{ playbookId: STEPS, exit: "own" }] }, me.cookie);
    const EVENING = Date.UTC(2027, 2, 5, 16, 5, 0); // 5 March 2027, 21:35 IST: after every snapshot the cases above have left
    const products: Instrument[] = [];
    const quotes: Quote[] = [];
    for (const e of ["2027-03-06", "2027-03-07"])
      for (let i = -30; i <= 30; i++) {
        const k = 83_200 + i * 200;
        const code = e.slice(8, 10) + e.slice(5, 7) + e.slice(2, 4);
        const tv = 600 * Math.exp(-Math.abs(k - 83_200) / 900);
        for (const [kind, letter, intrinsic] of [["call", "C", Math.max(83_200 - k, 0)], ["put", "P", Math.max(k - 83_200, 0)]] as const) {
          const symbol = `${letter}-BTC-${k}-${code}`;
          products.push(inst(symbol, kind, k, e));
          quotes.push({ instrumentId: `delta_india:${symbol}`, ts: EVENING - MIN, mark: (intrinsic + tv).toFixed(2), oi: "1", spot: "83200", markIv: 0.5 });
        }
      }
    await snapshotOnce(t.deps, { venue: "delta_india", products: () => Promise.resolve(products), tickers: (u) => Promise.resolve(u === "BTC" ? quotes : []) }, () => EVENING - MIN);
    await runAutopilot(deps(EVENING, { maxOpen: undefined }), ["delta_india"]);

    const [trade] = await t.db.select().from(strategies).where(eq(strategies.userId, id));
    expect(trade).toMatchObject({ autopilotPlaybookId: STEPS, asset: "BTC", status: "paper", name: "Evening strangle, profit steps · Autopilot" });
    const legsNow = () => t.db.select().from(strategyLegs).where(eq(strategyLegs.strategyId, trade!.id)).orderBy(asc(strategyLegs.position));
    // 1 % of 83,200 is 832: 82,368 and 84,032, nearest listed 82,400 and 84,000
    const legs = await legsNow();
    expect(legs.map((l) => `${l.side} ${l.kind} ${l.strike} ${l.expiry} x${l.lots}`)).toEqual(["sell put 82400 2027-03-06 x100", "sell call 84000 2027-03-06 x100"]);
    const rules = await t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, trade!.id));
    expect(rules.filter((r) => r.kind === "leg_stop").map((r) => [r.value, r.scope])).toEqual([["3", "leg"], ["3", "leg"]]);
    expect(rules.filter((r) => r.kind === "step").sort((a, b) => Number(a.value) - Number(b.value)).map((r) => [r.trigger, r.value, r.thresholdUsd, r.closeShare, r.state])).toEqual([["pct", "25", "25", "0.25", "armed"], ["pct", "50", "50", "0.333333", "armed"], ["pct", "75", "75", "0.5", "armed"]]);
    expect(rules.some((r) => r.kind === "target")).toBe(false);
    const line = (await view(me.cookie)).runs.find((r) => r.kind === "entered" && r.strategyId === trade!.id)!;
    expect(line.detail).toMatchObject({ exit: "own", legStop: 3, ladder: [25, 50, 75] });
    expect(line.detail.targetUsd).toBeUndefined();

    // both options at seven tenths of their entry: the open lots are up 30 %, so the first step goes and the others wait
    const marks = new Map(legs.map((l) => [l.symbol, 0.7 * Number(l.price)]));
    const fired = await evaluateRules(t.deps, { tick: () => Promise.resolve({ marks, spot: null }) }, () => EVENING + HOUR);
    expect(fired.fired).toHaveLength(1);
    expect((await legsNow()).filter((l) => l.status === "open").map((l) => l.lots)).toEqual([75, 75]);
    expect((await legsNow()).filter((l) => l.status === "squared_off").map((l) => [l.lots, l.closeReason])).toEqual([[25, "target"], [25, "target"]]);
    expect((await t.db.select().from(strategies).where(eq(strategies.id, trade!.id)))[0]!.status).toBe("paper");
    // what was written is what the screens can read
    expect((await t.request("/v1/strategies", { cookie: me.cookie })).status).toBe(200);
    expect((await t.request("/v1/autopilot", { cookie: me.cookie })).status).toBe(200);
  });
});

describe("HC-TR-241 the lab's strategies in the engine: a profit lock, a timed exit, an afternoon entry (ADR-121)", () => {
  const fees = { optionPct: 0.0001, optionCapOfPremium: 0.035, futurePct: 0.0005, gstPct: 0.18, settlementFee: true };
  const sold = (entryCost: number): PlaybookProposal => ({ day: "2027-03-12", spot: 83_200, expiry: "2027-03-13", legs: [{ asset: "BTC", kind: "put", side: "sell", strike: "82400", expiry: "2027-03-13", lots: 100, price: "400" }, { asset: "BTC", kind: "call", side: "sell", strike: "84000", expiry: "2027-03-13", lots: 100, price: "400" }], entryCost, maxProfit: -entryCost, maxLoss: -Infinity });

  it("HC-TR-241 the plan carries the lock as money (half and a quarter of the premium) and the exit hour; a floor that rounds to nothing is no plan; the next 20:00 UTC is today's or tomorrow's", () => {
    const lock = clockPlanFor(autopilotPlaybookById("evening-strangle-lock")!, sold(-80), 0.001, null)!;
    expect(lock).toMatchObject({ targetUsd: null, legStop: 3, lock: { atUsd: 40, floorUsd: 20 }, exitHourUtc: null, ladder: null });
    expect(clockPlanFor(autopilotPlaybookById("evening-strangle-lock")!, sold(-0.03), 0.001, null)).toBeNull();
    expect(clockPlanFor(autopilotPlaybookById("evening-strangle-out-early")!, sold(-80), 0.001, fees)).toMatchObject({ lock: null, exitHourUtc: 20, legStop: 3, takeTrailPct: null, legBuyBackAt: null, legBuyBackShare: null });
    expect(clockPlanFor(autopilotPlaybookById("evening-strangle-half-trail")!, sold(-80), 0.001, null)).toMatchObject({ targetUsd: 40, takeTrailPct: 20, legStop: 3 });
    expect(new Date(nextHourUtc(Date.UTC(2027, 2, 12, 16, 5), 20)).toISOString()).toBe("2027-03-12T20:00:00.000Z");
    expect(new Date(nextHourUtc(Date.UTC(2027, 2, 12, 20, 0), 20)).toISOString()).toBe("2027-03-13T20:00:00.000Z");
    expect(new Date(nextHourUtc(Date.UTC(2027, 2, 12, 23, 30), 20)).toISOString()).toBe("2027-03-13T20:00:00.000Z");
  });

  it("HC-TR-241 in the evening the lock and the timed exit are armed at entry beside the stops; in the afternoon the late entry takes that day's expiry; each only in its own window", async () => {
    const me = await t.signUp("autopilot-lab@hapiecoin.test");
    const id = ((await (await t.request("/v1/me", { cookie: me.cookie })).json()) as { id: string }).id;
    const LOCK = "evening-strangle-lock";
    const OUT = "evening-strangle-out-early";
    const NEAR = "evening-strangle-close";
    const PM = "afternoon-strangle-take-half";
    const TRAIL = "evening-strangle-half-trail";
    await put({ enabled: true, strategies: [LOCK, OUT, NEAR, PM, TRAIL].map((playbookId) => ({ playbookId, exit: "own" })) }, me.cookie);
    const market = (ts: number, expiries: readonly string[]): MarketSource => {
      const products: Instrument[] = [];
      const quotes: Quote[] = [];
      for (const e of expiries)
        for (let i = -30; i <= 30; i++) {
          const k = 83_200 + i * 200;
          const code = e.slice(8, 10) + e.slice(5, 7) + e.slice(2, 4);
          const tv = 600 * Math.exp(-Math.abs(k - 83_200) / 900);
          for (const [kind, letter, intrinsic] of [["call", "C", Math.max(83_200 - k, 0)], ["put", "P", Math.max(k - 83_200, 0)]] as const) {
            const symbol = `${letter}-BTC-${k}-${code}`;
            products.push(inst(symbol, kind, k, e));
            quotes.push({ instrumentId: `delta_india:${symbol}`, ts, mark: (intrinsic + tv).toFixed(2), oi: "1", spot: "83200", markIv: 0.5 });
          }
        }
      return { venue: "delta_india", products: () => Promise.resolve(products), tickers: (u) => Promise.resolve(u === "BTC" ? quotes : []) };
    };
    const pass = async (at: number, expiries: readonly string[]) => {
      await snapshotOnce(t.deps, market(at - MIN, expiries), () => at - MIN);
      return runAutopilot(deps(at, { maxOpen: undefined }), ["delta_india"]);
    };
    const mineNow = () => t.db.select().from(strategies).where(eq(strategies.userId, id));
    const reasons = async () => new Map((await view(me.cookie)).runs.filter((r) => r.asset === "BTC").reverse().map((r) => [r.playbookId, r.reason]));
    const legsOf = (sid: string) => t.db.select().from(strategyLegs).where(eq(strategyLegs.strategyId, sid)).orderBy(asc(strategyLegs.position));
    const rulesOf = (sid: string) => t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, sid));

    // Friday 12 March 2027, 15:35 IST: the afternoon one enters on today's expiry, two hours out; the evening ones wait
    const AFTERNOON = Date.UTC(2027, 2, 12, 10, 5, 0);
    await pass(AFTERNOON, ["2027-03-12", "2027-03-13"]);
    let all = await mineNow();
    expect(all.map((x) => x.autopilotPlaybookId)).toEqual([PM]);
    // 0.25 % of 83,200 is 208: 82,992 and 83,408, nearest listed 83,000 and 83,400
    expect((await legsOf(all[0]!.id)).map((l) => `${l.side} ${l.kind} ${l.strike} ${l.expiry} x${l.lots}`)).toEqual(["sell put 83000 2027-03-12 x100", "sell call 83400 2027-03-12 x100"]);
    expect((await rulesOf(all[0]!.id)).map((r) => r.kind).sort()).toEqual(["leg_stop", "leg_stop", "target"]);
    expect((await reasons()).get(LOCK)).toBe("Outside its entry hours (9:30 to 10:30 PM IST)");

    // the same evening, 21:35 IST: the three evening ones enter on tomorrow's expiry; the afternoon one is outside its hours
    const EVENING = Date.UTC(2027, 2, 12, 16, 5, 0);
    await pass(EVENING, ["2027-03-13", "2027-03-14"]);
    all = await mineNow();
    expect(all.map((x) => x.autopilotPlaybookId).sort()).toEqual([LOCK, NEAR, OUT, PM, TRAIL].sort());
    expect((await reasons()).get(PM)).toBe("Outside its entry hours (3:30 to 4:30 PM IST)");
    const of = (pb: string) => all.find((x) => x.autopilotPlaybookId === pb)!;
    // the lock: half and a quarter of the premium collected, beside a stop on each option, and no target
    const lockLegs = await legsOf(of(LOCK).id);
    const credit = lockLegs.reduce((sum, l) => sum + Number(l.price) * l.lots * 0.001, 0);
    const lockRules = await rulesOf(of(LOCK).id);
    expect(lockRules.map((r) => r.kind).sort()).toEqual(["leg_stop", "leg_stop", "lock"]);
    const lock = lockRules.find((r) => r.kind === "lock")!;
    expect(Number(lock.value)).toBeCloseTo(credit / 2, 2);
    expect(Number(lock.thresholdUsd)).toBeCloseTo(credit / 4, 2);
    expect(lock).toMatchObject({ trigger: "money", scope: "strategy", state: "armed", peakPnl: null });
    const lockLine = (await view(me.cookie)).runs.find((r) => r.kind === "entered" && r.strategyId === of(LOCK).id)!;
    expect(lockLine.detail).toMatchObject({ legStop: 3, lock: { at: lock.value, floor: lock.thresholdUsd } });
    // out early: a time exit at 20:00 UTC the same evening (01:30 IST)
    const outRules = await rulesOf(of(OUT).id);
    expect(outRules.map((r) => r.kind).sort()).toEqual(["leg_stop", "leg_stop", "time"]);
    expect(outRules.find((r) => r.kind === "time")).toMatchObject({ trigger: "at", value: "2027-03-12T20:00:00.000Z", thresholdUsd: String(Date.UTC(2027, 2, 12, 20)) });
    expect((await view(me.cookie)).runs.find((r) => r.kind === "entered" && r.strategyId === of(OUT).id)!.detail).toMatchObject({ exitAt: "2027-03-12T20:00:00.000Z" });
    // half then trail: a target at half the premium that trails with a give-back of 20 % instead of closing
    const trailTarget = (await rulesOf(of(TRAIL).id)).find((r) => r.kind === "target")!;
    expect(trailTarget).toMatchObject({ trigger: "money", trailTrigger: "pct", trailValue: "20", peakPnl: null });
    expect(Number(trailTarget.thresholdUsd)).toBeCloseTo(credit / 2, 2);
    expect((await view(me.cookie)).runs.find((r) => r.kind === "entered" && r.strategyId === of(TRAIL).id)!.detail).toMatchObject({ takeTrailPct: 20, legStop: 3 });
    // half a per cent away: 0.5 % of 83,200 is 416, nearest listed 82,800 and 83,600
    expect((await legsOf(of(NEAR).id)).map((l) => `${l.side} ${l.kind} ${l.strike}`)).toEqual(["sell put 82800", "sell call 83600"]);

    // the engine on the rows the job made: at 01:30 IST the timed exit closes its trade at the marks
    const marks = new Map((await legsOf(of(OUT).id)).map((l) => [l.symbol, 0.9 * Number(l.price)]));
    for (const x of all) for (const l of await legsOf(x.id)) if (!marks.has(l.symbol)) marks.set(l.symbol, Number(l.price));
    await evaluateRules(t.deps, { tick: () => Promise.resolve({ marks, spot: null }) }, () => Date.UTC(2027, 2, 12, 19, 59));
    expect((await mineNow()).find((x) => x.id === of(OUT).id)!.status).toBe("paper");
    await evaluateRules(t.deps, { tick: () => Promise.resolve({ marks, spot: null }) }, () => Date.UTC(2027, 2, 12, 20, 0, 5));
    expect((await mineNow()).find((x) => x.id === of(OUT).id)).toMatchObject({ status: "archived", closeReason: "squared_off" });
    // the lock and the trail the job armed, run by the engine. Every option at 40 % of its entry: each trade is up 60 %
    // of its premium, past half. The lock is set and closes nothing; the trailing target starts and closes nothing.
    const LATER = Date.UTC(2027, 2, 12, 20, 30);
    const tickAt = async (share: number, ms: number) => {
      const m = new Map<string, number>();
      for (const x of await mineNow()) for (const l of await legsOf(x.id)) if (l.status === "open") m.set(l.symbol, share * Number(l.price));
      return evaluateRules(t.deps, { tick: () => Promise.resolve({ marks: m, spot: null }) }, () => ms);
    };
    const stateOf = async (pb: string) => (await mineNow()).find((x) => x.autopilotPlaybookId === pb)!.status;
    await tickAt(0.4, LATER);
    expect(await stateOf(LOCK)).toBe("paper");
    expect(await stateOf(TRAIL)).toBe("paper");
    expect(Number((await rulesOf(of(LOCK).id)).find((r) => r.kind === "lock")!.peakPnl)).toBeCloseTo(0.6 * credit, 1);
    expect(Number((await rulesOf(of(TRAIL).id)).find((r) => r.kind === "target")!.peakPnl)).toBeCloseTo(0.6 * credit, 1);
    // back to 45 % of the premium: the trail has given back a quarter of its best (more than its fifth) and closes;
    // the lock's floor is at 25 %, so its trade stays
    await tickAt(0.55, LATER + MIN);
    expect((await mineNow()).find((x) => x.id === of(TRAIL).id)).toMatchObject({ status: "archived", closeReason: "target" });
    expect(await stateOf(LOCK)).toBe("paper");
    // down to 20 % of the premium: under the floor, the lock closes its trade; one fire a strategy a tick
    await tickAt(0.8, LATER + 2 * MIN);
    const locked = (await mineNow()).find((x) => x.id === of(LOCK).id)!;
    expect(locked).toMatchObject({ status: "archived", closeReason: "target" });
    expect(Number(locked.realizedPnl)).toBeCloseTo(0.2 * credit, 1);
    // the bolder one, with the stop alone, is still held
    expect(await stateOf(NEAR)).toBe("paper");
    // what was written is what the screens can read
    expect((await t.request("/v1/strategies", { cookie: me.cookie })).status).toBe(200);
    expect((await t.request("/v1/autopilot", { cookie: me.cookie })).status).toBe(200);
  });
});

describe("HC-TR-234 what Autopilot writes can be read back", () => {
  it("HC-TR-234 every playbook's strategy name fits a strategy name, whole; a longer playbook name would be cut, never refused", () => {
    for (const p of AUTOPILOT_PLAYBOOKS) expect(`${p.name}${AUTOPILOT_NAME_SUFFIX}`.length, p.id).toBeLessThanOrEqual(MAX_STRATEGY_NAME);
    expect(new Set(AUTOPILOT_PLAYBOOKS.map((p) => p.name)).size).toBe(AUTOPILOT_PLAYBOOKS.length); // and they stay distinct
    expect(AUTOPILOT_PLAYBOOKS.length).toBeLessThanOrEqual(AUTOPILOT_MAX_STRATEGIES); // the settings can hold them all switched on
  });

  it("HC-TR-234 the strategies Autopilot opened pass the schema the screens read the list with", async () => {
    const rows = await t.db.select().from(strategies);
    const auto = rows.filter((r) => r.autopilotPlaybookId !== null);
    expect(auto.length).toBeGreaterThan(5);
    for (const r of auto) expect(r.name.length, r.name).toBeLessThanOrEqual(MAX_STRATEGY_NAME);
    // through the API, as the first trader: the whole list parses
    const list = StrategyList.safeParse(await (await t.request("/v1/strategies", { cookie })).json());
    expect(list.success).toBe(true);
  });
});

describe("HC-TR-242 one side after a move (ADR-122)", () => {
  it("HC-TR-242 the stored spot nearest an instant, within half an hour of it; a spot of zero is not one", async () => {
    const AT = Date.UTC(2027, 3, 1, 16, 0, 0);
    const row = (offsetMin: number, spot: string) => ({ venue: "delta_india" as const, asset: "BTC" as const, expiry: "2027-04-02", ts: new Date(AT + offsetMin * MIN), atmIv: "0.5", spot, atmStrike: "80000", front: true });
    expect(await spotNear(t.db, "delta_india", "BTC", AT)).toBeNull();
    await t.db.insert(ivSnapshots).values([row(-40, "70000"), row(-20, "80100"), row(-5, "80200"), row(-1, "0"), row(10, "80300"), row(45, "90000")]);
    expect(await spotNear(t.db, "delta_india", "BTC", AT)).toBe(80_200);
    expect(await spotNear(t.db, "delta_india", "BTC", AT + 12 * MIN)).toBe(80_300);
    expect(await spotNear(t.db, "delta_india", "ETH", AT)).toBeNull();
    expect(SPOT_NEAR_MS).toBe(30 * MIN);
  });

  it("HC-TR-242 no entry without the spot of 24 hours earlier; after a rise the put alone, after a fall the call alone, after a flat day both, each with its own stop; the entry records the move", async () => {
    const me = await t.signUp("autopilot-move@hapiecoin.test");
    const id = ((await (await t.request("/v1/me", { cookie: me.cookie })).json()) as { id: string }).id;
    const PB = "evening-strangle-one-side";
    const HELD = "Holds a trade already: one at a time for a strategy and coin";
    const STOPPED = { status: "archived", closeReason: "stopped" };
    await put({ enabled: true, strategies: [{ playbookId: PB, exit: "own" }] }, me.cookie);
    const market = (ts: number, spot: number, expiries: readonly string[]): MarketSource => {
      const products: Instrument[] = [];
      const quotes: Quote[] = [];
      for (const e of expiries)
        for (let i = -40; i <= 40; i++) {
          const k = 83_200 + i * 200;
          const code = e.slice(8, 10) + e.slice(5, 7) + e.slice(2, 4);
          const tv = 600 * Math.exp(-Math.abs(k - spot) / 900);
          for (const [kind, letter, intrinsic] of [["call", "C", Math.max(spot - k, 0)], ["put", "P", Math.max(k - spot, 0)]] as const) {
            const symbol = `${letter}-BTC-${k}-${code}`;
            products.push(inst(symbol, kind, k, e));
            quotes.push({ instrumentId: `delta_india:${symbol}`, ts, mark: (intrinsic + tv).toFixed(2), oi: "1", spot: String(spot), markIv: 0.5 });
          }
        }
      return { venue: "delta_india", products: () => Promise.resolve(products), tickers: (u) => Promise.resolve(u === "BTC" ? quotes : []) };
    };
    // one pass a day at 21:35 IST in April 2027, on the next day's expiry
    const evening = (day: number) => Date.UTC(2027, 3, day, 16, 5, 0);
    const iso = (day: number) => `2027-04-${String(day).padStart(2, "0")}`;
    const pass = async (day: number, spot: number, lateMin = 0) => {
      const at = evening(day) + lateMin * MIN;
      await snapshotOnce(t.deps, market(at - MIN, spot, [iso(day + 1), iso(day + 2)]), () => at - MIN);
      return runAutopilot(deps(at, { maxOpen: undefined }), ["delta_india"]);
    };
    const mine = () => t.db.select().from(strategies).where(eq(strategies.userId, id)).orderBy(asc(strategies.startedAt));
    const legsOf = (sid: string) => t.db.select().from(strategyLegs).where(eq(strategyLegs.strategyId, sid)).orderBy(asc(strategyLegs.position));
    const rulesOf = (sid: string) => t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, sid));
    const runs = async () => (await view(me.cookie)).runs.filter((r) => r.playbookId === PB);
    const last = async () => {
      const all = await mine();
      const s = all[all.length - 1]!;
      const out = { n: all.length, legs: (await legsOf(s.id)).map((l) => `${l.side} ${l.kind} ${l.strike} ${l.expiry} x${l.lots}`), rules: (await rulesOf(s.id)).map((r) => `${r.kind} ${r.trigger} ${r.value}`), mode: s.tradingMode, status: s.status };
      // yesterday's trade has settled by the next evening: out of the way of the next entry
      await t.db.update(strategies).set({ status: "archived", closedAt: new Date(s.startedAt!.getTime() + 20 * 60 * MIN) }).where(eq(strategies.id, s.id));
      return out;
    };

    // 10 April: no snapshot from the evening of the 9th, so nothing to judge the move on
    await pass(10, 83_200);
    expect(await mine()).toHaveLength(0);
    expect((await runs())[0]).toMatchObject({ kind: "skipped", reason: "No spot price from 24 hours ago to judge the move on" });

    // 11 April: 84,500 against 83,200 is +1.56 %: the put alone, 1 % under the spot (83,655, nearest listed 83,600)
    await pass(11, 84_500);
    expect((await runs())[0]).toMatchObject({ kind: "entered", detail: { move: { pct: "1.56", side: "put" }, legStop: 3 } });
    // ten minutes on, still in the window, the spot is back near yesterday's: the rule would now say both sides, but the
    // evening's trade is taken; nothing more is entered
    await pass(11, 83_300, 10);
    expect(await mine()).toHaveLength(1);
    expect((await runs())[0]).toMatchObject({ kind: "skipped", reason: HELD });
    expect(await last()).toEqual({ n: 1, legs: ["sell put 83600 2027-04-12 x100"], rules: ["leg_stop multiple 3"], mode: "paper", status: "paper" });

    // 12 April: 83,000 against 84,500 is -1.78 %: the call alone, 1 % over the spot (83,830, nearest listed 83,800)
    await pass(12, 83_000);
    expect((await runs())[0]!.detail.move).toEqual({ pct: "-1.78", side: "call" });
    // the one stop is the trade's only exit before settlement: run by the engine, the call at three times its price is
    // bought back and, nothing being left open, the trade is closed as stopped
    const callTrade = (await mine())[1]!;
    const [call] = await legsOf(callTrade.id);
    expect((await evaluateRules(t.deps, { tick: () => Promise.resolve({ marks: new Map([[call!.symbol, 2.9 * Number(call!.price)]]), spot: null }) }, () => evening(12) + 30 * MIN)).fired).toHaveLength(0);
    expect((await evaluateRules(t.deps, { tick: () => Promise.resolve({ marks: new Map([[call!.symbol, 3 * Number(call!.price)]]), spot: null }) }, () => evening(12) + 31 * MIN)).fired).toHaveLength(1);
    expect((await legsOf(callTrade.id)).map((l) => `${l.status} ${l.closeReason}`)).toEqual(["squared_off stopped"]);
    expect((await mine())[1]).toMatchObject(STOPPED);
    expect(await last()).toMatchObject({ n: 2, legs: ["sell call 83800 2027-04-13 x100"], rules: ["leg_stop multiple 3"] });

    // 13 April: 83,400 against 83,000 is +0.48 %: both sides, as the plain evening strangle
    await pass(13, 83_400);
    expect(await last()).toMatchObject({ n: 3, legs: ["sell put 82600 2027-04-14 x100", "sell call 84200 2027-04-14 x100"], rules: ["leg_stop multiple 3", "leg_stop multiple 3"] });
    expect((await runs())[0]!.detail.move).toEqual({ pct: "0.48", side: "both" });

    // what was written is what the screen can read
    expect((await t.request("/v1/autopilot", { cookie: me.cookie })).status).toBe(200);
  });
});

describe("HC-TR-246 the evening strangle that buys a cheap option back (ADR-123)", () => {
  it("HC-TR-246 HC-TR-248 at entry each sold option gets a stop at triple and a buy-back at 5 dollars; run by the engine, the option that falls to 5 is bought back alone and the other is kept; the 20 % one arms a fifth of each option's own price", async () => {
    const me = await t.signUp("autopilot-buyback@hapiecoin.test");
    const id = ((await (await t.request("/v1/me", { cookie: me.cookie })).json()) as { id: string }).id;
    const PB = "evening-strangle-buy-back";
    expect(clockPlanFor(autopilotPlaybookById(PB)!, { day: "2027-05-10", spot: 83_200, expiry: "2027-05-11", legs: [], entryCost: -80, maxProfit: 80, maxLoss: -Infinity }, 0.001, null)).toMatchObject({ legStop: 3, legBuyBackAt: 5, targetUsd: null });
    await put({ enabled: true, strategies: [{ playbookId: PB, exit: "own" }] }, me.cookie);
    const products: Instrument[] = [];
    const quotes: Quote[] = [];
    const AT = Date.UTC(2027, 4, 10, 16, 5, 0);
    for (const e of ["2027-05-11", "2027-05-12"])
      for (let i = -30; i <= 30; i++) {
        const k = 83_200 + i * 200;
        const code = e.slice(8, 10) + e.slice(5, 7) + e.slice(2, 4);
        const tv = 600 * Math.exp(-Math.abs(k - 83_200) / 900);
        for (const [kind, letter, intrinsic] of [["call", "C", Math.max(83_200 - k, 0)], ["put", "P", Math.max(k - 83_200, 0)]] as const) {
          const symbol = `${letter}-BTC-${k}-${code}`;
          products.push(inst(symbol, kind, k, e));
          quotes.push({ instrumentId: `delta_india:${symbol}`, ts: AT - MIN, mark: (intrinsic + tv).toFixed(2), oi: "1", spot: "83200", markIv: 0.5 });
        }
      }
    await snapshotOnce(t.deps, { venue: "delta_india", products: () => Promise.resolve(products), tickers: (u) => Promise.resolve(u === "BTC" ? quotes : []) }, () => AT - MIN);
    await runAutopilot(deps(AT, { maxOpen: undefined }), ["delta_india"]);
    const [trade] = await t.db.select().from(strategies).where(eq(strategies.userId, id));
    expect(trade).toMatchObject({ autopilotPlaybookId: PB, status: "paper", tradingMode: "paper" });
    const legsNow = () => t.db.select().from(strategyLegs).where(eq(strategyLegs.strategyId, trade!.id)).orderBy(asc(strategyLegs.position));
    const rulesNow = async () => (await t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, trade!.id))).map((r) => `${r.kind} ${r.trigger} ${r.value} ${r.scope} ${r.state}`).sort();
    const legs = await legsNow();
    // 1 % of 83,200 is 832: 82,368 and 84,032, nearest listed 82,400 and 84,000
    expect(legs.map((l) => `${l.side} ${l.kind} ${l.strike} x${l.lots}`)).toEqual(["sell put 82400 x100", "sell call 84000 x100"]);
    expect(await rulesNow()).toEqual(["leg_stop multiple 3 leg armed", "leg_stop multiple 3 leg armed", "leg_take price 5 leg armed", "leg_take price 5 leg armed"]);
    const buyBacks = (await t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, trade!.id))).filter((r) => r.kind === "leg_take");
    expect(buyBacks.map((r) => r.thresholdUsd)).toEqual(["5", "5"]);
    expect(buyBacks.map((r) => r.legId).sort()).toEqual(legs.map((l) => l.id).sort());
    expect((await view(me.cookie)).runs.find((r) => r.playbookId === PB && r.kind === "entered")!.detail).toMatchObject({ legStop: 3, legBuyBackAt: "5" });
    // the engine: the call falls to 5 while the put is unchanged; the call alone is bought back
    const [putLeg, callLeg] = legs;
    const tick = (putMark: number, callMark: number, ms: number) => evaluateRules(t.deps, { tick: () => Promise.resolve({ marks: new Map([[putLeg!.symbol, putMark], [callLeg!.symbol, callMark]]), spot: null }) }, () => ms);
    expect((await tick(Number(putLeg!.price), 5.5, AT + 10 * MIN)).fired).toHaveLength(0);
    expect((await tick(Number(putLeg!.price), 5, AT + 11 * MIN)).fired).toHaveLength(1);
    expect((await legsNow()).map((l) => `${l.kind} ${l.status} ${l.closeReason ?? ""}`)).toEqual(["put open ", "call squared_off target"]);
    const [after] = await t.db.select().from(strategies).where(eq(strategies.id, trade!.id));
    expect(after!.status).toBe("paper");
    expect(Number(after!.realizedPnl)).toBeCloseTo((Number(callLeg!.price) - 5) * 0.1, 2);
    // the next tick ends the stop that watched the call; the put keeps its stop and its own buy-back
    await tick(Number(putLeg!.price), 5, AT + 12 * MIN);
    expect(await rulesNow()).toEqual(["leg_stop multiple 3 leg armed", "leg_stop multiple 3 leg disarmed", "leg_take price 5 leg armed", "leg_take price 5 leg fired"]);
    // what was written is what the screens can read
    expect((await t.request("/v1/strategies", { cookie: me.cookie })).status).toBe(200);
    expect((await t.request("/v1/autopilot", { cookie: me.cookie })).status).toBe(200);
    await t.db.update(strategies).set({ status: "archived" }).where(eq(strategies.id, trade!.id));

    // HC-TR-248: the same evening's prices an hour's window later for the 20 % one: each buy-back is a fifth of the
    // price its own option was sold at
    const SHARE = "evening-strangle-buy-back-20pct";
    expect(clockPlanFor(autopilotPlaybookById(SHARE)!, { day: "2027-05-10", spot: 83_200, expiry: "2027-05-11", legs: [], entryCost: -80, maxProfit: 80, maxLoss: -Infinity }, 0.001, null)).toMatchObject({ legStop: 3, legBuyBackShare: 0.2, legBuyBackAt: null });
    await put({ enabled: true, strategies: [{ playbookId: SHARE, exit: "own" }] }, me.cookie);
    await runAutopilot(deps(AT + MIN, { maxOpen: undefined }), ["delta_india"]);
    const second = (await t.db.select().from(strategies).where(eq(strategies.userId, id))).find((x) => x.autopilotPlaybookId === SHARE)!;
    expect(second).toMatchObject({ status: "paper", tradingMode: "paper" });
    const legs2 = await t.db.select().from(strategyLegs).where(eq(strategyLegs.strategyId, second.id)).orderBy(asc(strategyLegs.position));
    const takes = (await t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, second.id))).filter((r) => r.kind === "leg_take");
    expect(takes.map((r) => `${r.trigger} ${r.value} ${r.scope} ${r.state}`)).toEqual(["multiple 0.2 leg armed", "multiple 0.2 leg armed"]);
    for (const l of legs2) expect(Number(takes.find((r) => r.legId === l.id)!.thresholdUsd)).toBeCloseTo(0.2 * Number(l.price), 2);
    expect((await view(me.cookie)).runs.find((r) => r.playbookId === SHARE && r.kind === "entered")!.detail).toMatchObject({ legStop: 3, legBuyBackShare: 0.2 });
    expect((await t.request("/v1/strategies", { cookie: me.cookie })).status).toBe(200);
    expect((await t.request("/v1/autopilot", { cookie: me.cookie })).status).toBe(200);
    await t.db.update(strategies).set({ status: "archived" }).where(eq(strategies.id, second.id));
  });
});

describe("HC-TR-249 the BTC Friday weekly closed at 90 % of the premium (ADR-125)", () => {
  it("HC-TR-249 its plan is a target at 90 % of the premium collected beside the stop at triple, and nothing else; a target at that level, armed by hand here, closes the whole trade (the job's own arming of a take-profit share is HC-TR-227's)", async () => {
    const pb = autopilotPlaybookById("weekly-fri-strangle-take-90")!;
    const plan = clockPlanFor(pb, { day: "2027-05-14", spot: 83_200, expiry: "2027-05-21", legs: [], entryCost: -150, maxProfit: 150, maxLoss: -Infinity }, 0.001, null)!;
    expect(plan).toMatchObject({ legStop: 3, takeTrailPct: null, ladder: null, lock: null, exitHourUtc: null, legBuyBackAt: null, legBuyBackShare: null, trailRestPct: null });
    expect(plan.targetUsd).toBeCloseTo(135, 6);
    // run by the engine as any target: a strangle of 100 lots a leg sold for 60 + 90 = 150 USD, a target at 135
    const me = await t.signUp("autopilot-take90@hapiecoin.test");
    const made = (await (await t.request("/v1/strategies", { cookie: me.cookie, json: { name: "Take 90", asset: "BTC", legs: [{ kind: "put", side: "sell", strike: "78000", expiry: "2027-05-21", symbol: "P-BTC-78000-210527", lots: 100, price: "600" }, { kind: "call", side: "sell", strike: "88000", expiry: "2027-05-21", symbol: "C-BTC-88000-210527", lots: 100, price: "900" }] } })).json()) as Strategy;
    const started = (await (await t.request(`/v1/strategies/${made.id}/start`, { cookie: me.cookie, json: { mode: "paper", brokerId: SEED.brokerId, entries: Object.fromEntries(made.legs.map((l) => [l.id, l.price])) } })).json()) as Strategy;
    expect(started.status).toBe("paper");
    expect((await t.request(`/v1/strategies/${made.id}/rules`, { method: "PUT", cookie: me.cookie, json: { rules: [{ kind: "target", trigger: "money", value: toDecimal(plan.targetUsd!, 2) }] } })).status).toBe(200);
    const tick = (putMark: number, callMark: number) => evaluateRules(t.deps, { tick: () => Promise.resolve({ marks: new Map([["P-BTC-78000-210527", putMark], ["C-BTC-88000-210527", callMark]]), spot: null }) }, () => Date.UTC(2027, 4, 18, 10));
    // up 134 of 150 (89.3 %): held. Up 136 (90.7 %): everything closed, booked as a target
    expect((await tick(70, 90)).fired).toHaveLength(0);
    expect((await tick(60, 80)).fired).toHaveLength(1);
    const [after] = await t.db.select().from(strategies).where(eq(strategies.id, made.id));
    expect(after).toMatchObject({ status: "archived", closeReason: "target", realizedPnl: "136" });
  });
});

describe("HC-TR-258 the daily strangle closed at 90 % of the premium or trailed from it (ADR-129)", () => {
  const proposal = (asset: "BTC" | "ETH"): PlaybookProposal => ({ day: "2027-03-12", spot: asset === "BTC" ? 83_200 : 3_000, expiry: "2027-03-13", legs: [], entryCost: -150, maxProfit: 150, maxLoss: -Infinity });

  it("HC-TR-258 the plans of the four: a target at 90 % of the premium beside the stop at triple; closing has no trail, the trail gives back 5 % of the best; nothing else is armed", () => {
    // the credit is already in USD for the trade, so the coin and its lot change nothing in the plan (no legs, no fee rule here)
    for (const [id, asset, lot, trail] of [["evening-strangle-take-90", "BTC", 0.001, null], ["evening-strangle-trail-90", "BTC", 0.001, 5], ["eth-evening-strangle-take-90", "ETH", 0.01, null], ["eth-evening-strangle-trail-90", "ETH", 0.01, 5]] as const) {
      const plan = clockPlanFor(autopilotPlaybookById(id)!, proposal(asset), lot, null)!;
      expect(plan).toMatchObject({ legStop: 3, takeTrailPct: trail, ladder: null, lock: null, exitHourUtc: null, legBuyBackAt: null, legBuyBackShare: null, trailRestPct: null, stopUsd: null });
      expect(plan.targetUsd).toBeCloseTo(135, 6);
    }
  });

  it("HC-TR-258 a target at 90 % that trails by 5 %, armed by hand here as the job arms it (HC-TR-241), is not closed at 90 %: it follows the best profit and closes the whole trade on a fall to the best less a twentieth", async () => {
    const plan = clockPlanFor(autopilotPlaybookById("evening-strangle-trail-90")!, proposal("BTC"), 0.001, null)!;
    const me = await t.signUp("autopilot-trail90@hapiecoin.test");
    const PUT = "P-BTC-82400-130327";
    const CALL = "C-BTC-84000-130327";
    // a strangle of 100 lots a leg sold for 60 + 90 = 150 USD: the trail starts at 135
    const made = (await (await t.request("/v1/strategies", { cookie: me.cookie, json: { name: "Trail 90", asset: "BTC", legs: [{ kind: "put", side: "sell", strike: "82400", expiry: "2027-03-13", symbol: PUT, lots: 100, price: "600" }, { kind: "call", side: "sell", strike: "84000", expiry: "2027-03-13", symbol: CALL, lots: 100, price: "900" }] } })).json()) as Strategy;
    const started = (await (await t.request(`/v1/strategies/${made.id}/start`, { cookie: me.cookie, json: { mode: "paper", brokerId: SEED.brokerId, entries: Object.fromEntries(made.legs.map((l) => [l.id, l.price])) } })).json()) as Strategy;
    expect(started.status).toBe("paper");
    expect((await t.request(`/v1/strategies/${made.id}/rules`, { method: "PUT", cookie: me.cookie, json: { rules: [{ kind: "target", trigger: "money", value: toDecimal(plan.targetUsd!, 2), trail: { trigger: "pct", value: String(plan.takeTrailPct) } }] } })).status).toBe(200);
    const tick = (putMark: number, callMark: number) => evaluateRules(t.deps, { tick: () => Promise.resolve({ marks: new Map([[PUT, putMark], [CALL, callMark]]), spot: null }) }, () => Date.UTC(2027, 2, 12, 20));
    const status = async () => (await t.db.select().from(strategies).where(eq(strategies.id, made.id)))[0]!.status;
    // up 134 of 150 (89.3 %): nothing. Up 140 (93.3 %): a fixed target would close here; the trail starts, exit level 133
    expect((await tick(70, 90)).fired).toHaveLength(0);
    expect((await tick(50, 50)).fired).toHaveLength(0);
    expect(await status()).toBe("paper");
    // up 142: the best, exit level 134.9. Back to 135.5: still over it. Down to 134.5: closed, booked as a target
    expect((await tick(40, 40)).fired).toHaveLength(0);
    expect((await tick(65, 80)).fired).toHaveLength(0);
    expect((await tick(70, 85)).fired).toHaveLength(1);
    const [after] = await t.db.select().from(strategies).where(eq(strategies.id, made.id));
    expect(after).toMatchObject({ status: "archived", closeReason: "target", realizedPnl: "134.5" });
  });
});

describe("HC-TR-259 the evening strangle with the profit lock and the buy-back at 5 dollars together (ADR-130)", () => {
  it("HC-TR-259 at entry each sold option gets its stop and its buy-back and the trade its lock; run by the engine, what the buy-back banked counts toward the lock, and the trade is closed when the whole profit falls back to the floor", async () => {
    const me = await t.signUp("autopilot-lock-buyback@hapiecoin.test");
    const id = ((await (await t.request("/v1/me", { cookie: me.cookie })).json()) as { id: string }).id;
    const PB = "evening-strangle-lock-buy-back";
    expect(clockPlanFor(autopilotPlaybookById(PB)!, { day: "2027-06-14", spot: 83_200, expiry: "2027-06-15", legs: [], entryCost: -80, maxProfit: 80, maxLoss: -Infinity }, 0.001, null)).toMatchObject({ legStop: 3, legBuyBackAt: 5, legBuyBackShare: null, lock: { atUsd: 40, floorUsd: 20 }, targetUsd: null, takeTrailPct: null, ladder: null, exitHourUtc: null, trailRestPct: null });
    await put({ enabled: true, strategies: [{ playbookId: PB, exit: "own" }] }, me.cookie);
    const products: Instrument[] = [];
    const quotes: Quote[] = [];
    const AT = Date.UTC(2027, 5, 14, 16, 5, 0);
    for (const e of ["2027-06-15", "2027-06-16"])
      for (let i = -30; i <= 30; i++) {
        const k = 83_200 + i * 200;
        const code = e.slice(8, 10) + e.slice(5, 7) + e.slice(2, 4);
        const tv = 600 * Math.exp(-Math.abs(k - 83_200) / 900);
        for (const [kind, letter, intrinsic] of [["call", "C", Math.max(83_200 - k, 0)], ["put", "P", Math.max(k - 83_200, 0)]] as const) {
          const symbol = `${letter}-BTC-${k}-${code}`;
          products.push(inst(symbol, kind, k, e));
          quotes.push({ instrumentId: `delta_india:${symbol}`, ts: AT - MIN, mark: (intrinsic + tv).toFixed(2), oi: "1", spot: "83200", markIv: 0.5 });
        }
      }
    await snapshotOnce(t.deps, { venue: "delta_india", products: () => Promise.resolve(products), tickers: (u) => Promise.resolve(u === "BTC" ? quotes : []) }, () => AT - MIN);
    await runAutopilot(deps(AT, { maxOpen: undefined }), ["delta_india"]);
    const [trade] = await t.db.select().from(strategies).where(eq(strategies.userId, id));
    expect(trade).toMatchObject({ autopilotPlaybookId: PB, status: "paper", tradingMode: "paper" });
    const legs = await t.db.select().from(strategyLegs).where(eq(strategyLegs.strategyId, trade!.id)).orderBy(asc(strategyLegs.position));
    expect(legs.map((l) => `${l.side} ${l.kind} ${l.strike} x${l.lots}`)).toEqual(["sell put 82400 x100", "sell call 84000 x100"]);
    const [putLeg, callLeg] = legs;
    const sold = Number(putLeg!.price);
    expect(Number(callLeg!.price)).toBe(sold); // the fixture prices both the same distance from the spot alike
    const credit = 2 * sold * 0.1;
    const rulesNow = () => t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, trade!.id));
    const lockNow = async () => (await rulesNow()).find((r) => r.kind === "lock")!;
    // two stops, two buy-backs and one lock: at half the premium, a floor at a quarter of it
    expect((await rulesNow()).map((r) => `${r.kind} ${r.state}`).sort()).toEqual(["leg_stop armed", "leg_stop armed", "leg_take armed", "leg_take armed", "lock armed"]);
    const lock = await lockNow();
    expect(Number(lock.value)).toBeCloseTo(credit / 2, 1);
    expect(Number(lock.thresholdUsd)).toBeCloseTo(credit / 4, 1);
    expect(lock.peakPnl).toBeNull();
    expect((await view(me.cookie)).runs.find((r) => r.playbookId === PB && r.kind === "entered")!.detail).toMatchObject({ legStop: 3, legBuyBackAt: "5", lock: { at: lock.value, floor: lock.thresholdUsd } });

    // earlier tests left users with Autopilot on, whose own trades entered on this snapshot hold the same options: only this trade's rules are counted
    const mine = new Set((await rulesNow()).map((r) => r.id));
    const tick = async (putMark: number, ms: number) => ({ fired: (await evaluateRules(t.deps, { tick: () => Promise.resolve({ marks: new Map([[putLeg!.symbol, putMark], [callLeg!.symbol, 5]]), spot: null }) }, () => ms)).fired.filter((r) => mine.has(r)) });
    const tradeNow = async () => (await t.db.select().from(strategies).where(eq(strategies.id, trade!.id)))[0]!;
    // the call falls to 5 and is bought back alone: just under half the premium is banked, the lock is not reached
    const banked = (sold - 5) * 0.1;
    expect(banked).toBeLessThan(credit / 2);
    expect((await tick(sold, AT + 10 * MIN)).fired).toHaveLength(1);
    expect(Number((await tradeNow()).realizedPnl)).toBeCloseTo(banked, 2);
    expect((await tradeNow()).status).toBe("paper");
    expect((await lockNow()).peakPnl).toBeNull();
    // the put gains 4.67 USD: with what the call banked the whole trade is past half the premium, and the lock is set.
    // The put alone is nowhere near it, so the bought-back option is counted
    expect((sold - 200) * 0.1).toBeLessThan(credit / 2);
    expect((await tick(200, AT + 11 * MIN)).fired).toHaveLength(0);
    expect((await lockNow()).peakPnl).not.toBeNull();
    expect((await lockNow()).state).toBe("armed");
    expect((await tradeNow()).status).toBe("paper");
    // the put turns: 15.8 USD in all is still over the floor (12.3); 11.8 is under it, and the rest is closed
    expect((await tick(330, AT + 12 * MIN)).fired).toHaveLength(0);
    expect((await tradeNow()).status).toBe("paper");
    expect((await tick(370, AT + 13 * MIN)).fired).toHaveLength(1);
    const done = await tradeNow();
    expect(done).toMatchObject({ status: "archived", closeReason: "target" });
    expect(Number(done.realizedPnl)).toBeCloseTo(banked + (sold - 370) * 0.1, 1); // stored to the cent, each leg rounded
    expect(Number(done.realizedPnl)).toBeLessThan(credit / 4);
    expect((await lockNow()).state).toBe("fired");
    // what was written is what the screens can read
    expect((await t.request("/v1/strategies", { cookie: me.cookie })).status).toBe(200);
    expect((await t.request("/v1/autopilot", { cookie: me.cookie })).status).toBe(200);
  });
});

describe("HC-TR-261 the daily strangle trailed from 15 % of the premium (ADR-132)", () => {
  const proposal: PlaybookProposal = { day: "2027-03-13", spot: 83_200, expiry: "2027-03-14", legs: [], entryCost: -150, maxProfit: 150, maxLoss: -Infinity };

  it("HC-TR-261 the plans: a target at 15 % of the premium that trails by 30 %, beside the stop at triple, and nothing else", () => {
    for (const id of ["evening-strangle-trail-15", "eth-evening-strangle-trail-15"]) {
      const plan = clockPlanFor(autopilotPlaybookById(id)!, proposal, 0.001, null)!;
      expect(plan).toMatchObject({ legStop: 3, takeTrailPct: 30, ladder: null, lock: null, exitHourUtc: null, legBuyBackAt: null, legBuyBackShare: null, trailRestPct: null, stopUsd: null });
      expect(plan.targetUsd).toBeCloseTo(22.5, 6);
    }
  });

  it("HC-TR-261 a target at 15 % that trails by 30 %, armed by hand here as the job arms it (HC-TR-241), starts early, follows the best profit and closes the whole trade on a fall to seven tenths of it", async () => {
    const plan = clockPlanFor(autopilotPlaybookById("evening-strangle-trail-15")!, proposal, 0.001, null)!;
    const me = await t.signUp("autopilot-trail15@hapiecoin.test");
    const PUT = "P-BTC-82400-140327";
    const CALL = "C-BTC-84000-140327";
    // a strangle of 100 lots a leg sold for 60 + 90 = 150 USD: the trail starts at 22.50
    const made = (await (await t.request("/v1/strategies", { cookie: me.cookie, json: { name: "Trail 15", asset: "BTC", legs: [{ kind: "put", side: "sell", strike: "82400", expiry: "2027-03-14", symbol: PUT, lots: 100, price: "600" }, { kind: "call", side: "sell", strike: "84000", expiry: "2027-03-14", symbol: CALL, lots: 100, price: "900" }] } })).json()) as Strategy;
    const started = (await (await t.request(`/v1/strategies/${made.id}/start`, { cookie: me.cookie, json: { mode: "paper", brokerId: SEED.brokerId, entries: Object.fromEntries(made.legs.map((l) => [l.id, l.price])) } })).json()) as Strategy;
    expect(started.status).toBe("paper");
    expect((await t.request(`/v1/strategies/${made.id}/rules`, { method: "PUT", cookie: me.cookie, json: { rules: [{ kind: "target", trigger: "money", value: toDecimal(plan.targetUsd!, 2), trail: { trigger: "pct", value: String(plan.takeTrailPct) } }] } })).status).toBe(200);
    const tick = (putMark: number, callMark: number) => evaluateRules(t.deps, { tick: () => Promise.resolve({ marks: new Map([[PUT, putMark], [CALL, callMark]]), spot: null }) }, () => Date.UTC(2027, 2, 13, 20));
    const status = async () => (await t.db.select().from(strategies).where(eq(strategies.id, made.id)))[0]!.status;
    // up 20 of 150 (13.3 %): nothing. Up 30 (20 %): the trail starts, exit level 21
    expect((await tick(560, 740)).fired).toHaveLength(0);
    expect((await tick(500, 700)).fired).toHaveLength(0);
    expect(await status()).toBe("paper");
    // up 40: the best, exit level 28. Back to 29: still over it. Down to 27: closed, booked as a target
    expect((await tick(450, 650)).fired).toHaveLength(0);
    expect((await tick(460, 750)).fired).toHaveLength(0);
    expect((await tick(480, 750)).fired).toHaveLength(1);
    const [after] = await t.db.select().from(strategies).where(eq(strategies.id, made.id));
    expect(after).toMatchObject({ status: "archived", closeReason: "target", realizedPnl: "27" });
  });
});

describe("HC-TR-262 the Gold daily strangle trailed from 15 % of the premium (ADR-133)", () => {
  it("HC-TR-262 the plan: a target at 15 % of the premium that trails by 20 %, beside Gold's stop at double, and nothing else", () => {
    const plan = clockPlanFor(autopilotPlaybookById("xaut-evening-strangle-trail-15")!, { day: "2027-03-13", spot: 4_000, expiry: "2027-03-14", legs: [], entryCost: -1.3, maxProfit: 1.3, maxLoss: -Infinity }, 0.001, null)!;
    expect(plan).toMatchObject({ legStop: 2, takeTrailPct: 20, ladder: null, lock: null, exitHourUtc: null, legBuyBackAt: null, legBuyBackShare: null, trailRestPct: null, stopUsd: null });
    expect(plan.targetUsd).toBeCloseTo(0.195, 6); // 15 % of a premium of 1.30 USD
  });

  it("HC-TR-262 at Gold's size, cents of premium: the trail starts at its level, follows the best and closes the trade on a fall of a fifth, without firing on the tick that starts it", async () => {
    const me = await t.signUp("autopilot-gold-trail@hapiecoin.test");
    const PUT = "P-XAUT-3960-140327";
    const CALL = "C-XAUT-4040-140327";
    // 100 lots of 0.001 oz a leg, sold at 6 and 7 dollars: 1.30 USD of premium; the trail starts at 0.20
    const made = (await (await t.request("/v1/strategies", { cookie: me.cookie, json: { name: "Gold trail 15", asset: "XAUT", legs: [{ kind: "put", side: "sell", strike: "3960", expiry: "2027-03-14", symbol: PUT, lots: 100, price: "6" }, { kind: "call", side: "sell", strike: "4040", expiry: "2027-03-14", symbol: CALL, lots: 100, price: "7" }] } })).json()) as Strategy;
    const started = (await (await t.request(`/v1/strategies/${made.id}/start`, { cookie: me.cookie, json: { mode: "paper", brokerId: SEED.brokerId, entries: Object.fromEntries(made.legs.map((l) => [l.id, l.price])) } })).json()) as Strategy;
    expect(started.status).toBe("paper");
    expect((await t.request(`/v1/strategies/${made.id}/rules`, { method: "PUT", cookie: me.cookie, json: { rules: [{ kind: "target", trigger: "money", value: "0.20", trail: { trigger: "pct", value: "20" } }] } })).status).toBe(200);
    const tick = (putMark: number, callMark: number) => evaluateRules(t.deps, { tick: () => Promise.resolve({ marks: new Map([[PUT, putMark], [CALL, callMark]]), spot: null }) }, () => Date.UTC(2027, 2, 13, 20));
    const now = async () => (await t.db.select().from(strategies).where(eq(strategies.id, made.id)))[0]!;
    // up 10 cents: nothing. Up 30 cents: the trail starts, exit level 24 cents, and that tick closes nothing
    expect((await tick(5.5, 6.5)).fired).toHaveLength(0);
    expect((await tick(4.5, 5.5)).fired).toHaveLength(0);
    expect((await now()).status).toBe("paper");
    // up 40: the best, exit level 32. Back to 35: still over it. Down to 30: closed, booked as a target
    expect((await tick(4, 5)).fired).toHaveLength(0);
    expect((await tick(4.5, 5)).fired).toHaveLength(0);
    expect((await tick(4.5, 5.5)).fired).toHaveLength(1);
    expect(await now()).toMatchObject({ status: "archived", closeReason: "target", realizedPnl: "0.3" });
  });
});

describe("HC-TR-263 the Friday weekly strangle held for its first day only (ADR-134)", () => {
  it("HC-TR-263 the plans carry the stop at triple and the exit hour and nothing else; from a Friday evening entry that hour is Saturday 12:00 UTC, twenty hours on, also for an entry at the end of the window", () => {
    for (const id of ["weekly-fri-strangle-one-day", "eth-weekly-fri-strangle-one-day"]) {
      const plan = clockPlanFor(autopilotPlaybookById(id)!, { day: "2027-05-14", spot: 83_200, expiry: "2027-05-21", legs: [], entryCost: -150, maxProfit: 150, maxLoss: -Infinity }, 0.001, null)!;
      expect(plan).toMatchObject({ legStop: 3, exitHourUtc: 12, targetUsd: null, takeTrailPct: null, ladder: null, lock: null, legBuyBackAt: null, legBuyBackShare: null, trailRestPct: null, stopUsd: null });
    }
    // 14 May 2027 is a Friday
    expect(new Date(Date.UTC(2027, 4, 14)).getUTCDay()).toBe(5);
    expect(new Date(nextHourUtc(Date.UTC(2027, 4, 14, 16, 2), 12)).toISOString()).toBe("2027-05-15T12:00:00.000Z");
    expect(new Date(nextHourUtc(Date.UTC(2027, 4, 14, 16, 59), 12)).toISOString()).toBe("2027-05-15T12:00:00.000Z");
    expect(nextHourUtc(Date.UTC(2027, 4, 14, 16, 2), 12) - Date.UTC(2027, 4, 14, 16, 0)).toBe(20 * HOUR);
  });

  it("HC-TR-263 entered by the job on a Friday evening: the two stops and a timed exit for Saturday 12:00 UTC are armed; on Saturday morning the trade is left alone, and at 12:00 it is closed whole, at a loss as readily as a profit", async () => {
    const me = await t.signUp("autopilot-one-day@hapiecoin.test");
    const id = ((await (await t.request("/v1/me", { cookie: me.cookie })).json()) as { id: string }).id;
    const PB = "weekly-fri-strangle-one-day";
    await put({ enabled: true, strategies: [{ playbookId: PB, exit: "own" }] }, me.cookie);
    const products: Instrument[] = [];
    const quotes: Quote[] = [];
    const FRI = Date.UTC(2027, 6, 9, 16, 5, 0); // a Friday, five minutes into the window, and later than every snapshot the tests above stored
    for (const e of ["2027-07-10", "2027-07-16"])
      for (let i = -30; i <= 30; i++) {
        const k = 83_200 + i * 200;
        const code = e.slice(8, 10) + e.slice(5, 7) + e.slice(2, 4);
        const tv = 600 * Math.exp(-Math.abs(k - 83_200) / 900);
        for (const [kind, letter, intrinsic] of [["call", "C", Math.max(83_200 - k, 0)], ["put", "P", Math.max(k - 83_200, 0)]] as const) {
          const symbol = `${letter}-BTC-${k}-${code}`;
          products.push(inst(symbol, kind, k, e));
          quotes.push({ instrumentId: `delta_india:${symbol}`, ts: FRI - MIN, mark: (intrinsic + tv).toFixed(2), oi: "1", spot: "83200", markIv: 0.5 });
        }
      }
    await snapshotOnce(t.deps, { venue: "delta_india", products: () => Promise.resolve(products), tickers: (u) => Promise.resolve(u === "BTC" ? quotes : []) }, () => FRI - MIN);
    await runAutopilot(deps(FRI, { maxOpen: undefined }), ["delta_india"]);
    const [trade] = await t.db.select().from(strategies).where(eq(strategies.userId, id));
    expect(trade).toMatchObject({ autopilotPlaybookId: PB, status: "paper", tradingMode: "paper" });
    const legs = await t.db.select().from(strategyLegs).where(eq(strategyLegs.strategyId, trade!.id)).orderBy(asc(strategyLegs.position));
    // 3 % of 83,200 is 2,496: 80,704 and 85,696, nearest listed 80,800 and 85,600, on the Friday a week out
    expect(legs.map((l) => `${l.side} ${l.kind} ${l.strike} ${l.expiry} x${l.lots}`)).toEqual(["sell put 80800 2027-07-16 x100", "sell call 85600 2027-07-16 x100"]);
    const rulesNow = () => t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, trade!.id));
    expect((await rulesNow()).map((r) => `${r.kind} ${r.trigger} ${r.state}`).sort()).toEqual(["leg_stop multiple armed", "leg_stop multiple armed", "time at armed"]);
    const timed = (await rulesNow()).find((r) => r.kind === "time")!;
    // the next 12:00 UTC after a Friday 16:05 entry: Saturday, not the Friday already past and not a week on
    expect(timed.value).toBe("2027-07-10T12:00:00.000Z");
    expect(timed.thresholdUsd).toBe(String(Date.UTC(2027, 6, 10, 12)));
    expect((await view(me.cookie)).runs.find((r) => r.playbookId === PB && r.kind === "entered")!.detail).toMatchObject({ legStop: 3, exitAt: "2027-07-10T12:00:00.000Z" }); // the log line says the same Saturday

    // earlier tests left users with Autopilot on, whose own trades entered on this snapshot: only this trade's rules are counted
    const mine = new Set((await rulesNow()).map((r) => r.id));
    const [putLeg, callLeg] = legs;
    const sold = [Number(putLeg!.price), Number(callLeg!.price)];
    const tick = async (putMark: number, callMark: number, ms: number) => (await evaluateRules(t.deps, { tick: () => Promise.resolve({ marks: new Map([[putLeg!.symbol, putMark], [callLeg!.symbol, callMark]]), spot: null }) }, () => ms)).fired.filter((r) => mine.has(r));
    // Saturday 11:59 UTC, both options 10 dollars dearer (the trade 2 USD down, far from a stop): left alone
    expect(await tick(sold[0]! + 10, sold[1]! + 10, Date.UTC(2027, 6, 10, 11, 59))).toHaveLength(0);
    expect((await t.db.select().from(strategies).where(eq(strategies.id, trade!.id)))[0]!.status).toBe("paper");
    // 12:00: closed whole by the timed exit, at that loss
    expect(await tick(sold[0]! + 10, sold[1]! + 10, Date.UTC(2027, 6, 10, 12, 0, 5))).toEqual([timed.id]);
    const [after] = await t.db.select().from(strategies).where(eq(strategies.id, trade!.id));
    expect(after!.status).toBe("archived");
    expect(Number(after!.realizedPnl)).toBeCloseTo(-2, 1);
    expect((await t.db.select().from(strategyLegs).where(eq(strategyLegs.strategyId, trade!.id))).map((l) => l.status)).toEqual(["squared_off", "squared_off"]);
    expect((await rulesNow()).filter((r) => r.kind === "leg_stop").map((r) => r.state)).not.toContain("fired");
    // the next evening is not a Friday: nothing is entered again
    await runAutopilot(deps(Date.UTC(2027, 6, 10, 16, 5, 0), { maxOpen: undefined }), ["delta_india"]);
    expect((await t.db.select().from(strategies).where(eq(strategies.userId, id))).filter((x) => x.status === "paper")).toHaveLength(0);
  });
});

describe("HC-TR-265 the cautious daily strangles (ADR-136)", () => {
  it("HC-TR-265 the plans carry the stop at double, the buy-back level and a target that trails, as each playbook sets them, and nothing else (the ETH one is not entered through the job here)", () => {
    const proposal: PlaybookProposal = { day: "2027-08-09", spot: 83_200, expiry: "2027-08-10", legs: [], entryCost: -100, maxProfit: 100, maxLoss: -Infinity };
    const btc = clockPlanFor(autopilotPlaybookById("evening-strangle-cautious")!, proposal, 0.001, null)!;
    expect(btc).toMatchObject({ legStop: 2, legBuyBackAt: 5, legBuyBackShare: null, takeTrailPct: 30, ladder: null, lock: null, exitHourUtc: null, trailRestPct: null, stopUsd: null });
    expect(btc.targetUsd).toBeCloseTo(25, 6);
    const eth = clockPlanFor(autopilotPlaybookById("eth-evening-strangle-cautious")!, proposal, 0.01, null)!;
    expect(eth).toMatchObject({ legStop: 2, legBuyBackAt: 0.25, legBuyBackShare: null, takeTrailPct: 20, ladder: null, lock: null, exitHourUtc: null, trailRestPct: null, stopUsd: null });
    expect(eth.targetUsd).toBeCloseTo(50, 6);
  });

  it("HC-TR-265 entered by the job: the strikes nearest 1.5 % away, two stops at double, two buy-backs at 5 dollars and one trailing target at a quarter of the premium; the option that falls to 5 is bought back alone, what it banked starts the trail, and the trail then closes the other option well before its stop", async () => {
    const me = await t.signUp("autopilot-cautious@hapiecoin.test");
    const id = ((await (await t.request("/v1/me", { cookie: me.cookie })).json()) as { id: string }).id;
    const PB = "evening-strangle-cautious";
    await put({ enabled: true, strategies: [{ playbookId: PB, exit: "own" }] }, me.cookie);
    const products: Instrument[] = [];
    const quotes: Quote[] = [];
    const AT = Date.UTC(2027, 7, 9, 16, 5, 0); // later than every snapshot the tests above stored
    for (const e of ["2027-08-10", "2027-08-11"])
      for (let i = -30; i <= 30; i++) {
        const k = 83_200 + i * 200;
        const code = e.slice(8, 10) + e.slice(5, 7) + e.slice(2, 4);
        const tv = 600 * Math.exp(-Math.abs(k - 83_200) / 900);
        for (const [kind, letter, intrinsic] of [["call", "C", Math.max(83_200 - k, 0)], ["put", "P", Math.max(k - 83_200, 0)]] as const) {
          const symbol = `${letter}-BTC-${k}-${code}`;
          products.push(inst(symbol, kind, k, e));
          quotes.push({ instrumentId: `delta_india:${symbol}`, ts: AT - MIN, mark: (intrinsic + tv).toFixed(2), oi: "1", spot: "83200", markIv: 0.5 });
        }
      }
    await snapshotOnce(t.deps, { venue: "delta_india", products: () => Promise.resolve(products), tickers: (u) => Promise.resolve(u === "BTC" ? quotes : []) }, () => AT - MIN);
    await runAutopilot(deps(AT, { maxOpen: undefined }), ["delta_india"]);
    const [trade] = await t.db.select().from(strategies).where(eq(strategies.userId, id));
    expect(trade).toMatchObject({ autopilotPlaybookId: PB, status: "paper", tradingMode: "paper" });
    const legsNow = () => t.db.select().from(strategyLegs).where(eq(strategyLegs.strategyId, trade!.id)).orderBy(asc(strategyLegs.position));
    const legs = await legsNow();
    // 1.5 % of 83,200 is 1,248: 81,952 and 84,448, nearest listed 82,000 and 84,400
    expect(legs.map((l) => `${l.side} ${l.kind} ${l.strike} x${l.lots}`)).toEqual(["sell put 82000 x100", "sell call 84400 x100"]);
    const rulesNow = () => t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, trade!.id));
    const rules = await rulesNow();
    expect(rules.map((r) => `${r.kind} ${r.trigger} ${r.value} ${r.state}`).filter((x) => !x.startsWith("target")).sort()).toEqual(["leg_stop multiple 2 armed", "leg_stop multiple 2 armed", "leg_take price 5 armed", "leg_take price 5 armed"]);
    const credit = (Number(legs[0]!.price) + Number(legs[1]!.price)) * 0.1;
    const target = rules.find((r) => r.kind === "target")!;
    expect(Number(target.value)).toBeCloseTo(credit / 4, 1);
    expect(target).toMatchObject({ state: "armed", trailTrigger: "pct", trailValue: "30", peakPnl: null });
    expect(rules).toHaveLength(5);
    expect((await view(me.cookie)).runs.find((r) => r.playbookId === PB && r.kind === "entered")!.detail).toMatchObject({ legStop: 2, legBuyBackAt: "5", takeTrailPct: 30 });

    // the call falls to 5 with the put unchanged: the call alone is bought back; the trade stays open on the put
    const mine = new Set(rules.map((r) => r.id));
    const [putLeg, callLeg] = legs;
    const fired = (await evaluateRules(t.deps, { tick: () => Promise.resolve({ marks: new Map([[putLeg!.symbol, Number(putLeg!.price)], [callLeg!.symbol, 5]]), spot: null }) }, () => AT + 10 * MIN)).fired.filter((r) => mine.has(r));
    expect(fired).toHaveLength(1);
    expect(rules.find((r) => r.id === fired[0])!.kind).toBe("leg_take");
    expect((await legsNow()).map((l) => `${l.kind} ${l.status}`)).toEqual(["put open", "call squared_off"]);
    expect((await t.db.select().from(strategies).where(eq(strategies.id, trade!.id)))[0]!.status).toBe("paper");
    const targetNow = async () => (await rulesNow()).find((r) => r.kind === "target")!;
    expect((await targetNow()).peakPnl).toBeNull(); // one fire a tick: the buy-back took it
    // the next tick: what the buy-back banked is already over a quarter of the premium, so the trail starts and closes nothing
    const tick = async (putMark: number, ms: number) => (await evaluateRules(t.deps, { tick: () => Promise.resolve({ marks: new Map([[putLeg!.symbol, putMark], [callLeg!.symbol, 5]]), spot: null }) }, () => ms)).fired.filter((r) => mine.has(r));
    const banked = (Number(callLeg!.price) - 5) * 0.1;
    expect(banked).toBeGreaterThan(credit / 4);
    expect(await tick(Number(putLeg!.price), AT + 11 * MIN)).toHaveLength(0);
    expect(Number((await targetNow()).peakPnl)).toBeCloseTo(banked, 1);
    // the put rises by half: far from its stop at double, but the whole profit is under seven tenths of its best, and the rest is closed
    const up = 1.5 * Number(putLeg!.price);
    expect(banked - (up - Number(putLeg!.price)) * 0.1).toBeLessThan(0.7 * banked);
    expect(await tick(up, AT + 12 * MIN)).toEqual([target.id]);
    expect((await legsNow()).map((l) => `${l.kind} ${l.status}`)).toEqual(["put squared_off", "call squared_off"]);
    const [done] = await t.db.select().from(strategies).where(eq(strategies.id, trade!.id));
    expect(done!.status).toBe("archived");
    expect((await rulesNow()).filter((r) => r.kind === "leg_stop").map((r) => r.state)).not.toContain("fired");
  });
});

describe("HC-TR-266 the ETH daily strangle with wings and the trail alone (ADR-138)", () => {
  it("HC-TR-266 the plan: a trailing target at half the NET premium, and no stop, buy-back, lock or timed exit; wings that cost more than the sold options bring are no trade", () => {
    const pb = autopilotPlaybookById("eth-evening-strangle-wings-trail")!;
    const proposal: PlaybookProposal = { day: "2027-09-06", spot: 2304, expiry: "2027-09-07", legs: [], entryCost: -13.9, maxProfit: 13.9, maxLoss: -36.1 };
    const plan = clockPlanFor(pb, proposal, 0.01, null)!;
    expect(plan).toMatchObject({ legStop: null, legBuyBackAt: null, legBuyBackShare: null, takeTrailPct: 20, ladder: null, lock: null, exitHourUtc: null, trailRestPct: null, stopUsd: null });
    expect(plan.targetUsd).toBeCloseTo(6.95, 6);
    expect(clockPlanFor(pb, { ...proposal, entryCost: 0.4 }, 0.01, null)).toBeNull(); // the wings cost more than the sold options bring
  });

  it("HC-TR-266 entered by the job: sold 2 % away, wings 4 % away, one trailing target at half the net premium and no other rule; the trail starts once the whole structure is up by that much and closes all four options when the profit gives back a fifth", async () => {
    const me = await t.signUp("autopilot-wings-trail@hapiecoin.test");
    const id = ((await (await t.request("/v1/me", { cookie: me.cookie })).json()) as { id: string }).id;
    const PB = "eth-evening-strangle-wings-trail";
    await put({ enabled: true, strategies: [{ playbookId: PB, exit: "own" }] }, me.cookie);
    const products: Instrument[] = [];
    const quotes: Quote[] = [];
    const AT = Date.UTC(2027, 8, 6, 16, 5, 0); // later than every snapshot the tests above stored
    for (const e of ["2027-09-07", "2027-09-08"])
      for (let i = -30; i <= 30; i++) {
        const k = 2300 + i * 10;
        const code = e.slice(8, 10) + e.slice(5, 7) + e.slice(2, 4);
        const tv = 30 * Math.exp(-Math.abs(k - 2304) / 40);
        for (const [kind, letter, intrinsic] of [["call", "C", Math.max(2304 - k, 0)], ["put", "P", Math.max(k - 2304, 0)]] as const) {
          const symbol = `${letter}-ETH-${k}-${code}`;
          products.push({ ...inst(symbol, kind, k, e), underlying: "ETH", contractSize: "0.01" });
          quotes.push({ instrumentId: `delta_india:${symbol}`, ts: AT - MIN, mark: (intrinsic + tv).toFixed(2), oi: "1", spot: "2304", markIv: 0.5 });
        }
      }
    await snapshotOnce(t.deps, { venue: "delta_india", products: () => Promise.resolve(products), tickers: (u) => Promise.resolve(u === "ETH" ? quotes : []) }, () => AT - MIN);
    await runAutopilot(deps(AT, { maxOpen: undefined }), ["delta_india"]);
    const [trade] = await t.db.select().from(strategies).where(eq(strategies.userId, id));
    expect(trade).toMatchObject({ autopilotPlaybookId: PB, status: "paper", tradingMode: "paper", asset: "ETH", name: "ETH evening strangle, wings and a trail · Autopilot" });
    const legsNow = () => t.db.select().from(strategyLegs).where(eq(strategyLegs.strategyId, trade!.id)).orderBy(asc(strategyLegs.position));
    const legs = await legsNow();
    // 2 % of 2,304 is 46.08: 2,257.92 and 2,350.08, nearest listed 2,260 and 2,350; 4 % is 92.16: 2,211.84 and 2,396.16, nearest 2,210 and 2,400
    expect(legs.map((l) => `${l.side} ${l.kind} ${l.strike} x${l.lots}`)).toEqual(["buy put 2210 x100", "sell put 2260 x100", "sell call 2350 x100", "buy call 2400 x100"]);
    const rulesNow = () => t.db.select().from(strategyRules).where(eq(strategyRules.strategyId, trade!.id));
    const rules = await rulesNow();
    // the net premium: collected on the two sold, less paid for the two wings, on 1 ETH (100 lots of 0.01)
    const net = legs.reduce((sum, l) => sum + (l.side === "sell" ? 1 : -1) * Number(l.price), 0);
    expect(net).toBeGreaterThan(0);
    expect(net).toBeLessThan(Number(legs[1]!.price) + Number(legs[2]!.price));
    expect(rules).toHaveLength(1);
    const target = rules[0]!;
    expect(target).toMatchObject({ kind: "target", state: "armed", trailTrigger: "pct", trailValue: "20", peakPnl: null });
    expect(Number(target.value)).toBeCloseTo(net / 2, 1);
    expect((await view(me.cookie)).runs.find((r) => r.playbookId === PB && r.kind === "entered")!.detail).toMatchObject({ takeTrailPct: 20 });

    // every option at `share` of its entry price: the structure is up by (1 - share) of the net premium
    const tick = async (share: number, ms: number) => (await evaluateRules(t.deps, { tick: () => Promise.resolve({ marks: new Map(legs.map((l) => [l.symbol, share * Number(l.price)])), spot: null }) }, () => ms)).fired.filter((r) => r === target.id);
    const targetNow = async () => (await rulesNow())[0]!;
    // up by 40 %: under half, nothing starts
    expect(await tick(0.6, AT + 10 * MIN)).toHaveLength(0);
    expect((await targetNow()).peakPnl).toBeNull();
    // up by 70 %: the trail starts and closes nothing
    expect(await tick(0.3, AT + 20 * MIN)).toHaveLength(0);
    expect(Number((await targetNow()).peakPnl)).toBeCloseTo(0.7 * net, 1);
    // back to 60 %: more than four fifths of its best, still held
    expect(await tick(0.4, AT + 30 * MIN)).toHaveLength(0);
    // back to 50 %: under four fifths of its best (56 %), and all four options are closed, the wings sold with the rest
    expect(await tick(0.5, AT + 40 * MIN)).toEqual([target.id]);
    expect((await legsNow()).map((l) => `${l.side} ${l.kind} ${l.status}`)).toEqual(["buy put squared_off", "sell put squared_off", "sell call squared_off", "buy call squared_off"]);
    const [done] = await t.db.select().from(strategies).where(eq(strategies.id, trade!.id));
    expect(done).toMatchObject({ status: "archived", closeReason: "target" });
    expect(Number(done!.realizedPnl)).toBeCloseTo(0.5 * net, 1);
  });
});
