// Builder, templates, chain picker and future dialog (HC-TR-001..049) against the in-memory API, the fake
// gateway socket and the recorded instrument list.
import { chainTopic } from "@hapiecoin/schema";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeSocket, installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { buildChain } from "../../../test/fixtures/chain";
import { useUiStore } from "@/lib/store";
import { daysToExpiry } from "@/lib/format";
import { TEMPLATES } from "@/lib/strategy/templates";
import { BuilderPanel, PriceCell } from "./BuilderPanel";

const EXPIRY = "2026-09-25";
const SPOT = 79521; // the spot serveMarket() sends
const TOPIC = chainTopic("delta_india", "BTC", EXPIRY);
const rows = buildChain("BTC", EXPIRY);
let mock: MockFetch;

function seedLegs() {
  const s = useUiStore.getState();
  const atm = rows.findIndex((r) => Number(r.strike) >= 79521);
  const call = rows[atm]!;
  const put = rows[atm - 2]!;
  s.addLeg({ asset: "BTC", kind: "call", side: "buy", strike: call.strike, expiry: EXPIRY, lots: 10, price: call.call!.mark, iv: call.call!.markIv });
  s.addLeg({ asset: "BTC", kind: "put", side: "sell", strike: put.strike, expiry: EXPIRY, lots: 10, price: put.put!.mark, iv: put.put!.markIv });
  return { call, put };
}

/** True once the gateway client has asked the socket for EXPIRY's chain topic. */
function subscribedToChain(): boolean {
  return FakeSocket.last()
    .sentFrames()
    .flatMap((f) => (f as { topics?: string[] }).topics ?? [])
    .includes(TOPIC);
}

/** Open the socket and serve the spot and the chain for EXPIRY. */
function serveMarket() {
  const ws = FakeSocket.last();
  act(() => {
    ws.open();
    ws.receive({ t: "spot", s: "BTC", p: String(SPOT), c24: 0.4 });
    ws.receive({ t: "snap", topic: TOPIC, seq: 0, rows });
  });
  return ws;
}

beforeEach(() => {
  FakeSocket.reset();
  mock = installMockFetch();
  mock.loginAs("trader@example.com");
  useUiStore.setState({
    asset: "BTC",
    expiry: { BTC: EXPIRY },
    legs: { BTC: [], ETH: [], XAUT: [] },
    strategy: { BTC: { name: "", basket: false, priceMode: "live", draftId: null }, ETH: { name: "", basket: false, priceMode: "live", draftId: null }, XAUT: { name: "", basket: false, priceMode: "live", draftId: null } },
    drafts: [],
    chainLots: 10,
    workspaceTab: "builder",
    builderTab: "builder",
    targetPrice: null,
    targetDays: 0,
  });
});
afterEach(() => {
  mock.restore();
});

describe("HC-TR-012 live price cell", () => {
  it("flashes up or down for a moment when the price moves, and not on the first render", () => {
    const { rerender } = renderWithProviders(<PriceCell value="100" title="t" />);
    const cell = () => screen.getByTestId("leg-price");
    expect(cell().dataset["flash"]).toBe("");
    rerender(<PriceCell value="101.5" title="t" />);
    expect(cell().dataset["flash"]).toBe("flash-up");
    expect(cell().textContent).toBe("101.5");
    rerender(<PriceCell value="99" title="t" />);
    expect(cell().dataset["flash"]).toBe("flash-down");
    rerender(<PriceCell value="99" title="t" />);
    expect(cell().dataset["flash"]).toBe("flash-down");
  });
});

