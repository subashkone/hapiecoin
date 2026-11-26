// Admin · approval of a saved Autopilot strategy for live, against the mock API (HC-TR-294; ADR-145): the paper record
// beside what it rests on, the checks, approve and withdraw, and what an admin without the permission sees. An approval
// is a record on a strategy that stays on paper: nothing here is live.
import { type SavedApprovalView, type SavedPaperRecord, type SavedStrategy, SavedDefinition, savedEntryText, savedLossCapped } from "@hapiecoin/schema";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { checkState, failingOf, signedUsdText } from "./AutopilotApprovalDialog";
import { AutopilotStrategiesAdmin } from "./AutopilotStrategiesAdmin";

const ADMIN = "boss@example.com";
let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
});
afterEach(() => mock.restore());

const leg = (kind: "call" | "put", side: "buy" | "sell", value: number) => ({ kind, side, by: "pct" as const, value });
const WINGED = SavedDefinition.parse({ assets: ["BTC"], venues: ["delta_india"], lots: 100, cadence: "daily", fromHourUtc: 16, toHourUtc: 17, oncePerExpiry: false, minDte: 0.5, maxDte: 1.5, legs: [leg("put", "buy", 3), leg("put", "sell", 1), leg("call", "sell", 1), leg("call", "buy", 3)], exits: {} });
const NAKED = SavedDefinition.parse({ ...WINGED, legs: [leg("put", "sell", 1), leg("call", "sell", 1)], exits: { legStop: 2 } });
const FIGURES = { mean: 4.2, per: "day" as const, positivePct: 71, worst: -60, samples: 106, basis: "autopilot-study, real fees" };
const GOOD: SavedPaperRecord = { since: "2026-10-25T10:00:00.000Z", publishedDays: 32, firstEntryAt: "2026-10-27T16:05:00.000Z", lastEntryAt: "2026-11-25T16:05:00.000Z", days: 30, accounts: 2, open: 1, closed: 21, wins: 14, grossUsd: "1071.40", feesUsd: "10.50", netUsd: "1060.90", worstNetUsd: "-8.50", skipLines: 3, logDays: 90 };
const TRADES: SavedApprovalView["trades"] = [
  { asset: "BTC", expiry: "2026-11-26", strikes: ["80600", "82200", "85800", "87400"], openedAt: "2026-11-25T16:05:00.000Z", closedAt: "2026-11-26T12:00:00.000Z", netUsd: "8.60", reason: "expired" },
  { asset: "BTC", expiry: "2026-11-25", strikes: ["80000", "81600", "85000", "86600"], openedAt: "2026-11-24T16:05:00.000Z", closedAt: "2026-11-24T19:10:00.000Z", netUsd: "-8.50", reason: "stopped" },
];
let n = 0;
function saved(over: Partial<SavedStrategy> = {}, paper?: Partial<SavedPaperRecord> | null): SavedStrategy {
  n += 1;
  const definition = over.definition ?? WINGED;
  const id = over.id ?? `ap_sv_${n}`;
  const at = new Date(Date.UTC(2026, 9, 25, 10, n)).toISOString();
  const row: SavedStrategy = { id, familyId: id, version: 1, name: `Strategy ${n}`, summary: "Sell both sides each evening, with wings.", definition, stage: "paper", audience: "admins", userIds: [], planIds: [], backtest: FIGURES, backtestAt: at, approval: null, traded: true, lossCapped: savedLossCapped(definition.legs), entryText: savedEntryText(definition), createdBy: null, createdAt: at, updatedAt: at, publishedAt: at, retiredAt: null, ...over };
  mock.state.savedStrategies.push(row);
  if (paper !== null) mock.state.savedPaper[id] = { record: { ...GOOD, ...paper }, trades: TRADES, skips: { "The premium does not cover the fees": 2, "Outside its entry hours": 1 } };
  return row;
}
const rowOf = (name: string) => screen.getAllByTestId("saved-row").find((r) => r.dataset["name"] === name)!;
const dialog = () => screen.getByTestId("saved-approval-dialog");
const check = (key: string) => screen.getAllByTestId("saved-approval-check").find((c) => c.dataset["key"] === key)!;
/** Signs the admin in; `approver` gives them the permission by name. */
async function open(name?: string, approver = true) {
  mock.loginAs(ADMIN, { role: "admin" });
  if (approver) mock.state.savedApprovers.push(mock.state.accounts.get(ADMIN)!.user.id);
  const u = userEvent.setup();
  renderWithProviders(<AutopilotStrategiesAdmin />);
  await waitFor(() => expect(screen.getByTestId("admin-saved").dataset["state"]).toBe("ready"));
  if (name) {
    await u.click(within(rowOf(name)).getByTestId("saved-approval-open"));
    await waitFor(() => expect(dialog().dataset["state"]).not.toBe("loading"));
  }
  return u;
}

