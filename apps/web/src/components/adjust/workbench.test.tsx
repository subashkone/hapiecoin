// Adjustment workbench (ADR-044; HC-TR-148..152) against the in-memory API and the fake gateway: open from a
// card, edit lots after on open legs and picks, net chain picks against the position, value at another
// expiry, keyboard picking, guard rails, review and apply on paper, history and badge afterwards.
import { chainTopic } from "@hapiecoin/schema";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSocket, installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { buildChain } from "../../../test/fixtures/chain";
import { fmtMoney } from "@/lib/money";
import { useUiStore } from "@/lib/store";
import { Workspace } from "@/components/workspace/Workspace";
import { lotStep } from "./PositionTicket";

// The workbench flows price real legs through the worker and drive Radix dialogs with user-event; under coverage on
// a shared CI runner the longest one needs well over the package allowance (CI runs measured > 60 s).
vi.setConfig({ testTimeout: 180_000 });

const EXPIRY = "2026-09-25";
const LATER = "2026-10-30";
const TOPIC = chainTopic("delta_india", "BTC", EXPIRY);
const TOPIC2 = chainTopic("delta_india", "BTC", LATER);
const rows = buildChain("BTC", EXPIRY);
const rows2 = buildChain("BTC", LATER);
const EMAIL = "adjust@example.com";
let mock: MockFetch;
const mine = () => mock.state.accounts.get(EMAIL)!.strategies;

function seedLegs() {
  const s = useUiStore.getState();
  const atm = rows.findIndex((r) => Number(r.strike) >= 79521);
  const call = rows[atm]!;
  const put = rows[atm - 2]!;
  s.addLeg({ asset: "BTC", kind: "call", side: "buy", strike: call.strike, expiry: EXPIRY, lots: 10, price: call.call!.mark, iv: call.call!.markIv });
  s.addLeg({ asset: "BTC", kind: "put", side: "sell", strike: put.strike, expiry: EXPIRY, lots: 10, price: put.put!.mark, iv: put.put!.markIv });
  return { call, put };
}
function serveMarket() {
  const ws = FakeSocket.last();
  act(() => {
    ws.open();
    ws.receive({ t: "spot", s: "BTC", p: "79521", c24: 0.4 });
    ws.receive({ t: "snap", topic: TOPIC, seq: 0, rows });
  });
  return ws;
}
async function paperTradeFromBuilder(u: ReturnType<typeof userEvent.setup>) {
  await u.click(screen.getByTestId("builder-paper-trade"));
  const mode = screen.getByTestId("trade-mode");
  await waitFor(() => expect(within(mode).getByTestId<HTMLSelectElement>("trade-broker").value).toBe("brk_delta"));
  await u.click(within(mode).getByTestId("trade-continue"));
  await u.click(within(screen.getByTestId("trade-preview")).getByTestId("trade-now"));
  const name = await screen.findByTestId("save-draft-dialog", {}, { timeout: 5000 });
  await u.clear(within(name).getByTestId("save-draft-name")); // the box arrives pre-filled (HC-TR-155)
  await u.type(within(name).getByTestId("save-draft-name"), "Risk reversal");
  await u.click(within(name).getByTestId("save-draft-confirm"));
  await waitFor(() => expect(mine()[0]?.status).toBe("paper"));
  return mine()[0]!;
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
    detailsId: null,
    adjust: null,
    paneSource: null,
    workspaceTab: "builder",
    builderTab: "builder",
    targetPrice: null,
    targetDays: 0,
  });
});
afterEach(() => mock.restore());