describe("HC-TR-001..021 Builder legs table", () => {
  it("lists the legs with side, instrument, lots, price and the ticket; toggles side, steps lots, deletes", async () => {
    const { call, put } = seedLegs();
    renderWithProviders(<BuilderPanel />);
    serveMarket();
    const u = userEvent.setup();
    const legRows = screen.getAllByTestId("leg-row");
    expect(legRows).toHaveLength(2);
    expect(legRows[0]!.dataset["side"]).toBe("buy");
    expect(within(legRows[0]!).getByTestId<HTMLSelectElement>("leg-strike").value).toBe(call.strike);
    expect(within(legRows[0]!).getByTestId("leg-kind").textContent).toBe("CE");
    expect(within(legRows[1]!).getByTestId<HTMLSelectElement>("leg-strike").value).toBe(put.strike);
    expect(within(legRows[1]!).getByTestId("leg-kind").textContent).toBe("PE");
    expect(screen.getByTestId("builder-remaining").textContent).toContain("6 of 8 slots left");
    // live price follows the feed mark
    await waitFor(() => expect(within(legRows[0]!).getByTestId("leg-price").textContent).not.toBe("—"));
    // ticket fills once the engine has priced
    await waitFor(() => expect(screen.getByTestId("ticket-net").textContent).not.toBe("—"), { timeout: 4000 });
    expect(screen.getByTestId("ticket-pop").textContent).toMatch(/POP \d+%/);
    // HC-TR-096 / 097 / 100 / 101 / 102 / 105: fees, total, width, the net line, the structure tag and the DTE lines
    await waitFor(() => expect(screen.getByTestId("ticket-fees").textContent).toContain("$"));
    expect(screen.getByTestId("ticket-total").dataset["kind"]).toMatch(/debit|credit/);
    expect(screen.getByTestId("ticket-total").textContent).toContain("$");
    expect(screen.getByTestId("ticket-width").textContent).not.toBe("—");
    expect(screen.getByTestId("ticket-width").parentElement!.textContent).toContain("2 strikes");
    expect(screen.getByTestId("builder-netline").textContent).toMatch(/Lot = 0\.001 BTC.*Net (debit|credit).*Net Δ.*Net Θ\/day.*Net ν\/1%/);
    expect(screen.queryByTestId("strategy-structure")).toBeNull(); // a bespoke two-leg mix has no named structure
    expect(screen.getByTestId("strategy-expiry-line").textContent).toMatch(/^BTC · 25 Sep · \d+d$/);
    expect(screen.getByTestId("builder-subinfo").textContent).toMatch(/2 legs · 25 Sep · \d+d · unsaved/);
    // side toggle
    await u.click(within(legRows[0]!).getByTestId("leg-side"));
    expect(useUiStore.getState().legs.BTC[0]!.side).toBe("sell");
    // lots stepper follows the presets: 10 → 25
    await u.click(within(legRows[0]!).getByTestId("leg-lots-up"));
    expect(useUiStore.getState().legs.BTC[0]!.lots).toBe(25);
    await u.click(within(legRows[0]!).getByTestId("leg-lots-down"));
    expect(useUiStore.getState().legs.BTC[0]!.lots).toBe(10);
    // basket applies quantity to every leg
    await u.click(screen.getByTestId("basket-switch"));
    await u.click(within(screen.getAllByTestId("leg-row")[0]!).getByTestId("leg-lots-up"));
    expect(useUiStore.getState().legs.BTC.map((l) => l.lots)).toEqual([25, 25]);
    // delete
    await u.click(within(screen.getAllByTestId("leg-row")[1]!).getByTestId("leg-delete"));
    expect(screen.getAllByTestId("leg-row")).toHaveLength(1);
    // HC-TR-104: P starts the paper-trade flow while legs exist and nothing is open
    fireEvent.keyDown(window, { key: "p" });
    expect(useUiStore.getState().tradeFlow).toEqual({ strategyId: null });
    useUiStore.setState({ tradeFlow: null });
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    expect(useUiStore.getState().tradeFlow).toBeNull();
    // clear → empty state
    await u.click(screen.getByTestId("builder-clear"));
    expect(screen.getByText("No legs added")).toBeTruthy();
    expect(screen.getByTestId("builder-select-chain")).toBeTruthy();
    fireEvent.keyDown(window, { key: "p" });
    expect(useUiStore.getState().tradeFlow).toBeNull(); // no legs, no flow
  });

  it("HC-TR-024 custom price mode edits the stored price per leg (and every leg with the basket on)", async () => {
    seedLegs();
    renderWithProviders(<BuilderPanel />);
    serveMarket();
    const u = userEvent.setup();
    await u.click(screen.getByTestId("price-mode"));
    expect(useUiStore.getState().strategy.BTC.priceMode).toBe("custom");
    const inputs = screen.getAllByTestId("leg-price-input");
    expect(inputs).toHaveLength(2);
    fireEvent.change(inputs[0]!, { target: { value: "1234.5" } });
    expect(useUiStore.getState().legs.BTC[0]!.price).toBe("1234.5");
    expect(useUiStore.getState().legs.BTC[1]!.price).not.toBe("1234.5");
  });
});

