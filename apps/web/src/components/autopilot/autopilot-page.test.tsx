// The Autopilot screen (ADR-109; HC-TR-219, HC-TR-220), its item on the Desk's status bar and its tag on a Paper card
// (HC-SH-143), against the in-memory mock API. Paper only: nothing here can place an order.
import { PLAYBOOKS } from "@hapiecoin/pricing";
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
import { AutopilotPage } from "./AutopilotPage";

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
const TRADABLE = PLAYBOOKS.filter((p) => !p.control);

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
    expect(trade("a2").textContent).toContain("no stop: its risk is the premium paid");
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
    expect(screen.getByTestId("autopilot-page").textContent).toContain("up to 5 trades per coin, each on its own strikes");
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
