// The Autopilot screen (ADR-109; HC-TR-219, HC-TR-220), its item on the Desk's status bar and its tag on a Paper card
// (HC-SH-143), against the in-memory mock API. Paper only: nothing here can place an order.
import { AUTOPILOT_PLAYBOOKS as PLAYBOOKS } from "@hapiecoin/pricing";
import { AUTOPILOT_PAPER_ONLY_MESSAGE, type AutopilotRun, type Strategy, type StrategyRule, chainTopic } from "@hapiecoin/schema";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeSocket, installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { buildChain } from "../../../test/fixtures/chain";
import { routerMock } from "../../../test/next-mocks";
import { PortfolioBar } from "@/components/chrome/PortfolioBar";
import { Workspace } from "@/components/workspace/Workspace";
import { fmtExpiry, fmtStrike } from "@/lib/format";
import { useUiStore } from "@/lib/store";
import { AutopilotPage, istClock, moveWords } from "./AutopilotPage";

const EMAIL = "autopilot@example.com";
let mock: MockFetch;
const acc = () => mock.state.accounts.get(EMAIL)!;
const AT = "2026-09-08T10:00:00Z";
// a listed BTC call the fake feed quotes: a trade's P&L is known once the chain snapshot arrives
const EXPIRY = "2026-09-25";
const rows = buildChain("BTC", EXPIRY);
const ROW = rows[Math.floor(rows.length / 2)]!;
const MARK = Number(ROW.call!.mark);
const CALL = { id: "leg_a", kind: "call" as const, side: "buy" as const, strike: ROW.strike, expiry: EXPIRY, symbol: "C-BTC-TEST", lots: 10, price: String(MARK), entryPrice: String(MARK), exitPrice: null, iv: 0.5, status: "open" as const, isAdjustment: false, position: 0, openedAt: AT, closedAt: null, orderId: null };
/** A long call of 10 lots (0.01 BTC) entered `above` dollars over the mark the feed will quote: its P&L is minus a hundredth of that. */
const leg = (id: string, above: number) => ({ ...CALL, id: `leg_${id}`, price: String(MARK + above), entryPrice: String(MARK + above) });
/** Open the feed and quote the chain. Call it once the trades are on screen: their legs are subscribed by then. */
function serveMarket() {
  const ws = FakeSocket.last();
  act(() => {
    ws.open();
    ws.receive({ t: "spot", s: "BTC", p: "79521", c24: 0.4 });
    ws.receive({ t: "snap", topic: chainTopic("delta_india", "BTC", EXPIRY), seq: 0, rows });
  });
}
const rule = (over: Partial<StrategyRule>): StrategyRule => ({ id: "rule_t", kind: "target", trigger: "money", value: "2", basis: null, basisUsd: null, thresholdUsd: "2", legId: null, scope: "strategy", trail: null, peakPnl: null, channels: ["push"], state: "armed", firedAt: null, firedPnl: null, outcome: null, note: null, createdAt: AT, updatedAt: AT, ...over });
function strat(id: string, over: Partial<Strategy> = {}): Strategy {
  return { id, name: `${id} name`, asset: "BTC", venue: "delta_india", status: "paper", tradingMode: "paper", templateName: "Custom", brokerId: "brk_delta", legs: [{ ...CALL, id: `leg_${id}` }], realizedPnl: "0", pnlHistory: [], notes: "", tags: [], orderBatchId: null, orders: [], adjustments: [], startedAt: AT, closedAt: null, createdAt: AT, updatedAt: AT, ...over };
}
const auto = (id: string, playbookId: string, over: Partial<Strategy> = {}) => strat(id, { name: `${PLAYBOOKS.find((p) => p.id === playbookId)!.name} · Autopilot`, tags: ["autopilot"], autopilotPlaybookId: playbookId, rules: [rule({ trail: { trigger: "pct", value: "10" } }), rule({ id: "rule_s", kind: "stop", value: "9", thresholdUsd: "-9" })], ...over });
const run = (over: Partial<AutopilotRun>): AutopilotRun => ({ id: "1", at: AT, playbookId: "pin-butterfly", venue: "delta_india", asset: "BTC", kind: "entered", reason: "Its entry conditions were met on the latest prices", strategyId: "a1", detail: { capital: "18", dte: 1 }, ...over });
const puts = () => mock.calls.filter((c) => c.url.includes("/v1/autopilot") && c.method === "PUT");
const TRADABLE = PLAYBOOKS; // every playbook Autopilot trades: the recorded ones (never the control) and the evening ones

beforeEach(() => {
  mock = installMockFetch();
  mock.loginAs(EMAIL);
  useUiStore.setState({ workspaceTab: "paper", paneSource: null, adjust: null });
});
afterEach(() => mock.restore());