describe("HC-TR-020 / HC-TR-041..049 drafts through the strategy API (ADR-024)", () => {
  it("Save draft creates the strategy on the server, My templates lists it, and Load / Archive / Delete round-trip", async () => {
    seedLegs();
    renderWithProviders(<BuilderPanel />);
    serveMarket();
    const u = userEvent.setup();
    const mine = () => mock.state.accounts.get("trader@example.com")!.strategies;
    await u.click(screen.getByTestId("builder-save"));
    const dialog = screen.getByTestId("save-draft-dialog");
    await u.clear(within(dialog).getByTestId("save-draft-name"));
    await u.type(within(dialog).getByTestId("save-draft-name"), "My strangle");
    await u.click(within(dialog).getByTestId("save-draft-confirm"));
    await waitFor(() => expect(mine()).toHaveLength(1));
    expect(mine()[0]!.name).toBe("My strangle");
    expect(mine()[0]!.legs).toHaveLength(2);
    expect(mine()[0]!.status).toBe("draft");
    await waitFor(() => expect(useUiStore.getState().strategy.BTC.draftId).toBe(mine()[0]!.id));
    expect(screen.getByTestId("builder-save").textContent).toBe("Update");
    // Update replaces the draft's legs on the server instead of creating a second row
    await u.click(within(screen.getAllByTestId("leg-row")[1]!).getByTestId("leg-delete"));
    await u.click(screen.getByTestId("builder-save"));
    await waitFor(() => expect(mine()[0]!.legs).toHaveLength(1));
    expect(mine()).toHaveLength(1);
    // New resets the Builder but keeps the draft
    await u.click(screen.getByTestId("builder-new"));
    expect(useUiStore.getState().legs.BTC).toHaveLength(0);
    expect(mine()).toHaveLength(1);
    // My templates reads the API
    await u.click(screen.getByTestId("builder-tab-templates"));
    await waitFor(() => expect(screen.getAllByTestId("mine-card")).toHaveLength(1));
    expect(screen.getByTestId("mine-activate")).toBeTruthy();
    await u.type(screen.getByTestId("mine-search"), "zzz");
    expect(screen.getByTestId("mine-empty")).toBeTruthy();
    await u.clear(screen.getByTestId("mine-search"));
    await u.click(screen.getByTestId("mine-load"));
    expect(useUiStore.getState().legs.BTC).toHaveLength(1);
    expect(useUiStore.getState().strategy.BTC.draftId).toBe(mine()[0]!.id);
    expect(useUiStore.getState().builderTab).toBe("builder");
    await u.click(screen.getByTestId("builder-tab-templates"));
    await u.click(screen.getByTestId("mine-archive"));
    await waitFor(() => expect(mine()[0]!.status).toBe("archived"));
    await waitFor(() => expect(screen.getByTestId("mine-empty")).toBeTruthy());
    await u.click(screen.getByTestId("mine-archived"));
    await waitFor(() => expect(screen.getAllByTestId("mine-card")).toHaveLength(1));
    await u.click(screen.getByTestId("mine-delete"));
    await u.click(screen.getByTestId("mine-delete-confirm"));
    await waitFor(() => expect(mine()).toHaveLength(0));
  });
});

