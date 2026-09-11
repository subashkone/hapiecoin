// Protect: stop and target rules on a strategy (ADR-059 §2.3; HC-TR-167 arming from the card and after a trade,
// HC-TR-168 the fired state on the card and in Details) against the mock API.
import type { Strategy, StrategyRule } from "@hapiecoin/schema";
import { chainTopic } from "@hapiecoin/schema";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSocket, installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { buildChain } from "../../../test/fixtures/chain";
import { useUiStore } from "@/lib/store";
import { Workspace } from "@/components/workspace/Workspace";
import { fromLocalInput, levelText, ruleText, toLocalInput, typedToUsd, usdToTyped } from "./RuleDialog";

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
    drafts: [],
    draftsImported: true,
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
