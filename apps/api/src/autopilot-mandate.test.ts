// The mandate for live Autopilot (ADR-147; HC-TR-296..298): sign with the typed LIVE word and the authenticator code,
// the refusals, pause / resume / end. A record only: nothing here places anything, and Autopilot stays paper only.
import { MANDATE_REFUSALS, MANDATE_STATEMENTS, type Mandate, type SavedStrategy } from "@hapiecoin/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUTH_BASE_PATH } from "./auth.js";
import { hasHeldExit, liveRefusalOf, standingFor } from "./autopilot-mandate.js";
import { auditLog, autopilotMandates, autopilotSavedStrategies, brokerCredentials, strategies, users } from "./db/schema.js";
import { SEED } from "./db/seed.js";
import { paperRecordOf } from "./saved-approval.js";
import { SECOND_FACTOR_HEADER } from "./security/second-factor.js";
import { cookieHeaderFrom, createTestApp, type TestApp } from "./test-support/harness.js";

let t: TestApp;
let admin: string;
/** A trader with the authenticator on and one exchange account connected. */
let trader: { cookie: string; id: string; secret: string; accountId: string };
/** A second trader: no authenticator, and an account of their own. */
let plain: { cookie: string; id: string; accountId: string };
const ADMIN = "/v1/admin/autopilot-strategies";
const BASE = "/v1/autopilot/mandates";
const password = "correct horse battery";
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
const idOf = async (cookie: string) => (await json<{ id: string }>(await t.request("/v1/me", { cookie }))).id;
const why = async (res: Response) => (await json<{ message: string }>(res)).message;

const base32Decode = (text: string): string => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of text.replace(/=+$/, "")) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes).toString("utf8");
};
/** The trader's current code, a step of the clock after the last one used. */
const code = async () => {
  t.now.value += 31_000;
  return (await t.auth.api.generateTOTP({ body: { secret: base32Decode(trader.secret) } })).code;
};
const coded = async () => ({ [SECOND_FACTOR_HEADER]: await code() });

beforeAll(async () => {
  t = await createTestApp();
  admin = await t.adminCookie();
  t.delta.accept("mandate-key-0001");
  t.delta.accept("mandate-key-0002");
  let cookie = (await t.signUp("mandate-trader@hapiecoin.test", { password })).cookie;
  // the account is connected before the authenticator goes on, so connecting it asks for no code
  const made = await t.request("/v1/credentials", { cookie, json: { brokerId: SEED.brokerId, apiKey: "mandate-key-0001", apiSecret: "s3cret" } });
  expect(made.status).toBe(201);
  t.now.value += 11_000;
  const enable = await t.request(`${AUTH_BASE_PATH}/two-factor/enable`, { cookie, json: { password } });
  expect(enable.status).toBe(200);
  const secret = new URL((await json<{ totpURI: string }>(enable)).totpURI).searchParams.get("secret")!;
  trader = { cookie, id: "", secret, accountId: "" };
  const verify = await t.request(`${AUTH_BASE_PATH}/two-factor/verify-totp`, { cookie, json: { code: await code() } });
  expect(verify.status).toBe(200);
  cookie = cookieHeaderFrom(verify, cookie);
  const id = await idOf(cookie);
  const [account] = await t.db.select({ id: brokerCredentials.id }).from(brokerCredentials).where(eq(brokerCredentials.userId, id));
  trader = { cookie, id, secret, accountId: account!.id };

  const p = await t.signUp("mandate-plain@hapiecoin.test");
  expect((await t.request("/v1/credentials", { cookie: p.cookie, json: { brokerId: SEED.brokerId, apiKey: "mandate-key-0002", apiSecret: "s3cret" } })).status).toBe(201);
  const pid = await idOf(p.cookie);
  const [pa] = await t.db.select({ id: brokerCredentials.id }).from(brokerCredentials).where(eq(brokerCredentials.userId, pid));
  plain = { cookie: p.cookie, id: pid, accountId: pa!.id };
});
afterAll(() => t.close());

