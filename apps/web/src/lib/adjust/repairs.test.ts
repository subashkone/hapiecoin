// Repair ideas (ADR-094; HC-TR-194 the diagnosis, HC-TR-195 the catalogue and its ranking): pure functions over a
// hand-made ladder whose marks make every wing choice checkable by arithmetic.
import type { StrategyLeg as ServerLeg } from "@hapiecoin/schema";
import { describe, expect, it } from "vitest";
import { type AdjustDraft, newDraft } from "./model";
import { MAX_SKIPPED_ON_ROLL_OUT, MIN_SIGMAS_AFTER_ROLL_IN, REPAIR_GOALS, ROLL_STEPS, WING_BUDGET, type RepairContext, type RepairFigures, type RepairRow, defaultGoal, diagnose, diagnosisLine, orderIdeas, repairIdeas, scoreFor, tagIdeas } from "./repairs";

const EXP = "2026-11-27";
const LATER = "2026-12-25";
const SPOT = 80_400;
const EM = 13_477; // one expected move to 27 Nov, the figure on the user's screen on 20 Sep 2026

const leg = (over: Partial<ServerLeg> & Pick<ServerLeg, "id" | "kind" | "side" | "strike">): ServerLeg => ({
  expiry: EXP,
  symbol: `${over.kind === "call" ? "C" : "P"}-BTC-${over.strike}-271126`,
  lots: 500,
  price: "1500",
  entryPrice: "1500",
  exitPrice: null,
  iv: 0.38,
  status: "open",
  isAdjustment: false,
  position: 0,
  openedAt: "2026-09-16T13:53:00Z",
  closedAt: null,
  orderId: null,
  ...over,
});

// 64,000 … 101,000 in 1,000 steps. Calls are listed everywhere; puts only from 65,000 to 97,000, as Delta listed them.
const CALL_MARKS: Record<number, string> = { 92000: "1600", 93000: "1450", 94000: "1300", 95000: "1150", 96000: "1000", 97000: "900", 98000: "780", 99000: "600", 100000: "390", 101000: "150" };
const PUT_MARKS: Record<number, string> = { 65000: "1300", 66000: "1500", 67000: "1700", 68000: "1900", 69000: "2100" };
function ladder(over: { call?: Record<number, string>; put?: Record<number, string> } = {}): RepairRow[] {
  const rows: RepairRow[] = [];
  for (let k = 64_000; k <= 101_000; k += 1_000) {
    const call = over.call?.[k] ?? CALL_MARKS[k] ?? String(Math.max(200, 20_000 - (k - 64_000) / 2));
    const put = k >= 65_000 && k <= 97_000 ? (over.put?.[k] ?? PUT_MARKS[k] ?? String(1_300 + (k - 65_000) / 5)) : undefined;
    rows.push({ strike: String(k), call: { mark: call, markIv: 0.38 }, ...(put === undefined ? {} : { put: { mark: put, markIv: 0.32 } }) });
  }
  return rows;
}

const SHORT_CALL = leg({ id: "leg_c", kind: "call", side: "sell", strike: "92000", price: "1600" });
const SHORT_PUT = leg({ id: "leg_p", kind: "put", side: "sell", strike: "66000", price: "1500" });
const base: AdjustDraft = newDraft("strat_1", 0);
const ctxOf = (open: ServerLeg[], over: Partial<RepairContext> = {}): RepairContext => ({ open, asset: "BTC", expiry: EXP, rows: ladder(), spot: SPOT, expectedMove: EM, ...over });
const strangle = ctxOf([SHORT_CALL, SHORT_PUT]);
const byKind = (ctx: RepairContext) => Object.fromEntries(repairIdeas(base, ctx).map((i) => [i.kind, i]));
const picksOf = (d: AdjustDraft | null | undefined) => (d?.picks ?? []).map((p) => `${p.side} ${p.lots} ${p.kind} ${p.strike} ${p.expiry}`).sort();

