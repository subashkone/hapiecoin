// Approval of a saved Autopilot strategy for live (ADR-145; HC-TR-291..293): the paper record of a version, the checks
// the owner kept, approve and withdraw by someone who holds the approver permission. Paper only: an approval is a
// record on a strategy that stays on paper, and nothing here places anything anywhere.
import { APPROVAL_MIN_DAYS, APPROVAL_MIN_TRADES, AUTOPILOT_RUNS_RETENTION_DAYS, SAVED_REFUSALS, type SavedApprovalView, type SavedPaperRecord, type SavedStrategy } from "@hapiecoin/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { savedCatalogue } from "./autopilot-saved.js";
import { auditLog, autopilotRuns, autopilotSavedStrategies, strategies, strategyLegs, users } from "./db/schema.js";
import { approvalChecks, mayApprove, paperRecordOf } from "./saved-approval.js";
import { createTestApp, type TestApp } from "./test-support/harness.js";

let t: TestApp;
let owner: { cookie: string; id: string };
let other: { cookie: string; id: string };
let trader: { cookie: string; id: string };
const BASE = "/v1/admin/autopilot-strategies";
const DAY = 86_400_000;
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
const idOf = async (cookie: string) => (await json<{ id: string }>(await t.request("/v1/me", { cookie }))).id;
const why = async (res: Response) => (await json<{ message: string }>(res)).message;

beforeAll(async () => {
  t = await createTestApp();
  const cookie = await t.adminCookie();
  owner = { cookie, id: await idOf(cookie) };
  // the owner holds the approver permission by name; a second admin does not
  await t.db.update(users).set({ canApproveLive: true }).where(eq(users.id, owner.id));
  const b = await t.signUp("approval-admin@hapiecoin.test");
  other = { cookie: b.cookie, id: await idOf(b.cookie) };
  await t.db.update(users).set({ role: "admin" }).where(eq(users.id, other.id));
  const c = await t.signUp("approval-trader@hapiecoin.test");
  trader = { cookie: c.cookie, id: await idOf(c.cookie) };
});
afterAll(() => t.close());

const leg = (kind: "call" | "put", side: "buy" | "sell", value: number) => ({ kind, side, by: "pct" as const, value });
/** A strangle with wings: the loss of every trade is limited by the bought options. */
const WINGED = { assets: ["BTC"], venues: ["delta_india"], lots: 100, cadence: "daily", fromHourUtc: 16, toHourUtc: 17, oncePerExpiry: false, minDte: 0.5, maxDte: 1.5, legs: [leg("put", "buy", 3), leg("put", "sell", 1), leg("call", "sell", 1), leg("call", "buy", 3)], exits: {} };
const NAKED = { ...WINGED, legs: [leg("put", "sell", 1), leg("call", "sell", 1)], exits: { legStop: 2 } };
const FIGURES = { mean: 4.2, per: "day", positivePct: 71, worst: -60, samples: 106, basis: "autopilot-study, real fees" };
const post = (path: string, body?: unknown, cookie = owner.cookie) => t.request(path, { cookie, method: "POST", ...(body === undefined ? {} : { json: body }) });
const patch = (id: string, body: unknown, cookie = owner.cookie) => t.request(`${BASE}/${id}`, { cookie, method: "PATCH", json: body });
const view = async (id: string, cookie = owner.cookie) => json<SavedApprovalView>(await t.request(`${BASE}/${id}/approval`, { cookie }));
const one = async (id: string) => (await json<{ items: SavedStrategy[] }>(await t.request(BASE, { cookie: owner.cookie }))).items.find((s) => s.id === id)!;