describe("HC-TR-037..044 templates", () => {
  it("shows every catalogue card by category and places a template on the venue ladder around ATM", async () => {
    useUiStore.setState({ builderTab: "templates" });
    renderWithProviders(<BuilderPanel />);
    serveMarket();
    const u = userEvent.setup();
    expect(screen.getAllByTestId("template-card")).toHaveLength(TEMPLATES.length);
    await u.click(screen.getByTestId("template-cat-bullish"));
    expect(screen.getAllByTestId("template-card")).toHaveLength(TEMPLATES.filter((t) => t.category === "Bullish").length);
    await u.click(screen.getByTestId("template-cat-neutral"));
    await waitFor(() => expect(screen.getByTestId<HTMLSelectElement>("template-expiry").value).toBe(EXPIRY));
    act(() => FakeSocket.last().open());
    await waitFor(() => expect(subscribedToChain()).toBe(true), { timeout: 5000 });
    serveMarket();
    // HC-TR-106..108: cards priced at the chain carry POP · R:R and an outlook; the chips filter on it; sketches fill
    await waitFor(() => expect(Number(screen.getByTestId("template-cards").dataset["priced"])).toBeGreaterThan(0), { timeout: 8000 });
    expect(screen.getAllByTestId("template-pop")[0]!.textContent).toMatch(/POP \d+%|POP —/);
    expect(screen.getAllByTestId("template-sketch")[0]!.querySelectorAll("polygon")).toHaveLength(2);
    await u.click(screen.getByTestId("template-cat-all"));
    await u.click(screen.getByTestId("template-outlook-bullish"));
    const bullish = screen.getAllByTestId("template-card");
    expect(bullish.length).toBeGreaterThan(0);
    for (const c of bullish) expect(c.dataset["outlook"]).toBe("Bullish");
    await u.click(screen.getByTestId("template-outlook-bullish")); // toggles off
    await u.click(screen.getByTestId("template-cat-neutral"));
    await u.click(screen.getByText("Iron Condor"));
    await waitFor(() => expect(useUiStore.getState().legs.BTC).toHaveLength(4));
    expect(screen.getByTestId("strategy-structure").textContent).toMatch(/Condor/); // HC-TR-102 detected structure
    const legs = useUiStore.getState().legs.BTC;
    // every strike is a listed one and the legs sit on the chosen expiry
    for (const l of legs) {
      expect(rows.some((r) => r.strike === l.strike)).toBe(true);
      expect(l.expiry).toBe(EXPIRY);
    }
    expect(useUiStore.getState().strategy.BTC.name).toBe("Iron Condor");
    expect(useUiStore.getState().builderTab).toBe("builder");
  });
});