const leg = (kind: "call" | "put", side: "buy" | "sell", value: number) => ({ kind, side, by: "pct" as const, value });
/** A strangle with wings: the loss of every trade is limited by the bought options. */
const WINGED = { assets: ["BTC"], venues: ["delta_india"], lots: 100, cadence: "daily", fromHourUtc: 16, toHourUtc: 17, oncePerExpiry: false, minDte: 0.5, maxDte: 1.5, legs: [leg("put", "buy", 3), leg("put", "sell", 1), leg("call", "sell", 1), leg("call", "buy", 3)], exits: {} };
const NAKED = { ...WINGED, legs: [leg("put", "sell", 1), leg("call", "sell", 1)], exits: { legStop: 2 } };
const FIGURES = { mean: 4.2, per: "day", positivePct: 71, worst: -60, samples: 106, basis: "autopilot-study, real fees" };
const adminPost = (path: string, body?: unknown) => t.request(path, { cookie: admin, method: "POST", ...(body === undefined ? {} : { json: body }) });

/**
 * A strategy on paper for the two traders. `approved` writes the approval straight onto the row: how an approval is
 * earned is HC-TR-292's subject, here only that one stands.
 */
async function strategy(name: string, definition: unknown = WINGED, approved = true): Promise<SavedStrategy> {
  const made = await json<SavedStrategy>(await adminPost(ADMIN, { name, summary: "Sell both sides each evening.", definition }));
  expect((await t.request(`${ADMIN}/${made.id}`, { cookie: admin, method: "PATCH", json: { backtest: FIGURES, audience: "users", userIds: [trader.id, plain.id] } })).status).toBe(200);
  expect((await adminPost(`${ADMIN}/${made.id}/publish`)).status).toBe(200);
  if (approved) await approve(made.id);
  return made;
}
async function approve(id: string): Promise<void> {
  const [row] = await t.db.select().from(autopilotSavedStrategies).where(eq(autopilotSavedStrategies.id, id));
  const { record } = await paperRecordOf(t.db, { id, publishedAt: row!.publishedAt!.toISOString() }, new Date());
  await t.db.update(autopilotSavedStrategies).set({ approval: { by: null, byName: "The Owner", at: new Date().toISOString(), record, backtest: row!.backtest! } }).where(eq(autopilotSavedStrategies.id, id));
}
const withdraw = (id: string) => t.db.update(autopilotSavedStrategies).set({ approval: null }).where(eq(autopilotSavedStrategies.id, id));

const DEACTIVATED: [number, string] = [403, "ACCOUNT_DEACTIVATED"];
const TICKED = { realOrders: true, ownAccount: true, canLose: true, estimate: true };
const terms = (strategyId: string, over: Record<string, unknown> = {}) => ({ strategyId, accountId: trader.accountId, lots: 10, maxCapitalUsd: 500, dayLossLimitUsd: 50, weekLossLimitUsd: 150, maxOpen: 1, statements: TICKED, confirm: "LIVE", ...over });
const sign = async (body: unknown, who: { cookie: string } = trader, headers?: Record<string, string>) => t.request(BASE, { cookie: who.cookie, json: body, headers: headers ?? (who === trader ? await coded() : {}) });
const mine = async (who: { cookie: string } = trader) => (await json<{ items: Mandate[] }>(await t.request(BASE, { cookie: who.cookie }))).items;
const step = async (id: string, what: "pause" | "resume" | "end", headers: Record<string, string> = {}, who: { cookie: string } = trader) => t.request(`${BASE}/${id}/${what}`, { cookie: who.cookie, method: "POST", headers });

describe("HC-TR-296 a trader signs a mandate for an approved strategy", () => {
  it("HC-TR-296 signing stores the account, the limits and the statements in the words signed, writes the audit line, and places nothing", async () => {
    const s = await strategy("Signed");
    const tradesBefore = (await t.db.select({ id: strategies.id }).from(strategies)).length;
    const res = await sign(terms(s.id));
    expect(res.status).toBe(201);
    const m = await json<Mandate>(res);
    expect(m).toMatchObject({ strategyId: s.id, strategyName: "Signed", version: 1, accountId: trader.accountId, accountLabel: "Main", lots: 10, maxCapitalUsd: 500, dayLossLimitUsd: 50, weekLossLimitUsd: 150, maxOpen: 1, state: "active", standing: true, pausedAt: null, pauseReason: null, endedAt: null, endReason: null });
    const [row] = await t.db.select().from(autopilotMandates).where(eq(autopilotMandates.id, m.id));
    expect(row!.statements).toEqual({ ...MANDATE_STATEMENTS });
    expect(row!.userId).toBe(trader.id);
    const [line] = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "autopilot.mandate.sign"), eq(auditLog.target, `autopilot_mandate:${m.id}`)));
    expect(line!.actorId).toBe(trader.id);
    expect(line!.after).toMatchObject({ strategyId: s.id, accountId: trader.accountId, lots: 10, maxCapitalUsd: 500, dayLossLimitUsd: 50, weekLossLimitUsd: 150, maxOpen: 1 });
    // read back by its trader only; the list is not kept by a browser
    const list = await t.request(BASE, { cookie: trader.cookie });
    expect(list.headers.get("cache-control")).toBe("private, no-store");
    expect((await mine()).map((x) => x.id)).toContain(m.id);
    expect(await mine(plain)).toEqual([]);
    expect((await t.request(BASE)).status).toBe(401);
    // a record only: no order went to the exchange, no trade was opened, and the strategy is still on paper
    expect(t.trading.placed).toHaveLength(0);
    expect((await t.db.select({ id: strategies.id }).from(strategies)).length).toBe(tradesBefore);
    const [after] = await t.db.select({ stage: autopilotSavedStrategies.stage }).from(autopilotSavedStrategies).where(eq(autopilotSavedStrategies.id, s.id));
    expect(after!.stage).toBe("paper");
  });
});