/** A strategy on paper since `daysAgo`, with backtest figures. */
async function onPaper(name: string, daysAgo: number, definition: unknown = WINGED, figures: unknown = FIGURES): Promise<SavedStrategy> {
  const made = await json<SavedStrategy>(await post(BASE, { name, summary: "Sell both sides each evening, with wings.", definition }));
  expect((await patch(made.id, { backtest: figures })).status).toBe(200);
  expect((await post(`${BASE}/${made.id}/publish`)).status).toBe(200);
  await t.db.update(autopilotSavedStrategies).set({ publishedAt: new Date(Date.now() - daysAgo * DAY - 60_000) }).where(eq(autopilotSavedStrategies.id, made.id));
  return one(made.id);
}
let n = 0;
type Closed = { pnl: string; fees: string; reason?: "expired" | "stopped" | "target"; byHand?: true };
/** One entry of a strategy as the engine logs it, with its trade: closed with a result (by a rule, or by hand), or still open. */
async function entry(s: SavedStrategy, userId: string, at: number, result: Closed | "open"): Promise<void> {
  n += 1;
  const id = `strat_appr_${n}`;
  const held = result === "open" || result.byHand === true;
  await t.db.insert(strategies).values({ id, userId, name: s.name, asset: "BTC", venue: "delta_india", status: held ? "paper" : "archived", tradingMode: "paper", autopilotPlaybookId: s.id, autopilotStructure: held ? `held-${n}` : null, startedAt: new Date(at), ...(result === "open" ? {} : { realizedPnl: result.pnl }), ...(held ? {} : { closedAt: new Date(at + 20 * 3_600_000), closeReason: result.reason ?? "expired" }) });
  // squared off by hand: the row still says paper, and its only leg is closed
  if (result !== "open" && result.byHand) await t.db.insert(strategyLegs).values({ id: `leg_appr_${n}`, strategyId: id, kind: "call", side: "sell", strike: "85000", expiry: "2026-11-20", symbol: "C-BTC-85000-201126", lots: 100, price: "50", status: "squared_off", closedAt: new Date(at + 3_600_000) });
  await t.db.insert(autopilotRuns).values({ userId, playbookId: s.id, venue: "delta_india", asset: "BTC", kind: "entered", reason: "Its entry conditions were met on the latest prices", strategyId: id, detail: { expiry: new Date(at + DAY).toISOString().slice(0, 10), fees: result === "open" ? "0.40" : result.fees, legs: [] }, at: new Date(at) });
}
const skip = (s: SavedStrategy, userId: string, at: number, reason: string) => t.db.insert(autopilotRuns).values({ userId, playbookId: s.id, venue: "delta_india", asset: "BTC", kind: "skipped", reason, detail: {}, at: new Date(at) });
/** Twenty-one closed trades of one account, one a day from thirty days ago, that end a little ahead after fees. */
async function goodRecord(s: SavedStrategy, userId = owner.id): Promise<void> {
  const from = Date.now() - 30 * DAY - 3_600_000;
  for (let i = 0; i < 21; i++) await entry(s, userId, from + i * DAY, { pnl: i % 3 === 0 ? "-8.00" : "9.10", fees: "0.50" });
}