describe("HC-TR-219 the Autopilot screen: the switch and the strategies", () => {
  it("HC-TR-219 starts off with every strategy off; the switch, a strategy's switch and its exit style are saved as they change", async () => {
    renderWithProviders(<AutopilotPage />);
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId("autopilot-page").dataset["state"]).toBe("ready"));
    expect(screen.getByTestId("autopilot-page").dataset["enabled"]).toBe("false");
    const cards = screen.getAllByTestId("autopilot-card");
    expect(cards.map((c) => c.dataset["playbook"])).toEqual(TRADABLE.map((p) => p.id)); // never the control
    expect(cards.every((c) => c.dataset["on"] === "false")).toBe(true);
    expect(screen.getByTestId("autopilot-on-count").textContent).toBe(`0 of ${TRADABLE.length}`);
    expect(screen.getByTestId("autopilot-open-count").textContent).toBe("0");
    expect(screen.getByTestId("autopilot-capital").textContent).toBe("—");
    expect(screen.getByTestId("autopilot-today").textContent).toBe("—");
    expect(within(screen.getByTestId("autopilot-running")).getByText("No Autopilot trade is open")).toBeTruthy();
    expect(screen.getByTestId("autopilot-log").textContent).toContain("Nothing yet");
    expect(screen.getByTestId("autopilot-stop-all")).toHaveProperty("disabled", true); // nothing to stop
    const butterfly = cards.find((c) => c.dataset["playbook"] === "pin-butterfly")!;
    expect(within(butterfly).getAllByTestId("autopilot-card-state").every((s) => s.textContent === "Switched off")).toBe(true);
    expect(within(butterfly).getByTestId("autopilot-card-exit")).toHaveProperty("disabled", true);

    await u.click(screen.getByTestId("autopilot-enabled"));
    await waitFor(() => expect(acc().autopilot.settings.enabled).toBe(true));
    await u.click(within(butterfly).getByTestId("autopilot-card-switch"));
    await waitFor(() => expect(acc().autopilot.settings.strategies).toEqual([{ playbookId: "pin-butterfly", exit: "trail" }]));
    await waitFor(() => expect(screen.getByTestId("autopilot-on-count").textContent).toBe(`1 of ${TRADABLE.length}`));
    const again = screen.getAllByTestId("autopilot-card").find((c) => c.dataset["playbook"] === "pin-butterfly")!;
    expect(within(again).getAllByTestId("autopilot-card-state")[0]!.textContent).toBe("Watching: no decision logged yet");
    await u.selectOptions(within(again).getByTestId("autopilot-card-exit"), "target");
    await waitFor(() => expect(acc().autopilot.settings.strategies).toEqual([{ playbookId: "pin-butterfly", exit: "target" }]));
    await u.click(within(again).getByTestId("autopilot-card-switch"));
    await waitFor(() => expect(acc().autopilot.settings.strategies).toEqual([]));
    expect(puts().length).toBe(4);
  });

  it("HC-TR-219 says why a switched-on strategy is not in a trade, from its newest log line; a failed load offers a retry", async () => {
    acc().autopilot = { settings: { enabled: true, strategies: [{ playbookId: "trend-calls", exit: "target" }, { playbookId: "premium-harvest", exit: "trail" }] }, runs: [run({ id: "6", kind: "noted", playbookId: "premium-harvest", strategyId: "gone" }), run({ id: "5", kind: "skipped", playbookId: "trend-calls", strategyId: null, reason: "Its entry conditions are not met", detail: {} }), run({ id: "4", kind: "skipped", playbookId: "trend-calls", asset: "ETH", strategyId: null, reason: "The fees are larger than the profit target, or the structure has no defined maximum", detail: { capital: "12" } })] };
    const first = renderWithProviders(<AutopilotPage />);
    await waitFor(() => expect(screen.getByTestId("autopilot-page").dataset["state"]).toBe("ready"));
    const card = screen.getAllByTestId("autopilot-card").find((c) => c.dataset["playbook"] === "trend-calls")!;
    const states = within(card).getAllByTestId("autopilot-card-state").map((s) => s.textContent);
    expect(states[0]).toBe("Its entry conditions are not met");
    expect(states[1]).toBe("The fees are larger than the profit target, or the structure has no defined maximum · needs $12.00");
    // a line about a trade that has ended is not a reason for being out of one
    const harvest = screen.getAllByTestId("autopilot-card").find((c) => c.dataset["playbook"] === "premium-harvest")!;
    expect(within(harvest).getAllByTestId("autopilot-card-state")[0]!.textContent).toBe("Waiting for the next check");
    const lines = screen.getAllByTestId("autopilot-run");
    expect(lines).toHaveLength(3);
    expect(lines[1]!.dataset["kind"]).toBe("skipped");
    first.unmount();
    // the session is gone: the read is refused, the screen says so and offers a retry that works once signed in again
    const kept = new Map(mock.state.sessions);
    mock.state.sessions.clear();
    renderWithProviders(<AutopilotPage />);
    await waitFor(() => expect(screen.getByTestId("autopilot-page").dataset["state"]).toBe("error"), { timeout: 8000 });
    for (const [k, v] of kept) mock.state.sessions.set(k, v);
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByTestId("autopilot-page").dataset["state"]).toBe("ready"));
  });
});