describe("HC-TR-297 what a signing is refused for", () => {
  it("HC-TR-297 the typed word, the authenticator and its code come first: a wrong word, an account without the authenticator, a missing or wrong code", async () => {
    const s = await strategy("Words");
    const wrongWord = await sign(terms(s.id, { confirm: "yes" }));
    expect(wrongWord.status).toBe(400);
    expect(await why(wrongWord)).toBe("Type LIVE to sign the mandate");
    // the second trader has no authenticator: a mandate is never signed without one
    const noApp = await sign(terms(s.id, { accountId: plain.accountId }), plain);
    expect(noApp.status).toBe(409);
    expect(await why(noApp)).toBe(MANDATE_REFUSALS.needsAuthenticator);
    const noCode = await sign(terms(s.id), trader, {});
    expect(noCode.status).toBe(403);
    expect((await json<{ code: string }>(noCode)).code).toBe("SECOND_FACTOR_REQUIRED");
    const badCode = await sign(terms(s.id), trader, { [SECOND_FACTOR_HEADER]: "000000" });
    expect(badCode.status).toBe(403);
    expect((await json<{ code: string }>(badCode)).code).toBe("SECOND_FACTOR_INVALID");
    expect(await mine()).not.toContainEqual(expect.objectContaining({ strategyId: s.id }));
  });

  it("HC-TR-297 the body is checked: every statement ticked, whole dollars, the week's limit at least the day's, the day's within the capital", async () => {
    const s = await strategy("Body");
    for (const over of [{ statements: { ...TICKED, canLose: false } }, { statements: { realOrders: true } }, { lots: 0 }, { maxCapitalUsd: 10.5 }, { maxOpen: 4 }, { weekLossLimitUsd: 40 }, { dayLossLimitUsd: 600, weekLossLimitUsd: 700 }, { weekLossLimitUsd: 501 }, { extra: 1 }]) {
      expect((await sign(terms(s.id, over))).status, JSON.stringify(over)).toBe(400);
    }
    expect(await mine()).not.toContainEqual(expect.objectContaining({ strategyId: s.id }));
  });

  it("HC-TR-297 the strategy must be allowed to trade live: approved, its loss limited, no exit that runs on paper only, and the trader in its audience", async () => {
    const pending = await strategy("Pending", WINGED, false);
    const r1 = await sign(terms(pending.id));
    expect([r1.status, await why(r1)]).toEqual([409, MANDATE_REFUSALS.notApproved]);
    // an approval written past the checks onto a strategy whose loss is not limited still signs nothing
    const naked = await strategy("Naked", NAKED);
    const r2 = await sign(terms(naked.id));
    expect([r2.status, await why(r2)]).toEqual([409, MANDATE_REFUSALS.notCapped]);
    for (const exits of [{ ladder: [30, 60] }, { legBuyBackShare: 0.2 }, { legBuyBackAt: 5 }]) {
      const held = await strategy(`Held ${JSON.stringify(exits)}`.slice(0, 40), { ...WINGED, exits });
      const r = await sign(terms(held.id));
      expect([r.status, await why(r)], JSON.stringify(exits)).toEqual([409, MANDATE_REFUSALS.heldExit]);
    }
    // settings written past the schema: a refusal in words, never a crash, for the signing and for the list
    const broken = await strategy("Broken");
    await t.db.update(autopilotSavedStrategies).set({ definition: { ...WINGED, legs: "none" } as never }).where(eq(autopilotSavedStrategies.id, broken.id));
    const r0 = await sign(terms(broken.id));
    expect([r0.status, await why(r0)]).toEqual([409, MANDATE_REFUSALS.unreadable]);
    expect((await t.request(BASE, { cookie: trader.cookie })).status).toBe(200);
    // a draft the trader is named on reads like one that does not exist
    const draft = await json<SavedStrategy>(await adminPost(ADMIN, { name: "Draft", summary: "Not published.", definition: WINGED }));
    await t.db.update(autopilotSavedStrategies).set({ audience: "users", userIds: [trader.id] }).where(eq(autopilotSavedStrategies.id, draft.id));
    const r7 = await sign(terms(draft.id));
    expect([r7.status, await why(r7)]).toEqual([409, MANDATE_REFUSALS.notUsable]);
    // not in its audience, and one that does not exist, read alike
    const closed = await strategy("Closed");
    await t.db.update(autopilotSavedStrategies).set({ userIds: [plain.id] }).where(eq(autopilotSavedStrategies.id, closed.id));
    const r3 = await sign(terms(closed.id));
    expect([r3.status, await why(r3)]).toEqual([409, MANDATE_REFUSALS.notUsable]);
    const r4 = await sign(terms("sv_nope"));
    expect([r4.status, await why(r4)]).toEqual([409, MANDATE_REFUSALS.notUsable]);
    // given to a plan the trader does not hold: not theirs either
    const planned = await strategy("Planned");
    await t.db.update(autopilotSavedStrategies).set({ audience: "plans", userIds: [], planIds: ["plan_they_do_not_hold"] }).where(eq(autopilotSavedStrategies.id, planned.id));
    const r6 = await sign(terms(planned.id));
    expect([r6.status, await why(r6)]).toEqual([409, MANDATE_REFUSALS.notUsable]);
    // retired: its approval went with it
    const retired = await strategy("Retired");
    expect((await adminPost(`${ADMIN}/${retired.id}/retire`)).status).toBe(200);
    const r5 = await sign(terms(retired.id));
    expect([r5.status, await why(r5)]).toEqual([409, MANDATE_REFUSALS.notApproved]);
    expect((await mine()).filter((m) => [pending.id, naked.id, closed.id, retired.id].includes(m.strategyId))).toEqual([]);
  });

  it("HC-TR-297 the account is the trader's own, the lots are within the strategy's, a deactivated account signs nothing, and a second mandate for the same strategy waits for the first to end", async () => {
    const s = await strategy("Terms");
    const r1 = await sign(terms(s.id, { accountId: plain.accountId })); // another trader's account
    expect([r1.status, await why(r1)]).toEqual([409, MANDATE_REFUSALS.noAccount]);
    const r2 = await sign(terms(s.id, { accountId: "cred_nope" }));
    expect([r2.status, await why(r2)]).toEqual([409, MANDATE_REFUSALS.noAccount]);
    const r3 = await sign(terms(s.id, { lots: 101 }));
    expect([r3.status, await why(r3)]).toEqual([409, `${MANDATE_REFUSALS.tooManyLots} (100)`]);
    // one coin, one trade at a time
    const r4 = await sign(terms(s.id, { maxOpen: 2 }));
    expect([r4.status, await why(r4)]).toEqual([409, `${MANDATE_REFUSALS.tooManyOpen} (1)`]);
    expect((await sign(terms(s.id, { lots: 100 }))).status).toBe(201);
    const again = await sign(terms(s.id));
    expect([again.status, await why(again)]).toEqual([409, MANDATE_REFUSALS.signedAlready]);
    // paused is not ended: still one mandate
    const [m] = (await mine()).filter((x) => x.strategyId === s.id);
    expect((await step(m!.id, "pause")).status).toBe(200);
    expect(await why(await sign(terms(s.id)))).toBe(MANDATE_REFUSALS.signedAlready);
    // ended: a new one can be signed, and the old one stays as the record of what was signed
    expect((await step(m!.id, "end")).status).toBe(200);
    expect((await sign(terms(s.id, { lots: 5 }))).status).toBe(201);
    expect((await mine()).filter((x) => x.strategyId === s.id).map((x) => [x.state, x.lots])).toEqual(expect.arrayContaining([["active", 5], ["ended", 100]]));
  });
});

