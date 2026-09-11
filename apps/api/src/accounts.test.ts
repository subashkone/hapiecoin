// Accounts (ADR-068; HC-TR-173, HC-TR-174): with two keys on one exchange every order and every exit goes through
// the key the strategy names, never the other one; nothing is guessed when none is named; a second key stamps the
// running strategies with the first; a key a live strategy names cannot be deleted.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Strategy } from "@hapiecoin/schema";
import { SEED } from "./db/seed.js";
import { evaluateRules } from "./rules-engine.js";
import { createTestApp, type TestApp } from "./test-support/harness.js";

let t: TestApp;
let cookie: string;
let main: string; // key ids
let sub: string;
const MAIN_KEY = "acct-main-key-AAAA";
const SUB_KEY = "acct-sub-key-BBBB";
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
const CALL = { kind: "call", side: "buy", strike: "80000", expiry: "2026-09-25", symbol: "C-BTC-80000-250926", lots: 1, price: "1200" };
const PUT = { kind: "put", side: "sell", strike: "78000", expiry: "2026-09-25", symbol: "P-BTC-78000-250926", lots: 1, price: "900" };
const connect = (label: string, apiKey: string) => t.request("/v1/credentials", { cookie, json: { brokerId: SEED.brokerId, label, apiKey, apiSecret: `${apiKey}-secret` } });
const keys = async () => (await json<{ items: { id: string; label: string }[] }>(await t.request("/v1/credentials", { cookie }))).items;
const draft = async (name: string, legs: unknown[] = [CALL, PUT]) => json<Strategy>(await t.request("/v1/strategies", { cookie, json: { name, asset: "BTC", legs } }));
const keyOf = (i: number) => t.trading.placed[i]!.creds.apiKey;

beforeAll(async () => {
  t = await createTestApp();
  cookie = (await t.signUp("accounts-flow@hapiecoin.test")).cookie;
  t.delta.accept(MAIN_KEY).accept(SUB_KEY);
  expect((await connect("Main", MAIN_KEY)).status).toBe(201);
  expect((await connect("Sub 1", SUB_KEY)).status).toBe(201);
  const list = await keys();
  main = list.find((k) => k.label === "Main")!.id;
  sub = list.find((k) => k.label === "Sub 1")!.id;
});
afterAll(() => t.close());
beforeEach(() => {
  t.trading.product("C-BTC-80000-250926", 101, "0.001").markAt("C-BTC-80000-250926", "1200").fillAt(101, "1200");
  t.trading.product("P-BTC-78000-250926", 102, "0.001").markAt("P-BTC-78000-250926", "900").fillAt(102, "900");
  t.trading.setBalances([{ asset: "USD", balance: "5000", availableBalance: "4000" }]);
  t.trading.setPositions([]);
  t.trading.succeed(101).succeed(102);
});