describe("HC-TR-220 the Autopilot screen: the trades it holds", () => {
  const runs = [run({ id: "2", playbookId: "trend-puts", asset: "ETH", strategyId: "a2", detail: { capital: "4.5", dte: 20 } }), run({ id: "1" })];
  const on = { enabled: true, strategies: [{ playbookId: "pin-butterfly", exit: "trail" as const }, { playbookId: "trend-puts", exit: "target" as const }] };

  it("HC-TR-220 lists only Autopilot's open trades; health and P&L need a live price for every leg; Exit now closes one at its price, never to a draft; Open on the Desk follows it there", async () => {
    // a1 stands 7 dollars down against a 9 dollar stop; a2 is on ETH, whose prices never arrive in this test
    acc().strategies.push(auto("a1", "pin-butterfly", { legs: [leg("a1", 700)] }), auto("a2", "trend-puts", { asset: "ETH", rules: [rule({})] }), strat("own"), auto("old", "pin-butterfly", { status: "archived", closedAt: new Date().toISOString(), realizedPnl: "3" }));
    acc().autopilot = { settings: on, runs };
    renderWithProviders(<AutopilotPage />);
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId("autopilot-trade")).toHaveLength(2));
    const trade = (id: string) => screen.getAllByTestId("autopilot-trade").find((t) => t.dataset["id"] === id)!;
    expect(screen.getAllByTestId("autopilot-trade").map((t) => t.dataset["id"]).sort()).toEqual(["a1", "a2"]); // not the trader's own, not the closed one
    expect(screen.getByTestId("autopilot-open-count").textContent).toBe("2");
    expect(screen.getByTestId("autopilot-capital").textContent).toBe("$22.50");
    // no prices yet: no health, no P&L, and the day counts only the trade closed today
    expect(trade("a1").dataset["health"]).toBe("unknown");
    expect(trade("a1").textContent).toContain("No live price");
    expect(within(trade("a1")).getByTestId("autopilot-trade-pnl").textContent).toBe("waiting for prices");
    expect(screen.getByTestId("autopilot-today").textContent).toBe("+$3.00");
    expect(screen.getByTestId("autopilot-today-note").textContent).toBe("2 open trades have no live price and are not counted");
    const card = (id: string) => screen.getAllByTestId("autopilot-card").find((x) => x.dataset["playbook"] === id)!;
    expect(within(card("pin-butterfly")).getAllByTestId("autopilot-card-state")[0]!.textContent).toBe("In a trade waiting for prices");
    expect(within(card("pin-butterfly")).getByTestId("autopilot-card-how").textContent).toContain("the record shown is the playbook's own exits, not Autopilot's");

    serveMarket();
    await waitFor(() => expect(trade("a1").dataset["health"]).toBe("danger"));
    expect(trade("a1").textContent).toContain("Pin butterfly · BTC");
    expect(trade("a1").textContent).toContain("Close to its stop");
    expect(within(trade("a1")).getByTestId("autopilot-trade-pnl").textContent).toBe("−$7.00");
    expect(within(trade("a1")).getByRole("img").getAttribute("aria-label")).toBe("78 percent of the allowed loss is used");
    expect(trade("a1").textContent).toContain("Starts trailing at+$2.00");
    expect(trade("a1").textContent).toContain("Stop closes it at−$9.00");
    expect(trade("a2").dataset["health"]).toBe("unknown"); // BTC prices are no prices for an ETH trade
    expect(trade("a2").textContent).toContain("Closes in profit at+$2.00");
    expect(trade("a2").textContent).toContain("no stop: held to its exit or settlement");
    expect(screen.getByTestId("autopilot-today").textContent).toBe("−$4.00"); // 3 closed today, 7 down on the open one
    expect(screen.getByTestId("autopilot-today-note").textContent).toBe("1 open trade has no live price and is not counted");
    expect(within(card("pin-butterfly")).getAllByTestId("autopilot-card-state")[0]!.textContent).toBe("In a trade −$7.00");
    expect(within(card("trend-puts")).getAllByTestId("autopilot-card-state")[1]!.textContent).toBe("In a trade waiting for prices");
    expect(screen.getAllByTestId("autopilot-run")[1]!.textContent).toContain("1d to expiry · capital $18.00");

    await u.click(within(trade("a1")).getByTestId("autopilot-trade-desk"));
    expect(useUiStore.getState().paneSource).toEqual({ kind: "strategy", id: "a1" });
    expect(routerMock.push).toHaveBeenCalledWith("/desk?tab=paper");

    await u.click(within(trade("a1")).getByTestId("autopilot-trade-exit"));
    const dialog = await screen.findByTestId("stop-paper");
    expect(within(dialog).queryByTestId("stop-archive")).toBeNull(); // closed, never parked as a draft
    await u.click(within(dialog).getByTestId("stop-go"));
    await waitFor(() => expect(acc().strategies.find((x) => x.id === "a1")!.status).toBe("archived"));
    expect(Number(acc().strategies.find((x) => x.id === "a1")!.realizedPnl)).toBeCloseTo(-7, 6); // at the live mark, not the entry
    await waitFor(() => expect(screen.getAllByTestId("autopilot-trade")).toHaveLength(1));
    expect(acc().strategies.find((x) => x.id === "own")!.status).toBe("paper");
  });

  it("HC-TR-220 Stop everything waits for live prices, switches Autopilot off, reads what it holds again and closes it all, never the trader's own", async () => {
    // one in profit and trailing, one losing a little
    acc().strategies.push(auto("g", "pin-butterfly", { legs: [leg("g", -100)], rules: [rule({ trail: { trigger: "pct", value: "10" }, peakPnl: "5" })] }), auto("w", "trend-puts", { legs: [leg("w", 100)] }), strat("own"));
    acc().autopilot = { settings: on, runs: [] };
    renderWithProviders(<AutopilotPage />);
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId("autopilot-trade")).toHaveLength(2));
    await u.click(screen.getByTestId("autopilot-stop-all"));
    const dialog = await screen.findByTestId("autopilot-stop-dialog");
    expect(dialog.textContent).toContain("its 2 open paper trades are closed at the current prices");
    expect(within(dialog).getByTestId("autopilot-stop-wait")).toBeTruthy();
    expect(within(dialog).getByTestId("autopilot-stop-confirm")).toHaveProperty("disabled", true);
    serveMarket();
    await waitFor(() => expect(within(dialog).getByTestId("autopilot-stop-confirm")).toHaveProperty("disabled", false));
    const trade = (id: string) => screen.getAllByTestId("autopilot-trade").find((t) => t.dataset["id"] === id)!;
    await waitFor(() => expect(trade("g").dataset["health"]).toBe("good"));
    expect(trade("g").textContent).toContain("On track");
    expect(trade("g").textContent).toContain("Trailing: exits at+$4.50");
    expect(trade("w").dataset["health"]).toBe("watch");
    expect(trade("w").textContent).toContain("Losing");
    expect(within(trade("w")).getByTestId("autopilot-trade-strikes").textContent).toBe(`${fmtStrike(ROW.strike)} · ${fmtExpiry(EXPIRY)}`);
    // behind the screen a pass enters one more trade: the page has not read it, Stop everything still closes it
    acc().strategies.push(auto("late", "expiry-week-credit", { legs: [] }));
    await u.click(within(dialog).getByTestId("autopilot-stop-confirm"));
    await waitFor(() => expect(acc().autopilot.settings.enabled).toBe(false));
    await waitFor(() => expect(acc().strategies.filter((x) => x.autopilotPlaybookId && x.status === "paper")).toHaveLength(0));
    expect(Number(acc().strategies.find((x) => x.id === "g")!.realizedPnl)).toBeCloseTo(1, 6);
    expect(Number(acc().strategies.find((x) => x.id === "w")!.realizedPnl)).toBeCloseTo(-1, 6);
    expect(acc().strategies.find((x) => x.id === "late")!.status).toBe("archived");
    expect(acc().strategies.find((x) => x.id === "own")!.status).toBe("paper");
    await waitFor(() => expect(screen.queryByTestId("autopilot-stop-dialog")).toBeNull());
    expect(acc().autopilot.settings.strategies).toHaveLength(2); // the choices are kept for the next time it is switched on
  });

  it("HC-TR-222 a strategy holding several trades on one coin shows them added up on its card, with the worst health, and one row each", async () => {
    // two butterflies on BTC (in the product each sits on its own strikes): one a dollar up, one seven down against a nine dollar stop
    acc().strategies.push(auto("b1", "pin-butterfly", { legs: [leg("b1", -100)] }), auto("b2", "pin-butterfly", { legs: [leg("b2", 700)] }));
    acc().autopilot = { settings: on, runs: [] };
    renderWithProviders(<AutopilotPage />);
    await waitFor(() => expect(screen.getAllByTestId("autopilot-trade")).toHaveLength(2));
    const state = () => within(screen.getAllByTestId("autopilot-card").find((x) => x.dataset["playbook"] === "pin-butterfly")!).getAllByTestId("autopilot-card-state")[0]!;
    expect(state().textContent).toBe("In 2 trades waiting for prices");
    serveMarket();
    await waitFor(() => expect(state().textContent).toBe("In 2 trades −$6.00"));
    expect(state().querySelector("span")!.className).toContain("bg-loss"); // the worse of the two: close to its stop
    expect(screen.getByTestId("autopilot-page").textContent).toContain("A strategy holds one trade per coin at a time");
  });

  it("HC-TR-220 a trade with no live price, or one the server refuses to close, is left open and named; the others are still closed", async () => {
    acc().strategies.push(auto("a1", "pin-butterfly", { legs: [leg("a1", 700)] }), auto("a2", "trend-puts", { asset: "ETH" }), auto("x", "expiry-week-credit", { legs: [leg("x", 0)] }));
    acc().autopilot = { settings: on, runs };
    renderWithProviders(<AutopilotPage />);
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId("autopilot-trade")).toHaveLength(3));
    serveMarket();
    await waitFor(() => expect(screen.getAllByTestId("autopilot-trade").find((t) => t.dataset["id"] === "a1")!.dataset["health"]).toBe("danger"));
    // x stops being a paper trade the moment a1 is closed: the server refuses to stop it
    const a1 = acc().strategies.find((s) => s.id === "a1")!;
    Object.defineProperty(acc().strategies.find((s) => s.id === "x")!, "status", { get: () => (a1.status === "archived" ? "live" : "paper"), enumerable: true, configurable: true });
    await u.click(screen.getByTestId("autopilot-stop-all"));
    await u.click(within(await screen.findByTestId("autopilot-stop-dialog")).getByTestId("autopilot-stop-confirm"));
    const left = await screen.findByTestId("autopilot-stop-left");
    expect(acc().autopilot.settings.enabled).toBe(false);
    expect(a1.status).toBe("archived");
    expect(Number(a1.realizedPnl)).toBeCloseTo(-7, 6);
    expect(left.textContent).toContain("Trend with puts · Autopilot (ETH): no live price for every leg");
    expect(left.textContent).toContain("Only a paper strategy can be stopped");
    expect(acc().strategies.find((s) => s.id === "a2")!.status).toBe("paper"); // not closed at its entry price
    expect(within(screen.getByTestId("autopilot-stop-dialog")).getByTestId("autopilot-stop-confirm")).toHaveProperty("disabled", false);
    // opening it again starts clean
    await u.click(within(screen.getByTestId("autopilot-stop-dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("autopilot-stop-dialog")).toBeNull());
    await u.click(screen.getByTestId("autopilot-stop-all"));
    expect(within(await screen.findByTestId("autopilot-stop-dialog")).queryByTestId("autopilot-stop-left")).toBeNull();
  });
});

