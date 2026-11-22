// Protect: stop and target rules on a strategy (ADR-059 §2.3; HC-TR-167 arming from the card and after a trade,
// HC-TR-168 the fired state on the card and in Details) against the mock API.
import type { Strategy, StrategyRule } from "@hapiecoin/schema";
import { chainTopic } from "@hapiecoin/schema";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSocket, installMockFetch, renderWithProviders, type MockFetch , typeLiveIf } from "../../../test/helpers";
import { buildChain } from "../../../test/fixtures/chain";
import { useUiStore } from "@/lib/store";
import { Workspace } from "@/components/workspace/Workspace";
import { firedLabel, fromLocalInput, levelText, ruleText, rulesLine, toLocalInput, typedToUsd, usdToTyped } from "./RuleDialog";

const EXPIRY = "2026-09-25";
const TOPIC = chainTopic("delta_india", "BTC", EXPIRY);
const rows = buildChain("BTC", EXPIRY);
const EMAIL = "rules@example.com";
let mock: MockFetch;
const acc = () => mock.state.accounts.get(EMAIL)!;
const mine = () => acc().strategies;

const CALL = { id: "leg_a", kind: "call" as const, side: "buy" as const, strike: "80000", expiry: EXPIRY, symbol: "C-BTC-80000-250926", lots: 10, price: "1200", entryPrice: "1200", exitPrice: null, iv: 0.5, status: "open" as const, isAdjustment: false, position: 0, openedAt: "2026-09-08T10:00:00Z", closedAt: null, orderId: null };
const PUT = { ...CALL, id: "leg_b", kind: "put" as const, side: "sell" as const, strike: "78000", symbol: "P-BTC-78000-250926", price: "900", entryPrice: "900", position: 1 };
function strat(i: number, over: Partial<Strategy> = {}): Strategy {
  const at = `2026-09-0${(i % 8) + 1}T10:00:00Z`;
  return { id: `strat_${i}`, name: `Paper ${i}`, asset: "BTC", venue: "delta_india", status: "paper", tradingMode: "paper", templateName: "Custom", brokerId: "brk_delta", legs: [{ ...CALL, id: `leg_${i}` }], realizedPnl: "0", pnlHistory: [], notes: "", tags: [], orderBatchId: null, orders: [], adjustments: [], rules: [], startedAt: at, closedAt: null, createdAt: at, updatedAt: at, ...over };
}
const USD_FMT = { currency: "USD" as const, rate: "1" };
const rule = (over: Partial<StrategyRule> = {}): StrategyRule => ({ id: "rule_1", kind: "stop", trigger: "money", value: "60", basis: null, basisUsd: null, thresholdUsd: "-60", legId: null, scope: "strategy", channels: ["push"], state: "armed", firedAt: null, firedPnl: null, outcome: null, note: null, createdAt: "2026-09-10T10:00:00Z", updatedAt: "2026-09-10T10:00:00Z", ...over });
function serveMarket() {
  const ws = FakeSocket.last();
  act(() => {
    ws.open();
    ws.receive({ t: "spot", s: "BTC", p: "79521", c24: 0.4 });
    ws.receive({ t: "snap", topic: TOPIC, seq: 0, rows });
  });
}