describe("HC-TR-174 the key is resolved once and never guessed", () => {
  it("two keys and none named: positions, positions-exit, place and Trade All are refused with the count; a foreign account is refused", async () => {
    expect((await t.request(`/v1/strategies/live/positions?brokerId=${SEED.brokerId}`, { cookie })).status).toBe(409);
    expect((await t.request(`/v1/strategies/live/positions?brokerId=${SEED.brokerId}&accountId=${sub}`, { cookie })).status).toBe(200);
    expect((await t.request("/v1/strategies/live/positions/exit", { cookie, json: { brokerId: SEED.brokerId, productIds: [101], idempotencyKey: "acct-exit-none-01" } })).status).toBe(409);
    const s = await draft("No account named");
    const refused = await t.request(`/v1/strategies/${s.id}/live/place`, { cookie, json: { brokerId: SEED.brokerId, idempotencyKey: "acct-place-none-01", expected: {} } });
    expect(refused.status).toBe(409);
    expect((await json<{ message: string }>(refused)).message).toContain("2 accounts connected · pick one");
    expect((await t.request(`/v1/strategies/${s.id}/live/place`, { cookie, json: { brokerId: SEED.brokerId, accountId: "crd_nope", idempotencyKey: "acct-place-foreign-01", expected: {} } })).status).toBe(409);
    expect((await t.request(`/v1/strategies/${s.id}/start`, { cookie, json: { mode: "paper", brokerId: SEED.brokerId, accountId: "crd_nope", entries: {} } })).status).toBe(400);
    // Trade All only takes paper strategies: started with two keys and no account, it names none
    expect((await t.request(`/v1/strategies/${s.id}/start`, { cookie, json: { mode: "paper", brokerId: SEED.brokerId, entries: {} } })).status).toBe(200);
    const batch = await t.request("/v1/strategies/live/batch", { cookie, json: { ids: [s.id], brokerId: SEED.brokerId, idempotencyKey: "acct-batch-none-01" } });
    expect(batch.status).toBe(200); // the batch reports the refusal on the first strategy and stops
    expect(await json<{ placed: string[]; failed: { id: string; error: string } | null }>(batch)).toMatchObject({ placed: [], failed: { id: s.id, error: expect.stringContaining("2 accounts connected") as string } });
    expect((await t.request(`/v1/strategies/${s.id}`, { cookie }).then((r) => json<Strategy>(r))).status).toBe("paper");
    expect((await t.request(`/v1/credentials/${SEED.brokerId}`, { method: "DELETE", cookie })).status).toBe(409); // by exchange id with two keys: which one?
  });

  it("live on Sub 1: the entry, a retry, a sync, a leg close, close-all and a fired rule all go through the Sub 1 key", async () => {
    const s = await draft("Sub book");
    const placed = await json<Strategy>(await t.request(`/v1/strategies/${s.id}/live/place`, { cookie, json: { brokerId: SEED.brokerId, accountId: sub, idempotencyKey: "acct-place-sub-01", expected: {} } }));
    expect(placed.status).toBe("live");
    expect(placed.accountId).toBe(sub);
    const n = t.trading.placed.length;
    expect(t.trading.placed.slice(n - 2).map((p) => p.creds.apiKey)).toEqual([SUB_KEY, SUB_KEY]);
    // the routes that open the key again
    expect((await t.request(`/v1/strategies/${s.id}/live/sync`, { method: "POST", cookie })).status).toBe(200);
    expect((await t.request(`/v1/strategies/${s.id}/live/retry`, { method: "POST", cookie })).status).toBe(200); // nothing to retry: the key was opened all the same
    const call = placed.legs.find((l) => l.symbol === CALL.symbol)!;
    expect((await t.request(`/v1/strategies/${s.id}/legs/${call.id}/close`, { cookie, json: { exitPrice: "1200" } })).status).toBe(200); // live: the price is the venue fill, the body only names the leg
    expect(keyOf(t.trading.placed.length - 1)).toBe(SUB_KEY);
    // a rule fires the put through the same key
    expect((await t.request(`/v1/strategies/${s.id}/rules`, { method: "PUT", cookie, json: { rules: [{ kind: "stop", trigger: "money", value: "0.1" }] } })).status).toBe(200);
    const fired = await evaluateRules(t.deps, { tick: () => Promise.resolve({ marks: new Map([["P-BTC-78000-250926", 1500]]), spot: null }) }, () => Date.UTC(2026, 8, 11, 9), { attempts: 1, backoffMs: 0 });
    expect(fired.fired).toHaveLength(1);
    expect(keyOf(t.trading.placed.length - 1)).toBe(SUB_KEY);
    const done = await json<Strategy>(await t.request(`/v1/strategies/${s.id}`, { cookie }));
    expect(done.status).toBe("archived");
    // close-all on another Sub 1 strategy, and the positions read for it
    const s2 = await draft("Sub book 2", [CALL]);
    expect((await t.request(`/v1/strategies/${s2.id}/live/place`, { cookie, json: { brokerId: SEED.brokerId, accountId: sub, idempotencyKey: "acct-place-sub-02", expected: {} } })).status).toBe(200);
    expect((await t.request(`/v1/strategies/${s2.id}/close`, { cookie, json: { exits: {} } })).status).toBe(200);
    expect(keyOf(t.trading.placed.length - 1)).toBe(SUB_KEY);
    expect(t.trading.placed.every((p) => p.creds.apiKey !== MAIN_KEY)).toBe(true); // the Main key never sent anything
  });

  it("Trade All: a paper strategy started on Sub 1 stays on Sub 1 even when the batch picks Main; one without an account takes the batch's", async () => {
    const onSub = await draft("Paper on sub", [CALL]);
    expect((await t.request(`/v1/strategies/${onSub.id}/start`, { cookie, json: { mode: "paper", brokerId: SEED.brokerId, accountId: sub, entries: {} } })).status).toBe(200);
    const onNone = await draft("Paper on none", [PUT]);
    // two keys: a paper start without an account records none
    expect((await t.request(`/v1/strategies/${onNone.id}/start`, { cookie, json: { mode: "paper", brokerId: SEED.brokerId, entries: {} } })).status).toBe(200);
    const before = t.trading.placed.length;
    const r = await json<{ placed: string[]; failed: unknown }>(await t.request("/v1/strategies/live/batch", { cookie, json: { ids: [onSub.id, onNone.id], brokerId: SEED.brokerId, accountId: main, idempotencyKey: "acct-batch-mixed-01" } }));
    expect(r.placed).toEqual([onSub.id, onNone.id]);
    expect(t.trading.placed.slice(before).map((p) => p.creds.apiKey)).toEqual([SUB_KEY, MAIN_KEY]);
    const a = await json<Strategy>(await t.request(`/v1/strategies/${onSub.id}`, { cookie }));
    const b = await json<Strategy>(await t.request(`/v1/strategies/${onNone.id}`, { cookie }));
    expect([a.accountId, b.accountId]).toEqual([sub, main]);
  });
});