describe("HC-TR-226 the Autopilot screen: the evening strategies", () => {
  it("HC-TR-226 a strategy entered by the clock says when it enters and how it exits, has no exit style to choose, and is saved with its own exits", async () => {
    renderWithProviders(<AutopilotPage />);
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId("autopilot-page").dataset["state"]).toBe("ready"));
    const card = (id: string) => screen.getAllByTestId("autopilot-card").find((x) => x.dataset["playbook"] === id)!;
    const wings = card("evening-strangle-wings-3");
    expect(within(wings).getByTestId("autopilot-card-how").textContent).toContain("Entered once an evening, 9:30 to 10:30 PM IST, on the next expiry. Held to settlement: the bought wings cap the loss. Backtest only so far:");
    expect(within(wings).getByTestId("autopilot-card-own").textContent).toBe("Its own exits");
    expect(within(wings).getByTestId("autopilot-card-exit")).toHaveProperty("hidden", true);
    expect(within(wings).getAllByTestId("autopilot-card-asset").map((a) => a.dataset["asset"])).toEqual(["BTC"]); // the backtest covers BTC only
    expect(within(wings).getByText("Backtest only")).toBeTruthy();
    expect(within(card("evening-strangle-stop-2x")).getByTestId("autopilot-card-how").textContent).toContain("Each sold option is bought back if its price reaches 2 times what it was sold for.");
    // HC-TR-228: the trail-the-rest version says what happens to the other side after a stop
    expect(within(card("evening-strangle-trail-rest")).getByTestId("autopilot-card-how").textContent).toContain("Each sold option is bought back if its price reaches 2 times what it was sold for. After that, the profit on the other one is trailed and it is closed when it gives back 50 % of its best.");
    // HC-TR-227: the quick-profit version says both of its exits
    expect(within(card("evening-strangle-take-half")).getByTestId("autopilot-card-how").textContent).toContain("The whole trade is closed once it is up by 50 % of the premium collected. Each sold option is bought back if its price reaches 2 times what it was sold for.");
    // HC-TR-239 / HC-TR-241: a ladder, a profit lock, a timed exit and a trail from the take level, each in the trader's words
    expect(within(card("evening-strangle-steps")).getByTestId("autopilot-card-how").textContent).toContain("An equal part of the lots is closed each time the lots still open are up by 25, 50, 75 % of their premium, and the last part is held.");
    expect(within(card("evening-strangle-lock")).getByTestId("autopilot-card-how").textContent).toContain("Once the trade is up by 50 % of the premium a floor is set at 25 %: the whole trade is closed if the profit falls back there.");
    expect(within(card("evening-strangle-out-early")).getByTestId("autopilot-card-how").textContent).toContain("Everything is closed at 1:30 AM IST, whatever the profit.");
    expect(within(card("evening-strangle-half-trail")).getByTestId("autopilot-card-how").textContent).toContain("it is not closed: it is trailed, and closed when the profit gives back 20 % of its best.");
    expect(card("evening-strangle-lock").textContent).toContain("a floor at 25 % of the premium once it is up 50 %");
    expect(card("evening-strangle-out-early").textContent).toContain("out at 1:30 AM IST");
    expect(card("evening-strangle-half-trail").textContent).toContain("trail from 50 % of the premium");
    expect(card("evening-strangle-steps").textContent).toContain("profit in steps at 25 / 50 / 75 %");
    expect([istClock(20), istClock(10), istClock(0), istClock(6), istClock(18)]).toEqual(["1:30 AM", "3:30 PM", "5:30 AM", "11:30 AM", "11:30 PM"]);
    expect(istClock(7)).toBe("12:30 PM");
    expect(istClock(19)).toBe("12:30 AM");
    // a recorded playbook keeps its two styles to choose from, and never offers "own"
    const butterfly = card("pin-butterfly");
    expect(within(butterfly).queryByTestId("autopilot-card-own")).toBeNull();
    expect([...within(butterfly).getByTestId<HTMLSelectElement>("autopilot-card-exit").options].map((o) => o.value)).toEqual(["trail", "target"]);
    await u.click(within(wings).getByTestId("autopilot-card-switch"));
    await waitFor(() => expect(acc().autopilot.settings.strategies).toEqual([{ playbookId: "evening-strangle-wings-3", exit: "own" }]));
  });

  it("HC-TR-226 a running evening strangle shows the stop on each sold option, or that it is held to settlement", async () => {
    const legStop = (legId: string) => rule({ id: `r_${legId}`, kind: "leg_stop", trigger: "multiple", value: "2", thresholdUsd: "500", legId, scope: "leg" });
    acc().strategies.push(auto("s2", "evening-strangle-stop-2x", { legs: [leg("s2", 0)], rules: [legStop("leg_s2")] }), auto("sw", "evening-strangle-wings-3", { legs: [leg("sw", 0)], rules: [] }));
    acc().autopilot = { settings: { enabled: true, strategies: [{ playbookId: "evening-strangle-stop-2x", exit: "own" }, { playbookId: "evening-strangle-wings-3", exit: "own" }] }, runs: [run({ id: "8", playbookId: "evening-strangle-stop-2x", strategyId: "s2", detail: { exit: "own", legStop: 2, capital: null, maxLoss: null } }), run({ id: "7", playbookId: "evening-strangle-wings-3", strategyId: "sw", detail: { exit: "own", capital: "31" } })] };
    renderWithProviders(<AutopilotPage />);
    await waitFor(() => expect(screen.getAllByTestId("autopilot-trade")).toHaveLength(2));
    const trade = (id: string) => screen.getAllByTestId("autopilot-trade").find((x) => x.dataset["id"] === id)!;
    expect(trade("s2").textContent).toContain("Evening strangle, stop at double · BTC");
    expect(trade("s2").textContent).toContain("Closes in profit atno level: held to settlement");
    expect(trade("s2").textContent).toContain("Stop closes it ateach sold option at 2 times its price");
    expect(trade("sw").textContent).toContain("Stop closes it atno stop: held to its exit or settlement");
    expect(within(trade("s2")).queryByTestId("autopilot-trade-rest-trail")).toBeNull(); // this one keeps the other side
    // the naked one was entered with no maximum loss: the capital tile says so, and adds only the bounded trade
    expect(screen.getByTestId("autopilot-capital").textContent).toBe("not bounded");
    expect(screen.getByTestId("autopilot-summary").textContent).toContain("a sold strangle with no wings has no maximum loss; the others $31.00");
  });
});

