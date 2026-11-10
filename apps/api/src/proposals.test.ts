// Playbook proposals (ADR-102; HC-TR-207, HC-TR-208, HC-TR-209): the detector writes one proposal per playbook, venue,
// asset and day for the plans that would enter on the latest recorded day (never the control, never without a record,
// never twice); the routes list a day's proposals with the caller's marks and take a mark; Telegram goes to opted-in
// linked users for pass-status proposals only, under a daily cap. Nothing here places anything.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PLAYBOOKS } from "@hapiecoin/pricing";
import type { Instrument, Proposal, Proposals, Quote, UserSettings } from "@hapiecoin/schema";
import { and, eq, inArray } from "drizzle-orm";
import { clearEodMemo } from "./chain-eod.js";
import { playbookRecords, users } from "./db/schema.js";
import { snapshotOnce, type MarketSource } from "./iv-snapshot.js";
import { refreshPlaybookRecords } from "./playbooks.js";
import { type ProposalDeps, deliverProposals, detectProposals, latestProposalDay, proposalMessage, runProposals } from "./proposals.js";
import { createTestApp, type TestApp } from "./test-support/harness.js";

let t: TestApp;
let cookie: string;
const EMAIL = "proposals@hapiecoin.test";
beforeAll(async () => {
  t = await createTestApp();
  cookie = (await t.signUp(EMAIL)).cookie;
});
afterAll(() => t.close());

const DAY = 86_400_000;
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 8, 1, 12, 0, 0);
const LATEST = "2026-09-08"; // day 7
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
function inst(symbol: string, kind: "call" | "put", strike: number, expiry: string): Instrument {
  return { id: `delta_india:${symbol}`, venue: "delta_india", symbol, underlying: "BTC", kind, strike: String(strike), expiry, contractSize: "0.001", tickSize: "0.1", quoteCurrency: "USD", venueProductId: 1, isActive: true };
}
/** Ten strikes on two expiries: a week past the latest day and six weeks past it, so a 30-day plan has an expiry too. */
function sourceOn(dayIndex: number): MarketSource {
  const spot = 80_000 + dayIndex * 400;
  const expiries = ["2026-09-15", "2026-10-20"];
  const strikes = [76_000, 77_000, 78_000, 79_000, 80_000, 81_000, 82_000, 83_000, 84_000, 85_000];
  const products: Instrument[] = [];
  const quotes: Quote[] = [];
  for (const e of expiries)
    for (const k of strikes) {
      const code = e.slice(8, 10) + e.slice(5, 7) + e.slice(2, 4);
      const c = `C-BTC-${k}-${code}`;
      const p = `P-BTC-${k}-${code}`;
      products.push(inst(c, "call", k, e), inst(p, "put", k, e));
      const ts = T0 + dayIndex * DAY;
      quotes.push({ instrumentId: `delta_india:${c}`, ts, mark: String(Math.max(spot - k, 0) + 400), oi: "1", spot: String(spot), markIv: 0.4 }, { instrumentId: `delta_india:${p}`, ts, mark: String(Math.max(k - spot, 0) + 400), oi: "1", spot: String(spot), markIv: 0.42 });
    }
  return { venue: "delta_india", products: () => Promise.resolve(products), tickers: (u) => Promise.resolve(u === "BTC" ? quotes : []) };
}
const deps = (over: Partial<ProposalDeps> = {}): ProposalDeps => ({ db: t.db, logger: t.deps.logger, telegram: t.telegram, webUrl: "https://app.example", telegramCap: 3, ...over });
const nonControlBtc = PLAYBOOKS.filter((p) => !p.control && p.assets.includes("BTC"));