describe("HC-TR-291 the paper record of a saved strategy version", () => {
  it("HC-TR-291 the paper record of a version is read from the account that took the most entries, in cents, and says its period and how many accounts traded it", async () => {
    const s = await onPaper("Record", 12);
    const d0 = Date.now() - 10 * DAY - 3_600_000;
    await entry(s, owner.id, d0, { pnl: "10.10", fees: "0.20" });
    await entry(s, owner.id, d0 + DAY, { pnl: "-30.30", fees: "0.20", reason: "stopped" });
    await entry(s, owner.id, d0 + 2 * DAY, { pnl: "0.10", fees: "0.20", byHand: true });
    await entry(s, owner.id, d0 + 3 * DAY, "open");
    // a second account at ten times the size took fewer entries: its trades are not added to the first one's
    await entry(s, trader.id, d0, { pnl: "101.00", fees: "2.00" });
    await entry(s, trader.id, d0 + 2 * DAY, { pnl: "1.00", fees: "2.00" });
    // skip lines: those of the account the record is read from
    await skip(s, owner.id, d0 + 4 * DAY, "The premium does not cover the fees");
    await skip(s, owner.id, d0 + 5 * DAY, "No expiry in its range");
    await skip(s, trader.id, d0 + 4 * DAY, "The premium does not cover the fees");
    // a line that is neither an entry nor a skip, and an entry whose trade is gone with its account, count for nothing
    await t.db.insert(autopilotRuns).values({ userId: owner.id, playbookId: s.id, venue: "delta_india", asset: "BTC", kind: "noted", reason: "A better entry than the open trade's", detail: {}, at: new Date(d0 + 6 * DAY) });
    await t.db.insert(autopilotRuns).values({ userId: other.id, playbookId: s.id, venue: "delta_india", asset: "BTC", kind: "entered", reason: "Its entry conditions were met on the latest prices", strategyId: null, detail: { fees: "9.99" }, at: new Date(d0 + 7 * DAY) });
    const { record, trades, skips } = await paperRecordOf(t.db, s, new Date());
    expect(record).toEqual({ since: s.publishedAt, publishedDays: 12, firstEntryAt: new Date(d0).toISOString(), lastEntryAt: new Date(d0 + 3 * DAY).toISOString(), days: 10, accounts: 2, open: 1, closed: 3, wins: 1, grossUsd: "-20.10", feesUsd: "0.60", netUsd: "-20.70", worstNetUsd: "-30.50", skipLines: 2, logDays: AUTOPILOT_RUNS_RETENTION_DAYS } satisfies SavedPaperRecord);
    // 0.10 before fees and 0.20 of fees is a losing trade: a win is counted after fees; the latest entered comes first
    expect(trades.map((x) => [x.netUsd, x.reason])).toEqual([["-0.10", "squared_off"], ["-30.50", "stopped"], ["9.90", "expired"]]);
    expect(trades[0]!.openedAt).toBe(new Date(d0 + 2 * DAY).toISOString());
    expect(trades[0]!.closedAt).toBe(new Date(d0 + 2 * DAY + 3_600_000).toISOString());
    expect(skips).toEqual({ "The premium does not cover the fees": 1, "No expiry in its range": 1 });
    // the same through the route, for an admin
    const v = await view(s.id);
    expect(v.record).toEqual(record);
    expect(v.trades).toHaveLength(3);
    expect(v.strategyId).toBe(s.id);
    // a trader cannot read it, and an unknown strategy is not found
    expect((await t.request(`${BASE}/${s.id}/approval`, { cookie: trader.cookie })).status).toBe(403);
    expect((await t.request(`${BASE}/sv_nope/approval`, { cookie: owner.cookie })).status).toBe(404);

    // two accounts with as many entries: the one that entered first; and with no entry at all, every account's skip lines
    const tie = await onPaper("Tie", 5);
    await entry(tie, owner.id, d0 + DAY, { pnl: "5.00", fees: "0.10" });
    await entry(tie, trader.id, d0, { pnl: "70.00", fees: "1.00" });
    expect((await paperRecordOf(t.db, tie, new Date())).record).toMatchObject({ firstEntryAt: new Date(d0).toISOString(), accounts: 2, closed: 1, netUsd: "69.00" });
    const quiet = await onPaper("Quiet", 5);
    await skip(quiet, owner.id, d0, "No expiry in its range");
    await skip(quiet, trader.id, d0, "No expiry in its range");
    const none = await paperRecordOf(t.db, quiet, new Date());
    expect(none.record).toMatchObject({ firstEntryAt: null, lastEntryAt: null, days: 0, publishedDays: 5, accounts: 0, closed: 0, skipLines: 2 });
    expect(none.skips).toEqual({ "No expiry in its range": 2 });
  });

  it("HC-TR-291 a strategy that never went on paper has an empty record, and a new version starts with an empty record and no approval", async () => {
    const draft = await json<SavedStrategy>(await post(BASE, { name: "Never published", summary: "A draft.", definition: WINGED }));
    const empty = await view(draft.id);
    expect(empty.record).toMatchObject({ since: null, publishedDays: 0, firstEntryAt: null, days: 0, accounts: 0, open: 0, closed: 0, wins: 0, netUsd: "0.00", worstNetUsd: null, skipLines: 0 });
    expect(empty.approvable).toBe(false);
    expect(empty.checks.find((c) => c.key === "days")!.detail).toBe("It is not on paper.");
    expect(empty.checks.find((c) => c.key === "backtest")!.detail).toBe("It has no backtest figures.");

    const s = await onPaper("Versioned", 31);
    await goodRecord(s);
    expect((await post(`${BASE}/${s.id}/approve`, { read: true })).status).toBe(200);
    // new settings on a version that has traded: version 2, a draft, with no approval and no record
    const v2 = await json<SavedStrategy>(await patch(s.id, { definition: { ...WINGED, lots: 50 } }));
    expect(v2.id).not.toBe(s.id);
    expect(v2).toMatchObject({ version: 2, stage: "draft", approval: null });
    expect((await view(v2.id)).record).toMatchObject({ since: null, closed: 0 });
    // version 1 keeps its approval and its record until version 2 is published, which retires it and its approval with it
    expect((await one(s.id)).approval).not.toBeNull();
    expect((await patch(v2.id, { backtest: FIGURES })).status).toBe(200);
    expect((await post(`${BASE}/${v2.id}/publish`)).status).toBe(200);
    expect(await one(s.id)).toMatchObject({ stage: "retired", approval: null });
    expect(await one(v2.id)).toMatchObject({ stage: "paper", approval: null });
    const [kept] = await t.db.select({ approval: autopilotSavedStrategies.approval }).from(autopilotSavedStrategies).where(eq(autopilotSavedStrategies.id, s.id));
    expect(kept!.approval).toBeNull();
  });
});