describe("HC-TR-294 the approval of a saved strategy for live on the admin screen", () => {
  it("HC-TR-294 money is shown as the server sent it, a check is pass, fail or open, and only the blocking ones that do not pass stand in the way", () => {
    expect(signedUsdText("1060.90")).toBe("+$1,060.90");
    expect(signedUsdText("-8.50")).toBe("−$8.50");
    expect(signedUsdText("0.00")).toBe("$0.00");
    expect(signedUsdText("-0.00")).toBe("$0.00");
    expect(signedUsdText("5")).toBe("+$5.00");
    expect(signedUsdText("5.5")).toBe("+$5.50");
    const c = (pass: boolean, blocking: boolean) => ({ key: "days" as const, label: "x", detail: "y", pass, blocking });
    expect([checkState(c(true, true)), checkState(c(false, true)), checkState(c(false, false)), checkState(c(true, false))]).toEqual(["pass", "fail", "open", "pass"]);
    expect(failingOf([c(true, true), c(false, false), c(false, true)])).toEqual([c(false, true)]);
  });

  it("HC-TR-294 Approval is offered for a strategy on paper only; the dialog shows the checks, the record with what it rests on, the trades and the skip lines, and says it places nothing", async () => {
    saved({ name: "Winged evening" });
    saved({ name: "A draft", stage: "draft", backtest: null, publishedAt: null }, null);
    saved({ name: "Retired one", stage: "retired" }, null);
    const u = await open();
    expect(within(rowOf("A draft")).queryByTestId("saved-approval-open")).toBeNull();
    expect(within(rowOf("Retired one")).queryByTestId("saved-approval-open")).toBeNull();
    expect(within(rowOf("Winged evening")).queryByTestId("saved-approved")).toBeNull();
    await u.click(within(rowOf("Winged evening")).getByTestId("saved-approval-open"));
    await waitFor(() => expect(dialog().dataset["state"]).toBe("open"));
    expect(dialog().textContent).toContain("Approval for live · Winged evening");
    expect(screen.getByTestId("saved-approval-stage").textContent).toBe("PAPER");
    expect(dialog().textContent).toContain("It places nothing and switches nothing: Autopilot stays paper only.");
    // the checks: five that block, all passing, and the margin check left open
    expect(screen.getByTestId("saved-approval-tally").textContent).toBe("5 of 5 pass");
    expect(screen.getAllByTestId("saved-approval-check").map((c) => [c.dataset["key"], c.dataset["state"]])).toEqual([["backtest", "pass"], ["days", "pass"], ["trades", "pass"], ["paperNet", "pass"], ["lossCapped", "pass"], ["margin", "open"]]);
    expect(check("backtest").textContent).toContain("4.20 USD a day on 106 samples; figures entered by hand. Source: autopilot-study, real fees");
    expect(check("days").textContent).toContain("First paper trade on 2026-10-27, 30 days ago; published 32 days ago.");
    expect(check("trades").textContent).toContain("in the account that took the most entries (2 accounts traded it)");
    expect(check("margin").textContent).toContain("open");
    expect(check("margin").textContent).toContain("Not checked yet.");
    // the record, never without what it rests on
    expect(screen.getByTestId("saved-approval-basis").textContent).toBe("Paper record · one account of the 2 that traded it · first paper trade 27 Oct 2026, latest 25 Nov 2026");
    expect(screen.getByTestId("saved-approval-figures").textContent).toBe("+$1,060.90 after est. fees14 of 21 wonworst −$8.501 open");
    expect(screen.getByTestId("saved-approval-totals").textContent).toBe("Before fees +$1,071.40 · estimated fees $10.50 (USD, at that account's size)");
    expect(screen.getByTestId("saved-approval-limits").textContent).toBe("Paper fills are at the mark price and the fees are the estimate made at entry. The figures are one account\u2019s, the one that took the most entries. The log keeps 90 days.");
    // what the approver has to read: the trades and the skip lines, open
    const trades = screen.getAllByTestId("saved-approval-trade");
    expect(screen.getByTestId("saved-approval-trades").hasAttribute("open")).toBe(true);
    expect(screen.getByTestId("saved-approval-trades").textContent).toContain("Closed trades (21), the latest 2 shown");
    expect(trades).toHaveLength(2);
    expect(trades[0]!.textContent).toContain("80,600 · 82,200 · 85,800 · 87,400");
    expect(trades[0]!.textContent).toContain("+$8.60");
    expect(trades[1]!.textContent).toContain("stopped");
    expect(trades[1]!.textContent).toContain("−$8.50");
    const skips = screen.getByTestId("saved-approval-skips");
    expect(skips.textContent).toContain("Skip lines in that account\u2019s log (3), by reason");
    expect(skips.textContent).toContain("The premium does not cover the fees: 2");
    expect(skips.textContent).toContain("A line is written when the reason changes, not once for every entry skipped.");
    // nothing can be approved before the box is ticked
    expect(screen.getByTestId("saved-approval-approve").hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("saved-approval-blocked").textContent).toBe("Tick the box once you have read its trades and its skip lines.");
    expect(screen.queryByTestId("saved-approval-withdraw")).toBeNull();
    await u.click(screen.getByTestId("saved-approval-close"));
    expect(screen.queryByTestId("saved-approval-dialog")).toBeNull();
    expect(mock.state.savedStrategies.find((s) => s.name === "Winged evening")!.approval).toBeNull();
  });

  it("HC-TR-294 a record that does not pass says which checks fail, a strategy with no paper trade says so, and neither can be approved", async () => {
    saved({ name: "Young" }, { days: 12, publishedDays: 14, closed: 9, wins: 4, netUsd: "-12.40", grossUsd: "-8.00", feesUsd: "4.40" });
    saved({ name: "Naked", definition: NAKED });
    saved({ name: "Quiet" }, null);
    saved({ name: "Just entered" }, { accounts: 1, open: 1, closed: 0, wins: 0, grossUsd: "0.00", feesUsd: "0.00", netUsd: "0.00", worstNetUsd: null, days: 0, publishedDays: 1 });
    const u = await open("Young");
    expect(screen.getByTestId("saved-approval-tally").textContent).toBe("2 of 5 pass");
    expect(["days", "trades", "paperNet"].map((k) => check(k).dataset["state"])).toEqual(["fail", "fail", "fail"]);
    expect(check("paperNet").textContent).toContain("does not pass");
    expect(screen.getByTestId("saved-approval-figures").textContent).toContain("−$12.40 after est. fees");
    expect(screen.getByTestId("saved-approval-blocked").textContent).toBe("3 checks do not pass.");
    expect(screen.getByTestId("saved-approval-approve").hasAttribute("disabled")).toBe(true);
    // ticking the box does not open a record that fails
    await u.click(screen.getByTestId("saved-approval-read"));
    expect(screen.getByTestId("saved-approval-approve").hasAttribute("disabled")).toBe(true);
    await u.click(screen.getByTestId("saved-approval-close"));

    // a good record on a strategy whose loss is not limited: never
    await u.click(within(rowOf("Naked")).getByTestId("saved-approval-open"));
    await waitFor(() => expect(check("lossCapped").dataset["state"]).toBe("fail"));
    expect(check("lossCapped").textContent).toContain("such a strategy runs on paper and never goes live");
    expect(screen.getByTestId("saved-approval-blocked").textContent).toBe("1 check does not pass.");
    await u.click(screen.getByTestId("saved-approval-close"));

    await u.click(within(rowOf("Quiet")).getByTestId("saved-approval-open"));
    await waitFor(() => expect(screen.getByTestId("saved-approval-no-trades").textContent).toBe("No paper trade yet; published 25 Oct 2026."));
    expect(screen.getByTestId("saved-approval-basis").textContent).toBe("Paper record · no account has traded it yet");
    expect(screen.getByTestId("saved-approval-limits").textContent).toBe("Paper fills are at the mark price and the fees are the estimate made at entry. The log keeps 90 days.");
    expect(screen.queryByTestId("saved-approval-figures")).toBeNull();
    expect(screen.queryByTestId("saved-approval-trades")).toBeNull();
    expect(screen.queryByTestId("saved-approval-skips")).toBeNull();
    // with no account trading it, the skip lines are every account's, and say so
    mock.state.savedPaper[mock.state.savedStrategies.find((s) => s.name === "Quiet")!.id] = { record: { ...GOOD, accounts: 0, open: 0, closed: 0, wins: 0, firstEntryAt: null, lastEntryAt: null, days: 0, netUsd: "0.00", grossUsd: "0.00", feesUsd: "0.00", worstNetUsd: null, skipLines: 4 }, trades: [], skips: { "No expiry in its range": 4 } };
    await u.click(screen.getByTestId("saved-approval-close"));
    await u.click(within(rowOf("Quiet")).getByTestId("saved-approval-open"));
    await waitFor(() => expect(screen.getByTestId("saved-approval-skips").textContent).toContain("Skip lines in every account\u2019s log (4), by reason"));
    await u.click(screen.getByTestId("saved-approval-close"));

    // one account, one trade still open: no result is shown where there is none
    await u.click(within(rowOf("Just entered")).getByTestId("saved-approval-open"));
    await waitFor(() => expect(screen.getByTestId("saved-approval-figures").textContent).toBe("No trade closed yet1 open"));
    expect(screen.getByTestId("saved-approval-basis").textContent).toContain("Paper record · the one account that traded it · ");
    expect(screen.queryByTestId("saved-approval-totals")).toBeNull();
  });

  it("HC-TR-294 approve stores the approval and marks the row; the approved view says who, when, on what and whether it still passes; withdraw asks once and clears it", async () => {
    const s = saved({ name: "Winged evening" });
    const u = await open("Winged evening");
    await u.click(screen.getByTestId("saved-approval-read"));
    expect(screen.queryByTestId("saved-approval-blocked")).toBeNull();
    await u.click(screen.getByTestId("saved-approval-approve"));
    await waitFor(() => expect(dialog().dataset["state"]).toBe("approved"));
    expect(s.approval).toMatchObject({ byName: mock.state.accounts.get(ADMIN)!.user.name, record: { netUsd: "1060.90", closed: 21 }, backtest: FIGURES });
    expect(s.stage).toBe("paper");
    expect(mock.calls.find((c) => c.url.endsWith(`/${s.id}/approve`))!.body).toBe(JSON.stringify({ read: true }));
    const given = screen.getByTestId("saved-approval-given");
    expect(given.textContent).toContain(`Approved for live by ${s.approval!.byName} on `);
    expect(given.textContent).toContain("Given on a paper record of +$1,060.90 after estimated fees on 21 closed paper trades of one account, 30 days after its first, and a backtest of 4.20 USD a day (entered by hand).");
    expect(given.textContent).toContain("It still trades on paper only.");
    expect(screen.getByTestId("saved-approval-today").textContent).toBe("Today it still passes the checks that block. The margin check is still open.");
    expect(screen.queryByTestId("saved-approval-approve")).toBeNull();
    expect(screen.queryByTestId("saved-approval-read")).toBeNull();
    // the record moves on after the approval: the view says what the checks say today, beside what it was given on
    mock.state.savedPaper[s.id]!.record = { ...GOOD, netUsd: "-40.00", closed: 30 };
    await u.click(screen.getByTestId("saved-approval-close"));
    await waitFor(() => expect(within(rowOf("Winged evening")).getByTestId("saved-approved").textContent).toBe("Approved for live"));
    expect(within(rowOf("Winged evening")).getByTestId("saved-stage").textContent).toBe("On paper");
    await u.click(within(rowOf("Winged evening")).getByTestId("saved-approval-open"));
    await waitFor(() => expect(screen.getByTestId("saved-approval-today").dataset["passes"]).toBe("false"));
    expect(screen.getByTestId("saved-approval-today").textContent).toBe("Today it no longer passes: paper result is positive after estimated fees. The approval stands until someone withdraws it.");
    expect(screen.getByTestId("saved-approval-given").textContent).toContain("+$1,060.90 after estimated fees on 21 closed paper trades of one account");
    // withdraw asks once more, and "Keep it" leaves it
    await u.click(screen.getByTestId("saved-approval-withdraw"));
    expect(screen.getByTestId("saved-approval-withdraw-ask").textContent).toContain("The strategy stays on paper and its open paper trades keep their exits.");
    expect(s.approval).not.toBeNull();
    await u.click(screen.getByTestId("saved-approval-close"));
    expect(screen.queryByTestId("saved-approval-withdraw-ask")).toBeNull();
    expect(s.approval).not.toBeNull();
    await u.click(screen.getByTestId("saved-approval-withdraw"));
    await u.click(screen.getByTestId("saved-approval-withdraw"));
    await waitFor(() => expect(dialog().dataset["state"]).toBe("open"));
    expect(s.approval).toBeNull();
    expect(s.stage).toBe("paper");
    await u.click(screen.getByTestId("saved-approval-close"));
    await waitFor(() => expect(within(rowOf("Winged evening")).queryByTestId("saved-approved")).toBeNull());

    // other backtest figures end an approval, and so does retiring: the mark goes with it
    mock.state.savedPaper[s.id]!.record = GOOD;
    await u.click(within(rowOf("Winged evening")).getByTestId("saved-approval-open"));
    await waitFor(() => expect(screen.getByTestId("saved-approval-read")).toBeTruthy());
    await u.click(screen.getByTestId("saved-approval-read"));
    await u.click(screen.getByTestId("saved-approval-approve"));
    await waitFor(() => expect(s.approval).not.toBeNull());
    await u.click(screen.getByTestId("saved-approval-close"));
    await waitFor(() => expect(within(rowOf("Winged evening")).getByTestId("saved-approved")).toBeTruthy());
    await u.click(within(rowOf("Winged evening")).getByTestId("saved-edit"));
    fireEvent.change(screen.getByTestId("saved-bt-mean"), { target: { value: "9.9" } });
    await u.click(screen.getByTestId("saved-save"));
    await waitFor(() => expect(s.backtest!.mean).toBe(9.9));
    expect(s.approval).toBeNull();
    await waitFor(() => expect(within(rowOf("Winged evening")).queryByTestId("saved-approved")).toBeNull());
    s.approval = { by: "usr_owner", byName: "The Owner", at: "2026-11-26T08:00:00.000Z", record: GOOD, backtest: s.backtest! };
    await waitFor(() => expect(screen.queryByTestId("saved-save")).toBeNull());
    await u.click(within(rowOf("Winged evening")).getByTestId("saved-retire"));
    await u.click(screen.getByTestId("saved-confirm-yes"));
    await waitFor(() => expect(s.stage).toBe("retired"));
    expect(s.approval).toBeNull();
    await waitFor(() => expect(within(rowOf("Winged evening")).getByTestId("saved-stage").textContent).toBe("Retired"));
    expect(within(rowOf("Winged evening")).queryByTestId("saved-approved")).toBeNull();
    expect(within(rowOf("Winged evening")).queryByTestId("saved-approval-open")).toBeNull();
  });

  it("HC-TR-294 an admin without the approver permission reads everything and can neither approve nor withdraw", async () => {
    saved({ name: "Readable" });
    const given = saved({ name: "Given" });
    given.approval = { by: "usr_owner", byName: "The Owner", at: "2026-11-26T08:00:00.000Z", record: GOOD, backtest: { ...FIGURES, run: { id: "bt_1", from: "2026-08-07", to: "2026-11-20", resolution: "5m", notes: [] } } };
    const u = await open("Readable", false);
    expect(screen.getByTestId("saved-approval-tally").textContent).toBe("5 of 5 pass");
    expect(screen.getAllByTestId("saved-approval-trade")).toHaveLength(2);
    expect(screen.getByTestId("saved-approval-blocked").textContent).toBe("Approving a strategy for live is not among your permissions.");
    expect(screen.queryByTestId("saved-approval-read")).toBeNull();
    expect(screen.getByTestId("saved-approval-approve").hasAttribute("disabled")).toBe(true);
    await u.click(screen.getByTestId("saved-approval-close"));
    await u.click(within(rowOf("Given")).getByTestId("saved-approval-open"));
    await waitFor(() => expect(dialog().dataset["state"]).toBe("approved"));
    expect(screen.getByTestId("saved-approval-given").textContent).toContain("Approved for live by The Owner on ");
    expect(screen.getByTestId("saved-approval-given").textContent).toContain("a backtest of 4.20 USD a day (computed in the app)");
    expect(screen.queryByTestId("saved-approval-withdraw")).toBeNull();
    expect(screen.getByTestId("saved-approval-blocked").textContent).toBe("Withdrawing an approval is not among your permissions.");
  });

  it("HC-TR-294 the server's refusals are said in its words, the view is read again, and an account with the authenticator on confirms with its code", async () => {
    const s = saved({ name: "Raced" });
    const coded = saved({ name: "Coded" });
    const u = await open("Raced");
    await u.click(screen.getByTestId("saved-approval-read"));
    // a loss is booked between the read and the press: the server checks again and refuses, and the checks on screen follow
    mock.state.savedPaper[s.id]!.record = { ...GOOD, netUsd: "-5.00" };
    await u.click(screen.getByTestId("saved-approval-approve"));
    await waitFor(() => expect(screen.getByTestId("saved-approval-refusal").textContent).toBe("It does not pass the approval checks: paper result is positive after estimated fees"));
    await waitFor(() => expect(check("paperNet").dataset["state"]).toBe("fail"));
    expect(s.approval).toBeNull();
    expect(screen.getByTestId("saved-approval-approve").hasAttribute("disabled")).toBe(true);
    // the permission is taken away while the dialog is open
    mock.state.savedPaper[s.id]!.record = GOOD;
    await u.click(screen.getByTestId("saved-approval-close"));
    await u.click(within(rowOf("Raced")).getByTestId("saved-approval-open"));
    await waitFor(() => expect(screen.getByTestId("saved-approval-read")).toBeTruthy());
    await u.click(screen.getByTestId("saved-approval-read"));
    mock.state.savedApprovers.length = 0;
    await u.click(screen.getByTestId("saved-approval-approve"));
    await waitFor(() => expect(screen.getByTestId("saved-approval-refusal").textContent).toBe("Approving a strategy for live is not among your permissions"));
    await waitFor(() => expect(screen.queryByTestId("saved-approval-read")).toBeNull());
    expect(s.approval).toBeNull();
    await u.click(screen.getByTestId("saved-approval-close"));

    // the authenticator: no code, a wrong code, the right one
    const acc = mock.state.accounts.get(ADMIN)!;
    mock.state.savedApprovers.push(acc.user.id);
    acc.twoFactor = { enabled: true, pending: false, backupCodes: [] };
    await u.click(within(rowOf("Coded")).getByTestId("saved-approval-open"));
    await waitFor(() => expect(screen.getByTestId("saved-approval-read")).toBeTruthy());
    await u.click(screen.getByTestId("saved-approval-read"));
    // the field is there before anything is sent, and nothing is sent without a whole code
    const field = await screen.findByTestId("second-factor");
    expect(field.textContent).toContain("confirm this approval with the code your app shows now");
    await u.click(screen.getByTestId("saved-approval-approve"));
    expect(screen.getByTestId("second-factor-error").textContent).toContain("6-digit code");
    expect(mock.calls.some((c) => c.url.endsWith(`/${coded.id}/approve`))).toBe(false);
    expect(coded.approval).toBeNull();
    const boxes = () => within(screen.getByTestId("second-factor")).getAllByRole("textbox");
    await u.type(boxes()[0]!, "000000");
    await u.click(screen.getByTestId("saved-approval-approve"));
    await waitFor(() => expect(screen.getByTestId("second-factor-error").textContent).toContain("not right"));
    expect(coded.approval).toBeNull();
    for (const b of boxes()) await u.clear(b);
    await u.type(boxes()[0]!, "654321");
    await u.click(screen.getByTestId("saved-approval-approve"));
    await waitFor(() => expect(dialog().dataset["state"]).toBe("approved"));
    expect(coded.approval).not.toBeNull();
    expect(mock.calls.filter((c) => c.url.endsWith(`/${coded.id}/approve`)).at(-1)!.headers["x-second-factor"]).toBe("654321");
    // withdrawing asks for a fresh code too, once the question is asked; a wrong one is refused, and Keep it clears it
    expect(screen.queryByTestId("second-factor")).toBeNull();
    await u.click(screen.getByTestId("saved-approval-withdraw"));
    await u.type(boxes()[0]!, "111111");
    await u.click(screen.getByTestId("saved-approval-withdraw"));
    await waitFor(() => expect(screen.getByTestId("second-factor-error").textContent).toContain("not right"));
    expect(coded.approval).not.toBeNull();
    await u.click(screen.getByTestId("saved-approval-close"));
    expect(screen.queryByTestId("second-factor")).toBeNull();
    expect(screen.queryByTestId("saved-approval-withdraw-ask")).toBeNull();
    await u.click(screen.getByTestId("saved-approval-withdraw"));
    expect(screen.queryByTestId("second-factor-error")).toBeNull();
    expect(boxes().map((b) => (b as HTMLInputElement).value).join("")).toBe("");
    await u.type(boxes()[0]!, "654321");
    await u.click(screen.getByTestId("saved-approval-withdraw"));
    await waitFor(() => expect(coded.approval).toBeNull());
    expect(mock.calls.filter((c) => c.url.endsWith(`/${coded.id}/withdraw-approval`)).at(-1)!.headers["x-second-factor"]).toBe("654321");
  });

  it("HC-TR-294 a record that cannot be read is said, with a way to try again", async () => {
    const s = saved({ name: "Gone" });
    const u = await open();
    mock.state.savedStrategies.splice(mock.state.savedStrategies.indexOf(s), 1);
    await u.click(within(rowOf("Gone")).getByTestId("saved-approval-open"));
    await waitFor(() => expect(dialog().dataset["state"]).toBe("error"));
    expect(screen.getByTestId("saved-approval-load-error").textContent).toContain("Couldn't load its paper record: Strategy not found");
    expect(screen.queryByTestId("saved-approval-approve")).toBeNull();
    mock.state.savedStrategies.push(s);
    await u.click(within(screen.getByTestId("saved-approval-load-error")).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(dialog().dataset["state"]).toBe("open"));
  });
});