describe("HC-TR-207 the proposal detector", () => {
  it("HC-TR-207 proposes nothing without a record, then one proposal per entering plan on the latest recorded day, never the control, never twice", async () => {
    clearEodMemo();
    for (let d = 0; d <= 7; d++) await snapshotOnce(t.deps, sourceOn(d), () => T0 + d * DAY + HOUR);
    // records first (ADR-098: nothing proposes without one)
    const bare = await detectProposals(deps(), ["delta_india"]);
    expect(bare).toEqual({ created: 0, skipped: 0, noRecord: nonControlBtc.length, noData: 1 }); // ETH has no day
    await refreshPlaybookRecords({ db: t.db, logger: t.deps.logger, now: () => T0 + 7 * DAY + 2 * HOUR }, ["delta_india"]);
    // two plans will have a passing record when they are detected (the Telegram test below delivers pass only)
    await t.db.update(playbookRecords).set({ status: "pass" }).where(and(eq(playbookRecords.asset, "BTC"), inArray(playbookRecords.playbookId, ["pin-butterfly", "covered-call"])));
    const first = await detectProposals(deps(), ["delta_india"]);
    expect(first.noRecord).toBe(0);
    expect(first.created).toBeGreaterThanOrEqual(2);
    const res = await t.request(`/v1/proposals?day=${LATEST}`, { cookie });
    expect(res.status).toBe(200);
    const body = await json<Proposals>(res);
    expect(body).toMatchObject({ venue: "delta_india", day: LATEST });
    const ids = body.items.map((p) => p.playbookId);
    expect(ids).not.toContain("hero-or-zero");
    // the butterfly needs one day to expiry, the covered call thirty: the 15 Sep and 20 Oct expiries respectively
    const fly = body.items.find((p) => p.playbookId === "pin-butterfly")!;
    expect(fly).toMatchObject({ asset: "BTC", expiry: "2026-09-15", recordStatus: "pass", status: "new", telegramSentAt: null });
    expect(fly.legs.length).toBeGreaterThanOrEqual(3);
    expect(fly.legs.every((l) => l.expiry === "2026-09-15")).toBe(true);
    expect(fly.legs.some((l) => l.lots === 10)).toBe(true); // the plan's size; a ratio leg carries a multiple of it
    expect(Number(fly.spot)).toBe(82_800);
    const cc = body.items.find((p) => p.playbookId === "covered-call")!;
    expect(cc.expiry).toBe("2026-10-20");
    expect(cc.legs.some((l) => l.kind === "future")).toBe(true);
    expect(cc.maxProfit).not.toBeNull();
    // the trend and IV-rank plans have no signal on eight days: not proposed
    for (const id of ["trend-calls", "trend-puts", "premium-harvest", "expiry-week-credit"]) expect(ids).not.toContain(id);
    // a second run adds nothing
    const again = await detectProposals(deps(), ["delta_india"]);
    expect(again.created).toBe(0);
    expect((await json<Proposals>(await t.request(`/v1/proposals?day=${LATEST}`, { cookie }))).items).toHaveLength(body.items.length);
  });
});