describe("HC-TR-232 the Autopilot screen: by expiry and by coin", () => {
  const press = async (u: ReturnType<typeof userEvent.setup>, kind: "cadence" | "coin", value: string) => u.click(screen.getAllByTestId(`autopilot-filter-${kind}`).find((b) => b.dataset["value"] === value)!);
  const cards = () => screen.queryAllByTestId("autopilot-card").map((c) => c.dataset["playbook"]);

  it("HC-TR-232 a strategy is one row: how it gets out, its backtest in figures, its paper result so far and what it is doing now", async () => {
    acc().autopilotResults = {
      since: AT,
      total: { open: 1, closed: 3, wins: 2, grossUsd: "4.00", feesUsd: "0.80", netUsd: "3.20" },
      rows: [{ playbookId: "evening-strangle-stop-2x", asset: "BTC", exit: "own", open: 1, closed: 3, wins: 2, grossUsd: "4.00", feesUsd: "0.80", netUsd: "3.20", bestNetUsd: "4.60", worstNetUsd: "-2.40", avgHoldMinutes: 40, reasons: { expired: 3 } }],
      byDte: [],
      trades: [],
    };
    renderWithProviders(<AutopilotPage />);
    await waitFor(() => expect(screen.getByTestId("autopilot-page").dataset["state"]).toBe("ready"));
    const row = (id: string) => screen.getAllByTestId("autopilot-card").find((x) => x.dataset["playbook"] === id)!;
    const twice = row("evening-strangle-stop-2x");
    expect(twice.textContent).toContain("Enters once an evening, 9:30 to 10:30 PM IST, on the next expiry");
    expect(twice.textContent).toContain("Stop at 2x on each sold option");
    expect(within(twice).getByTestId("autopilot-card-backtest").textContent).toBe("Backtest+$7.51 a day45% won · worst −$60.00106 days tested");
    await waitFor(() => expect(within(twice).getByTestId("autopilot-card-paper").textContent).toBe("Paper so far+$3.20 net3 closed · 2 won · 1 open"));
    expect(within(row("evening-strangle-wings-3")).getByTestId("autopilot-card-paper").textContent).toBe("Paper so farNo trade yet");
    expect(within(twice).getByTestId("autopilot-card-backtest").querySelector("span")!.className).toContain("md:sr-only"); // the column's name stays for a screen reader
    expect(row("evening-strangle-wings-3").textContent).toContain("Wings cap the loss, held to expiry");
    expect(row("evening-strangle-take-half").textContent).toContain("Stop at 2x on each sold option, take 50 % of the premium");
    expect(row("weekly-fri-strangle-trail-rest").textContent).toContain("Stop at 2x on each sold option, then trail the other side");
    expect(within(row("weekly-tue-strangle-stop-3x")).getByTestId("autopilot-card-backtest").textContent).toContain("−$2.92 a week");
    // a recorded playbook has no backtest figure of its own: its record per coin sits under Now
    expect(within(row("trend-calls")).getByTestId("autopilot-card-backtest").textContent).toContain("Recorded per coin, under Now");
    expect(row("trend-calls").textContent).toContain("Playbook stop and time exit");
  });

  it("HC-TR-232 the expiry and coin buttons narrow the strategies, the running trades, the log and the results together", async () => {
    acc().strategies.push(auto("d1", "evening-strangle-stop-2x", { legs: [leg("d1", 0)], rules: [] }), auto("w1", "weekly-fri-strangle-stop-3x", { legs: [leg("w1", 0)], rules: [] }), auto("t1", "trend-puts", { asset: "ETH", rules: [rule({})] }));
    acc().autopilot = { settings: { enabled: true, strategies: [{ playbookId: "evening-strangle-stop-2x", exit: "own" }] }, runs: [run({ id: "3", playbookId: "evening-strangle-stop-2x", strategyId: "d1" }), run({ id: "2", playbookId: "weekly-fri-strangle-stop-3x", strategyId: "w1" }), run({ id: "1", playbookId: "trend-puts", asset: "ETH", strategyId: "t1" })] };
    renderWithProviders(<AutopilotPage />);
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId("autopilot-trade")).toHaveLength(3));
    expect(screen.getAllByTestId("autopilot-filter-cadence").map((b) => b.textContent)).toEqual([`All · ${TRADABLE.length}`, "Trend · 6", "Daily · 32", "Weekly · 19", "Monthly · 15"]);
    expect(screen.getAllByTestId("autopilot-filter-coin").map((b) => b.textContent)).toEqual(["All", `BTC · ${TRADABLE.length - 26}`, "ETH · 28", "XAUT · 4"]); // HC-TR-235: six ETH and four XAUT evening strangles, five ETH weekly and five ETH monthly ones of their own
    expect(screen.getByTestId("autopilot-filters").dataset["filtered"]).toBe("false");
    expect(screen.queryByTestId("autopilot-filter-note")).toBeNull();
    expect(screen.getByRole("group", { name: "Expiry" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Coin" })).toBeTruthy();

    await press(u, "cadence", "weekly");
    expect(screen.getAllByTestId("autopilot-group").map((g) => g.dataset["group"])).toEqual(["Weekly strangles, Friday expiry"]);
    expect(cards()).toHaveLength(19);
    expect(screen.getAllByTestId("autopilot-trade").map((x) => x.dataset["id"])).toEqual(["w1"]);
    expect(screen.getAllByTestId("autopilot-run")).toHaveLength(1);
    expect(screen.getByTestId("autopilot-filter-note")).toBeTruthy();
    expect(screen.getByTestId("autopilot-results").dataset["filtered"]).toBe("true");
    expect(screen.getByTestId("autopilot-open-count").textContent).toBe("3"); // the summary stays everything

    // XAUT: no weekly strategy trades it (HC-TR-235: its weekly study did not hold up), and nothing of it is open in this selection
    await press(u, "coin", "XAUT");
    expect(cards()).toHaveLength(0);
    expect(screen.getByTestId("autopilot-group-empty").textContent).toBe("No weekly strategy trades XAUT yet.");
    expect(screen.queryAllByTestId("autopilot-trade")).toHaveLength(0);
    expect(screen.getByTestId("autopilot-running-none").textContent).toBe("No open trade in this selection (3 open in all).");
    expect(screen.getByTestId("autopilot-log-none").textContent).toBe("No log line in this selection.");

    await press(u, "coin", "ETH");
    expect(cards()).toHaveLength(5); // the ETH weekly strangles
    await press(u, "cadence", "all");
    expect(cards()).toEqual(TRADABLE.filter((p) => (p.assets as readonly string[]).includes("ETH")).map((p) => p.id));
    expect(screen.getAllByTestId("autopilot-trade").map((x) => x.dataset["id"])).toEqual(["t1"]);
    const puts = screen.getAllByTestId("autopilot-card").find((x) => x.dataset["playbook"] === "trend-puts")!;
    expect(within(puts).getAllByTestId("autopilot-card-asset").map((a) => a.dataset["asset"])).toEqual(["ETH"]); // its BTC line is hidden too

    await press(u, "coin", "all");
    expect(cards()).toHaveLength(TRADABLE.length);
    expect(screen.getAllByTestId("autopilot-trade")).toHaveLength(3);
    expect(screen.getByTestId("autopilot-results").dataset["filtered"]).toBe("false");
  });
});

describe("HC-TR-232 the Autopilot screen: the paper column without its read", () => {
  it("HC-TR-232 a results read that failed is not shown as no trade", async () => {
    renderWithProviders(<AutopilotPage />);
    await waitFor(() => expect(screen.getByTestId("autopilot-page").dataset["state"]).toBe("ready"));
    const cell = () => within(screen.getAllByTestId("autopilot-card").find((x) => x.dataset["playbook"] === "evening-strangle-stop-2x")!).getByTestId("autopilot-card-paper");
    await waitFor(() => expect(cell().textContent).toBe("Paper so farNo trade yet"));
  });

  it("HC-TR-232 while the results have never loaded the cell says so", async () => {
    // the results route refuses while everything else answers: the session is dropped for that path only
    const real = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => (String(input instanceof Request ? input.url : input).includes("/autopilot/results") ? Promise.resolve(new Response(JSON.stringify({ error: { code: "INTERNAL", message: "down" } }), { status: 500, headers: { "content-type": "application/json" } })) : real(input, init)));
    try {
      renderWithProviders(<AutopilotPage />);
      await waitFor(() => expect(screen.getByTestId("autopilot-page").dataset["state"]).toBe("ready"));
      const cell = () => within(screen.getAllByTestId("autopilot-card").find((x) => x.dataset["playbook"] === "evening-strangle-stop-2x")!).getByTestId("autopilot-card-paper");
      expect(["Paper so far…", "Paper so farNot loaded"]).toContain(cell().textContent);
      await waitFor(() => expect(cell().textContent).toBe("Paper so farNot loaded"), { timeout: 8000 });
      expect(screen.getByTestId("autopilot-results").dataset["state"]).toBe("error");
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe("HC-TR-230 the Autopilot screen: the weekly strangles", () => {
  it("HC-TR-230 the strategies are grouped by how far out they trade; a weekly card says its day, its expiry and its exit", async () => {
    renderWithProviders(<AutopilotPage />);
    await waitFor(() => expect(screen.getByTestId("autopilot-page").dataset["state"]).toBe("ready"));
    const groups = screen.getAllByTestId("autopilot-group");
    expect(groups.map((g) => g.dataset["group"])).toEqual(["Longer-dated strategies", "Evening strangles, daily expiry", "Weekly strangles, Friday expiry", "Monthly strangles, month-end expiry"]);
    expect(groups.map((g) => within(g).getAllByTestId("autopilot-card").map((c) => c.dataset["playbook"]))).toEqual([TRADABLE.filter((p) => !p.clock), TRADABLE.filter((p) => p.clock && p.clock.weekdayUtc === undefined && p.clock.cadence !== "monthly"), TRADABLE.filter((p) => p.clock?.weekdayUtc !== undefined), TRADABLE.filter((p) => p.clock?.cadence === "monthly")].map((g) => g.map((p) => p.id)));
    expect(groups.map((g) => within(g).getAllByTestId("autopilot-card").length)).toEqual([6, 32, 19, 15]);
    // HC-TR-233: a monthly row says when it enters, and its backtest reads per month
    const monthly = screen.getAllByTestId("autopilot-card").find((x) => x.dataset["playbook"] === "monthly-strangle-premium-1000")!;
    expect(monthly.textContent).toContain("Enters on the first evening a month-end expiry is 60 to 75 days out, once per expiry");
    expect(monthly.textContent).toContain("Stop at 3x on each sold option, take 50 % of the premium");
    expect(within(monthly).getByTestId("autopilot-card-backtest").textContent).toBe("Backtest+$44.80 a trade77% won · worst −$507.00176 entry days over 11 expiries, 8 positive");
    const card = (id: string) => screen.getAllByTestId("autopilot-card").find((x) => x.dataset["playbook"] === id)!;
    const fri = card("weekly-fri-strangle-stop-3x");
    expect(within(fri).getByText("Friday weekly strangle, stop at triple")).toBeTruthy();
    expect(within(fri).getByTestId("autopilot-card-how").textContent).toContain("Entered each Friday, 9:30 to 10:30 PM IST, on next Friday's expiry. Each sold option is bought back if its price reaches 3 times what it was sold for. Backtest only so far:");
    expect(within(card("weekly-tue-strangle-wings")).getByTestId("autopilot-card-how").textContent).toContain("Entered each Tuesday, 9:30 to 10:30 PM IST, on that week's Friday expiry. Held to settlement: the bought wings cap the loss.");
    expect(within(card("weekly-tue-strangle-trail-rest")).getByTestId("autopilot-card-how").textContent).toContain("gives back 50 % of its best");
    expect(within(fri).getByTestId("autopilot-card-own").textContent).toBe("Its own exits");
  });
});

describe("HC-TR-228 the Autopilot screen: the strangle that trails the rest", () => {
  it("HC-TR-228 a running trail-the-rest strangle says its stops trail the other side, and once one has fired shows where the rest exits", async () => {
    const stop = rule({ id: "r_tr", kind: "leg_stop", trigger: "multiple", value: "2", thresholdUsd: "500", legId: "leg_tr", scope: "leg", trail: { trigger: "pct", value: "50" } });
    acc().strategies.push(auto("tr", "evening-strangle-trail-rest", { legs: [leg("tr", 0)], rules: [stop] }), auto("tr2", "evening-strangle-trail-rest", { asset: "ETH", legs: [leg("tr2", 0)], rules: [stop, rule({ id: "r_t2", kind: "trail", trigger: "pct", value: "50", thresholdUsd: "-26.8", peakPnl: "20" })] }), auto("tr3", "evening-strangle-trail-rest", { asset: "XAUT", legs: [leg("tr3", 0)], rules: [rule({ id: "r_t3", kind: "trail", trigger: "pct", value: "50", thresholdUsd: "-26.8" })] }));
    acc().autopilot = { settings: { enabled: true, strategies: [{ playbookId: "evening-strangle-trail-rest", exit: "own" }] }, runs: [] };
    renderWithProviders(<AutopilotPage />);
    await waitFor(() => expect(screen.getAllByTestId("autopilot-trade")).toHaveLength(3));
    const trade = (id: string) => screen.getAllByTestId("autopilot-trade").find((x) => x.dataset["id"] === id)!;
    expect(trade("tr").textContent).toContain("Stop closes it ateach sold option at 2 times its price, then the other side is trailed");
    expect(within(trade("tr")).queryByTestId("autopilot-trade-rest-trail")).toBeNull(); // no stop has fired
    expect(within(trade("tr2")).getByTestId("autopilot-trade-rest-trail").textContent).toBe("Trailing what is leftcloses if its profit falls to +$10.00");
    expect(within(trade("tr3")).getByTestId("autopilot-trade-rest-trail").textContent).toBe("Trailing what is leftstarts once it is in profit");
  });
});

describe("HC-TR-219 the Autopilot screen: what does not go through", () => {
  it("HC-TR-219 a change that is not saved leaves the switch as it was; both dialogs can be left without doing anything", async () => {
    acc().strategies.push(auto("a1", "pin-butterfly"));
    acc().autopilot = { settings: { enabled: true, strategies: [{ playbookId: "pin-butterfly", exit: "trail" }] }, runs: [run({})] };
    renderWithProviders(<AutopilotPage />);
    act(() => FakeSocket.last().open());
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId("autopilot-trade")).toHaveLength(1));
    // the session is gone: the save is refused
    const kept = new Map(mock.state.sessions);
    mock.state.sessions.clear();
    await u.click(screen.getByTestId("autopilot-enabled"));
    await waitFor(() => expect(puts()).toHaveLength(1));
    for (const [k, v] of kept) mock.state.sessions.set(k, v);
    expect(acc().autopilot.settings.enabled).toBe(true);
    await waitFor(() => expect(screen.getByTestId("autopilot-page").dataset["enabled"]).toBe("true"));
    // Exit now, then Escape: the trade stays
    await u.click(screen.getByTestId("autopilot-trade-exit"));
    expect(await screen.findByTestId("stop-paper")).toBeTruthy();
    await u.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("stop-paper")).toBeNull());
    // Stop everything, then Cancel: nothing changes
    await u.click(screen.getByTestId("autopilot-stop-all"));
    await u.click(within(await screen.findByTestId("autopilot-stop-dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("autopilot-stop-dialog")).toBeNull());
    await u.click(screen.getByTestId("autopilot-stop-all"));
    await screen.findByTestId("autopilot-stop-dialog");
    await u.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("autopilot-stop-dialog")).toBeNull());
    expect(acc().strategies.find((x) => x.id === "a1")!.status).toBe("paper");
    expect(acc().autopilot.settings.enabled).toBe(true);
    // the switch-off itself is refused: nothing is closed and the dialog stays
    serveMarket();
    await u.click(screen.getByTestId("autopilot-stop-all"));
    const dialog = await screen.findByTestId("autopilot-stop-dialog");
    await waitFor(() => expect(within(dialog).getByTestId("autopilot-stop-confirm")).toHaveProperty("disabled", false));
    mock.state.sessions.clear();
    await u.click(within(dialog).getByTestId("autopilot-stop-confirm"));
    await waitFor(() => expect(puts()).toHaveLength(2));
    for (const [k, v] of kept) mock.state.sessions.set(k, v);
    await waitFor(() => expect(within(screen.getByTestId("autopilot-stop-dialog")).getByTestId("autopilot-stop-confirm")).toHaveProperty("disabled", false));
    expect(acc().strategies.find((x) => x.id === "a1")!.status).toBe("paper");
    expect(acc().autopilot.settings.enabled).toBe(true);
  });
});

describe("HC-SH-143 Autopilot on the Desk", () => {
  it("HC-SH-143 the status bar always says where Autopilot stands and links to its screen; the P&L shows once every leg has a live price", async () => {
    const off = renderWithProviders(<PortfolioBar />);
    const none = await screen.findByTestId("bar-autopilot");
    expect(none.getAttribute("href")).toBe("/autopilot");
    expect(none.dataset["enabled"]).toBe("false");
    expect(none.textContent).toContain("Off · 0 open");
    off.unmount();
    acc().strategies.push(auto("a1", "pin-butterfly", { legs: [leg("a1", 700)] }), strat("own"));
    acc().autopilot = { settings: { enabled: true, strategies: [{ playbookId: "pin-butterfly", exit: "trail" }] }, runs: [] };
    renderWithProviders(<PortfolioBar />);
    const item = await screen.findByTestId("bar-autopilot");
    await waitFor(() => expect(item.textContent).toContain("On · 1 open"));
    expect(item.dataset["enabled"]).toBe("true");
    expect(within(item).queryByTestId("bar-autopilot-pnl")).toBeNull(); // no quote yet: no figure, not a zero
    serveMarket();
    await waitFor(() => expect(within(item).getByTestId("bar-autopilot-pnl").textContent).toBe("−$7.00"));
  });

  it("HC-SH-143 a Paper card says which trades Autopilot opened and offers no Go live on them", async () => {
    acc().strategies.push(auto("a1", "pin-butterfly"), strat("own"));
    renderWithProviders(<Workspace />);
    act(() => FakeSocket.last().open());
    await waitFor(() => expect(screen.getAllByTestId("paper-card")).toHaveLength(2));
    const cards = screen.getAllByTestId("paper-card");
    const mineCard = cards.find((c) => c.dataset["id"] === "own")!;
    const autoCard = cards.find((c) => c.dataset["id"] === "a1")!;
    expect(within(autoCard).getByTestId("card-autopilot").textContent).toBe("Autopilot");
    expect(within(mineCard).queryByTestId("card-autopilot")).toBeNull();
    const goLive = within(autoCard).getByTestId("card-golive");
    expect(goLive).toHaveProperty("disabled", true);
    expect(goLive.getAttribute("title")).toBe(AUTOPILOT_PAPER_ONLY_MESSAGE);
    expect(within(mineCard).getByTestId("card-golive").getAttribute("title")).not.toBe(AUTOPILOT_PAPER_ONLY_MESSAGE);
  });
});

describe("HC-TR-243 the Autopilot screen: one side after a move", () => {
  it("HC-TR-243 the log says the move an entry was judged on and the side it sold", async () => {
    expect(moveWords("BTC", { pct: "1.56", side: "put" })).toBe("BTC up 1.56 % over 24 hours: the put only");
    expect(moveWords("ETH", { pct: "-1.78", side: "call" })).toBe("ETH down 1.78 % over 24 hours: the call only");
    expect(moveWords("BTC", { pct: "0.4", side: "both" })).toBe("BTC up 0.40 % over 24 hours: both sides");
    acc().autopilot = { settings: { enabled: true, strategies: [{ playbookId: "evening-strangle-one-side", exit: "own" }] }, runs: [run({ id: "3", kind: "skipped", reason: "Holds a trade already: one at a time for a strategy and coin", playbookId: "evening-strangle-one-side", strategyId: null, detail: { dte: 1, move: { pct: "-1.20", side: "call" } } }), run({ id: "2", playbookId: "evening-strangle-one-side", strategyId: "m1", detail: { capital: "40", dte: 1, legStop: 3, move: { pct: "1.56", side: "put" } } }), run({ id: "1" })] };
    renderWithProviders(<AutopilotPage />);
    const log = await screen.findByTestId("autopilot-log");
    await waitFor(() => expect(log.textContent).toContain("BTC up 1.56 % over 24 hours: the put only"));
    // an entry of a strategy without the rule says nothing about a move, and neither does a pass that placed nothing
    expect(log.textContent).toContain("Holds a trade already");
    expect(log.textContent.match(/over 24 hours/g)).toHaveLength(1);
    // the card says how the side is chosen
    const card = screen.getAllByTestId("autopilot-card").find((c) => c.textContent.includes("Evening strangle, one side after a move"))!;
    expect(card.textContent).toContain("Stop at 3x on each sold option");
  });
});

describe("HC-TR-246 the Autopilot screen: the strangle that buys a cheap option back", () => {
  it("HC-TR-246 HC-TR-248 its card says each sold option is bought back once its price is down to 5 dollars, beside the stop; the 20 % one says its share", async () => {
    acc().autopilot = { settings: { enabled: true, strategies: [{ playbookId: "evening-strangle-buy-back", exit: "own" }] }, runs: [] };
    renderWithProviders(<AutopilotPage />);
    await waitFor(() => expect(screen.getAllByTestId("autopilot-card").length).toBeGreaterThan(0));
    const card = screen.getAllByTestId("autopilot-card").find((c) => c.textContent.includes("Evening strangle, buy back at 5 dollars"))!;
    expect(card.textContent).toContain("Stop at 3x on each sold option, each sold option bought back once its price is down to 5 dollars");
    // HC-TR-248: the one at a share of the price says the share
    const share = screen.getAllByTestId("autopilot-card").find((c) => c.textContent.includes("Evening strangle, buy back at 20 % of the price"))!;
    expect(share.textContent).toContain("Stop at 3x on each sold option, each sold option bought back once its price is down to 20 % of what it was sold for");
  });
});

describe("HC-TR-249 the Autopilot screen: the weekly closed at 90 % of the premium", () => {
  it("HC-TR-249 its card reads as a stop at triple and a take at 90 % of the premium", async () => {
    acc().autopilot = { settings: { enabled: true, strategies: [{ playbookId: "weekly-fri-strangle-take-90", exit: "own" }] }, runs: [] };
    renderWithProviders(<AutopilotPage />);
    await waitFor(() => expect(screen.getAllByTestId("autopilot-card").length).toBeGreaterThan(0));
    const card = screen.getAllByTestId("autopilot-card").find((c) => c.textContent.includes("Friday weekly strangle, close at 90 %"))!;
    expect(card.textContent).toContain("Stop at 3x on each sold option, take 90 % of the premium");
  });
});