describe("HC-TR-298 pause, resume and end", () => {
  it("HC-TR-298 pausing and ending ask for no code; resuming asks for one and checks the strategy again; an ended mandate is final; another trader's is not found", async () => {
    const s = await strategy("Steps");
    const m = await json<Mandate>(await sign(terms(s.id)));
    const paused = await step(m.id, "pause");
    expect(paused.status).toBe(200);
    expect(await json<Mandate>(paused)).toMatchObject({ state: "paused", pauseReason: "Paused by you", standing: true });
    expect(await why(await step(m.id, "pause"))).toBe(MANDATE_REFUSALS.notActive);
    // resuming lets orders go out again: the code is asked for
    const noCode = await step(m.id, "resume");
    expect(noCode.status).toBe(403);
    // the approval was withdrawn meanwhile: it reads as not standing, and it cannot be resumed
    await withdraw(s.id);
    expect((await mine()).find((x) => x.id === m.id)).toMatchObject({ state: "paused", standing: false });
    const refused = await step(m.id, "resume", await coded());
    expect([refused.status, await why(refused)]).toEqual([409, MANDATE_REFUSALS.notApproved]);
    await approve(s.id);
    const resumed = await step(m.id, "resume", await coded());
    expect(resumed.status).toBe(200);
    expect(await json<Mandate>(resumed)).toMatchObject({ state: "active", pausedAt: null, pauseReason: null, standing: true });
    expect(await why(await step(m.id, "resume", await coded()))).toBe(MANDATE_REFUSALS.notPaused);
    // taken out of its audience meanwhile: it does not stand, and a paused one does not resume
    expect((await step(m.id, "pause")).status).toBe(200);
    await t.db.update(autopilotSavedStrategies).set({ userIds: [plain.id] }).where(eq(autopilotSavedStrategies.id, s.id));
    expect((await mine()).find((x) => x.id === m.id)).toMatchObject({ state: "paused", standing: false });
    const outside = await step(m.id, "resume", await coded());
    expect([outside.status, await why(outside)]).toEqual([409, MANDATE_REFUSALS.notUsable]);
    await t.db.update(autopilotSavedStrategies).set({ userIds: [trader.id, plain.id] }).where(eq(autopilotSavedStrategies.id, s.id));
    expect((await step(m.id, "resume", await coded())).status).toBe(200);
    // an active mandate whose strategy lost its approval still reads active, and says it does not stand
    await withdraw(s.id);
    expect((await mine()).find((x) => x.id === m.id)).toMatchObject({ state: "active", standing: false });
    // another trader cannot see or stop it
    expect((await step(m.id, "end", {}, plain)).status).toBe(404);
    expect((await step("mnd_nope", "pause")).status).toBe(404);
    const ended = await step(m.id, "end");
    expect(await json<Mandate>(ended)).toMatchObject({ state: "ended", endReason: "Ended by you", standing: false });
    for (const what of ["pause", "end"] as const) expect(await why(await step(m.id, what))).toBe(MANDATE_REFUSALS.ended);
    expect(await why(await step(m.id, "resume", await coded()))).toBe(MANDATE_REFUSALS.ended);
    const lines = await t.db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.target, `autopilot_mandate:${m.id}`));
    expect(lines.map((l) => l.action).sort()).toEqual(["autopilot.mandate.end", "autopilot.mandate.pause", "autopilot.mandate.pause", "autopilot.mandate.resume", "autopilot.mandate.resume", "autopilot.mandate.sign"]);
  });

  it("HC-TR-298 disconnecting an exchange account ends its mandates with it, in words, and a new one can be signed", async () => {
    const s = await strategy("Disconnected");
    t.delta.accept("mandate-key-0004");
    expect((await t.request("/v1/credentials", { cookie: trader.cookie, json: { brokerId: SEED.brokerId, apiKey: "mandate-key-0004", apiSecret: "s3cret", label: "Third" }, headers: await coded() })).status).toBe(201);
    const [third] = await t.db.select({ id: brokerCredentials.id }).from(brokerCredentials).where(and(eq(brokerCredentials.userId, trader.id), eq(brokerCredentials.label, "Third")));
    const m = await json<Mandate>(await sign(terms(s.id, { accountId: third!.id })));
    const gone = await t.request(`/v1/credentials/${third!.id}`, { cookie: trader.cookie, method: "DELETE", headers: await coded() });
    expect(gone.status).toBe(204);
    const [row] = await t.db.select().from(autopilotMandates).where(eq(autopilotMandates.id, m.id));
    expect(row).toMatchObject({ state: "ended", accountId: null, endReason: MANDATE_REFUSALS.accountGone });
    expect(row!.endedAt).not.toBeNull();
    expect((await mine()).find((x) => x.id === m.id)).toMatchObject({ state: "ended", standing: false, endReason: MANDATE_REFUSALS.accountGone });
    const lines = await t.db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.target, `autopilot_mandate:${m.id}`));
    expect(lines.map((l) => l.action).sort()).toEqual(["autopilot.mandate.end", "autopilot.mandate.sign"]);
    expect(await why(await step(m.id, "pause"))).toBe(MANDATE_REFUSALS.ended);
    // it has ended: the next signing for the same strategy is not held up by it
    expect((await sign(terms(s.id))).status).toBe(201);
  });

  it("HC-TR-298 an account removed past the route leaves a mandate that reads ended, takes no step but End, and does not hold up a new signing", async () => {
    const s = await strategy("Account gone");
    // an account of its own, so the other tests keep theirs
    t.delta.accept("mandate-key-0003");
    const made = await t.request("/v1/credentials", { cookie: trader.cookie, json: { brokerId: SEED.brokerId, apiKey: "mandate-key-0003", apiSecret: "s3cret", label: "Second" }, headers: await coded() });
    expect(made.status).toBe(201);
    const [second] = await t.db.select({ id: brokerCredentials.id }).from(brokerCredentials).where(and(eq(brokerCredentials.userId, trader.id), eq(brokerCredentials.label, "Second")));
    const m = await json<Mandate>(await sign(terms(s.id, { accountId: second!.id })));
    expect(m.accountLabel).toBe("Second");
    expect((await step(m.id, "pause")).status).toBe(200);
    await t.db.delete(brokerCredentials).where(eq(brokerCredentials.id, second!.id));
    expect((await mine()).find((x) => x.id === m.id)).toMatchObject({ accountId: null, accountLabel: null, state: "ended", standing: false, endReason: MANDATE_REFUSALS.accountGone });
    expect(await why(await step(m.id, "resume", await coded()))).toBe(MANDATE_REFUSALS.accountGone);
    // signing again ends the old row for good and stores the new one
    const again = await sign(terms(s.id));
    expect(again.status).toBe(201);
    const [old] = await t.db.select().from(autopilotMandates).where(eq(autopilotMandates.id, m.id));
    expect(old).toMatchObject({ state: "ended", endReason: MANDATE_REFUSALS.accountGone });
    // and one still active when its account went: no pause, only End
    const s2 = await strategy("Account gone twice");
    t.delta.accept("mandate-key-0005");
    expect((await t.request("/v1/credentials", { cookie: trader.cookie, json: { brokerId: SEED.brokerId, apiKey: "mandate-key-0005", apiSecret: "s3cret", label: "Fourth" }, headers: await coded() })).status).toBe(201);
    const [fourth] = await t.db.select({ id: brokerCredentials.id }).from(brokerCredentials).where(and(eq(brokerCredentials.userId, trader.id), eq(brokerCredentials.label, "Fourth")));
    const m2 = await json<Mandate>(await sign(terms(s2.id, { accountId: fourth!.id })));
    await t.db.delete(brokerCredentials).where(eq(brokerCredentials.id, fourth!.id));
    expect(await why(await step(m2.id, "pause"))).toBe(MANDATE_REFUSALS.accountGone);
    expect(await json<Mandate>(await step(m2.id, "end"))).toMatchObject({ state: "ended", endReason: MANDATE_REFUSALS.accountGone });
  });

  it("HC-TR-298 the checks a mandate rests on, alone: what stands, and which exits are held on live", () => {
    expect(standingFor(undefined)).toBe(false);
    expect(hasHeldExit({ exits: { legStop: 2, takeProfitOfCredit: 0.5 } })).toBe(false);
    expect(hasHeldExit({ exits: { ladder: [50] } })).toBe(true);
    expect(liveRefusalOf(undefined)).toBe(MANDATE_REFUSALS.notApproved);
  });

  it("HC-TR-297 a trader whose account was deactivated signs nothing", async () => {
    const s = await strategy("Deactivated");
    await t.db.update(users).set({ active: false }).where(eq(users.id, trader.id));
    try {
      const res = await sign(terms(s.id));
      expect([res.status, (await json<{ code: string }>(res)).code]).toEqual(DEACTIVATED);
      expect(await t.db.select().from(autopilotMandates).where(eq(autopilotMandates.strategyId, s.id))).toEqual([]);
    } finally {
      await t.db.update(users).set({ active: true }).where(eq(users.id, trader.id));
    }
  });
});