describe("HC-TR-148..152 adjustment workbench on a paper strategy", () => {
  it("opens from the card, edits lots after in both places with netting, values at another expiry, reviews and applies", async () => {
    const { call, put } = seedLegs();
    renderWithProviders(<Workspace />);
    serveMarket();
    const u = userEvent.setup();
    const s = await paperTradeFromBuilder(u);
    const card = await screen.findByTestId("paper-card");
    await waitFor(() => expect(within(card).getByTestId("card-figures").dataset["state"]).toBe("ready"));
    expect(within(card).queryByTestId("adjusted-badge")).toBeNull();
    // open the workbench: the left tabs give way, the pane follows the strategy "after the change"
    await u.click(within(card).getByTestId("card-adjust"));
    const wb = await screen.findByTestId("adjust-workbench");
    serveMarket(); // the workbench subscribes to the chain when it mounts
    expect(screen.queryByTestId("left-pane")).toBeNull();
    expect(wb.dataset["empty"]).toBe("true");
    expect(within(wb).getByTestId<HTMLButtonElement>("adjust-review").disabled).toBe(true);
    await waitFor(() => expect(screen.getByTestId("pane-adjusting")).toBeTruthy());
    const legs = within(wb).getAllByTestId("wb-leg");
    expect(legs).toHaveLength(2);
    expect(within(wb).getAllByTestId("effect-none")).toHaveLength(2);
    // lots after on the bought call: one step down trims by one (10 lots → step 1), the field can close it, up reopens a lot
    const callRow = legs[0]!;
    await u.click(within(callRow).getByTestId("lots-after-down"));
    expect(within(callRow).getByTestId("effect").dataset["kind"]).toBe("trim");
    expect(within(callRow).getByTestId("effect").textContent).toContain("by 1");
    expect(wb.dataset["empty"]).toBe("false");
    await waitFor(() => expect(screen.getByTestId("before-after")).toBeTruthy());
    // ADR-058: "This change" sits at the top of the analysis pane with the six before → after tiles, not in the footer
    const change = screen.getByTestId("adjust-change-box");
    await waitFor(() => expect(within(change).getByTestId("adjust-summary").textContent).toContain("This change"));
    expect(change.dataset["empty"]).toBe("false");
    expect(within(wb).queryByTestId("adjust-summary")).toBeNull();
    for (const id of ["ba-max-loss", "ba-max-profit", "ba-pop", "ba-breakeven", "ba-greeks", "ba-margin"]) expect(within(screen.getByTestId("before-after-tiles")).getByTestId(id)).toBeTruthy();
    expect(screen.getByTestId("tile-max-loss").textContent).toContain("after");
    fireEvent.change(within(callRow).getByTestId("lots-after-input"), { target: { value: "" } }); // an emptied field changes nothing
    expect(within(callRow).getByTestId("effect").dataset["kind"]).toBe("trim");
    fireEvent.change(within(callRow).getByTestId("lots-after-input"), { target: { value: "0" } });
    expect(within(callRow).getByTestId("effect").dataset["kind"]).toBe("close");
    await u.click(within(callRow).getByTestId("lots-after-up"));
    expect(within(callRow).getByTestId("effect").textContent).toBe("TRIMS by 9");
    expect(within(callRow).getByTestId("lots-after").dataset["value"]).toBe("1");
    fireEvent.change(within(callRow).getByTestId("lots-after-input"), { target: { value: "25" } });
    expect(within(callRow).getByTestId("effect").textContent).toBe("ADDS +15");
    expect(within(callRow).getByTestId("effect").title).toMatch(/^ADDS \+15 to /); // the contract stays on hover
    expect(within(change).getByTestId("adjust-cash").textContent).toContain("debit");
    // reset clears every change
    await u.click(within(wb).getByTestId("adjust-reset"));
    expect(wb.dataset["empty"]).toBe("true");
    // the chain: a held strike shows its lots and B / S add to or trim it; another strike proposes a new leg
    await waitFor(() => expect(within(wb).getAllByTestId("wb-chain-row").length).toBeGreaterThan(0), { timeout: 5000 });
    const heldRow = within(wb).getAllByTestId("wb-chain-row").find((r) => r.dataset["strike"] === call.strike)!;
    expect(within(heldRow).getAllByTestId("wb-chain-held")).toHaveLength(1);
    await u.click(within(heldRow).getByTestId("wb-chain-buy-call")); // same side: adds 100 lots (the chain preset)
    expect(within(legs[0]!).getByTestId("effect").textContent).toContain("ADDS +100");
    await u.click(within(heldRow).getByTestId("wb-chain-sell-call")); // opposite side: trims them back
    expect(useUiStore.getState().adjust?.lotsAfter).toEqual({}); // back to lots now: no order, no key (hasAdjustWork stays exact)
    expect(within(legs[0]!).getByTestId("effect-none")).toBeTruthy();
    await u.click(within(heldRow).getByTestId("wb-chain-sell-call")); // trims below zero: closes, the rest flips
    expect(within(legs[0]!).getByTestId("effect").dataset["kind"]).toBe("close");
    expect(within(wb).getAllByTestId("wb-pick")).toHaveLength(1);
    expect(within(within(wb).getByTestId("wb-pick")).getByTestId("effect").dataset["kind"]).toBe("flip");
    expect(within(heldRow).getByTestId("wb-chain-held").dataset["after"]).toBe("0");
    await u.click(within(within(wb).getByTestId("wb-pick")).getByTestId("wb-pick-remove"));
    await u.click(within(wb).getByTestId("adjust-reset"));
    const freeRow = within(wb).getAllByTestId("wb-chain-row").find((r) => r.dataset["strike"] !== call.strike && r.dataset["strike"] !== put.strike && r.dataset["strike"]! > call.strike)!;
    await u.click(within(freeRow).getByTestId("wb-chain-sell-call"));
    const pick = within(wb).getByTestId("wb-pick");
    expect(within(pick).getByTestId("effect").textContent).toBe("NEW LEG");
    expect(within(freeRow).getByTestId("wb-chain-sell-call").getAttribute("aria-pressed")).toBe("true");
    await u.click(within(pick).getByTestId("pick-lots-up"));
    expect(within(pick).getByTestId("pick-lots").dataset["value"]).toBe(String(100 + lotStep(100)));
    await u.click(within(freeRow).getByTestId("wb-chain-sell-call")); // same side again deselects
    expect(within(wb).queryByTestId("wb-pick")).toBeNull();
    // another expiry: the "value at" chips grow with the combined position (today is always offered)
    expect(within(within(wb).getByTestId("value-at")).getAllByTestId("value-at-chip").map((c) => c.dataset["expiry"])).toEqual(["today", EXPIRY]);
    await u.click(within(wb).getAllByTestId("wb-chain-expiry").find((b) => b.dataset["expiry"] === LATER)!);
    act(() => {
      FakeSocket.last().receive({ t: "snap", topic: TOPIC2, seq: 0, rows: rows2 });
    });
    await waitFor(() => expect(within(wb).getByTestId("wb-chain-table").dataset["rows"]).not.toBe("0"), { timeout: 5000 });
    await u.click(within(within(wb).getAllByTestId("wb-chain-row")[2]!).getByTestId("wb-chain-buy-call"));
    const chips = within(within(wb).getByTestId("value-at")).getAllByTestId("value-at-chip");
    expect(chips.map((c) => c.dataset["expiry"])).toEqual(["today", EXPIRY, LATER]);
    expect(chips[1]!.getAttribute("aria-pressed")).toBe("true"); // the nearest expiry by default (ADR-059): the later leg keeps its time value
    // the pick belongs to the later expiry and survives switching the chain back to the front one
    await u.click(within(wb).getAllByTestId("wb-chain-expiry").find((b) => b.dataset["expiry"] === EXPIRY)!);
    await waitFor(() => expect(within(wb).getAllByTestId("wb-chain-row").length).toBeGreaterThan(0));
    expect(within(wb).getAllByTestId("wb-pick")).toHaveLength(1);
    expect(within(wb).getByTestId("wb-pick").textContent).toContain("30 Oct");
    // only held rows are lit on this chain (the pick belongs to the other expiry)
    expect(within(wb).getAllByTestId("wb-chain-buy-call").filter((b) => b.getAttribute("aria-pressed") === "true").every((b) => b.closest("tr")?.querySelector("[data-testid=wb-chain-held]") !== null)).toBe(true);
    await u.click(within(wb).getAllByTestId("wb-chain-expiry").find((b) => b.dataset["expiry"] === LATER)!);
    await waitFor(() => expect(within(wb).getAllByTestId("wb-chain-row").length).toBeGreaterThan(0));
    await u.click(chips[1]!);
    expect(chips[1]!.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(screen.getByTestId("before-after").textContent).toContain("valued at"));
    await u.click(chips[0]!);
    expect(chips[0]!.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(screen.getByTestId("before-after").textContent).toContain("valued at"));
    await u.click(within(wb).getByTestId("adjust-reset"));
    // keyboard on the chain: ↓ then s picks a sell call on the next row; Esc resets
    await u.click(within(wb).getAllByTestId("wb-chain-expiry").find((b) => b.dataset["expiry"] === EXPIRY)!);
    await waitFor(() => expect(within(wb).getAllByTestId("wb-chain-row").length).toBeGreaterThan(0));
    const box = within(wb).getByTestId("wb-chain-box");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(within(wb).getAllByTestId("wb-chain-row").some((r) => r.dataset["focused"] === "true")).toBe(true);
    fireEvent.keyDown(box, { key: "s" });
    expect(wb.dataset["empty"]).toBe("false");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(wb.dataset["empty"]).toBe("true");
    // the change to apply: trim the sold put to 5 and sell a call two strikes up; Enter reviews
    const putRow = within(wb).getAllByTestId("wb-leg")[1]!;
    fireEvent.change(within(putRow).getByTestId("lots-after-input"), { target: { value: "5" } });
    const freeAgain = within(wb).getAllByTestId("wb-chain-row").find((r) => r.dataset["strike"] === freeRow.dataset["strike"])!;
    await u.click(within(freeAgain).getByTestId("wb-chain-sell-call"));
    expect(within(wb).getByTestId("adjust-review").textContent).toContain("2 orders");
    fireEvent.keyDown(box, { key: "Enter" });
    const confirm = await screen.findByTestId("adjust-confirm");
    expect(confirm.dataset["mode"]).toBe("paper");
    const crows = within(confirm).getAllByTestId("adjust-confirm-row");
    expect(crows.map((r) => r.dataset["kind"])).toEqual(["trim", "add"]);
    expect(within(confirm).getByTestId("adjust-paper-note")).toBeTruthy();
    await u.type(within(confirm).getByTestId("adjust-reason"), "spot ran above the wings");
    await u.click(within(confirm).getByTestId("adjust-apply"));
    await waitFor(() => expect(mine()[0]!.adjustments).toHaveLength(1));
    expect(mine()[0]!.adjustments[0]).toMatchObject({ added: 1, trimmed: 1, closed: 0, reason: "spot ran above the wings" });
    expect(mine()[0]!.legs.filter((l) => l.status === "open").map((l) => [l.side, l.lots])).toEqual([
      ["buy", 10],
      ["sell", 5],
      ["sell", 100],
    ]);
    expect(mine()[0]!.legs.find((l) => l.status === "squared_off")).toMatchObject({ lots: 5, side: "sell" });
    expect(mine()[0]!.adjustments[0]!.realizedPnl).toBe("0"); // the mark has not moved since entry
    // the workbench closes, Details reopens with the history, the card wears the badge
    await waitFor(() => expect(screen.queryByTestId("adjust-workbench")).toBeNull());
    const details = await screen.findByTestId("strategy-details");
    await waitFor(() => expect(within(details).getAllByTestId("details-adjustment")).toHaveLength(1));
    expect(within(details).getByTestId("details-adjustment").textContent).toContain("spot ran above the wings");
    expect(within(details).getByTestId("adjusted-badge")).toBeTruthy();
    await u.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("strategy-details")).toBeNull());
    await waitFor(() => expect(within(screen.getByTestId("paper-card")).getByTestId("adjusted-badge").dataset["count"]).toBe("1"));
    expect(s.id).toBe(mine()[0]!.id);
  });

  it("A on a focused card opens the workbench, Exit discards the draft, the cap and Details' button are guarded", async () => {
    seedLegs();
    renderWithProviders(<Workspace />);
    serveMarket();
    const u = userEvent.setup();
    await paperTradeFromBuilder(u);
    const card = await screen.findByTestId("paper-card");
    card.focus();
    fireEvent.keyDown(card, { key: "a" });
    const wb = await screen.findByTestId("adjust-workbench");
    serveMarket();
    expect(within(wb).getByTestId("adjust-mark-age").textContent).toMatch(/marks \d+s ago/);
    // ten picks over the cap: Review is refused with the guard rail
    await waitFor(() => expect(within(wb).getAllByTestId("wb-chain-row").length).toBeGreaterThan(8), { timeout: 5000 });
    const free = within(wb).getAllByTestId("wb-chain-row").filter((r) => within(r).queryByTestId("wb-chain-held") === null).slice(0, 9);
    for (const r of free) await u.click(within(r).getByTestId("wb-chain-buy-put"));
    expect(within(wb).getAllByTestId("wb-pick")).toHaveLength(9);
    expect(screen.getByTestId("adjust-warnings").textContent).toContain("open-leg cap");
    expect(within(wb).getByTestId("adjust-tile-legs").textContent).toContain("11");
    expect(within(wb).getByTestId("wb-chain-cap").textContent).toContain("over the 10 open-leg cap");
    expect(within(wb).getByTestId<HTMLButtonElement>("adjust-review").disabled).toBe(true);
    // Exit asks before discarding a change; Keep editing leaves everything as it was
    await u.click(within(wb).getByTestId("adjust-exit"));
    const ask = await screen.findByTestId("adjust-exit-confirm");
    expect(ask.textContent).toContain("9 orders in this change");
    await u.click(within(ask).getByTestId("adjust-exit-keep"));
    await waitFor(() => expect(screen.queryByTestId("adjust-exit-confirm")).toBeNull());
    expect(within(wb).getAllByTestId("wb-pick")).toHaveLength(9);
    await u.click(within(wb).getByTestId("adjust-exit"));
    await u.click(within(await screen.findByTestId("adjust-exit-confirm")).getByTestId("adjust-exit-discard"));
    await waitFor(() => expect(screen.queryByTestId("adjust-workbench")).toBeNull());
    expect(useUiStore.getState().adjust).toBeNull();
    expect(screen.getByTestId("left-pane")).toBeTruthy();
    expect(mine()[0]!.adjustments).toEqual([]);
    // Details: the button opens the same workbench
    await u.click(within(screen.getByTestId("paper-card")).getByTestId("card-details"));
    const details = await screen.findByTestId("strategy-details");
    expect(within(details).getByTestId("details-adjust").textContent).toContain("Adjust");
    await u.click(within(details).getByTestId("details-adjust"));
    await screen.findByTestId("adjust-workbench");
    expect(useUiStore.getState().adjust?.strategyId).toBe(mine()[0]!.id);
    // nothing changed: Exit leaves at once, no question asked
    await u.click(screen.getByTestId("adjust-exit"));
    await waitFor(() => expect(screen.queryByTestId("adjust-workbench")).toBeNull());
    expect(screen.queryByTestId("adjust-exit-confirm")).toBeNull();
    // the strategy went away (archived or deleted elsewhere): the workbench closes itself
    act(() => useUiStore.getState().openAdjust("str_gone"));
    await waitFor(() => expect(useUiStore.getState().adjust).toBeNull());
    expect(screen.queryByTestId("adjust-workbench")).toBeNull();
  });

  it("HC-TR-153 / HC-TR-154 plans compare, quick fixes with ranking, the scenario slider and the alert stub", async () => {
    const { call } = seedLegs();
    renderWithProviders(<Workspace />);
    serveMarket();
    const u = userEvent.setup();
    const s = await paperTradeFromBuilder(u);
    await u.click(within(await screen.findByTestId("paper-card")).getByTestId("card-adjust"));
    const wb = await screen.findByTestId("adjust-workbench");
    serveMarket();
    await waitFor(() => expect(within(wb).getAllByTestId("wb-chain-row").length).toBeGreaterThan(0), { timeout: 5000 });
    // quick fixes: roll up and hedge can be built from the shown chain; roll out waits for the next expiry's chain
    const fixes = within(wb).getByTestId("quick-fixes");
    await waitFor(() => expect(within(fixes).getAllByTestId("quick-fix").map((b) => b.dataset["state"])).toEqual(["ready", "unavailable", "ready"]));
    expect(within(fixes).getAllByTestId("quick-fix-tag").length).toBeGreaterThan(0);
    await u.click(within(fixes).getAllByTestId("quick-fix")[0]!); // roll strikes up
    expect(wb.dataset["empty"]).toBe("false");
    const kinds = () => [...within(wb).getAllByTestId("wb-leg"), ...within(wb).queryAllByTestId("wb-pick")].map((r) => within(r).queryByTestId("effect")?.dataset["kind"]);
    expect(kinds()).toEqual(["close", "close", "new", "new"]);
    expect(within(wb).getAllByTestId("wb-order").map((r) => r.dataset["kind"])).toEqual(["close", "close"]); // the two closes are orders under Proposed too
    expect(within(wb).getAllByTestId("wb-pick")).toHaveLength(2);
    // plans: keep this as Plan A, build another (hedge), compare, load A back, remove it
    const plans = within(wb).getByTestId("plans-bar");
    await u.click(within(plans).getByTestId("plan-save"));
    expect(plans.dataset["count"]).toBe("1");
    // saving keeps Plan A and starts the next change: the ticket is back to the position as it stands
    expect(wb.dataset["empty"]).toBe("true");
    expect(within(wb).queryAllByTestId("wb-pick")).toHaveLength(0);
    expect(within(plans).getByTestId("plan-current-note").textContent).toBe("nothing yet");
    expect(plans.textContent).toContain("Plan A kept");
    await u.click(within(fixes).getAllByTestId("quick-fix")[2]!); // hedge with a call: nothing is short, so it buys above spot, which is the held call's strike → nets as ADDS
    expect(within(wb).queryAllByTestId("wb-pick")).toHaveLength(0);
    expect(kinds()).toEqual(["add", undefined]);
    expect(within(wb).getAllByTestId("wb-order").map((r) => r.dataset["kind"])).toEqual(["add"]);
    await u.click(within(plans).getByTestId("plan-save"));
    const rows = within(plans).getAllByTestId("plan-row");
    expect(rows.map((r) => (r.dataset["plan"] === "current" || r.dataset["plan"] === "before" ? r.dataset["plan"] : "plan"))).toEqual(["before", "current", "plan", "plan"]);
    await waitFor(() => expect(within(plans).getAllByTestId("plan-row").every((r) => r.dataset["state"] === "ready")).toBe(true), { timeout: 5000 });
    expect(within(plans).getByText("Plan A")).toBeTruthy();
    expect(within(plans).getByText("Plan B")).toBeTruthy();
    await u.click(within(plans).getAllByTestId("plan-use")[0]!); // back to Plan A: the roll
    expect(within(wb).getAllByTestId("wb-pick")).toHaveLength(2);
    // the working change is a copy of Plan A now, and the row says so instead of showing the same figures unexplained
    expect(within(plans).getByTestId("plan-current-note").textContent).toBe("= Plan A");
    expect(within(plans).getAllByTestId("plan-row")[1]!.dataset["same"]).toBe(within(plans).getAllByTestId("plan-row")[2]!.dataset["plan"]);
    // a copy of a kept plan cannot be saved again; an edit makes it a new change
    expect(within(plans).getByTestId<HTMLButtonElement>("plan-save").disabled).toBe(true);
    expect(within(plans).getByTestId("plan-save").title).toContain("Already kept as Plan A");
    await u.click(within(within(wb).getAllByTestId("wb-pick")[0]!).getByTestId("pick-lots-up"));
    expect(within(plans).getByTestId("plan-current-note").textContent).toBe("unsaved");
    expect(within(plans).getByTestId<HTMLButtonElement>("plan-save").disabled).toBe(false);
    await u.click(within(within(wb).getAllByTestId("wb-pick")[0]!).getByTestId("pick-lots-down"));
    expect(within(plans).getByTestId<HTMLButtonElement>("plan-save").disabled).toBe(true);
    await u.click(within(plans).getAllByTestId("plan-remove")[1]!);
    expect(plans.dataset["count"]).toBe("1");
    // removing the plan the change equals makes it a new change again (the table folds away with no plans), so it can be kept once more
    await u.click(within(plans).getAllByTestId("plan-remove")[0]!);
    expect(plans.dataset["count"]).toBe("0");
    expect(within(plans).queryByTestId("plans-table")).toBeNull();
    expect(within(plans).getByTestId<HTMLButtonElement>("plan-save").disabled).toBe(false);
    await u.click(within(plans).getByTestId("plan-save"));
    expect(plans.dataset["count"]).toBe("1");
    expect(wb.dataset["empty"]).toBe("true");
    // Clear all on Proposed is Reset: the orders go, the plan stays
    await u.click(within(fixes).getAllByTestId("quick-fix")[0]!);
    expect(within(wb).getByTestId("proposed-count").dataset["count"]).toBe("4");
    await u.click(within(wb).getByTestId("proposed-clear"));
    expect(within(wb).queryByTestId("proposed-clear")).toBeNull();
    expect(wb.dataset["empty"]).toBe("true");
    expect(plans.dataset["count"]).toBe("1");
    // Exit asks about saved plans even when the change is empty
    await u.click(within(wb).getByTestId("adjust-exit"));
    const ask = await screen.findByTestId("adjust-exit-confirm");
    expect(ask.textContent).toContain("1 saved plan will be discarded");
    await u.click(within(ask).getByTestId("adjust-exit-keep"));
    await waitFor(() => expect(screen.queryByTestId("adjust-exit-confirm")).toBeNull());
    // the side doors ask the same question: Back to Builder on the pane, or a tab change from the palette
    await u.click(screen.getByTestId("pane-back-to-builder"));
    await u.click(within(await screen.findByTestId("adjust-exit-confirm")).getByTestId("adjust-exit-keep"));
    expect(screen.getByTestId("adjust-workbench")).toBeTruthy();
    expect(useUiStore.getState().adjust?.plans).toHaveLength(1);
    act(() => useUiStore.getState().setWorkspaceTab("chain"));
    await u.click(within(await screen.findByTestId("adjust-exit-confirm")).getByTestId("adjust-exit-keep"));
    expect(useUiStore.getState().workspaceTab).toBe("paper"); // the tab change waited for the answer and was dropped
    expect(useUiStore.getState().adjust?.plans).toHaveLength(1);
    // the scenario slider values the position on a day between today and the latest expiry
    const slider = within(wb).getByTestId<HTMLInputElement>("scenario-days");
    expect(Number(slider.max)).toBeGreaterThan(1);
    fireEvent.change(slider, { target: { value: "1" } });
    expect(within(wb).getByTestId("scenario-label").textContent).toMatch(/^\+1d · /);
    expect(useUiStore.getState().adjust?.valuation).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    fireEvent.change(slider, { target: { value: "0" } });
    expect(useUiStore.getState().adjust?.valuation).toBe("today");
    fireEvent.change(slider, { target: { value: slider.max } });
    expect(useUiStore.getState().adjust?.valuation).toBe("2026-09-25"); // the far end of the slider is the latest expiry, an explicit choice now
    // ADR-058: the P&L alert line opens the Alerts center with a real strategy P&L rule filled in (ADR-052), no local stub
    const alertBox = within(wb).getByTestId("risk-alert");
    expect(within(alertBox).getByTestId<HTMLButtonElement>("risk-alert-save").disabled).toBe(true);
    await u.type(within(alertBox).getByTestId("risk-alert-input"), "1500");
    await u.click(within(alertBox).getByTestId("risk-alert-save"));
    expect(useUiStore.getState().dialog).toBe("alerts");
    expect(useUiStore.getState().alertPrefill).toMatchObject({ kind: "pnl", strategyId: s.id, asset: "BTC", op: "<=", value: "-1500" });
    expect(useUiStore.getState().riskAlerts).toEqual([]);
    expect(call.strike).toBeTruthy();
    // a side door answered with Discard runs the parked action: Back to Builder leaves the workbench and switches the tab
    act(() => useUiStore.getState().closeDialog?.());
    await u.click(screen.getByTestId("pane-back-to-builder"));
    await u.click(within(await screen.findByTestId("adjust-exit-confirm")).getByTestId("adjust-exit-discard"));
    await waitFor(() => expect(screen.queryByTestId("adjust-workbench")).toBeNull());
    expect(useUiStore.getState().workspaceTab).toBe("builder");
    expect(useUiStore.getState().paneSource).toBeNull();
    expect(useUiStore.getState().adjust).toBeNull();
    expect(useUiStore.getState().adjustDiscard).toBeNull();
  });

  it("ADR-058 figures checklist: the same change reads the same in the ticket, the change box and the footer tiles", async () => {
    const { call } = seedLegs();
    renderWithProviders(<Workspace />);
    serveMarket();
    const u = userEvent.setup();
    await paperTradeFromBuilder(u);
    await u.click(within(await screen.findByTestId("paper-card")).getByTestId("card-adjust"));
    const wb = await screen.findByTestId("adjust-workbench");
    serveMarket();
    await waitFor(() => expect(within(wb).getAllByTestId("wb-chain-row").length).toBeGreaterThan(0), { timeout: 5000 });
    // the served chain is the one the legs were entered from, so every leg marks at its entry: P&L is zero on each line
    const legs = within(wb).getAllByTestId("wb-leg");
    for (const l of legs) expect(within(l).getByTestId("wb-leg-pnl").textContent).toBe("$0.00");
    expect(within(wb).getByTestId("adjust-tile-cash").textContent).toContain("—");
    expect(within(wb).getByTestId("adjust-tile-legs").textContent).toContain("2");
    // trim the bought call by one lot: a credit of one lot at the mark (BTC lot = 0.001), read identically in three places
    await u.click(within(legs[0]!).getByTestId("lots-after-down"));
    const credit = fmtMoney(Number(call.call!.mark) * 0.001);
    const change = screen.getByTestId("adjust-change-box");
    await waitFor(() => expect(within(change).getByTestId("adjust-cash").textContent).toBe(`credit ${credit}`));
    const cashTile = within(wb).getByTestId("adjust-tile-cash");
    expect(cashTile.textContent).toContain("You receive");
    expect(cashTile.textContent).toContain(credit);
    expect(cashTile.textContent).toMatch(/fees est\. \$\d/);
    expect(within(wb).getByTestId("adjust-tile-legs").textContent).toContain("of 10 · 2 now");
    // the trim is an order, so it is listed under Proposed (H2 mockup): SELL to close one lot, editable and removable there
    expect(within(wb).getByTestId("proposed-count").dataset["count"]).toBe("1");
    const order = within(wb).getByTestId("wb-order");
    expect(order.dataset["kind"]).toBe("trim");
    expect(order.textContent).toContain("SELL");
    expect(within(order).getByTestId("effect").textContent).toBe("TRIMS by 1");
    await u.click(within(order).getByTestId("order-lots-up"));
    expect(within(legs[0]!).getByTestId("lots-after").dataset["value"]).toBe("8");
    expect(within(legs[0]!).getByTestId("effect").textContent).toBe("TRIMS by 2");
    await u.click(within(order).getByTestId("order-lots-down"));
    expect(within(legs[0]!).getByTestId("lots-after").dataset["value"]).toBe("9");
    // the loss after in the footer is the loss after in the analysis pane, and both show the before figure with a verdict
    await waitFor(() => expect(screen.getByTestId("ba-max-loss").textContent).toMatch(/→ (▲ better|▼ worse|unchanged)/), { timeout: 5000 });
    const after = (id: string) => screen.getByTestId(id).querySelector(".num")!.textContent;
    expect(after("adjust-tile-loss")).toBe(after("ba-max-loss"));
    expect(after("adjust-tile-margin")).toBe(after("ba-margin"));
    expect(within(wb).getByTestId("adjust-tile-loss").textContent).toContain("→");
    // undo restores the trimmed line; Close then sets lots after to 0 and the chain pill shows the strike going to zero
    await u.click(within(legs[0]!).getByTestId("wb-leg-undo"));
    expect(wb.dataset["empty"]).toBe("true");
    await u.click(within(legs[0]!).getByTestId("wb-leg-close"));
    expect(within(legs[0]!).getByTestId("effect").dataset["kind"]).toBe("close");
    expect(within(wb).getByTestId("wb-order").dataset["kind"]).toBe("close");
    expect(within(within(wb).getByTestId("wb-order")).getByTestId("order-lots").dataset["value"]).toBe("10");
    // adding lots lists a BUY order on the same side; ✕ on the order row puts lots after back
    fireEvent.change(within(legs[0]!).getByTestId("lots-after-input"), { target: { value: "25" } });
    expect(within(wb).getByTestId("wb-order").dataset["kind"]).toBe("add");
    expect(within(wb).getByTestId("wb-order").textContent).toContain("BUY");
    await u.click(within(wb).getByTestId("wb-order-remove"));
    expect(within(wb).queryByTestId("wb-order")).toBeNull();
    expect(wb.dataset["empty"]).toBe("true");
    await u.click(within(legs[0]!).getByTestId("wb-leg-close"));
    expect(within(wb).getAllByTestId("wb-chain-held").find((p) => p.dataset["after"] === "0")?.textContent).toBe("10→0");
    await u.click(within(legs[0]!).getByTestId("wb-leg-undo"));
    expect(wb.dataset["empty"]).toBe("true");
    // the plans table stays folded until a plan exists
    expect(within(wb).queryByTestId("plans-table")).toBeNull();
    expect(within(wb).getByTestId("plans-toggle").getAttribute("aria-expanded")).toBe("false");
  });
});