beforeEach(() => {
  FakeSocket.reset();
  mock = installMockFetch();
  mock.loginAs(EMAIL);
  HTMLCanvasElement.prototype.getContext = vi.fn(() => new Proxy({} as CanvasRenderingContext2D, { get: () => () => undefined, set: () => true })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  useUiStore.setState({
    asset: "BTC",
    expiry: { BTC: EXPIRY },
    legs: { BTC: [], ETH: [], XAUT: [] },
    strategy: { BTC: { name: "", basket: false, priceMode: "live", draftId: null }, ETH: { name: "", basket: false, priceMode: "live", draftId: null }, XAUT: { name: "", basket: false, priceMode: "live", draftId: null } },
    tradeFlow: null,
    rulesFor: null,
    protectPrompt: true,
    detailsId: null,
    workspaceTab: "paper",
    dialog: null,
  });
});
afterEach(() => {
  mock.restore();
});

describe("HC-TR-167 Protect from the card", () => {
  it("arms a money stop and a percentage target of the credit, shows both units, and the card carries the line", async () => {
    const u = userEvent.setup();
    mine().push(strat(1, { legs: [{ ...CALL, id: "l1" }, { ...PUT, id: "l2" }] })); // credit 9 − 12 = −3: a debit strategy
    renderWithProviders(<Workspace />);
    serveMarket();
    await waitFor(() => expect(screen.getByTestId("card-rules").dataset["state"]).toBe("none"));
    expect(screen.getByTestId("card-rules").textContent).toBe("no stop");
    await u.click(screen.getByTestId("card-protect"));
    const dlg = await screen.findByTestId("rule-dialog");
    expect(dlg.dataset["afterTrade"]).toBe("false");
    // stop: 5 USD
    await u.click(within(dlg).getByTestId("rule-stop-on"));
    fireEvent.change(within(dlg).getByTestId("rule-stop-value"), { target: { value: "5" } });
    await waitFor(() => expect(within(dlg).getByTestId("rule-stop-level").textContent).toContain("−$5.00"));
    // target: 50 % of the debit paid (the credit basis is not known for a debit strategy)
    await u.click(within(dlg).getByTestId("rule-target-on"));
    await u.click(within(dlg).getByTestId("rule-target-pct"));
    const basis = within(dlg).getByTestId<HTMLSelectElement>("rule-target-basis");
    expect(basis.value).toBe("debit");
    expect(within(basis).getByText(/of the credit received/).closest("option")?.disabled).toBe(true);
    fireEvent.change(within(dlg).getByTestId("rule-target-value"), { target: { value: "50" } });
    await waitFor(() => expect(within(dlg).getByTestId("rule-target-level").textContent).toContain("+$1.50")); // 50 % of the 3 USD debit
    expect(within(dlg).getByTestId("rule-arm").textContent).toBe("Arm stop loss + target");
    await u.click(within(dlg).getByTestId("rule-arm"));
    await waitFor(() => expect(screen.queryByTestId("rule-dialog")).toBeNull());
    const armed = mine()[0]!.rules!;
    expect(armed.map((r) => [r.kind, r.trigger, r.value, r.thresholdUsd, r.basis, r.basisUsd])).toEqual([
      ["stop", "money", "5", "-5", null, null],
      ["target", "pct", "50", "1.5", "debit", "3"],
    ]);
    await waitFor(() => expect(screen.getByTestId("card-rules").textContent).toBe("stop at −$5.00 · target at +$1.50 (50 %)"));
    expect(screen.getByTestId("card-protect").textContent).toBe("Protect…");
    // reopen: the drafts are seeded from the armed rules; Disarm all clears them
    await u.click(screen.getByTestId("card-protect"));
    const again = await screen.findByTestId("rule-dialog");
    expect(within(again).getByTestId<HTMLInputElement>("rule-stop-value").value).toBe("5");
    await u.click(within(again).getByTestId("rule-disarm"));
    await waitFor(() => expect(screen.queryByTestId("rule-dialog")).toBeNull());
    await waitFor(() => expect(screen.getByTestId("card-rules").dataset["state"]).toBe("none"));
    expect(mine()[0]!.rules).toEqual([]);
  });

  it("the Protect step follows a paper trade from the Builder and can be skipped; the preference turns it off", async () => {
    const u = userEvent.setup();
    useUiStore.setState({ workspaceTab: "builder" });
    useUiStore.getState().addLeg({ asset: "BTC", kind: "call", side: "buy", strike: "80000", expiry: EXPIRY, lots: 10, price: "1200", iv: 0.5 });
    renderWithProviders(<Workspace />);
    serveMarket();
    await u.click(await screen.findByTestId("builder-paper-trade"));
    await u.click(await screen.findByTestId("trade-continue"));
    await typeLiveIf(u, await screen.findByTestId("trade-preview"));
    await u.click(await screen.findByTestId("trade-now"));
    const name = await screen.findByTestId("save-draft-dialog");
    await u.click(within(name).getByTestId("save-draft-confirm"));
    const dlg = await screen.findByTestId("rule-dialog", {}, { timeout: 5000 });
    expect(dlg.dataset["afterTrade"]).toBe("true");
    expect(within(dlg).getByTestId("rule-skip")).toBeTruthy();
    await u.click(within(dlg).getByTestId("rule-no-prompt"));
    expect(useUiStore.getState().protectPrompt).toBe(false);
    await u.click(within(dlg).getByTestId("rule-skip"));
    await waitFor(() => expect(screen.queryByTestId("rule-dialog")).toBeNull());
    expect(mine()[0]!.rules ?? []).toEqual([]);
  });
});

describe("HC-TR-167 money in the trader's currency", () => {
  it("a level typed in INR is stored in USD and comes back in INR", () => {
    const inr = { currency: "INR" as const, rate: "83" };
    expect(typedToUsd("830", inr)).toBeCloseTo(10);
    expect(usdToTyped("10", inr)).toBe("830");
    expect(usdToTyped("10", { currency: "USD", rate: "1" })).toBe("10");
    expect(levelText(-60, inr)).toMatch(/^[−-]₹4,980\.00 \([−-]\$60\.00\)$/);
  });
});

describe("HC-TR-168 fired rules", () => {
  it("the card shows a fired stop and names a leg still open; Details lists every rule with its state and note", async () => {
    const u = userEvent.setup();
    mine().push(
      strat(1, {
        status: "live",
        tradingMode: "live",
        name: "Stopped one",
        legs: [{ ...CALL, id: "l1", status: "squared_off", exitPrice: "700", closeReason: "stopped", closedAt: "2026-09-11T10:00:00Z" }, { ...PUT, id: "l2" }],
        rules: [rule({ state: "fired", firedAt: "2026-09-11T10:00:00Z", firedPnl: "-5", outcome: "partial", note: "Stop loss fired at P&L -5 USD: 1 exited, 1 still open: P-BTC-78000-250926 (insufficient_margin)" }), rule({ id: "rule_2", kind: "target", thresholdUsd: "50", state: "disarmed", note: "disarmed: the stop loss fired" })],
      }),
    );
    useUiStore.setState({ workspaceTab: "live" });
    renderWithProviders(<Workspace />);
    serveMarket();
    const chip = await screen.findByTestId("card-rule-fired");
    expect(chip.textContent).toBe("stop fired · a leg still open");
    expect(chip.dataset["outcome"]).toBe("partial");
    expect(screen.getByTestId("card-rules").dataset["state"]).toBe("none"); // nothing armed any more
    await u.click(screen.getByTestId("card-details"));
    const details = await screen.findByTestId("strategy-details");
    const rulesList = within(details).getByTestId("details-rules");
    expect(within(rulesList).getAllByTestId("details-rule").map((r) => [r.dataset["kind"], r.dataset["state"]])).toEqual([
      ["stop", "fired"],
      ["target", "disarmed"],
    ]);
    expect(rulesList.textContent).toContain("1 still open: P-BTC-78000-250926");
  });
});

describe("HC-TR-171 leg stop, spot level and time exit from the dialog; the workbench entry", () => {
  it("arms a leg stop on the short put, a spot level and a days-to-expiry exit; the card line names them", async () => {
    const u = userEvent.setup();
    mine().push(strat(1, { legs: [{ ...CALL, id: "l1" }, { ...PUT, id: "l2" }] }));
    renderWithProviders(<Workspace />);
    serveMarket();
    await u.click(await screen.findByTestId("card-protect"));
    const dlg = await screen.findByTestId("rule-dialog");
    // the short put: twice its 900 entry, this leg only
    await u.click(within(dlg).getByTestId("rule-leg-l2-on"));
    fireEvent.change(within(dlg).getByTestId("rule-leg-l2-value"), { target: { value: "2" } });
    await waitFor(() => expect(within(dlg).getByTestId("rule-leg-l2-level").textContent).toContain("= 1,800.0"));
    expect(within(dlg).getByTestId<HTMLSelectElement>("rule-leg-l2-scope").value).toBe("leg");
    // spot at or above 70,000 is already true at 79,521: refused until the level is above the market
    await u.click(within(dlg).getByTestId("rule-spot-on"));
    await u.click(within(dlg).getByTestId("rule-spot-above"));
    fireEvent.change(within(dlg).getByTestId("rule-spot-value"), { target: { value: "70000" } });
    expect(within(dlg).getByTestId("rule-spot-level").textContent).toBe("now 79,521");
    await waitFor(() => expect(within(dlg).getByTestId<HTMLButtonElement>("rule-arm").disabled).toBe(true));
    expect(dlg.textContent).toContain("That level is already crossed");
    fireEvent.change(within(dlg).getByTestId("rule-spot-value"), { target: { value: "82000" } });
    await waitFor(() => expect(within(dlg).getByTestId<HTMLButtonElement>("rule-arm").disabled).toBe(false));
    // one day to the nearest expiry
    await u.click(within(dlg).getByTestId("rule-time-on"));
    await u.click(within(dlg).getByTestId("rule-time-dte"));
    fireEvent.change(within(dlg).getByTestId("rule-time-value"), { target: { value: "1" } });
    expect(within(dlg).getByTestId("rule-time-level").textContent).toContain("nearest expiry 25 Sep");
    expect(within(dlg).getByTestId("rule-arm").textContent).toBe("Arm leg stop + spot level + time exit");
    await u.click(within(dlg).getByTestId("rule-arm"));
    await waitFor(() => expect(screen.queryByTestId("rule-dialog")).toBeNull());
    expect(mine()[0]!.rules!.map((r) => [r.kind, r.trigger, r.value, r.thresholdUsd, r.legId, r.scope])).toEqual([
      ["leg_stop", "multiple", "2", "1800", "l2", "leg"],
      ["spot", "above", "82000", "82000", null, "strategy"],
      ["time", "dte", "1", "1", null, "strategy"],
    ]);
    await waitFor(() => expect(screen.getByTestId("card-rules").textContent).toBe("S P 78,000 25 Sep stop at 1,800.0 (2× entry) · spot ≥ 82,000 · exit at 1 day to expiry"));
    // reopen: the drafts come back from the armed rules
    await u.click(screen.getByTestId("card-protect"));
    const again = await screen.findByTestId("rule-dialog");
    expect(within(again).getByTestId<HTMLInputElement>("rule-leg-l2-value").value).toBe("2");
    expect(within(again).getByTestId<HTMLInputElement>("rule-spot-value").value).toBe("82000");
    expect(within(again).getByTestId<HTMLInputElement>("rule-time-value").value).toBe("1");
  });

  it("HC-TR-199 a calendar arms an exit before the nearest expiry settles: the instant is shown, the card names it, the draft comes back", async () => {
    // a put calendar: the sold 25 Sep leg settles first (12:00 UTC); the far leg would otherwise stay open after settlement
    const FAR = { ...PUT, id: "leg_far", side: "buy" as const, expiry: "2026-10-02", symbol: "P-BTC-78000-021026", price: "1100", entryPrice: "1100", position: 1 };
    mine().push(strat(5, { name: "Calendar", legs: [{ ...PUT, id: "leg_near", position: 0 }, FAR] }));
    const u = userEvent.setup();
    renderWithProviders(<Workspace />);
    serveMarket();
    await u.click(await screen.findByTestId("card-protect"));
    const dlg = await screen.findByTestId("rule-dialog");
    await u.click(within(dlg).getByTestId("rule-time-on"));
    await u.click(within(dlg).getByTestId("rule-time-settle"));
    // the lead defaults to 15 minutes and the instant is 11:45 UTC on 25 Sep, shown on the trader's clock
    expect(within(dlg).getByTestId<HTMLInputElement>("rule-time-value").value).toBe("15");
    expect(within(dlg).getByTestId("rule-time-level").textContent).toContain("25 Sep settles");
    expect(within(dlg).getByTestId("rule-time-level").textContent).toContain(new Date(Date.UTC(2026, 8, 25, 11, 45)).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }));
    // out of range refused, back in range armed
    fireEvent.change(within(dlg).getByTestId("rule-time-value"), { target: { value: "0" } });
    await waitFor(() => expect(within(dlg).getByTestId<HTMLButtonElement>("rule-arm").disabled).toBe(true));
    fireEvent.change(within(dlg).getByTestId("rule-time-value"), { target: { value: "20" } });
    await waitFor(() => expect(within(dlg).getByTestId<HTMLButtonElement>("rule-arm").disabled).toBe(false));
    await u.click(within(dlg).getByTestId("rule-arm"));
    await waitFor(() => expect(screen.queryByTestId("rule-dialog")).toBeNull());
    expect(mine()[0]!.rules!.map((r) => [r.kind, r.trigger, r.value, r.thresholdUsd])).toEqual([["time", "settle", "20", String(Date.UTC(2026, 8, 25, 11, 40))]]);
    await waitFor(() => expect(screen.getByTestId("card-rules").textContent).toContain("exit all legs 20 min before expiry settles"));
    await u.click(screen.getByTestId("card-protect"));
    const again = await screen.findByTestId("rule-dialog");
    expect(within(again).getByTestId("rule-time-settle").getAttribute("aria-pressed")).toBe("true");
    expect(within(again).getByTestId<HTMLInputElement>("rule-time-value").value).toBe("20");
  });

  it("HC-TR-199 with no dated leg the settle unit says so and cannot be armed", async () => {
    const FUT = { ...CALL, id: "leg_fut", kind: "future" as const, strike: "", expiry: "PERP", symbol: "BTCUSD", price: "79000", entryPrice: "79000", position: 0 };
    mine().push(strat(6, { name: "Perp only", legs: [FUT] }));
    const u = userEvent.setup();
    renderWithProviders(<Workspace />);
    serveMarket();
    await u.click(await screen.findByTestId("card-protect"));
    const dlg = await screen.findByTestId("rule-dialog");
    await u.click(within(dlg).getByTestId("rule-time-on"));
    await u.click(within(dlg).getByTestId("rule-time-settle"));
    expect(within(dlg).getByTestId<HTMLInputElement>("rule-time-value").disabled).toBe(true);
    expect(within(dlg).getByTestId("rule-time-level").textContent).toBe("no dated leg to count to");
    await waitFor(() => expect(within(dlg).getByTestId<HTMLButtonElement>("rule-arm").disabled).toBe(true));
    expect(dlg.textContent).toContain("No dated leg to count to");
  });

  it("an exit at a time is typed on the trader's clock, stored as an instant and refused when it has passed", () => {
    const iso = "2026-09-12T11:30:00.000Z";
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
    expect(fromLocalInput("")).toBeNull();
    expect(toLocalInput("nonsense")).toBe("");
    expect(ruleText(rule({ kind: "time", trigger: "dte", value: "3", thresholdUsd: "3" }), USD_FMT)).toBe("exit at 3 days to expiry");
    expect(ruleText(rule({ kind: "spot", trigger: "below", value: "78000", thresholdUsd: "78000" }), USD_FMT)).toBe("spot ≤ 78,000");
    expect(ruleText(rule({ kind: "leg_stop", trigger: "price", value: "150", thresholdUsd: "150", legId: "leg_b", scope: "strategy" }), USD_FMT, [CALL, PUT])).toBe("S P 78,000 25 Sep stop at 150.00, exits all");
    expect(ruleText(rule({ kind: "leg_stop", trigger: "price", value: "150", thresholdUsd: "150", legId: "gone", scope: "leg" }), USD_FMT, [CALL, PUT])).toBe("leg stop at 150.00");
  });

  it("the workbench carries the Protect entry beside the alert line", async () => {
    const u = userEvent.setup();
    mine().push(strat(1, { legs: [{ ...CALL, id: "l1" }, { ...PUT, id: "l2" }] }));
    renderWithProviders(<Workspace />);
    serveMarket();
    const card = await screen.findByTestId("paper-card");
    await u.click(within(card).getByTestId("card-adjust"));
    const wb = await screen.findByTestId("adjust-workbench");
    serveMarket(); // the workbench subscribes to the chain when it mounts
    expect(within(wb).getByTestId("risk-protect").textContent).toContain("No exit rule");
    expect(within(wb).getByTestId("adjust-protect").textContent).toBe("Protect");
    await u.click(within(wb).getByTestId("adjust-protect"));
    expect(await screen.findByTestId("rule-dialog")).toBeTruthy();
  });
});