describe("HC-TR-208 the proposals routes", () => {
  it("HC-TR-208 lists behind the session, the latest proposal day by default, and takes the caller's mark", async () => {
    expect((await t.request("/v1/proposals")).status).toBe(401);
    // no day asked: the newest day with a proposal (the recorded chain's day, not the calendar day)
    const latest = await t.request("/v1/proposals", { cookie });
    expect(latest.status).toBe(200);
    expect(latest.headers.get("cache-control")).toBe("private, no-store");
    const latestBody = await json<Proposals>(latest);
    expect(latestBody.day).toBe(LATEST);
    expect(latestBody.items.length).toBeGreaterThanOrEqual(2);
    // a day with nothing recorded is an empty list, not an error
    expect((await json<Proposals>(await t.request("/v1/proposals?day=2026-01-01", { cookie }))).items).toEqual([]);
    const items = (await json<Proposals>(await t.request(`/v1/proposals?day=${LATEST}`, { cookie }))).items;
    const fly = items.find((p) => p.playbookId === "pin-butterfly")!;
    const marked = await t.request(`/v1/proposals/${fly.id}/mark`, { method: "POST", cookie, json: { status: "dismissed" } });
    expect(marked.status).toBe(200);
    expect((await json<Proposal>(marked)).status).toBe("dismissed");
    const after = (await json<Proposals>(await t.request(`/v1/proposals?day=${LATEST}`, { cookie }))).items;
    expect(after.find((p) => p.id === fly.id)?.status).toBe("dismissed");
    expect(after.filter((p) => p.id !== fly.id).every((p) => p.status === "new")).toBe(true);
    // another user's view is untouched by this caller's mark
    const other = (await t.signUp("proposals-other@hapiecoin.test")).cookie;
    expect((await json<Proposals>(await t.request(`/v1/proposals?day=${LATEST}`, { cookie: other }))).items.every((p) => p.status === "new")).toBe(true);
    expect((await t.request("/v1/proposals/999999/mark", { method: "POST", cookie, json: { status: "taken" } })).status).toBe(404);
    expect((await t.request(`/v1/proposals/${fly.id}/mark`, { method: "POST", cookie, json: { status: "new" } })).status).toBe(400);
    // taken overrides dismissed
    expect((await json<Proposal>(await t.request(`/v1/proposals/${fly.id}/mark`, { method: "POST", cookie, json: { status: "taken" } }))).status).toBe("taken");
    // a venue with no proposal yet: today's empty list, not an error
    const deribit = await json<Proposals>(await t.request("/v1/proposals?venue=deribit", { cookie }));
    expect(deribit.venue).toBe("deribit");
    expect(deribit.items).toEqual([]);
    expect(await latestProposalDay(t.db, "deribit")).toBeNull();
    expect(await latestProposalDay(t.db, "delta_india")).toBe(LATEST);
  });

  it("HC-TR-209 the message names every leg kind and side, the venue, pays or receives, and an unbounded loss; nothing fresh means nothing attempted", async () => {
    const p = PLAYBOOKS.find((x) => x.id === "covered-call")!;
    const row = {
      id: 1,
      playbookId: p.id,
      venue: "deribit" as const,
      asset: "ETH" as const,
      day: "2026-09-08",
      expiry: "2026-10-20",
      spot: "3000",
      legs: [
        { kind: "future" as const, side: "buy" as const, strike: "", expiry: "PERP", lots: 10, price: "3000", iv: null },
        { kind: "put" as const, side: "sell" as const, strike: "2900", expiry: "2026-10-20", lots: 10, price: "50", iv: 0.6 },
      ],
      entryCost: "-12.5",
      maxProfit: null,
      maxLoss: "-300",
      recordStatus: "pass" as const,
      createdAt: new Date(T0),
    };
    const credit = proposalMessage(p, row, "https://x.example");
    expect(credit).toContain("(ETH, Deribit)");
    expect(credit).toContain("B PERP · S P 2900");
    expect(credit).toContain("receives 12.5");
    expect(credit).toContain("max loss -300");
    const debit = proposalMessage(p, { ...row, venue: "delta_india", legs: [{ kind: "call", side: "buy", strike: "3100", expiry: "2026-10-20", lots: 10, price: "80", iv: null }], entryCost: "8", maxLoss: null }, "https://x.example");
    expect(debit).toContain("(ETH, Delta India)");
    expect(debit).toContain("B C 3100");
    expect(debit).toContain("pays 8");
    expect(debit).toContain("max loss unbounded");
    // nothing detected in the day before `now`: no recipient is even read
    expect(await deliverProposals(deps({ now: () => Date.UTC(2030, 0, 1, 12) }))).toEqual({ sent: 0, capped: 0, failed: 0 });
  });
});