describe("HC-TR-292 the approval checks, approve and withdraw", () => {
  it("HC-TR-292 each check fails for its own reason: under 30 days, under 20 trades, backtest or paper net not positive, loss not limited, no backtest", () => {
    const record: SavedPaperRecord = { since: "2026-09-25T00:00:00.000Z", publishedDays: 36, firstEntryAt: "2026-10-01T16:05:00.000Z", lastEntryAt: "2026-10-30T16:05:00.000Z", days: APPROVAL_MIN_DAYS, accounts: 1, open: 0, closed: APPROVAL_MIN_TRADES, wins: 14, grossUsd: "12.00", feesUsd: "2.00", netUsd: "10.00", worstNetUsd: "-8.00", skipLines: 0, logDays: 90 };
    const good = { backtest: { ...FIGURES, per: "day" as const }, lossCapped: true };
    const failing = (s: Parameters<typeof approvalChecks>[0], r: SavedPaperRecord) => approvalChecks(s, r).filter((c) => !c.pass).map((c) => c.key);
    // everything the owner kept passes at exactly 30 days and 20 trades; the margin check stays open and does not block
    expect(failing(good, record)).toEqual(["margin"]);
    expect(approvalChecks(good, record).filter((c) => !c.blocking).map((c) => c.key)).toEqual(["margin"]);
    expect(failing(good, { ...record, days: 29 })).toEqual(["days", "margin"]);
    // published long ago and first traded yesterday is not thirty days on paper
    expect(failing(good, { ...record, publishedDays: 200, days: 1 })).toEqual(["days", "margin"]);
    expect(failing(good, { ...record, closed: 19 })).toEqual(["trades", "margin"]);
    expect(failing(good, { ...record, netUsd: "0.00" })).toEqual(["paperNet", "margin"]);
    expect(failing(good, { ...record, netUsd: "-0.01" })).toEqual(["paperNet", "margin"]);
    expect(failing({ ...good, backtest: { ...good.backtest, mean: 0 } }, record)).toEqual(["backtest", "margin"]);
    expect(failing({ ...good, backtest: null }, record)).toEqual(["backtest", "margin"]);
    expect(failing({ ...good, lossCapped: false }, record)).toEqual(["lossCapped", "margin"]);
    const said = Object.fromEntries(approvalChecks({ ...good, lossCapped: false }, { ...record, days: 1, publishedDays: 5, closed: 1, open: 2, accounts: 3 }).map((c) => [c.key, c.detail]));
    expect(said).toMatchObject({
      days: "First paper trade on 2026-10-01, 1 day ago; published 5 days ago.",
      trades: "1 closed paper trade, 2 still open, in the account that took the most entries (3 accounts traded it).",
      paperNet: "10.00 USD on 1 closed paper trade of one account, filled at the mark, less the fees estimated at entry.",
      lossCapped: "Its loss is not limited: such a strategy runs on paper and never goes live.",
      backtest: "4.20 USD a day on 106 samples; figures entered by hand. Source: autopilot-study, real fees",
    });
    // figures computed in the app say so, a mean with a long tail is printed to the cent, and a record older than the log says what it lacks
    const app = approvalChecks({ ...good, backtest: { ...good.backtest, mean: 4.199999999, samples: 1, run: { id: "bt_1", from: "2026-08-07", to: "2026-11-20", resolution: "5m", notes: [] } } }, { ...record, closed: 0, days: 120, publishedDays: 121, accounts: 1 }).map((c) => c.detail);
    expect(app.slice(0, 5)).toEqual([
      "4.20 USD a day on 1 sample; a backtest in the app. Source: autopilot-study, real fees",
      "First paper trade on 2026-10-01, 120 days ago; published 121 days ago. The log keeps 90 days: older trades are not in this record.",
      "0 closed paper trades, 0 still open, in the account that took the most entries (1 account traded it).",
      "No paper trade has closed yet.",
      "By its settings, every sold option is covered by a bought one, and no stop closes a sold option alone.",
    ]);
    expect(approvalChecks(good, { ...record, firstEntryAt: null, lastEntryAt: null, days: 0, publishedDays: 3, closed: 0 }).find((c) => c.key === "days")!.detail).toBe("No paper trade yet; published 3 days ago.");
  });

  it("HC-TR-292 approval is refused unless every blocking check passes and the trades were confirmed read", async () => {
    // too young and without trades
    const young = await onPaper("Young", 3);
    expect((await view(young.id)).approvable).toBe(false);
    const refused = await post(`${BASE}/${young.id}/approve`, { read: true });
    expect(refused.status).toBe(409);
    expect(await why(refused)).toBe(`${SAVED_REFUSALS.approveChecks}: at least 30 days since its first paper trade; at least 20 closed paper trades; paper result is positive after estimated fees`);
    // old enough, enough trades, a positive record, but its loss is not limited: never
    const naked = await onPaper("Naked", 31, NAKED);
    await goodRecord(naked);
    const v = await view(naked.id);
    expect(v.checks.filter((c) => !c.pass && c.blocking).map((c) => c.key)).toEqual(["lossCapped"]);
    expect(v.approvable).toBe(false);
    expect(await why(await post(`${BASE}/${naked.id}/approve`, { read: true }))).toBe(`${SAVED_REFUSALS.approveChecks}: loss limited: every sold option covered, none stopped alone`);
    // ADR-157 (HC-TR-315): the same for wings with a stop that closes one sold option alone, in its own words
    const stopped = await onPaper("Wings, stop 3x", 31, { ...WINGED, exits: { legStop: 3 } });
    await goodRecord(stopped);
    expect(stopped.lossCapped).toBe(false);
    const vs = await view(stopped.id);
    expect(vs.checks.filter((c) => !c.pass && c.blocking).map((c) => [c.key, c.detail])).toEqual([["lossCapped", "Every sold option is covered, but its stop closes one sold option alone and keeps the rest open: after that the loss is not limited. Such a strategy runs on paper and never goes live."]]);
    expect(vs.approvable).toBe(false);
    expect(await why(await post(`${BASE}/${stopped.id}/approve`, { read: true }))).toBe(`${SAVED_REFUSALS.approveChecks}: loss limited: every sold option covered, none stopped alone`);
    // everything passes: still nothing without the approver saying the trades were read
    const good = await onPaper("Good", 31);
    await goodRecord(good);
    expect((await view(good.id)).approvable).toBe(true);
    expect((await post(`${BASE}/${good.id}/approve`, {})).status).toBe(400);
    expect((await post(`${BASE}/${good.id}/approve`, { read: false })).status).toBe(400);
    expect((await post(`${BASE}/${good.id}/approve`)).status).toBe(400);
    expect((await one(good.id)).approval).toBeNull();
    // the checks are made again at the moment of approval: a loss booked after the screen was read refuses it
    await entry(good, owner.id, Date.now() - DAY, { pnl: "-500.00", fees: "0.50", reason: "stopped" });
    const late = await post(`${BASE}/${good.id}/approve`, { read: true });
    expect(late.status).toBe(409);
    expect(await why(late)).toBe(`${SAVED_REFUSALS.approveChecks}: paper result is positive after estimated fees`);
    expect((await one(good.id)).approval).toBeNull();
    // a draft and an unknown strategy
    const draft = await json<SavedStrategy>(await post(BASE, { name: "Draft for approval", summary: "A draft.", definition: WINGED }));
    const notPaper = await post(`${BASE}/${draft.id}/approve`, { read: true });
    expect(notPaper.status).toBe(409);
    expect(await why(notPaper)).toBe(SAVED_REFUSALS.approveNotPaper);
    expect((await post(`${BASE}/sv_nope/approve`, { read: true })).status).toBe(404);
    expect((await post(`${BASE}/sv_nope/withdraw-approval`)).status).toBe(404);
  });

  it("HC-TR-292 approve records who, when and the numbers; withdraw clears it; both are audited", async () => {
    const s = await onPaper("Approved", 31);
    await goodRecord(s);
    // a second account at a larger size and a worse run does not touch the record of the first
    await entry(s, trader.id, Date.now() - 5 * DAY, { pnl: "-900.00", fees: "5.00" });
    const before = Date.now();
    const res = await post(`${BASE}/${s.id}/approve`, { read: true });
    expect(res.status).toBe(200);
    const approved = await json<SavedStrategy>(res);
    expect(approved.stage).toBe("paper");
    expect(approved.traded).toBe(true);
    expect(approved.approval).toMatchObject({ by: owner.id, backtest: FIGURES, record: { publishedDays: 31, days: 30, closed: 21, wins: 14, accounts: 2, grossUsd: "71.40", feesUsd: "10.50", netUsd: "60.90", worstNetUsd: "-8.50" } });
    expect(approved.approval!.byName.length).toBeGreaterThan(0);
    expect(Date.parse(approved.approval!.at)).toBeGreaterThanOrEqual(before);
    expect((await view(s.id)).approval).toEqual(approved.approval);
    expect((await one(s.id)).approval).toEqual(approved.approval);
    // not twice
    const twice = await post(`${BASE}/${s.id}/approve`, { read: true });
    expect(twice.status).toBe(409);
    expect(await why(twice)).toBe(SAVED_REFUSALS.approveTwice);
    // its name, and the same figures sent again, leave the approval
    expect((await patch(s.id, { name: "Approved, renamed" })).status).toBe(200);
    expect((await patch(s.id, { backtest: FIGURES })).status).toBe(200);
    expect((await one(s.id)).approval).toEqual(approved.approval);
    const withdrawn = await post(`${BASE}/${s.id}/withdraw-approval`);
    expect(withdrawn.status).toBe(200);
    expect(await json<SavedStrategy>(withdrawn)).toMatchObject({ stage: "paper", approval: null });
    const again = await post(`${BASE}/${s.id}/withdraw-approval`);
    expect(again.status).toBe(409);
    expect(await why(again)).toBe(SAVED_REFUSALS.notApproved);
    const lines = await t.db.select({ action: auditLog.action, actorId: auditLog.actorId }).from(auditLog).where(eq(auditLog.target, `autopilot_strategy:${s.id}`));
    expect(lines.filter((l) => l.action === "admin.autopilot_strategy.approve")).toEqual([{ action: "admin.autopilot_strategy.approve", actorId: owner.id }]);
    expect(lines.filter((l) => l.action === "admin.autopilot_strategy.withdraw_approval")).toEqual([{ action: "admin.autopilot_strategy.withdraw_approval", actorId: owner.id }]);
    // approved again; other backtest figures, typed by any admin, end the approval: it was given on the old ones
    expect((await post(`${BASE}/${s.id}/approve`, { read: true })).status).toBe(200);
    expect((await patch(s.id, { backtest: { ...FIGURES, mean: 9.9 } }, other.cookie)).status).toBe(200);
    expect(await one(s.id)).toMatchObject({ stage: "paper", approval: null });
    // and retiring it ends one too
    expect((await post(`${BASE}/${s.id}/approve`, { read: true })).status).toBe(200);
    expect((await post(`${BASE}/${s.id}/retire`)).status).toBe(200);
    expect(await one(s.id)).toMatchObject({ stage: "retired", approval: null });
    expect(await why(await post(`${BASE}/${s.id}/withdraw-approval`))).toBe(SAVED_REFUSALS.notApproved);
  });

  it("HC-TR-292 an approved strategy trades on paper exactly as before, and nothing live exists", async () => {
    const s = await onPaper("Still paper", 31);
    await goodRecord(s);
    const was = (await savedCatalogue(t.db, new Date())).playbooks.find((p) => p.id === s.id);
    expect(was).toBeTruthy();
    expect((await post(`${BASE}/${s.id}/approve`, { read: true })).status).toBe(200);
    // the engine's catalogue holds the same playbook, the row is at the same stage, and every trade of it is a paper trade
    const now = (await savedCatalogue(t.db, new Date())).playbooks.find((p) => p.id === s.id);
    expect(now).toEqual(was);
    const [row] = await t.db.select({ stage: autopilotSavedStrategies.stage }).from(autopilotSavedStrategies).where(eq(autopilotSavedStrategies.id, s.id));
    expect(row!.stage).toBe("paper");
    const modes = await t.db.selectDistinct({ mode: strategies.tradingMode, status: strategies.status }).from(strategies).where(eq(strategies.autopilotPlaybookId, s.id));
    expect(modes).toEqual([{ mode: "paper", status: "archived" }]);
    // the trader's own card of it carries no word of the approval
    await t.db.update(autopilotSavedStrategies).set({ audience: "users", userIds: [trader.id] }).where(eq(autopilotSavedStrategies.id, s.id));
    const mine = await json<{ saved: Record<string, unknown>[] }>(await t.request("/v1/autopilot", { cookie: trader.cookie }));
    const card = mine.saved.find((c) => c["id"] === s.id)!;
    expect(card).toBeTruthy();
    expect(Object.keys(card)).not.toContain("approval");
  });
});