describe("HC-TR-194 the diagnosis of the open position", () => {
  it("HC-TR-194 measures each short strike from spot in percent and in expected moves, names the tested side and says when it is under pressure", () => {
    const d = diagnose(strangle);
    expect(d.shorts.map((s) => [s.kind, s.strike, s.distance, s.lots])).toEqual([["call", 92_000, 11_600, 500], ["put", 66_000, 14_400, 500]]);
    expect(d.shorts[0]!.pct).toBeCloseTo(11_600 / SPOT, 10);
    expect(d.shorts[0]!.sigmas).toBeCloseTo(11_600 / EM, 10); // 0.86 of a move
    expect(d.shorts[1]!.sigmas).toBeCloseTo(14_400 / EM, 10); // 1.07
    expect(d.tested?.legIds).toEqual(["leg_c"]);
    expect(d.underPressure).toBe(true); // closer than one expected move
    expect(d.nakedLongs).toBe(0);
    expect(diagnosisLine(d)).toBe("short 92,000 C is above spot by 14.4 % (0.86 σ) · short 66,000 P is below spot by 17.9 % (1.07 σ) · the call side is tested");
  });

  it("HC-TR-194 an in-the-money short is under pressure whatever the move; without an expected move the percent decides; no spot, no distances", () => {
    const itm = diagnose(ctxOf([leg({ id: "leg_c", kind: "call", side: "sell", strike: "79000" }), SHORT_PUT]));
    expect(itm.tested?.distance).toBe(-1_400);
    expect(itm.underPressure).toBe(true);
    expect(diagnosisLine(itm)).toContain("short 79,000 C is in the money by 1.7 %");
    const noMove = diagnose(ctxOf([SHORT_CALL, SHORT_PUT], { expectedMove: null }));
    expect(noMove.shorts.every((s) => s.sigmas === null)).toBe(true);
    expect(noMove.tested?.legIds).toEqual(["leg_c"]); // 14.4 % is nearer than 17.9 %
    expect(noMove.underPressure).toBe(false); // further than 5 % of spot
    expect(diagnosisLine(noMove)).toContain("the call side is the nearer one");
    // before the spot price arrives nothing is measured and nothing is offered, and the line says so instead of
    // claiming there is no option leg (or handing a short strangle the ideas meant for a long position)
    const waiting = ctxOf([SHORT_CALL, SHORT_PUT], { spot: null });
    expect(diagnose(waiting).shorts).toEqual([]);
    expect(diagnose(waiting).waiting).toBe(true);
    expect(diagnosisLine(diagnose(waiting))).toBe("Waiting for the spot price: the ideas are built once it arrives");
    expect(repairIdeas(base, waiting)).toEqual([]);
    expect(diagnose(ctxOf([], { spot: null })).waiting).toBe(false); // nothing held, nothing to wait for
  });

  it("HC-TR-194 twin rows on one contract (an earlier add books a second row) are one short, named once", () => {
    const twin = leg({ id: "leg_t", kind: "call", side: "sell", strike: "92000", lots: 200 });
    const d = diagnose(ctxOf([SHORT_CALL, SHORT_PUT, twin]));
    expect(d.shorts.map((s) => [s.kind, s.strike, s.lots, s.legIds])).toEqual([["call", 92_000, 700, ["leg_c", "leg_t"]], ["put", 66_000, 500, ["leg_p"]]]);
    expect(diagnosisLine(d).match(/short 92,000 C/g)).toHaveLength(1);
  });

  it("HC-TR-194 legs on another expiry and futures take no part; a long with nothing sold beyond it is counted", () => {
    const other = leg({ id: "leg_x", kind: "call", side: "sell", strike: "90000", expiry: LATER });
    const fut = { ...leg({ id: "leg_f", kind: "call", side: "buy", strike: "0" }), kind: "future" as const, symbol: "BTCUSD" };
    expect(diagnose(ctxOf([SHORT_CALL, other, fut])).shorts.map((s) => s.legIds)).toEqual([["leg_c"]]);
    const long = diagnose(ctxOf([leg({ id: "leg_l", kind: "call", side: "buy", strike: "80000" })]));
    expect(long.shorts).toEqual([]);
    expect(long.nakedLongs).toBe(1);
    expect(diagnosisLine(long)).toContain("lower the cost of the long legs");
  });
});