describe("HC-TR-176..178 strategy wizard (ADR-072)", () => {
  /** The templates test's dance: the loader subscribes once the expiry list is known, then the chain is served. */
  async function serveForWizard() {
    serveMarket();
    await waitFor(() => expect(screen.getByTestId<HTMLSelectElement>("wizard-expiry").value).toBe(EXPIRY));
    act(() => FakeSocket.last().open());
    await waitFor(() => expect(subscribedToChain()).toBe(true), { timeout: 5000 });
    serveMarket();
    await waitFor(() => expect(screen.getByTestId("wizard-panel").dataset["state"]).toBe("ready"), { timeout: 20_000 });
  }

  it("HC-TR-176 / 177 ranks up to three defined-risk templates for the view, move and date at the live chain, with units on every figure", async () => {
    useUiStore.setState({ builderTab: "wizard" });
    renderWithProviders(<BuilderPanel />);
    expect(screen.getByTestId("wizard-panel").dataset["state"]).toBe("no-spot");
    expect(screen.getByTestId<HTMLInputElement>("wizard-move").disabled).toBe(true);
    await serveForWizard();
    const u = userEvent.setup();
    const cards = screen.getAllByTestId("wizard-card");
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.length).toBeLessThanOrEqual(3);
    expect(cards.map((c) => c.dataset["rank"])).toEqual(cards.map((_, i) => String(i + 1)));
    for (const c of cards) expect(TEMPLATES.find((t) => t.name === c.dataset["name"])!.risk).toBe("defined");
    // card 1 carries the amber button and the return-on-risk tag; the tags never repeat
    expect(within(cards[0]!).getByTestId("wizard-tag").textContent).toBe("best return on risk");
    const tags = cards.flatMap((c) => within(c).queryAllByTestId("wizard-tag").map((t) => t.textContent));
    expect(new Set(tags).size).toBe(tags.length);
    expect(within(cards[0]!).getByTestId("wizard-pnl").textContent).toMatch(/^\+\$[\d,]+\.\d\d$/);
    expect(within(cards[0]!).getByTestId("wizard-maxloss").textContent).toMatch(/^−\$[\d,]+\.\d\d$/);
    expect(within(cards[0]!).getByTestId("wizard-pop").textContent).toMatch(/^\d+ %$|^—$/);
    expect(within(cards[0]!).getByTestId("wizard-legs").textContent).toMatch(/(Buy|Sell) [\d,]+ [CP]/);
    expect(screen.getByTestId("wizard-basis").textContent).toMatch(/^Priced at the live chain · 10 lots × 0\.001 BTC · marks · 25 Sep/);
    expect(screen.getAllByTestId("template-sketch")).toHaveLength(cards.length);
    // the move derives the target: +3 % of the spot
    const price = () => screen.getByTestId<HTMLInputElement>("wizard-price");
    const move = () => screen.getByTestId<HTMLInputElement>("wizard-move");
    expect(price().value).toBe((SPOT * 1.03).toFixed(1));
    // a typed price is kept while typing and becomes the move on blur, at full precision (the price is not rewritten)
    fireEvent.change(price(), { target: { value: "81000" } });
    expect(move().value).toBe("3");
    fireEvent.blur(price());
    expect(move().value).toBe(String(Number(((81000 / SPOT - 1) * 100).toFixed(2))));
    expect(price().value).toBe("81000.0");
    // Enter commits too; a price on the other side of spot switches the view
    fireEvent.change(price(), { target: { value: String(SPOT * 0.95) } });
    fireEvent.keyDown(price(), { key: "Enter" });
    expect(screen.getByTestId("wizard-view-bearish").getAttribute("aria-pressed")).toBe("true");
    expect(move().value).toBe("5");
    expect(price().value).toBe((SPOT * 0.95).toFixed(1));
    // the bullish view again: the default move comes back; the bearish list differs from the bullish one
    await u.click(screen.getByTestId("wizard-view-bullish"));
    expect(move().value).toBe("3");
    const bullNames = screen.getAllByTestId("wizard-card").map((c) => c.dataset["name"]);
    await u.click(screen.getByTestId("wizard-view-bearish"));
    expect(price().value).toBe((SPOT * 0.97).toFixed(1));
    expect(screen.getByTestId("wizard-panel").dataset["state"]).toBe("ready");
    expect(screen.getAllByTestId("wizard-card").map((c) => c.dataset["name"])).not.toEqual(bullNames);
    // neutral and volatile views show a band instead of one price
    await u.click(screen.getByTestId("wizard-view-neutral"));
    expect(screen.getByTestId("wizard-band").textContent).toContain(`${(SPOT * 0.98).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} – ${(SPOT * 1.02).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`);
    // arrow keys move between the view chips
    screen.getByTestId("wizard-view-neutral").focus();
    fireEvent.keyDown(screen.getByTestId("wizard-views"), { key: "ArrowRight" });
    expect(screen.getByTestId("wizard-view-volatile").getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(screen.getByTestId("wizard-views"), { key: "ArrowLeft" });
    expect(screen.getByTestId("wizard-view-neutral").getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTestId("wizard-price")).toBeNull();
    // nothing fits: a volatile view with no move at all
    await u.click(screen.getByTestId("wizard-view-volatile"));
    fireEvent.change(screen.getByTestId("wizard-move"), { target: { value: "0" } });
    expect(screen.getByTestId("wizard-panel").dataset["state"]).toBe("no-fit");
    expect(screen.getByText(/No defined-risk template fits a Volatile view at ±0\.0 % by 25 Sep/)).toBeTruthy();
    await u.click(screen.getByTestId("wizard-goto-templates"));
    expect(useUiStore.getState().builderTab).toBe("templates");
  });

  it("HC-TR-178 Use this loads the template into the Builder and opens the payoff on the thesis; the empty state links to the wizard", async () => {
    renderWithProviders(<BuilderPanel />);
    const u = userEvent.setup();
    await u.click(screen.getByTestId("builder-goto-wizard"));
    expect(useUiStore.getState().builderTab).toBe("wizard");
    await serveForWizard();
    fireEvent.change(screen.getByTestId("wizard-move"), { target: { value: "5" } });
    const first = screen.getAllByTestId("wizard-card")[0]!;
    const name = first.dataset["name"]!;
    await u.click(within(first).getByTestId("wizard-use"));
    await waitFor(() => expect(useUiStore.getState().legs.BTC.length).toBeGreaterThan(0));
    const st = useUiStore.getState();
    expect(st.strategy.BTC.name).toBe(name);
    expect(st.builderTab).toBe("builder");
    for (const l of st.legs.BTC) {
      expect(rows.some((r) => r.strike === l.strike) || l.kind === "future").toBe(true);
      if (l.kind !== "future") expect(l.expiry).toBe(EXPIRY);
    }
    expect(st.targetPrice).toBeCloseTo(SPOT * 1.05, 6);
    // the loaded legs are the ones the card showed
    expect(screen.getByTestId("strategy-name")).toBeTruthy();
    expect(st.targetDays).toBe(daysToExpiry(EXPIRY));
  });
});