describe("HC-TR-293 the approver permission", () => {
  it("HC-TR-293 an admin without the approver permission can read the record and cannot approve or withdraw", async () => {
    const s = await onPaper("Guarded", 31);
    await goodRecord(s);
    const seen = await view(s.id, other.cookie);
    expect(seen.approvable).toBe(true);
    expect(seen.mayApprove).toBe(false);
    expect((await view(s.id)).mayApprove).toBe(true);
    const refused = await post(`${BASE}/${s.id}/approve`, { read: true }, other.cookie);
    expect(refused.status).toBe(403);
    expect(await why(refused)).toBe(SAVED_REFUSALS.notApprover);
    expect((await one(s.id)).approval).toBeNull();
    // an admin without it is told so for an unknown strategy too: what exists is not theirs to probe by approving
    expect((await post(`${BASE}/sv_nope/approve`, { read: true }, other.cookie)).status).toBe(403);
    expect((await post(`${BASE}/${s.id}/approve`, { read: true })).status).toBe(200);
    const kept = await post(`${BASE}/${s.id}/withdraw-approval`, undefined, other.cookie);
    expect(kept.status).toBe(403);
    expect((await one(s.id)).approval).not.toBeNull();
    // a trader reaches none of it, and the permission without the admin role is not enough
    expect((await post(`${BASE}/${s.id}/approve`, { read: true }, trader.cookie)).status).toBe(403);
    await t.db.update(users).set({ canApproveLive: true }).where(eq(users.id, trader.id));
    expect((await post(`${BASE}/${s.id}/withdraw-approval`, undefined, trader.cookie)).status).toBe(403);
    // an approver who is deactivated loses it with the account
    await t.db.update(users).set({ canApproveLive: true, active: false }).where(eq(users.id, other.id));
    expect(await mayApprove(t.db, other.id)).toBe(false);
    expect(await mayApprove(t.db, trader.id)).toBe(false);
    expect(await mayApprove(t.db, "nobody")).toBe(false);
    expect(await mayApprove(t.db, owner.id)).toBe(true);
    // neither refusal left an audit line
    const lines = await t.db.select({ actorId: auditLog.actorId }).from(auditLog).where(eq(auditLog.target, `autopilot_strategy:${s.id}`));
    expect(lines.filter((l) => l.actorId !== owner.id)).toEqual([]);
  });
});