describe("HC-TR-209 Telegram delivery", () => {
  it("HC-TR-209 messages opted-in linked users for pass proposals only, under the daily cap, once per proposal, and never without the bot or the opt-in", async () => {
    const now = () => Date.UTC(2026, 8, 8, 12, 30, 0); // the proposals' day
    // nobody opted in yet: nothing goes out
    expect(await deliverProposals(deps({ now }))).toEqual({ sent: 0, capped: 0, failed: 0 });
    await t.db.update(users).set({ telegramChatId: "chat-1" }).where(eq(users.email, EMAIL));
    const settings = await json<UserSettings>(await t.request("/v1/settings", { cookie }));
    expect(settings.proposalsTelegram).toBe(false); // HC-SH-141: off by default
    const put = await t.request("/v1/settings", { method: "PUT", cookie, json: { ...settings, proposalsTelegram: true } });
    expect(put.status).toBe(200);
    expect((await json<UserSettings>(put)).proposalsTelegram).toBe(true);
    // a linked user who did not opt in gets nothing
    await t.db.update(users).set({ telegramChatId: "chat-2" }).where(eq(users.email, "proposals-other@hapiecoin.test"));
    const before = t.telegram.sent.length;
    const capped = await deliverProposals(deps({ now, telegramCap: 1 }));
    expect(capped).toEqual({ sent: 1, capped: 1, failed: 0 });
    expect(t.telegram.sent.length - before).toBe(1);
    const msg = t.telegram.sent.at(-1)!;
    expect(msg.chatId).toBe("chat-1");
    expect(msg.text).toContain("HapieCoin playbook");
    expect(msg.text).toContain("paper");
    expect(msg.text).toContain("https://app.example/analyse");
    expect(msg.text).not.toMatch(/place now|buy now/i);
    // the same cap again: the sent one is skipped, the other still capped
    expect(await deliverProposals(deps({ now, telegramCap: 1 }))).toEqual({ sent: 0, capped: 1, failed: 0 });
    // a wider cap sends the rest, once
    const rest = await deliverProposals(deps({ now, telegramCap: 5 }));
    expect(rest.capped).toBe(0);
    expect(rest.sent).toBeGreaterThanOrEqual(1);
    expect(await deliverProposals(deps({ now, telegramCap: 5 }))).toEqual({ sent: 0, capped: 0, failed: 0 });
    expect(t.telegram.sent.every((m) => m.chatId === "chat-1")).toBe(true);
    // the marks carry the delivery time and keep the caller's status
    const items = (await json<Proposals>(await t.request(`/v1/proposals?day=${LATEST}`, { cookie }))).items;
    expect(items.filter((p) => p.recordStatus === "pass").every((p) => p.telegramSentAt !== null)).toBe(true);
    expect(items.find((p) => p.playbookId === "pin-butterfly")?.status).toBe("taken");
    // a blocked chat is a failure, not a mark: the second user opts in, the bot refuses, nothing is marked, and once
    // unblocked the next run sends; without the bot or with the cap at zero nothing is attempted
    const other = (await t.signUp("proposals-blocked@hapiecoin.test")).cookie;
    await t.db.update(users).set({ telegramChatId: "chat-3" }).where(eq(users.email, "proposals-blocked@hapiecoin.test"));
    const otherSettings = await json<UserSettings>(await t.request("/v1/settings", { cookie: other }));
    await t.request("/v1/settings", { method: "PUT", cookie: other, json: { ...otherSettings, proposalsTelegram: true } });
    t.telegram.blocked.add("chat-3");
    const blocked = await deliverProposals(deps({ now, telegramCap: 5 }));
    expect(blocked.sent).toBe(0);
    expect(blocked.failed).toBeGreaterThanOrEqual(1);
    expect((await json<Proposals>(await t.request(`/v1/proposals?day=${LATEST}`, { cookie: other }))).items.every((p) => p.telegramSentAt === null)).toBe(true);
    t.telegram.blocked.delete("chat-3");
    const unblocked = await deliverProposals(deps({ now, telegramCap: 5 }));
    expect(unblocked.failed).toBe(0);
    expect(unblocked.sent).toBe(blocked.failed);
    expect(t.telegram.sent.filter((m) => m.chatId === "chat-3")).toHaveLength(blocked.failed);
    expect(await deliverProposals(deps({ now, telegram: null }))).toEqual({ sent: 0, capped: 0, failed: 0 });
    expect(await deliverProposals(deps({ now, telegramCap: 0 }))).toEqual({ sent: 0, capped: 0, failed: 0 });
    // the snapshotter's hook: detect then deliver, and a failure inside never throws out of it
    const logs: string[] = [];
    const logger = { info: (_o: object, msg: string) => void logs.push(`info:${msg}`), warn: (_o: object, msg: string) => void logs.push(`warn:${msg}`) };
    await runProposals(deps({ now, logger }), ["delta_india"]);
    expect(logs.some((l) => l.startsWith("warn:"))).toBe(false);
    await runProposals(deps({ now, logger }), ["nope" as never]);
    expect(logs.at(-1)).toBe("warn:playbook proposals failed");
    const fly = items.find((p) => p.playbookId === "pin-butterfly")!;
    const text = proposalMessage(PLAYBOOKS.find((p) => p.id === "pin-butterfly")!, { ...fly, id: Number(fly.id), createdAt: new Date(fly.createdAt) }, "https://x.example");
    expect(text).toContain("expiry 2026-09-15");
    expect(text).toContain("10 lots");
    expect(text).toContain("https://x.example/analyse");
  });
});