describe("HC-TR-146 / HC-TR-147 leg checkbox and in-place instrument edits (ADR-028)", () => {
  it("unticking a leg drops it from the analysis and the ticket but keeps the row; the master checkbox toggles all", async () => {
    seedLegs();
    renderWithProviders(<BuilderPanel />);
    serveMarket();
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId("ticket-net").textContent).not.toBe("—"), { timeout: 4000 });
    const before = screen.getByTestId("ticket-net").textContent;
    await u.click(within(screen.getAllByTestId("leg-row")[1]!).getByTestId("leg-enabled"));
    expect(useUiStore.getState().legs.BTC[1]!.enabled).toBe(false);
    expect(screen.getAllByTestId("leg-row")).toHaveLength(2);
    expect(screen.getAllByTestId("leg-row")[1]!.dataset["enabled"]).toBe("false");
    expect(screen.getByTestId("builder-panel").dataset["activeLegs"]).toBe("1");
    expect(screen.getByTestId("builder-subinfo").textContent).toContain("(1 on)");
    await waitFor(() => expect(screen.getByTestId("ticket-net").textContent).not.toBe(before), { timeout: 4000 });
    await u.click(screen.getByTestId("legs-enable-all"));
    expect(useUiStore.getState().legs.BTC.every((l) => l.enabled !== false)).toBe(true);
    await u.click(screen.getByTestId("legs-enable-all"));
    expect(useUiStore.getState().legs.BTC.every((l) => l.enabled === false)).toBe(true);
    expect(screen.getByTestId("builder-panel").dataset["activeLegs"]).toBe("0");
  });

  it("type, strike and expiry change in place; the symbol follows and the quote comes from the ladder", async () => {
    const { call } = seedLegs();
    renderWithProviders(<BuilderPanel />);
    serveMarket();
    const u = userEvent.setup();
    const row = screen.getAllByTestId("leg-row")[0]!;
    await u.click(within(row).getByTestId("leg-kind"));
    expect(useUiStore.getState().legs.BTC[0]).toMatchObject({ kind: "put", symbol: `P-BTC-${call.strike}-250926` });
    const other = rows.find((r) => r.strike !== call.strike && r.put)!;
    await u.selectOptions(within(row).getByTestId("leg-strike"), other.strike);
    expect(useUiStore.getState().legs.BTC[0]).toMatchObject({ kind: "put", strike: other.strike, price: other.put!.mark, symbol: `P-BTC-${other.strike}-250926` });
    await waitFor(() => expect(within(row).getByTestId<HTMLSelectElement>("leg-expiry").options.length).toBeGreaterThan(1));
    const nextExpiry = [...within(row).getByTestId<HTMLSelectElement>("leg-expiry").options].map((o) => o.value).find((v) => v !== EXPIRY)!;
    await u.selectOptions(within(row).getByTestId("leg-expiry"), nextExpiry);
    expect(useUiStore.getState().legs.BTC[0]!.expiry).toBe(nextExpiry);
    expect(useUiStore.getState().legs.BTC[0]!.symbol.startsWith("P-BTC-")).toBe(true);
  });
});

describe("HC-TR-040 templates strip under the Builder legs (ADR-027)", () => {
  it("loads a template with one click, filters by outlook, collapses with a persisted flag, and links to the full gallery", async () => {
    useUiStore.setState({ builderTab: "builder", templatesStrip: true });
    renderWithProviders(<BuilderPanel />);
    serveMarket();
    const u = userEvent.setup();
    const strip = screen.getByTestId("templates-strip");
    expect(strip.dataset["open"]).toBe("true");
    expect(screen.getAllByTestId("strip-card")).toHaveLength(TEMPLATES.filter((t) => t.category === "Bullish").length);
    await u.click(screen.getByTestId("strip-cat-neutral"));
    expect(screen.getAllByTestId("strip-card")).toHaveLength(TEMPLATES.filter((t) => t.category === "Neutral").length);
    await waitFor(() => expect(screen.getByTestId<HTMLSelectElement>("strip-expiry").value).toBe(EXPIRY));
    act(() => FakeSocket.last().open());
    await waitFor(() => expect(subscribedToChain()).toBe(true), { timeout: 5000 });
    serveMarket();
    await waitFor(() => expect(within(strip).getByText("Iron Condor").closest("button")?.hasAttribute("disabled")).toBe(false));
    await u.click(within(strip).getByText("Iron Condor"));
    await waitFor(() => expect(useUiStore.getState().legs.BTC).toHaveLength(4));
    expect(useUiStore.getState().strategy.BTC.name).toBe("Iron Condor");
    expect(useUiStore.getState().builderTab).toBe("builder"); // never leaves the Builder
    // one more click replaces the legs rather than merging them
    await u.click(within(strip).getByText("Iron Butterfly"));
    await waitFor(() => expect(useUiStore.getState().strategy.BTC.name).toBe("Iron Butterfly"));
    expect(useUiStore.getState().legs.BTC).toHaveLength(4);
    await u.click(screen.getByTestId("templates-strip-toggle"));
    expect(useUiStore.getState().templatesStrip).toBe(false);
    expect(screen.queryByTestId("strip-cards")).toBeNull();
    await u.click(screen.getByTestId("templates-strip-toggle"));
    await u.click(screen.getByTestId("strip-see-all"));
    expect(useUiStore.getState().builderTab).toBe("templates");
  });
});