describe("HC-TR-211 a target that trails (ADR-103)", () => {
  it("the Target box takes a give-back, shows two worked exit levels, refuses a give-back that is not below the target, and the card names the trail", async () => {
    const u = userEvent.setup();
    mine().push(strat(1, { legs: [{ ...CALL, id: "l1" }, { ...PUT, id: "l2" }] }));
    renderWithProviders(<Workspace />);
    serveMarket();
    await u.click(await screen.findByTestId("card-protect"));
    const dlg = await screen.findByTestId("rule-dialog");
    await u.click(within(dlg).getByTestId("rule-target-on"));
    fireEvent.change(within(dlg).getByTestId("rule-target-value"), { target: { value: "6" } });
    await waitFor(() => expect(within(dlg).getByTestId("rule-target-level").textContent).toContain("+$6.00"));
    // off by default: a fixed target, as before
    expect(within(dlg).getByTestId("rule-target-trail").dataset["on"]).toBe("false");
    expect(within(dlg).queryByTestId("rule-target-trail-value")).toBeNull();
    expect(within(dlg).getByTestId("rule-target").textContent).toContain("exit all when P&L reaches");
    await u.click(within(dlg).getByTestId("rule-target-trail-on"));
    expect(within(dlg).getByTestId("rule-target").textContent).toContain("start trailing when P&L reaches");
    // nothing typed yet: no level to show, and nothing to arm
    expect(within(dlg).getByTestId("rule-target-trail-preview").textContent).toBe("Enter the target and the give-back to see the exit level.");
    await waitFor(() => expect(within(dlg).getByTestId<HTMLButtonElement>("rule-arm").disabled).toBe(true));
    expect(dlg.textContent).toContain("Enter a give-back greater than 0");
    // a give-back as large as the target would put the exit at nothing
    fireEvent.change(within(dlg).getByTestId("rule-target-trail-value"), { target: { value: "6" } });
    await waitFor(() => expect(dlg.textContent).toContain("The give-back must be below the target"));
    expect(within(dlg).getByTestId<HTMLButtonElement>("rule-arm").disabled).toBe(true);
    fireEvent.change(within(dlg).getByTestId("rule-target-trail-value"), { target: { value: "3" } });
    await waitFor(() => expect(within(dlg).getByTestId("rule-target-trail-preview").textContent).toBe("Nothing happens below +$6.00. At +$6.00 the exit is set at +$3.00. If the profit reaches +$12.00 the exit moves up to +$9.00. The exit never moves down."));
    await u.click(within(dlg).getByTestId("rule-arm"));
    await waitFor(() => expect(screen.queryByTestId("rule-dialog")).toBeNull());
    expect(mine()[0]!.rules!.map((r) => [r.kind, r.trigger, r.value, r.thresholdUsd, r.trail, r.peakPnl])).toEqual([["target", "money", "6", "6", { trigger: "money", value: "3" }, null]]);
    await waitFor(() => expect(screen.getByTestId("card-rules").textContent).toBe("target at +$6.00, then trail $3.00"));
    // reopen: the trail comes back; a percentage is taken from the best and stays below 100
    await u.click(screen.getByTestId("card-protect"));
    const again = await screen.findByTestId("rule-dialog");
    expect(within(again).getByTestId<HTMLInputElement>("rule-target-trail-value").value).toBe("3");
    await u.click(within(again).getByTestId("rule-target-trail-pct"));
    fireEvent.change(within(again).getByTestId("rule-target-trail-value"), { target: { value: "100" } });
    await waitFor(() => expect(within(again).getByTestId<HTMLButtonElement>("rule-arm").disabled).toBe(true));
    fireEvent.change(within(again).getByTestId("rule-target-trail-value"), { target: { value: "25" } });
    await waitFor(() => expect(within(again).getByTestId("rule-target-trail-preview").textContent).toContain("At +$6.00 the exit is set at +$4.50. If the profit reaches +$12.00 the exit moves up to +$9.00."));
    await u.click(within(again).getByTestId("rule-arm"));
    await waitFor(() => expect(screen.queryByTestId("rule-dialog")).toBeNull());
    expect(mine()[0]!.rules![0]!.trail).toEqual({ trigger: "pct", value: "25" });
    await waitFor(() => expect(screen.getByTestId("card-rules").textContent).toBe("target at +$6.00, then trail 25 %"));
    // unticking the trail arms a fixed target again
    await u.click(screen.getByTestId("card-protect"));
    const third = await screen.findByTestId("rule-dialog");
    await u.click(within(third).getByTestId("rule-target-trail-on"));
    await u.click(within(third).getByTestId("rule-arm"));
    await waitFor(() => expect(screen.queryByTestId("rule-dialog")).toBeNull());
    expect(mine()[0]!.rules![0]!.trail).toBeNull();
    await waitFor(() => expect(screen.getByTestId("card-rules").textContent).toBe("target at +$6.00"));
  });

  it("once past the target the card shows the best and the exit level; a target that trailed says so on its chip and in Details", async () => {
    const u = userEvent.setup();
    const trailing = rule({ id: "rule_2", kind: "target", value: "6", thresholdUsd: "6", trail: { trigger: "money", value: "3" }, peakPnl: "18" });
    mine().push(strat(1, { legs: [{ ...CALL, id: "l1" }, { ...PUT, id: "l2" }], rules: [rule({ kind: "target", value: "6", thresholdUsd: "6", trail: { trigger: "money", value: "3" }, peakPnl: "18", state: "fired", firedAt: "2026-09-11T10:00:00Z", firedPnl: "15", outcome: "closed", note: "Target fired at P&L 15 USD (trailed from the best 18 USD, exit level 15 USD): 1 leg exited" }), trailing] }));
    renderWithProviders(<Workspace />);
    serveMarket();
    await waitFor(() => expect(screen.getByTestId("card-rules").textContent).toBe("trailing: best +$18.00, exits at +$15.00"));
    expect(screen.getByTestId("card-rule-fired").textContent).toBe("target hit · trailed from +$18.00");
    await u.click(screen.getByTestId("card-details"));
    const list = within(await screen.findByTestId("strategy-details")).getByTestId("details-rules");
    expect(list.textContent).toContain("target at +$6.00, then trail $3.00, best +$18.00"); // the fired one keeps how far it ran
    expect(list.textContent).toContain("trailing: best +$18.00, exits at +$15.00");
  });

  it("with a trail already running the preview says where the exit stands, refuses a tighter exit the P&L is already under, and says when a higher target starts over", async () => {
    const u = userEvent.setup();
    // realised +1,000 and a few dollars on the open legs; the best was +2,000 with 90 % given back: exit +200
    mine().push(strat(1, { realizedPnl: "1000", legs: [{ ...CALL, id: "l1" }, { ...PUT, id: "l2" }], rules: [rule({ kind: "target", value: "6", thresholdUsd: "6", trail: { trigger: "pct", value: "90" }, peakPnl: "2000" })] }));
    renderWithProviders(<Workspace />);
    serveMarket();
    const protect = await screen.findByTestId("card-protect");
    serveMarket(); // the held legs subscribe once the strategy has loaded: their marks arrive with this snapshot
    await u.click(protect);
    const dlg = await screen.findByTestId("rule-dialog");
    const preview = () => within(dlg).getByTestId("rule-target-trail-preview").textContent;
    await waitFor(() => expect(preview()).toBe("Already trailing: the best so far is +$2,000.00, so the exit is +$200.00 from the moment you arm. It never moves down."));
    expect(within(dlg).getByTestId<HTMLButtonElement>("rule-arm").disabled).toBe(false);
    // 10 % given back would put the exit at +1,800, above today's P&L: it would fire at once
    fireEvent.change(within(dlg).getByTestId("rule-target-trail-value"), { target: { value: "10" } });
    await waitFor(() => expect(dlg.textContent).toContain("That level is already crossed"));
    expect(within(dlg).getByTestId<HTMLButtonElement>("rule-arm").disabled).toBe(true);
    // a target above the best: the trail starts over and waits for it
    fireEvent.change(within(dlg).getByTestId("rule-target-value"), { target: { value: "3000" } });
    await waitFor(() => expect(preview()).toBe("The target is above the best so far (+$2,000.00), so the trail starts over. Nothing happens below +$3,000.00. At +$3,000.00 the exit is set at +$2,700.00. If the profit reaches +$6,000.00 the exit moves up to +$5,400.00. The exit never moves down."));
    expect(within(dlg).getByTestId<HTMLButtonElement>("rule-arm").disabled).toBe(false);
  });

  it("when the P&L is already past the target the preview says the trail starts on arming; the server keeps a running best across a save", async () => {
    const u = userEvent.setup();
    mine().push(strat(1, { realizedPnl: "1000", legs: [{ ...CALL, id: "l1" }, { ...PUT, id: "l2" }] }));
    renderWithProviders(<Workspace />);
    serveMarket();
    const protect = await screen.findByTestId("card-protect");
    serveMarket(); // the marks of the held legs
    await u.click(protect);
    const dlg = await screen.findByTestId("rule-dialog");
    await u.click(within(dlg).getByTestId("rule-target-on"));
    fireEvent.change(within(dlg).getByTestId("rule-target-value"), { target: { value: "6" } });
    await u.click(within(dlg).getByTestId("rule-target-trail-on"));
    fireEvent.change(within(dlg).getByTestId("rule-target-trail-value"), { target: { value: "3" } });
    await waitFor(() => expect(within(dlg).getByTestId("rule-target-trail-preview").textContent).toMatch(/^P&L is already \+\$[\d,.]+: the trail starts as soon as you arm, with the exit at \+\$[\d,.]+\. The exit never moves down\.$/));
    await u.click(within(dlg).getByTestId("rule-arm"));
    await waitFor(() => expect(screen.queryByTestId("rule-dialog")).toBeNull());
    // the engine has since seen a best of +1,200; adding a stop beside the target keeps it
    mine()[0]!.rules![0]!.peakPnl = "1200";
    await u.click(screen.getByTestId("card-protect"));
    const again = await screen.findByTestId("rule-dialog");
    await u.click(within(again).getByTestId("rule-stop-on"));
    fireEvent.change(within(again).getByTestId("rule-stop-value"), { target: { value: "5" } });
    await u.click(within(again).getByTestId("rule-arm"));
    await waitFor(() => expect(screen.queryByTestId("rule-dialog")).toBeNull());
    expect(mine()[0]!.rules!.find((r) => r.kind === "target")).toMatchObject({ trail: { trigger: "money", value: "3" }, peakPnl: "1200" });
  });

  it("the words in the trader's currency and for a percentage give-back; a fixed target keeps its old chip", () => {
    const inr = { currency: "INR" as const, rate: "100" };
    const t = rule({ kind: "target", trigger: "pct", value: "50", basis: "credit", basisUsd: "12", thresholdUsd: "6", trail: { trigger: "pct", value: "25" } });
    expect(ruleText(t, USD_FMT)).toBe("target at +$6.00 (50 %), then trail 25 %");
    expect(ruleText({ ...t, peakPnl: "20" }, USD_FMT)).toBe("trailing: best +$20.00, exits at +$15.00");
    expect(ruleText(rule({ kind: "target", value: "6", thresholdUsd: "6", trail: { trigger: "money", value: "3" } }), inr)).toMatch(/^target at \+₹600\.00 \(\+\$6\.00\), then trail ₹300\.00$/);
    expect(firedLabel({ ...t, state: "fired", peakPnl: "20" }, USD_FMT)).toBe("target hit · trailed from +$20.00");
    expect(firedLabel(rule({ kind: "target", thresholdUsd: "6", state: "fired" }), USD_FMT)).toBe("target hit");
    expect(firedLabel(rule({ state: "fired" }), USD_FMT)).toBe("stop fired");
  });
});