describe("HC-TR-195 the catalogue of repair ideas", () => {
  it("HC-TR-195 wings are chosen by price: the nearest strike within 10 / 25 / 50 % of the short's mark, and past the end of the ladder the furthest listed one, with a note", () => {
    expect(WING_BUDGET).toEqual({ capCheap: 0.1, capBalanced: 0.25, capTight: 0.5 });
    const ideas = byKind(strangle);
    // short call 1,600: budgets 160 / 400 / 800 → 101,000 (150) / 100,000 (390) / 98,000 (780)
    // short put 1,500: budgets 150 / 375 / 750, and the only put below 66,000 is 65,000 at 1,300: the ladder ends there
    expect(picksOf(ideas["capCheap"]!.draft)).toEqual([`buy 500 call 101000 ${EXP}`, `buy 500 put 65000 ${EXP}`]);
    expect(picksOf(ideas["capBalanced"]!.draft)).toEqual([`buy 500 call 100000 ${EXP}`, `buy 500 put 65000 ${EXP}`]);
    expect(picksOf(ideas["capTight"]!.draft)).toEqual([`buy 500 call 98000 ${EXP}`, `buy 500 put 65000 ${EXP}`]);
    expect(ideas["capCheap"]!.what).toBe("buy 500 × 101,000 C 27 Nov and buy 500 × 65,000 P 27 Nov");
    expect(ideas["capCheap"]!.note).toBe("the put ladder ends at 65,000, above the 10 % budget");
    expect(ideas["capTight"]!.note).toBe("the put ladder ends at 65,000, above the 50 % budget");
    expect(ideas["capCheap"]!.draft!.picks[0]!.symbol).toBe("C-BTC-101000-271126"); // the venue's symbol, never a made-up one
    expect(Object.keys(ideas["capCheap"]!.draft!.lotsAfter)).toEqual([]); // wings add, they close nothing
    expect(ideas["capCheap"]!.givesUp).toContain("the most you can make falls");
  });

  it("HC-TR-195 a quote at zero is not a price: the wing skips it, and two budgets that land on the same strikes are one idea", () => {
    const ctx = ctxOf([SHORT_CALL, SHORT_PUT], { rows: ladder({ call: { 101000: "0" } }) });
    const ideas = repairIdeas(base, ctx);
    const cheap = ideas.find((i) => i.kind === "capCheap")!;
    // 101,000 is unusable, nothing else is within 160, so the furthest usable call is 100,000 (390)
    expect(picksOf(cheap.draft)).toEqual([`buy 500 call 100000 ${EXP}`, `buy 500 put 65000 ${EXP}`]);
    expect(cheap.note).toContain("the call ladder ends at 100,000, above the 10 % budget");
    // balanced picks the same 100,000: the duplicate is dropped, tight (98,000) stays
    expect(ideas.map((i) => i.kind).filter((k) => k.startsWith("cap"))).toEqual(["capCheap", "capTight"]);
  });

  it("HC-TR-195 a wing is sized by the short lots no long answers: a long nearer the money caps the risk too, and a condor needs none at all", () => {
    const callCovered = byKind(ctxOf([SHORT_CALL, SHORT_PUT, leg({ id: "leg_w", kind: "call", side: "buy", strike: "96000" })]));
    expect(picksOf(callCovered["capCheap"]!.draft)).toEqual([`buy 500 put 65000 ${EXP}`]);
    const partly = byKind(ctxOf([SHORT_CALL, leg({ id: "leg_w", kind: "call", side: "buy", strike: "96000", lots: 200 })]));
    expect(picksOf(partly["capTight"]!.draft)).toEqual([`buy 300 call 98000 ${EXP}`]); // 500 short, 200 covered
    const condor = byKind(ctxOf([SHORT_CALL, SHORT_PUT, leg({ id: "w1", kind: "call", side: "buy", strike: "96000" }), leg({ id: "w2", kind: "put", side: "buy", strike: "65000" })]));
    expect(condor["capCheap"]!.draft).toBeNull();
    expect(condor["capCheap"]!.note).toBe("every short on this expiry is already answered by a long on its side");
    // long 88,000 C / short 92,000 C is a debit spread: above 92,000 the payoff is flat, the risk is already capped,
    // and a wing would only cost money under a label that promises the opposite
    const inner = byKind(ctxOf([SHORT_CALL, leg({ id: "leg_i", kind: "call", side: "buy", strike: "88000" })]));
    expect(inner["capTight"]!.draft).toBeNull();
    // 300 long against 500 short: 200 lots run on without a limit, and that is the size of the wing
    const partInner = byKind(ctxOf([SHORT_CALL, leg({ id: "leg_i", kind: "call", side: "buy", strike: "88000", lots: 300 })]));
    expect(picksOf(partInner["capTight"]!.draft)).toEqual([`buy 200 call 98000 ${EXP}`]);
    // two shorts with one long between them: 1,000 short, 500 long, so 500 uncovered, and the wing goes beyond the
    // FURTHEST short (96,000, mark 1,000: the 50 % budget of 500 first fits 100,000 at 390)
    const between = byKind(ctxOf([leg({ id: "s1", kind: "call", side: "sell", strike: "90000" }), leg({ id: "s2", kind: "call", side: "sell", strike: "96000" }), leg({ id: "l1", kind: "call", side: "buy", strike: "93000" })]));
    expect(picksOf(between["capTight"]!.draft)).toEqual([`buy 500 call 100000 ${EXP}`]);
    // more long than short: nothing to cap
    expect(byKind(ctxOf([SHORT_CALL, leg({ id: "l1", kind: "call", side: "buy", strike: "96000", lots: 1_000 })]))["capCheap"]!.draft).toBeNull();
  });

  it("HC-TR-195 rolls: the tested side moves two listed strikes away, the untested side two strikes in while it keeps half a move of room", () => {
    expect(ROLL_STEPS).toBe(2);
    const ideas = byKind(strangle);
    const away = ideas["rollTestedAway"]!;
    expect(away.draft!.lotsAfter).toEqual({ leg_c: 0 });
    expect(picksOf(away.draft)).toEqual([`sell 500 call 94000 ${EXP}`]);
    expect(away.what).toBe("close 92,000 C, sell 500 × 94,000 C 27 Nov");
    const closer = ideas["rollUntestedCloser"]!;
    expect(closer.draft!.lotsAfter).toEqual({ leg_p: 0 });
    expect(picksOf(closer.draft)).toEqual([`sell 500 put 68000 ${EXP}`]); // 12,400 from spot, more than half of 13,477
    // a put two strikes under spot has no room to move in
    const tight = byKind(ctxOf([SHORT_CALL, leg({ id: "leg_p", kind: "put", side: "sell", strike: "79000" })]));
    expect(MIN_SIGMAS_AFTER_ROLL_IN).toBe(0.5);
    // here the put is the tested one (1,400 away), so the call is the side that could move in: 90,000 is 9,600 away, fine
    expect(picksOf(tight["rollUntestedCloser"]!.draft)).toEqual([`sell 500 call 90000 ${EXP}`]);
    const crowded = byKind(ctxOf([leg({ id: "leg_c", kind: "call", side: "sell", strike: "82000" }), leg({ id: "leg_p", kind: "put", side: "sell", strike: "70000" })]));
    // the call is tested (1,600 away); the put may come in to 72,000 (8,400 away ≥ 6,738.5)
    expect(picksOf(crowded["rollUntestedCloser"]!.draft)).toEqual([`sell 500 put 72000 ${EXP}`]);
    const noRoom = byKind(ctxOf([leg({ id: "leg_c", kind: "call", side: "sell", strike: "82000" }), leg({ id: "leg_p", kind: "put", side: "sell", strike: "74000" })]));
    expect(noRoom["rollUntestedCloser"]!.draft).toBeNull(); // 75,000 is 5,400 away, under half a move
    expect(noRoom["rollUntestedCloser"]!.note).toBe("74,000 P is already close to spot");
    // one short only: there is no other side
    expect(byKind(ctxOf([SHORT_CALL]))["rollUntestedCloser"]!.note).toBe("no short on the other side to move");
    // the last listed call cannot move away
    expect(byKind(ctxOf([leg({ id: "leg_c", kind: "call", side: "sell", strike: "101000" })]))["rollTestedAway"]!.note).toBe("no call listed beyond 101,000");
  });

  it("HC-TR-195 rolling out waits for the next chain, then moves every leg to the nearest listed strike; out and away also moves the tested leg two strikes", () => {
    expect(byKind(strangle)["rollOut"]!.note).toBe("the next expiry's chain is not loaded yet");
    const next = ctxOf([SHORT_CALL, SHORT_PUT], { nextExpiry: LATER, nextRows: ladder() });
    const ideas = byKind(next);
    expect(ideas["rollOut"]!.label).toBe("Roll out to 25 Dec");
    expect(ideas["rollOut"]!.draft!.lotsAfter).toEqual({ leg_c: 0, leg_p: 0 });
    expect(picksOf(ideas["rollOut"]!.draft)).toEqual([`sell 500 call 92000 ${LATER}`, `sell 500 put 66000 ${LATER}`]);
    expect(picksOf(ideas["rollOutAway"]!.draft)).toEqual([`sell 500 call 94000 ${LATER}`, `sell 500 put 66000 ${LATER}`]);
  });

  it("HC-TR-195 rolling out onto a coarser ladder: a short only ever lands further out, a long on the nearest strike, the card says the strike moved, and a sparse ladder is refused", () => {
    const coarse = ladder().filter((r) => Number(r.strike) % 5_000 === 0); // 65,000, 70,000 … 100,000
    // 90,000 is nearer to 92,000 than 95,000 is, but it is 2,000 closer to spot: a roll OUT must not do that unasked
    const short = byKind(ctxOf([SHORT_CALL], { nextExpiry: LATER, nextRows: coarse }))["rollOut"]!;
    expect(picksOf(short.draft)).toEqual([`sell 500 call 95000 ${LATER}`]);
    expect(short.note).toBe("92,000 C is not quoted on 25 Dec: it moves to 95,000");
    const long = byKind(ctxOf([leg({ id: "leg_l", kind: "call", side: "buy", strike: "92000" })], { nextExpiry: LATER, nextRows: coarse }))["rollOut"]!;
    expect(picksOf(long.draft)).toEqual([`buy 500 call 90000 ${LATER}`]);
    // the same strike listed on both: no note
    expect(byKind(ctxOf([SHORT_CALL], { nextExpiry: LATER, nextRows: ladder() }))["rollOut"]!.note).toBe("");
    // 92,000 … 99,000 unquoted on the next expiry: the first usable call is 100,000, seven listed strikes away
    expect(MAX_SKIPPED_ON_ROLL_OUT).toBe(1);
    const dead = Object.fromEntries([92, 93, 94, 95, 96, 97, 98, 99].map((k) => [k * 1_000, "0"]));
    const sparse = byKind(ctxOf([SHORT_CALL], { nextExpiry: LATER, nextRows: ladder({ call: dead }) }))["rollOut"]!;
    expect(sparse.draft).toBeNull();
    expect(sparse.note).toBe("no call quote at or next to 92,000 on 25 Dec");
    // one unquoted strike in between is allowed: 92,000 and 93,000 dead → 94,000, with 93,000 the one skipped
    const one = byKind(ctxOf([SHORT_CALL], { nextExpiry: LATER, nextRows: ladder({ call: { 92000: "0", 93000: "0" } }) }))["rollOut"]!;
    expect(picksOf(one.draft)).toEqual([`sell 500 call 94000 ${LATER}`]);
  });

  it("HC-TR-195 an idea never sells into its own long: a roll that would flatten or turn a spread around is refused, with the reason", () => {
    // call credit spread short 92,000 / long 94,000: two strikes away IS the long. Selling it would close the wing and
    // leave nothing, under a card that says "more room"
    const long94 = leg({ id: "leg_w", kind: "call", side: "buy", strike: "94000" });
    const spread = byKind(ctxOf([SHORT_CALL, long94], { nextExpiry: LATER, nextRows: ladder() }));
    expect(spread["rollTestedAway"]!.draft).toBeNull();
    expect(spread["rollTestedAway"]!.note).toBe("your long 94,000 C is in the way: moving the short onto or past it would turn the spread around");
    // rolled out and away the short would land on the rolled wing (94,000 on 25 Dec): buy and sell of one contract
    expect(spread["rollOutAway"]!.draft).toBeNull();
    expect(spread["rollOutAway"]!.note).toBe("the short 92,000 C would land on or past your long 94,000 C on 25 Dec");
    // the plain roll out keeps both strikes and is fine
    expect(picksOf(spread["rollOut"]!.draft)).toEqual([`buy 500 call 94000 ${LATER}`, `sell 500 call 92000 ${LATER}`]);
    // a wider wing leaves room: short 92,000 → 94,000, long stays 96,000
    const wide = byKind(ctxOf([SHORT_CALL, leg({ id: "leg_w", kind: "call", side: "buy", strike: "96000" })], { nextExpiry: LATER, nextRows: ladder() }));
    expect(picksOf(wide["rollTestedAway"]!.draft)).toEqual([`sell 500 call 94000 ${EXP}`]);
    expect(picksOf(wide["rollOutAway"]!.draft)).toEqual([`buy 500 call 96000 ${LATER}`, `sell 500 call 94000 ${LATER}`]);
    // a coarse next ladder maps short 93,000 and long 94,000 onto the same 95,000: refused, not netted
    const coarse = ladder().filter((r) => Number(r.strike) % 5_000 === 0);
    const tight = byKind(ctxOf([leg({ id: "leg_s", kind: "call", side: "sell", strike: "93000" }), long94], { nextExpiry: LATER, nextRows: coarse }));
    expect(tight["rollOut"]!.draft).toBeNull();
    expect(tight["rollOut"]!.note).toBe("the short 93,000 C would land on or past your long 94,000 C on 25 Dec");
    // a calendar: the short 27 Nov 92,000 C rolled out would meet the long 25 Dec 92,000 C the trader already holds
    const cal = byKind(ctxOf([SHORT_CALL, leg({ id: "leg_d", kind: "call", side: "buy", strike: "92000", expiry: LATER })], { nextExpiry: LATER, nextRows: ladder() }));
    expect(cal["rollOut"]!.draft).toBeNull();
    expect(cal["rollOut"]!.note).toContain("92,000 C 25 Dec would meet its own other side");
    // the untested side moving in stops at a long as well: short 66,000 P with a long 68,000 P above it
    const putSide = byKind(ctxOf([SHORT_CALL, SHORT_PUT, leg({ id: "leg_lp", kind: "put", side: "buy", strike: "68000" })]));
    expect(putSide["rollUntestedCloser"]!.draft).toBeNull();
    expect(putSide["rollUntestedCloser"]!.note).toContain("your long 68,000 P is in the way");
  });

  it("HC-TR-195 twin rows move together: close, halve and roll act on the whole short contract, never on one row of it", () => {
    const twin = leg({ id: "leg_t", kind: "call", side: "sell", strike: "92000", lots: 200 });
    const ideas = byKind(ctxOf([SHORT_CALL, SHORT_PUT, twin]));
    expect(ideas["closeTested"]!.draft!.lotsAfter).toEqual({ leg_c: 0, leg_t: 0 });
    expect(ideas["closeTested"]!.what).toBe("buy back 700 of 700 × 92,000 C");
    expect(ideas["halveTested"]!.draft!.lotsAfter).toEqual({ leg_c: 150 }); // 350 of 700 bought back, from the larger row first
    expect(ideas["halveTested"]!.what).toBe("buy back 350 of 700 × 92,000 C");
    expect(ideas["rollTestedAway"]!.draft!.lotsAfter).toEqual({ leg_c: 0, leg_t: 0 });
    expect(picksOf(ideas["rollTestedAway"]!.draft)).toEqual([`sell 700 call 94000 ${EXP}`]);
    expect(ideas["closeTested"]!.label).toBe("Close the tested short"); // the label names the short, not the whole side
  });

  it("HC-TR-195 a roll never nets a replacement against a leg it is closing: a spread on adjacent strikes rolls whole, and twin legs merge", () => {
    // long 92,000 C / short 93,000 C: rolled out, the new 93,000 must not cancel against anything, both legs stay a spread
    const long = leg({ id: "leg_l", kind: "call", side: "buy", strike: "92000", lots: 100 });
    const short = leg({ id: "leg_s", kind: "call", side: "sell", strike: "93000", lots: 100 });
    const out = byKind(ctxOf([long, short], { nextExpiry: LATER, nextRows: ladder() }))["rollOut"]!;
    expect(out.draft!.lotsAfter).toEqual({ leg_l: 0, leg_s: 0 });
    expect(out.draft!.picks.map((p) => [p.side, p.strike, p.lots, p.expiry])).toEqual([["buy", "92000", 100, LATER], ["sell", "93000", 100, LATER]]);
    // the tested short moves two strikes away onto 95,000 while the long stays: still two separate contracts
    const away = byKind(ctxOf([long, short]))["rollTestedAway"]!;
    expect(away.draft!.lotsAfter).toEqual({ leg_s: 0 });
    expect(picksOf(away.draft)).toEqual([`sell 100 call 95000 ${EXP}`]);
    // two short calls landing on the same contract and side merge into one pick
    const twin = leg({ id: "leg_t", kind: "call", side: "sell", strike: "92000", lots: 30 });
    const merged = byKind(ctxOf([SHORT_CALL, twin], { nextExpiry: LATER, nextRows: ladder() }))["rollOut"]!;
    expect(merged.draft!.picks.map((p) => [p.strike, p.lots])).toEqual([["92000", 530]]);
    // a wing, unlike a roll, does net: buying the strike a long already holds adds to that leg instead of a second pick
    const held = leg({ id: "leg_w", kind: "call", side: "buy", strike: "98000", lots: 200 });
    const tight = byKind(ctxOf([SHORT_CALL, held]))["capTight"]!; // 500 short, 200 covered: 300 more at 98,000
    expect(tight.draft!.picks).toEqual([]);
    expect(tight.draft!.lotsAfter).toEqual({ leg_w: 500 });
  });

  it("HC-TR-195 sizing: halve keeps the larger half, a single lot cannot be halved, close takes the leg off", () => {
    const ideas = byKind(strangle);
    expect(ideas["halveTested"]!.draft!.lotsAfter).toEqual({ leg_c: 250 });
    expect(ideas["halveTested"]!.what).toBe("buy back 250 of 500 × 92,000 C");
    expect(ideas["closeTested"]!.draft!.lotsAfter).toEqual({ leg_c: 0 });
    expect(ideas["closeTested"]!.draft!.picks).toEqual([]);
    const odd = byKind(ctxOf([leg({ id: "leg_c", kind: "call", side: "sell", strike: "92000", lots: 3 })]));
    expect(odd["halveTested"]!.draft!.lotsAfter).toEqual({ leg_c: 2 });
    expect(byKind(ctxOf([leg({ id: "leg_c", kind: "call", side: "sell", strike: "92000", lots: 1 })]))["halveTested"]!.note).toBe("the tested short is a single lot");
  });

  it("HC-TR-195 a long position gets its own two ideas and the roll out, never the short-side ones", () => {
    const ideas = repairIdeas(base, ctxOf([leg({ id: "leg_l", kind: "call", side: "buy", strike: "80000", lots: 100 })]));
    expect(ideas.map((i) => i.kind)).toEqual(["convertToSpread", "rollCheaper", "rollOut"]);
    expect(picksOf(ideas[0]!.draft)).toEqual([`sell 100 call 82000 ${EXP}`]);
    expect(ideas[0]!.draft!.lotsAfter).toEqual({});
    expect(picksOf(ideas[1]!.draft)).toEqual([`buy 100 call 82000 ${EXP}`]);
    expect(ideas[1]!.draft!.lotsAfter).toEqual({ leg_l: 0 });
    // twin longs (100 + 50 on one contract) sell ONE spread leg of 150: the second row must not toggle the first off
    const twins = repairIdeas(base, ctxOf([leg({ id: "leg_a", kind: "call", side: "buy", strike: "80000", lots: 100 }), leg({ id: "leg_b", kind: "call", side: "buy", strike: "80000", lots: 50 })]));
    expect(picksOf(twins[0]!.draft)).toEqual([`sell 150 call 82000 ${EXP}`]);
    expect(twins[1]!.draft!.lotsAfter).toEqual({ leg_a: 0, leg_b: 0 });
    expect(picksOf(twins[1]!.draft)).toEqual([`buy 150 call 82000 ${EXP}`]);
    // longs at 80,000 and 82,000: the spread leg for 80,000 skips 82,000 (selling it would cancel the other long)
    const two = repairIdeas(base, ctxOf([leg({ id: "leg_a", kind: "call", side: "buy", strike: "80000", lots: 100 }), leg({ id: "leg_b", kind: "call", side: "buy", strike: "82000", lots: 100 })]));
    expect(picksOf(two[0]!.draft)).toEqual([`sell 100 call 83000 ${EXP}`, `sell 100 call 84000 ${EXP}`]);
    expect(two[0]!.draft!.lotsAfter).toEqual({});
    // the short-side catalogue, in its order, for a position with something sold
    expect(repairIdeas(base, strangle).map((i) => i.kind)).toEqual(["capCheap", "capBalanced", "capTight", "rollTestedAway", "rollUntestedCloser", "rollOut", "rollOutAway", "halveTested", "closeTested"]);
  });

  it("HC-TR-195 an idea never touches the working change it starts from, and keeps the saved plans", () => {
    const working: AdjustDraft = { ...base, lotsAfter: { leg_p: 100 }, picks: [], plans: [{ id: "plan_1", name: "Plan A", lotsAfter: {}, picks: [], valuation: null }] };
    const idea = byKind({ ...strangle })["closeTested"]!;
    const fromWorking = repairIdeas(working, strangle).find((i) => i.kind === "closeTested")!;
    expect(fromWorking.draft!.lotsAfter).toEqual({ leg_c: 0 }); // the earlier edit of leg_p is not carried into the idea
    expect(fromWorking.draft!.plans).toHaveLength(1);
    expect(working.lotsAfter).toEqual({ leg_p: 100 });
    expect(idea.draft!.strategyId).toBe("strat_1");
  });
});