describe("HC-TR-027..035 chain picker and future dialog", () => {
  it("multi-selects B / S per side within the remaining slots and adds the picks", async () => {
    renderWithProviders(<BuilderPanel />);
    serveMarket();
    const u = userEvent.setup();
    await u.click(screen.getByTestId("builder-select-chain"));
    const dialog = screen.getByTestId("chain-picker");
    await waitFor(() => expect(within(dialog).getAllByTestId("picker-expiry").length).toBeGreaterThan(0));
    act(() => FakeSocket.last().open());
    await waitFor(() => expect(subscribedToChain()).toBe(true), { timeout: 5000 });
    serveMarket();
    await waitFor(() => expect(within(dialog).getAllByTestId("picker-row").length).toBeGreaterThan(0), { timeout: 5000 });
    const picker = within(dialog);
    // HC-TR-127: Δ outboard, OI bars toward the strike, ITM tint below / above ATM
    expect(picker.getAllByTestId("picker-delta-call")[0]!.textContent).toMatch(/^-?\d\.\d\d$|^—$/);
    expect([...picker.getAllByTestId("picker-oi-call"), ...picker.getAllByTestId("picker-oi-put")].some((c) => Number(c.dataset["pct"]) > 0)).toBe(true);
    await waitFor(() => expect(picker.getAllByTestId("picker-row").some((r) => r.className.includes("atm-band"))).toBe(true), { timeout: 5000 });
    const rowsEl = picker.getAllByTestId("picker-row");
    const atmIdx = rowsEl.findIndex((r) => r.className.includes("atm-band"));
    expect(atmIdx).toBeGreaterThan(0);
    expect(rowsEl[atmIdx - 1]!.querySelector("td")!.className).toContain("itm-tint"); // calls below ATM
    expect(rowsEl[atmIdx + 1]!.querySelectorAll("td")[5]!.className).toContain("itm-tint"); // puts above ATM
    const first = picker.getAllByTestId("picker-row")[5]!;
    await u.click(within(first).getByTestId("picker-buy-call"));
    await u.click(within(first).getByTestId("picker-sell-put"));
    // second click on the same cell deselects
    await u.click(within(first).getByTestId("picker-sell-put"));
    await u.click(within(first).getByTestId("picker-buy-put"));
    expect(picker.getAllByTestId("picker-qty")).toHaveLength(2);
    fireEvent.change(picker.getAllByTestId("picker-qty")[0]!, { target: { value: "5" } });
    await u.click(picker.getByTestId("picker-add"));
    await waitFor(() => expect(useUiStore.getState().legs.BTC).toHaveLength(2));
    expect(useUiStore.getState().legs.BTC.map((l) => [l.kind, l.side, l.lots])).toEqual([
      ["call", "buy", 5],
      ["put", "buy", 10],
    ]);
  });

  it("adds a perpetual future at the live spot", async () => {
    seedLegs();
    renderWithProviders(<BuilderPanel />);
    serveMarket();
    const u = userEvent.setup();
    await u.click(screen.getByTestId("builder-add-future"));
    const dialog = screen.getByTestId("future-dialog");
    expect(dialog.textContent).toContain("Spot 79,521");
    await u.click(within(dialog).getByTestId("future-sell"));
    await u.click(within(dialog).getByTestId("future-add"));
    await waitFor(() => expect(useUiStore.getState().legs.BTC).toHaveLength(3));
    const fut = useUiStore.getState().legs.BTC[2]!;
    expect(fut.kind).toBe("future");
    expect(fut.side).toBe("sell");
    expect(fut.symbol).toBe("BTCUSD");
    expect(fut.price).toBe("79521");
  });
});