describe("HC-TR-172 re-enter", () => {
  it("Re-enter on a closed card makes a fresh draft of the position it held at the close and opens the paper trade dialog on it; a settled position cannot", async () => {
    const u = userEvent.setup();
    const closedAt = "2026-09-11T10:00:00Z";
    mine().push(
      strat(1, {
        name: "Stopped one",
        status: "archived",
        closedAt,
        closeReason: "stopped",
        legs: [
          { ...CALL, id: "l1", status: "squared_off", exitPrice: "700", closeReason: "stopped", closedAt },
          // four lots of the put were taken off earlier: not part of the position at the close
          { ...PUT, id: "l0", lots: 4, status: "squared_off", exitPrice: "880", closeReason: "squared_off", closedAt: "2026-09-10T10:00:00Z", position: 1 },
          { ...PUT, id: "l2", lots: 6, status: "squared_off", exitPrice: "950", closeReason: "stopped", closedAt, position: 2 },
        ],
      }),
    );
    mine().push(strat(2, { name: "Long gone", status: "archived", closedAt, closeReason: "expired", legs: [{ ...CALL, id: "l3", expiry: "2026-09-04", symbol: "C-BTC-80000-040926", status: "squared_off", exitPrice: "0", closeReason: "expired", closedAt }] }));
    renderWithProviders(<Workspace />);
    serveMarket();
    await u.click(await screen.findByTestId("paper-life-closed"));
    const cards = await screen.findAllByTestId("paper-card");
    const gone = cards.find((c) => c.textContent?.includes("Long gone"))!;
    expect(within(gone).getByTestId<HTMLButtonElement>("card-reenter").disabled).toBe(true);
    expect(within(gone).getByTestId("card-reenter").dataset["expired"]).toBe("true");
    const card = cards.find((c) => c.textContent?.includes("Stopped one"))!;
    expect(within(card).getByTestId("card-close-reason").textContent).toBe("stopped");
    expect(within(card).getByTestId<HTMLButtonElement>("card-reenter").disabled).toBe(false);
    await u.click(within(card).getByTestId("card-reenter"));
    await waitFor(() => expect(mine()).toHaveLength(3));
    const draft = mine().find((x) => x.status === "draft")!;
    expect(draft).toMatchObject({ status: "draft", name: "Stopped one re-entry", asset: "BTC" });
    expect(draft.legs.map((l) => [l.kind, l.side, l.symbol, l.lots])).toEqual([
      ["call", "buy", "C-BTC-80000-250926", 10],
      ["put", "sell", "P-BTC-78000-250926", 6],
    ]);
    const mode = await screen.findByTestId("trade-mode");
    expect(within(mode).getByTestId("mode-paper").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("HC-TR-213 a leg stop that trails the rest (ADR-104)", () => {
  const trailOf = (id = "l2") => mine()[0]!.rules!.filter((r) => r.state === "armed" && r.legId === id).map((r) => [r.kind, r.scope, r.trail ?? null]);

  it("the third What to exit takes a give-back (10 % by default, or money), says where the other legs would exit, and the card names it; the two old choices send what they always sent", async () => {
    const u = userEvent.setup();
    // the other leg, a call bought at 1: far in profit at any mark the chain serves
    mine().push(strat(1, { legs: [{ ...CALL, id: "l1", price: "1", entryPrice: "1" }, { ...PUT, id: "l2" }] }));
    renderWithProviders(<Workspace />);
    serveMarket();
    await u.click(await screen.findByTestId("card-protect"));
    let dlg = await screen.findByTestId("rule-dialog");
    await u.click(within(dlg).getByTestId("rule-leg-l2-on"));
    fireEvent.change(within(dlg).getByTestId("rule-leg-l2-value"), { target: { value: "5" } });
    expect(within(dlg).queryByTestId("rule-leg-l2-trail")).toBeNull(); // nothing new until it is chosen
    fireEvent.change(within(dlg).getByTestId("rule-leg-l2-scope"), { target: { value: "trail" } });
    serveMarket(); // the legs are subscribed by now: their marks arrive
    expect(within(dlg).getByTestId<HTMLInputElement>("rule-leg-l2-trail-value").value).toBe("10");
    expect(within(dlg).getByTestId("rule-leg-l2-trail-pct").getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(within(dlg).getByTestId("rule-leg-l2-trail-preview").textContent).toMatch(/^The other legs are \+\$[\d,.]+ now\. If they stand there when this stop fires, they exit together at \+\$[\d,.]+\. The exit follows their best profit up and never moves down; their own stops stay armed\.$/));
    await u.click(within(dlg).getByTestId("rule-arm"));
    await waitFor(() => expect(screen.queryByTestId("rule-dialog")).toBeNull());
    expect(trailOf()).toEqual([["leg_stop", "leg", { trigger: "pct", value: "10" }]]);
    await waitFor(() => expect(screen.getByTestId("card-rules").textContent).toBe("S P 78,000 25 Sep stop at 4,500.0 (5× entry), then trail the rest by 10 %"));
    // reopen: the choice and the give-back come back; money needs its amount, 100 % is everything
    await u.click(screen.getByTestId("card-protect"));
    dlg = await screen.findByTestId("rule-dialog");
    expect(within(dlg).getByTestId<HTMLSelectElement>("rule-leg-l2-scope").value).toBe("trail");
    expect(within(dlg).getByTestId<HTMLInputElement>("rule-leg-l2-trail-value").value).toBe("10");
    fireEvent.change(within(dlg).getByTestId("rule-leg-l2-trail-value"), { target: { value: "100" } });
    await waitFor(() => expect(within(dlg).getByTestId<HTMLButtonElement>("rule-arm").disabled).toBe(true));
    expect(within(dlg).getByTestId("rule-leg-l2-trail-preview").textContent).toBe("Enter a give-back greater than 0 (a percentage below 100).");
    await u.click(within(dlg).getByTestId("rule-leg-l2-trail-money"));
    expect(within(dlg).getByTestId<HTMLInputElement>("rule-leg-l2-trail-value").value).toBe("");
    expect(within(dlg).getByTestId<HTMLButtonElement>("rule-arm").disabled).toBe(true);
    fireEvent.change(within(dlg).getByTestId("rule-leg-l2-trail-value"), { target: { value: "2" } });
    await waitFor(() => expect(within(dlg).getByTestId<HTMLButtonElement>("rule-arm").disabled).toBe(false));
    await u.click(within(dlg).getByTestId("rule-arm"));
    await waitFor(() => expect(screen.queryByTestId("rule-dialog")).toBeNull());
    expect(trailOf()).toEqual([["leg_stop", "leg", { trigger: "money", value: "2" }]]);
    await waitFor(() => expect(screen.getByTestId("card-rules").textContent).toContain("then trail the rest by $2.00"));
    // money comes back as typed; back on % the default returns; the old choices carry no give-back at all
    await u.click(screen.getByTestId("card-protect"));
    dlg = await screen.findByTestId("rule-dialog");
    expect(within(dlg).getByTestId<HTMLInputElement>("rule-leg-l2-trail-value").value).toBe("2");
    await u.click(within(dlg).getByTestId("rule-leg-l2-trail-pct"));
    expect(within(dlg).getByTestId<HTMLInputElement>("rule-leg-l2-trail-value").value).toBe("10");
    fireEvent.change(within(dlg).getByTestId("rule-leg-l2-scope"), { target: { value: "strategy" } });
    expect(within(dlg).queryByTestId("rule-leg-l2-trail")).toBeNull();
    await u.click(within(dlg).getByTestId("rule-arm"));
    await waitFor(() => expect(screen.queryByTestId("rule-dialog")).toBeNull());
    expect(trailOf()).toEqual([["leg_stop", "strategy", null]]);
    await u.click(screen.getByTestId("card-protect"));
    dlg = await screen.findByTestId("rule-dialog");
    expect(within(dlg).getByTestId<HTMLSelectElement>("rule-leg-l2-scope").value).toBe("strategy");
    fireEvent.change(within(dlg).getByTestId("rule-leg-l2-scope"), { target: { value: "leg" } });
    await u.click(within(dlg).getByTestId("rule-arm"));
    await waitFor(() => expect(screen.queryByTestId("rule-dialog")).toBeNull());
    expect(trailOf()).toEqual([["leg_stop", "leg", null]]);
  });

  it("a percentage says it waits while the other legs are under water; without their marks the line stays general", async () => {
    const u = userEvent.setup();
    // the other leg, a call bought at 99,999: under water at any mark
    mine().push(strat(1, { legs: [{ ...CALL, id: "l1", price: "99999", entryPrice: "99999" }, { ...PUT, id: "l2" }] }));
    renderWithProviders(<Workspace />);
    await u.click(await screen.findByTestId("card-protect")); // before any mark arrives
    const dlg = await screen.findByTestId("rule-dialog");
    await u.click(within(dlg).getByTestId("rule-leg-l2-on"));
    fireEvent.change(within(dlg).getByTestId("rule-leg-l2-value"), { target: { value: "2" } });
    fireEvent.change(within(dlg).getByTestId("rule-leg-l2-scope"), { target: { value: "trail" } });
    expect(within(dlg).getByTestId("rule-leg-l2-trail-preview").textContent).toBe("When this stop fires the other legs stay open, and exit together once their profit falls this far from its best.");
    serveMarket();
    await waitFor(() => expect(within(dlg).getByTestId("rule-leg-l2-trail-preview").textContent).toMatch(/^The other legs are −\$[\d,.]+ now\. A percentage waits until they are in profit; from then the exit follows their best profit up and never moves down\.$/));
    // money has no such wait: it names the exit under where they stand
    await u.click(within(dlg).getByTestId("rule-leg-l2-trail-money"));
    fireEvent.change(within(dlg).getByTestId("rule-leg-l2-trail-value"), { target: { value: "2" } });
    await waitFor(() => expect(within(dlg).getByTestId("rule-leg-l2-trail-preview").textContent).toContain("they exit together at −$"));
  });

  it("a running trail shows on the card and as its own box: the give-back can be changed with its level and best kept, unticking stops it; with one leg left there is no rest to offer", async () => {
    const u = userEvent.setup();
    const running = rule({ id: "rule_t", kind: "trail", trigger: "pct", value: "15", thresholdUsd: "-12", peakPnl: "4" });
    mine().push(strat(1, { legs: [{ ...PUT, id: "l2" }], realizedPnl: "-12", rules: [running] }));
    renderWithProviders(<Workspace />);
    serveMarket();
    await waitFor(() => expect(screen.getByTestId("card-rules").textContent).toBe("trailing the rest: best +$4.00, exits at +$3.40"));
    await u.click(screen.getByTestId("card-protect"));
    let dlg = await screen.findByTestId("rule-dialog");
    expect(within(dlg).getByTestId("rule-trail").dataset["on"]).toBe("true");
    expect(within(dlg).getByTestId<HTMLInputElement>("rule-trail-value").value).toBe("15");
    expect(within(dlg).getByTestId("rule-trail-level").textContent).toBe("trailing the rest: best +$4.00, exits at +$3.40");
    await u.click(within(dlg).getByTestId("rule-leg-l2-on"));
    expect(within(dlg).getByTestId<HTMLSelectElement>("rule-leg-l2-scope").querySelector<HTMLOptionElement>('option[value="trail"]')!.disabled).toBe(true);
    await u.click(within(dlg).getByTestId("rule-leg-l2-on"));
    fireEvent.change(within(dlg).getByTestId("rule-trail-value"), { target: { value: "" } });
    await waitFor(() => expect(within(dlg).getByTestId<HTMLButtonElement>("rule-arm").disabled).toBe(true));
    await u.click(within(dlg).getByTestId("rule-trail-money"));
    fireEvent.change(within(dlg).getByTestId("rule-trail-value"), { target: { value: "1" } });
    await waitFor(() => expect(within(dlg).getByTestId("rule-arm").textContent).toBe("Arm trail on the rest"));
    // a new give-back under the old best could exit at once: the box says the trail starts again instead
    expect(within(dlg).getByTestId("rule-trail-level").textContent).toBe("A changed give-back starts the trail again from where the rest stands when you arm; the exit then follows the best from there.");
    await u.click(within(dlg).getByTestId("rule-arm"));
    await waitFor(() => expect(screen.queryByTestId("rule-dialog")).toBeNull());
    expect(mine()[0]!.rules!.map((r) => [r.kind, r.trigger, r.value, r.thresholdUsd, r.peakPnl, r.basis])).toEqual([["trail", "money", "1", "-12", null, null]]);
    await waitFor(() => expect(screen.getByTestId("card-rules").textContent).toBe("trailing the rest: exits on a fall of $1.00 from its best"));
    // reopen: money comes back; back to a percentage it is saved as one; unticked, the trail is removed
    await u.click(screen.getByTestId("card-protect"));
    dlg = await screen.findByTestId("rule-dialog");
    expect(within(dlg).getByTestId<HTMLInputElement>("rule-trail-value").value).toBe("1");
    await u.click(within(dlg).getByTestId("rule-trail-pct"));
    fireEvent.change(within(dlg).getByTestId("rule-trail-value"), { target: { value: "20" } });
    await u.click(within(dlg).getByTestId("rule-arm"));
    await waitFor(() => expect(screen.queryByTestId("rule-dialog")).toBeNull());
    expect(mine()[0]!.rules!.map((r) => [r.kind, r.trigger, r.value, r.thresholdUsd, r.peakPnl])).toEqual([["trail", "pct", "20", "-12", null]]);
    await u.click(screen.getByTestId("card-protect"));
    dlg = await screen.findByTestId("rule-dialog");
    await u.click(within(dlg).getByTestId("rule-trail-on"));
    expect(within(dlg).getByTestId("rule-arm").textContent).toBe("Remove rules");
    await u.click(within(dlg).getByTestId("rule-arm"));
    await waitFor(() => expect(screen.queryByTestId("rule-dialog")).toBeNull());
    expect(mine()[0]!.rules).toEqual([]);
    // and nothing can start one by hand: the API refuses a trail that no leg stop started
    const res = await fetch("/v1/strategies/strat_1/rules", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ rules: [{ kind: "trail", trigger: "pct", value: "15" }] }) });
    expect(res.status).toBe(400);
  });

  it("the words for a trail before its first best, a money give-back, and the fired chip", () => {
    const waiting = rule({ kind: "trail", trigger: "pct", value: "15", thresholdUsd: "-12", peakPnl: null });
    expect(ruleText(waiting, USD_FMT)).toBe("trailing the rest: exits on a fall of 15 % from its best");
    expect(ruleText({ ...waiting, trigger: "money", value: "2" }, USD_FMT)).toBe("trailing the rest: exits on a fall of $2.00 from its best");
    expect(ruleText({ ...waiting, trigger: "money", value: "2", peakPnl: "-1" }, USD_FMT)).toBe("trailing the rest: best −$1.00, exits at −$3.00");
    // a percentage of a few cents is not a give-back: the 0.10 USD minimum stands in
    expect(ruleText({ ...waiting, peakPnl: "0.01" }, USD_FMT)).toBe("trailing the rest: best +$0.01, exits at −$0.09");
    const fired = { ...waiting, peakPnl: "6", state: "fired" as const };
    expect(ruleText(fired, USD_FMT)).toBe("trailing the rest: exits on a fall of 15 % from its best");
    expect(firedLabel(fired, USD_FMT)).toBe("trail on the rest fired");
    expect(ruleText(rule({ kind: "leg_stop", trigger: "price", value: "150", thresholdUsd: "150", legId: "leg_b", scope: "leg", trail: { trigger: "money", value: "2" } }), USD_FMT, [CALL, PUT])).toBe("S P 78,000 25 Sep stop at 150.00, then trail the rest by $2.00");
  });
});

describe("HC-TR-237 take profit in steps from the dialog (ADR-120)", () => {
  // a sold strangle of 100 lots a leg at the chain's own marks, so the open lots are up by nothing when the dialog opens
  const SC = { ...CALL, id: "lc", side: "sell" as const, lots: 100 };
  const SP = { ...PUT, id: "lp", lots: 100 };
  const rowsOf = (dlg: HTMLElement) => within(dlg).getAllByTestId("rule-ladder-step").map((r) => `${within(r).getByTestId<HTMLInputElement>("rule-ladder-pct").value}:${within(r).getByTestId<HTMLInputElement>("rule-ladder-lots").value}`);

  it("HC-TR-237 the box offers presets and rows, excludes the target, refuses steps that do not add up, arms each step as a share of what is left, and comes back as typed; HC-TR-238 the card counts the steps", async () => {
    const u = userEvent.setup();
    mine().push(strat(1, { legs: [SC, SP] }));
    renderWithProviders(<Workspace />);
    serveMarket();
    await waitFor(() => expect(screen.getByTestId("card-rules").dataset["state"]).toBe("none"));
    await u.click(screen.getByTestId("card-protect"));
    const dlg = await screen.findByTestId("rule-dialog");
    expect(within(dlg).getByTestId("rule-ladder").dataset["on"]).toBe("false");
    await u.click(within(dlg).getByTestId("rule-ladder-on"));
    // Standard to begin with: three steps of 25 lots, 25 held
    expect(within(dlg).getByTestId("rule-ladder-preset-standard").getAttribute("aria-pressed")).toBe("true");
    expect(rowsOf(dlg)).toEqual(["25:25", "50:25", "75:25"]);
    expect(within(dlg).getByTestId("rule-ladder-hold").textContent).toContain("Step 4 · hold the rest");
    expect(within(dlg).getByTestId("rule-ladder-sum").textContent).toBe("75 + 25 held = 100 lots a leg");
    // 25 % of the 210 USD premium on a quarter of the lots
    expect(within(dlg).getAllByTestId("rule-ladder-banks")[0]!.textContent).toBe("+$13.13");
    expect(within(dlg).getByTestId("rule-ladder-note").textContent).toContain("Lots already closed do not count toward later steps");
    // steps or a target: ticking one unticks the other, both ways
    await u.click(within(dlg).getByTestId("rule-target-on"));
    expect(within(dlg).getByTestId("rule-ladder").dataset["on"]).toBe("false");
    await u.click(within(dlg).getByTestId("rule-ladder-on"));
    expect(within(dlg).getByTestId("rule-target").dataset["on"]).toBe("false");
    // Early has four steps and no room for a fifth; Late has two
    await u.click(within(dlg).getByTestId("rule-ladder-preset-early"));
    expect(rowsOf(dlg)).toEqual(["10:20", "25:20", "40:20", "55:20"]);
    expect(within(dlg).getByTestId<HTMLButtonElement>("rule-ladder-add").disabled).toBe(true);
    await u.click(within(dlg).getByTestId("rule-ladder-preset-late"));
    expect(rowsOf(dlg)).toEqual(["50:34", "75:33"]);
    // a step added, then removed: the preset reads Custom
    await u.click(within(dlg).getByTestId("rule-ladder-add"));
    expect(rowsOf(dlg)).toEqual(["50:25", "75:25", "88:25"]);
    expect(within(dlg).getByTestId("rule-ladder-preset-custom").getAttribute("aria-pressed")).toBe("true");
    await u.click(within(dlg).getAllByTestId("rule-ladder-remove")[2]!);
    await u.click(within(dlg).getByTestId("rule-ladder-preset-custom")); // Custom keeps the rows as they are
    expect(rowsOf(dlg)).toEqual(["50:25", "75:25"]);
    // lots that leave nothing to hold cannot be armed
    fireEvent.change(within(dlg).getAllByTestId("rule-ladder-lots")[0]!, { target: { value: "75" } });
    expect(within(dlg).getByTestId<HTMLButtonElement>("rule-arm").disabled).toBe(true);
    expect(within(dlg).getByTestId("rule-foot").textContent).toContain("The steps close 100 of 100 lots: leave at least 1 lot to hold");
    // lots left empty: nothing to bank yet, and the count leaves the row out
    fireEvent.change(within(dlg).getAllByTestId("rule-ladder-lots")[0]!, { target: { value: "" } });
    expect(within(dlg).getAllByTestId("rule-ladder-banks")[0]!.textContent).toBe("–");
    expect(within(dlg).getByTestId("rule-ladder-sum").textContent).toBe("25 + 75 held = 100 lots a leg");
    expect(within(dlg).getByTestId("rule-foot").textContent).toContain("Step 1: close at least 1 whole lot");
    fireEvent.change(within(dlg).getAllByTestId("rule-ladder-lots")[0]!, { target: { value: "34" } });
    fireEvent.change(within(dlg).getAllByTestId("rule-ladder-pct")[1]!, { target: { value: "80" } });
    expect(within(dlg).getByTestId("rule-arm").textContent).toBe("Arm profit steps");
    await u.click(within(dlg).getByTestId("rule-arm"));
    await waitFor(() => expect(screen.queryByTestId("rule-dialog")).toBeNull());
    // 34 of 100, then 25 of the 66 left
    expect(mine()[0]!.rules!.map((r) => [r.kind, r.trigger, r.value, r.closeShare, r.thresholdUsd])).toEqual([["step", "pct", "50", "0.34", "50"], ["step", "pct", "80", "0.378788", "80"]]);
    await waitFor(() => expect(screen.getByTestId("card-rules").textContent).toBe("profit steps 0 of 3 taken, next at 50 %"));
    // reopen: the armed steps come back as lots, ticked
    await u.click(screen.getByTestId("card-protect"));
    const again = await screen.findByTestId("rule-dialog");
    expect(within(again).getByTestId("rule-ladder").dataset["on"]).toBe("true");
    expect(rowsOf(again)).toEqual(["50:34", "80:25"]);
    await u.click(within(again).getByText("Cancel"));
    // the first step taken by the server: the line counts it beside the other armed rules, and Details names a step
    const taken = mine()[0]!.rules!.map((r, i) => (i === 0 ? { ...r, state: "fired" as const } : r));
    expect(rulesLine([rule(), ...taken], USD_FMT)).toBe("stop at −$60.00 · profit steps 1 of 3 taken, next at 80 %");
    // every step taken: no step is armed, so the line has nothing to say about them
    expect(rulesLine(taken.map((r) => ({ ...r, state: "fired" as const })), USD_FMT)).toBeNull();
    expect(rulesLine([rule(), ...taken.map((r) => ({ ...r, state: "fired" as const }))], USD_FMT)).toBe("stop at −$60.00");
    expect(ruleText(taken[1]!, USD_FMT)).toBe("profit step at 80 % of the open lots' premium, closing 38 % of them");
    expect(ruleText({ ...taken[1]!, closeShare: null }, USD_FMT)).toContain("closing 0 % of them");
    // HC-TR-240: a profit lock reads as a floor to come, then as the exit it holds; its chip says it closed the trade
    const lockRule = rule({ kind: "lock", trigger: "money", value: "37.44", thresholdUsd: "18.72" });
    expect(ruleText(lockRule, USD_FMT)).toBe("profit lock: a floor at +$18.72 once the profit reaches +$37.44");
    expect(ruleText({ ...lockRule, peakPnl: "38.1" }, USD_FMT)).toBe("profit locked: exits at +$18.72");
    expect(firedLabel({ ...lockRule, state: "fired" }, USD_FMT)).toBe("profit lock closed it");
  }, 20000);

  it("HC-TR-237 a step the open lots have already reached is refused: it would fire on the next tick", async () => {
    const u = userEvent.setup();
    // the put was sold far above any mark of the chain: the open lots are up well past 25 %
    mine().push(strat(1, { legs: [SC, { ...SP, price: "50000", entryPrice: "50000" }] }));
    renderWithProviders(<Workspace />);
    serveMarket();
    const protect = await screen.findByTestId("card-protect");
    serveMarket(); // the held legs subscribe once the strategy has loaded: their marks arrive with this snapshot
    await u.click(protect);
    const dlg = await screen.findByTestId("rule-dialog");
    await u.click(within(dlg).getByTestId("rule-ladder-on"));
    await waitFor(() => expect(within(dlg).getByTestId("rule-ladder-note").textContent).toMatch(/\(now \d+(\.\d)? %\)/), { timeout: 8000 });
    expect(within(dlg).getByTestId("rule-foot").textContent).toContain("a step at or under that would fire on the next tick");
    expect(within(dlg).getByTestId<HTMLButtonElement>("rule-arm").disabled).toBe(true);
  }, 20000);

  it("HC-TR-237 on a live trade the box says steps are on paper only and nothing can be armed with it ticked", async () => {
    const u = userEvent.setup();
    mine().push(strat(2, { name: "Live strangle", status: "live", tradingMode: "live", legs: [SC, { ...SP, lots: 50 }] }));
    useUiStore.setState({ workspaceTab: "live" });
    renderWithProviders(<Workspace />);
    serveMarket();
    await u.click(await screen.findByTestId("card-protect"));
    const dlg = await screen.findByTestId("rule-dialog");
    expect(within(dlg).getByTestId("rule-ladder").textContent).toContain("paper trades only for now");
    await u.click(within(dlg).getByTestId("rule-ladder-on"));
    expect(within(dlg).getByTestId("rule-foot").textContent).toContain("Profit steps are on paper trades only for now");
    // legs of different sizes: the rows are the smaller leg's lots, and the note says the other gives up the same share
    expect(within(dlg).getByTestId("rule-ladder-sum").textContent).toBe("38 + 12 held = 50 lots of the smallest leg; the others give up the same share");
    expect(within(dlg).getByTestId<HTMLButtonElement>("rule-arm").disabled).toBe(true);
  }, 20000);

  it("HC-TR-237 legs that nearly cancel out have no premium to take a share of: the box says so and nothing can be armed", async () => {
    const u = userEvent.setup();
    // sold and bought at the same price: the net premium is nothing
    mine().push(strat(1, { legs: [SC, { ...SC, id: "lb", side: "buy" }] }));
    renderWithProviders(<Workspace />);
    serveMarket();
    await u.click(await screen.findByTestId("card-protect"));
    const dlg = await screen.findByTestId("rule-dialog");
    await u.click(within(dlg).getByTestId("rule-ladder-on"));
    expect(within(dlg).getByTestId("rule-foot").textContent).toContain("Profit steps need a premium to measure against: the open legs nearly cancel out");
    expect(within(dlg).getByTestId<HTMLButtonElement>("rule-arm").disabled).toBe(true);
    expect(within(dlg).getByTestId("rule-ladder-note").textContent).not.toContain("removes the trailing target");
  }, 20000);

  it("HC-TR-237 ticking the steps on a trade whose target is already trailing says the running trail is removed", async () => {
    const u = userEvent.setup();
    mine().push(strat(2, { legs: [SC, SP], rules: [rule({ kind: "target", value: "6", thresholdUsd: "6", trail: { trigger: "money", value: "3" }, peakPnl: "18" })] }));
    renderWithProviders(<Workspace />);
    serveMarket();
    await u.click(await screen.findByTestId("card-protect"));
    const dlg = await screen.findByTestId("rule-dialog");
    await u.click(within(dlg).getByTestId("rule-ladder-on"));
    expect(within(dlg).getByTestId("rule-target").dataset["on"]).toBe("false");
    expect(within(dlg).getByTestId("rule-ladder-note").textContent).toContain("Arming steps removes the trailing target that is running now, with its best and its exit level.");
  }, 20000);

  it("HC-TR-240 a trade with Autopilot's profit lock: the dialog says the lock stays, an empty save is not offered, and arming another rule keeps the lock", async () => {
    const u = userEvent.setup();
    mine().push(strat(3, { legs: [SC, SP], rules: [rule({ id: "rule_lock", kind: "lock", trigger: "money", value: "105", thresholdUsd: "52.5" })] }));
    renderWithProviders(<Workspace />);
    serveMarket();
    await waitFor(() => expect(screen.getByTestId("card-rules").textContent).toBe("profit lock: a floor at +$52.50 once the profit reaches +$105.00"));
    await u.click(screen.getByTestId("card-protect"));
    const dlg = await screen.findByTestId("rule-dialog");
    expect(within(dlg).getByTestId("rule-foot").textContent).toContain("Autopilot's profit lock on this trade stays as it is when you arm; Disarm removes it with the rest.");
    // nothing ticked: there is nothing of the dialog's own to remove, so no "Remove rules"
    expect(within(dlg).getByTestId<HTMLButtonElement>("rule-arm").disabled).toBe(true);
    await u.click(within(dlg).getByTestId("rule-stop-on"));
    fireEvent.change(within(dlg).getByTestId("rule-stop-value"), { target: { value: "5" } });
    await u.click(within(dlg).getByTestId("rule-arm"));
    await waitFor(() => expect(screen.queryByTestId("rule-dialog")).toBeNull());
    expect(mine()[0]!.rules!.map((r) => r.kind).sort()).toEqual(["lock", "stop"]);
  }, 20000);
});