describe("HC-TR-173 a second key stamps the running strategies with the first; the delete is refused while a live strategy names a key", () => {
  it("stamping: paper and live rows on that exchange with no account, not drafts or archived ones", async () => {
    const other = (await t.signUp("accounts-stamp@hapiecoin.test")).cookie;
    t.delta.accept("stamp-main-CCCC").accept("stamp-sub-DDDD");
    expect((await t.request("/v1/credentials", { cookie: other, json: { brokerId: SEED.brokerId, apiKey: "stamp-main-CCCC", apiSecret: "s" } })).status).toBe(201);
    const [first] = (await json<{ items: { id: string }[] }>(await t.request("/v1/credentials", { cookie: other }))).items;
    const mk = async (name: string) => json<Strategy>(await t.request("/v1/strategies", { cookie: other, json: { name, asset: "BTC", legs: [CALL] } }));
    const paper = await mk("Stamp paper");
    expect((await t.request(`/v1/strategies/${paper.id}/start`, { cookie: other, json: { mode: "paper", brokerId: SEED.brokerId, entries: {} } })).status).toBe(200);
    const live = await mk("Stamp live");
    expect((await t.request(`/v1/strategies/${live.id}/live/place`, { cookie: other, json: { brokerId: SEED.brokerId, idempotencyKey: "acct-stamp-live-01", expected: {} } })).status).toBe(200);
    const stillDraft = await mk("Stamp draft");
    // with one key the start and the place recorded it already; a row from before accounts would carry null: model that
    await t.db.update((await import("./db/schema.js")).strategies).set({ accountId: null });
    expect((await t.request("/v1/credentials", { cookie: other, json: { brokerId: SEED.brokerId, label: "Sub 1", apiKey: "stamp-sub-DDDD", apiSecret: "s" } })).status).toBe(201);
    const get = async (id: string) => (await json<Strategy>(await t.request(`/v1/strategies/${id}`, { cookie: other }))).accountId;
    expect(await get(paper.id)).toBe(first!.id);
    expect(await get(live.id)).toBe(first!.id);
    expect(await get(stillDraft.id)).toBeNull();
    // the live strategy names the first key: that key cannot go; the second can; closing the strategy frees the first
    expect((await t.request(`/v1/credentials/${first!.id}`, { method: "DELETE", cookie: other })).status).toBe(409);
    const second = (await json<{ items: { id: string; label: string }[] }>(await t.request("/v1/credentials", { cookie: other }))).items.find((k) => k.label === "Sub 1")!;
    expect((await t.request(`/v1/credentials/${second.id}`, { method: "DELETE", cookie: other })).status).toBe(204);
    expect((await t.request(`/v1/strategies/${live.id}/close`, { cookie: other, json: { exits: {} } })).status).toBe(200);
    expect((await t.request(`/v1/credentials/${first!.id}`, { method: "DELETE", cookie: other })).status).toBe(204);
    expect(await get(paper.id)).toBeNull(); // the paper strategy stopped naming the deleted key (restrict column, cleared by the route)
  });
});