describe("HC-TR-195 ranking the ideas by the trader's goal", () => {
  const f = (over: Partial<RepairFigures>): RepairFigures => ({ maxLoss: -1_000, maxProfit: 500, breakevens: [70_000, 90_000], pop: 0.6, delta: 0.1, cash: 0, ...over });
  const before = f({ maxLoss: -Infinity, breakevens: [63_941, 94_059], delta: -0.063 });

  it("HC-TR-195 the default goal follows the diagnosis: an unlimited loss first, then a tested side, else the credit", () => {
    expect(REPAIR_GOALS.map((g) => g.id)).toEqual(["maxLoss", "credit", "neutral", "breakevens"]);
    const dx = diagnose(strangle);
    expect(defaultGoal(dx, before)).toBe("maxLoss");
    expect(defaultGoal(dx, f({}))).toBe("breakevens"); // defined risk, but the call side is under pressure
    expect(defaultGoal({ ...dx, underPressure: false }, f({}))).toBe("credit");
    expect(defaultGoal(dx, null)).toBe("breakevens");
  });

  it("HC-TR-195 orders best first per goal, keeps unpriced ideas last in catalogue order, and an unlimited loss never wins", () => {
    const figures = [f({ maxLoss: -Infinity, cash: 900 }), null, f({ maxLoss: -400, cash: -300, delta: 0.01 }), f({ maxLoss: -2_000, cash: 50, delta: -0.4, breakevens: [60_000, 100_000] }), null];
    expect(orderIdeas(figures, "maxLoss")).toEqual([2, 3, 0, 1, 4]);
    expect(orderIdeas(figures, "credit")).toEqual([0, 3, 2, 1, 4]);
    expect(orderIdeas(figures, "neutral")).toEqual([2, 0, 3, 1, 4]);
    expect(orderIdeas(figures, "breakevens")).toEqual([3, 0, 2, 1, 4]); // 40,000 wide beats 20,000; a tie keeps catalogue order
    expect(scoreFor("breakevens", f({ breakevens: [80_000] }))).toBe(-Infinity); // one break-even has no width
    expect(scoreFor("maxLoss", f({ maxLoss: -Infinity }))).toBe(-Number.MAX_VALUE);
  });

  it("HC-TR-195 tags are facts: every idea that gives the loss a floor says so, and one idea leads each goal", () => {
    const figures = [f({ maxLoss: -5_000, cash: -200 }), f({ maxLoss: -Infinity, cash: 700, delta: 0.0 }), null, f({ maxLoss: -900, cash: -50, breakevens: [60_000, 100_000] })];
    const tags = tagIdeas(figures, before);
    expect(tags[0]).toEqual(["defines your risk"]);
    expect(tags[1]).toEqual(["largest credit", "closest to delta-neutral"]); // still unlimited: no "defines your risk"
    expect(tags[2]).toEqual([]);
    expect(tags[3]).toEqual(["defines your risk", "smallest max loss", "widest break-evens"]);
    // a position whose loss already had a floor gets no "defines your risk"
    expect(tagIdeas(figures, f({})).flat()).not.toContain("defines your risk");
    // when every idea costs money nobody has the largest credit: the cheapest debit is not a credit
    expect(tagIdeas([f({ cash: -200 }), f({ cash: -50 })], before).flat()).not.toContain("largest credit");
    // when every idea is still unlimited nobody has the smallest max loss
    expect(tagIdeas([f({ maxLoss: -Infinity }), f({ maxLoss: -Infinity })], before).flat()).not.toContain("smallest max loss");
  });
});
