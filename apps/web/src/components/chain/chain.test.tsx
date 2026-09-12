import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { chainTopic } from "@hapiecoin/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildChain, strikesOf } from "../../../test/fixtures/chain";
import { FakeSocket, renderWithProviders } from "../../../test/helpers";
import { applyPreset, defaultLayout, moveColumn } from "@/lib/chain/layout";
import { applySnapshot, emptyChain, applyDeltas, atmIndex } from "@/lib/gateway/reducer";
import { useUiStore } from "@/lib/store";
import { ChainPanel } from "./ChainPanel";
import { ChainTable, type ChainTableProps, quoteFlashes } from "./ChainTable";

const EXPIRY = "2026-09-25";
const TOPIC = chainTopic("delta_india", "BTC", EXPIRY);
const rows = buildChain("BTC", EXPIRY);
// spot 50,500 puts the ATM row (50,000, index 2) inside jsdom's un-scrollable first viewport;
// the bracketing rule itself is unit-tested against 79,521 in reducer.test.ts.
const SPOT = "50500";

function tableProps(over: Partial<ChainTableProps> = {}): ChainTableProps {
  return {
    chain: applySnapshot(emptyChain(TOPIC), 0, rows, 1),
    spot: SPOT,
    height: 520,
    range: 12,
    onRange: vi.fn(),
    layout: defaultLayout(),
    expiryLabel: "25 Sep",
    daysLeft: 18,
    lotLabel: "Lot ₿ · USD per contract",
    live: true,
    asOf: null,
    ...over,
  };
}

beforeEach(() => {
  FakeSocket.reset();
  useUiStore.setState({
    asset: "BTC",
    expiry: {},
    feedPaused: false,
    dialog: null,
    dialogsTouched: false,
    paletteOpen: false,
    chainRange: 12,
    chainRecentre: 0,
    chainColumns: defaultLayout(),
    legs: { BTC: [], ETH: [], XAUT: [] },
    chainLots: 10,
    optionDetail: null,
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("HC-WS-023 / HC-WS-024 / HC-WS-025 row controls add legs at mark", () => {
  it("hover shows the control on both sides, B / S add with the stepper lots, − / + step the presets, ⓘ asks for details", async () => {
    const onAddLeg = vi.fn();
    const onLots = vi.fn();
    const onInfo = vi.fn();
    renderWithProviders(<ChainTable {...tableProps({ onAddLeg, onLots, onInfo, lots: 10, lotsTitle: "Lots × 0.001 BTC" })} />);
    const u = userEvent.setup();
    expect(screen.queryByTestId("row-controls-calls")).toBeNull();
    const row = screen.getAllByTestId("chain-row-calls")[3]!;
    await u.hover(row);
    const calls = screen.getByTestId("row-controls-calls");
    const puts = screen.getByTestId("row-controls-puts");
    expect(calls.dataset["strike"]).toBe(row.dataset["strike"]);
    expect(puts.dataset["strike"]).toBe(row.dataset["strike"]);
    expect(screen.getByTestId("row-lots-value-calls").textContent).toBe("10");
    expect(screen.getByTestId("row-lots-calls").getAttribute("title")).toBe("Lots × 0.001 BTC");
    // user-event moves the pointer with a mouseout whose relatedTarget is null (jsdom), which React reads as
    // leaving the table; real browsers name the button, and the e2e tests cover that path. Click directly here.
    fireEvent.click(screen.getByTestId("row-buy-calls"));
    const strike = row.dataset["strike"]!;
    const quote = rows.find((r) => r.strike === strike)!;
    expect(onAddLeg).toHaveBeenLastCalledWith("call", "buy", strike, quote.call);
    fireEvent.click(screen.getByTestId("row-sell-puts"));
    expect(onAddLeg).toHaveBeenLastCalledWith("put", "sell", strike, quote.put);
    fireEvent.click(screen.getByTestId("row-lots-up-calls"));
    expect(onLots).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByTestId("row-lots-down-puts"));
    expect(onLots).toHaveBeenLastCalledWith(-1);
    fireEvent.click(screen.getByTestId("row-info-puts"));
    expect(onInfo).toHaveBeenLastCalledWith("put", strike);
    expect(screen.getByTestId("row-buy-calls").getAttribute("aria-label")).toMatch(/^Buy call /);
    // leaving the table hides the control (React maps mouseout with an outside relatedTarget to onMouseLeave)
    fireEvent.mouseOut(screen.getByTestId("chain-scroll").firstElementChild!, { relatedTarget: document.body });
    expect(screen.getByTestId("chain-table").dataset["active"]).toBe("-1");
    expect(screen.queryByTestId("row-controls-calls")).toBeNull();
  });
  it("HC-TR-017 at the limit the B / S buttons are disabled with the reason", async () => {
    renderWithProviders(<ChainTable {...tableProps({ onAddLeg: vi.fn(), atLimit: true })} />);
    await userEvent.setup().hover(screen.getAllByTestId("chain-row-puts")[2]!);
    expect(screen.getByTestId("row-buy-puts").hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("row-sell-calls").getAttribute("title")).toBe("Maximum 10 legs");
  });
});

describe("HC-WS-027 leg pills, mark outline, stripes and filled buttons follow the legs", () => {
  it("marks the rows that hold legs on the right side only", async () => {
    const strike = rows[4]!.strike;
    const other = rows[6]!.strike;
    const legs = [
      { id: "l1", asset: "BTC" as const, kind: "call" as const, side: "buy" as const, strike, expiry: EXPIRY, lots: 10, price: "1", symbol: "C-BTC-x", status: "open" as const, createdAt: 1 },
      { id: "l2", asset: "BTC" as const, kind: "put" as const, side: "sell" as const, strike, expiry: EXPIRY, lots: 3, price: "1", symbol: "P-BTC-x", status: "open" as const, createdAt: 1 },
      { id: "l3", asset: "BTC" as const, kind: "call" as const, side: "sell" as const, strike: other, expiry: EXPIRY, lots: 2, price: "1", symbol: "C-BTC-y", status: "open" as const, createdAt: 1 },
    ];
    renderWithProviders(<ChainTable {...tableProps({ legs, onAddLeg: vi.fn(), range: 0 })} />);
    const strikeRow = screen.getAllByTestId("chain-row").find((r) => r.dataset["strike"] === strike)!;
    expect(strikeRow.dataset["legs"]).toBe("C B 10|P S 3");
    const pills = within(strikeRow).getByTestId("leg-pills");
    expect(within(pills).getByText("C B 10").className).toContain("text-buy");
    expect(within(pills).getByText("P S 3").className).toContain("text-sell");
    const callsRow = screen.getAllByTestId("chain-row-calls").find((r) => r.dataset["strike"] === strike)!;
    const putsRow = screen.getAllByTestId("chain-row-puts").find((r) => r.dataset["strike"] === strike)!;
    expect(callsRow.dataset["leg"]).toBe("buy");
    expect(callsRow.className).toContain("leg-stripe-buy");
    expect(callsRow.querySelector("[data-col=mark]")?.className).toContain("legcell-buy");
    expect(putsRow.dataset["leg"]).toBe("sell");
    expect(putsRow.className).toContain("leg-stripe-sell-r");
    expect(putsRow.querySelector("[data-col=mark]")?.className).toContain("legcell-sell");
    const otherCalls = screen.getAllByTestId("chain-row-calls").find((r) => r.dataset["strike"] === other)!;
    expect(otherCalls.dataset["leg"]).toBe("sell");
    const otherPuts = screen.getAllByTestId("chain-row-puts").find((r) => r.dataset["strike"] === other)!;
    expect(otherPuts.dataset["leg"]).toBeUndefined();
    expect(otherPuts.querySelector("[data-col=mark]")?.className).not.toContain("legcell");
    // the ATM row without legs keeps its tag; hover fills the held button
    expect(screen.getAllByTestId("chain-row").find((r) => r.dataset["atm"] === "true")?.textContent).toContain("ATM ·");
    await userEvent.setup().hover(callsRow);
    expect(screen.getByTestId("row-buy-calls").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("row-sell-calls").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("row-sell-puts").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("HC-WS-028 keys B / S / Shift+B / Shift+S / Enter / Esc / + / −", () => {
  it("act on the highlighted row", async () => {
    const onAddLeg = vi.fn();
    const onLots = vi.fn();
    const onInfo = vi.fn();
    renderWithProviders(<ChainTable {...tableProps({ onAddLeg, onLots, onInfo })} />);
    const u = userEvent.setup();
    const grid = screen.getByTestId("chain-scroll");
    grid.focus();
    await u.keyboard("j");
    const focused = screen.getAllByTestId("chain-row").find((r) => r.dataset["focus"] === "true")!;
    const strike = focused.dataset["strike"]!;
    const quote = rows.find((r) => r.strike === strike)!;
    // the highlighted row shows the control too
    expect(screen.getByTestId("row-controls-calls").dataset["strike"]).toBe(strike);
    await u.keyboard("b");
    expect(onAddLeg).toHaveBeenLastCalledWith("call", "buy", strike, quote.call);
    await u.keyboard("s");
    expect(onAddLeg).toHaveBeenLastCalledWith("call", "sell", strike, quote.call);
    await u.keyboard("{Shift>}B{/Shift}");
    expect(onAddLeg).toHaveBeenLastCalledWith("put", "buy", strike, quote.put);
    await u.keyboard("{Shift>}S{/Shift}");
    expect(onAddLeg).toHaveBeenLastCalledWith("put", "sell", strike, quote.put);
    await u.keyboard("{Enter}");
    expect(onInfo).toHaveBeenLastCalledWith("call", strike);
    await u.keyboard("{Shift>}{Enter}{/Shift}");
    expect(onInfo).toHaveBeenLastCalledWith("put", strike);
    await u.keyboard("+");
    expect(onLots).toHaveBeenLastCalledWith(1);
    await u.keyboard("-");
    expect(onLots).toHaveBeenLastCalledWith(-1);
    await u.keyboard("{Escape}");
    expect(screen.queryByTestId("row-controls-calls")).toBeNull();
    expect(screen.getAllByTestId("chain-row").some((r) => r.dataset["focus"] === "true")).toBe(false);
  });
});

describe("HC-WS-021 ChainTable renders the visible columns from the strike outward, mirrored on the calls side", () => {
  it("shows every column with its unit title, in layout order, and formats the extra figures", () => {
    const all = applyPreset(defaultLayout(), "all");
    renderWithProviders(<ChainTable {...tableProps({ layout: all, range: 0, onOpenColumns: vi.fn() })} />);
    const table = screen.getByTestId("chain-table");
    expect(table.dataset["columns"]).toBe("ask,mark,bid,oi,delta,gamma,theta,vega,volume,bidQty,askQty,chg24,last");
    const putHeads = within(screen.getByTestId("chain-head-puts")).getAllByTitle(/./).map((e) => e.dataset["col"]);
    expect(putHeads).toEqual(["ask", "mark", "bid", "oi", "delta", "gamma", "theta", "vega", "volume", "bidQty", "askQty", "chg24", "last"]);
    const callHeads = within(screen.getByTestId("chain-head-calls")).getAllByTitle(/./).map((e) => e.dataset["col"]);
    expect(callHeads).toEqual([...putHeads].reverse());
    expect(within(screen.getByTestId("chain-head-puts")).getByTitle(/Theta, USD per unit per day/)).toBeTruthy();
    const first = screen.getAllByTestId("chain-row-puts")[0]!;
    expect(first.querySelectorAll("[data-col]")).toHaveLength(13);
    expect(first.querySelector("[data-col=gamma]")?.textContent).toMatch(/^(—|-?\d+\.\d{6})$/);
    expect(first.querySelector("[data-col=theta]")?.textContent).toMatch(/^(—|-?\d+\.\d)$/);
    expect(first.querySelector("[data-col=chg24]")?.textContent).toMatch(/^(—|[+-]?\d+\.\d\d%)$/);
    // the gear reports the count and opens the dialog through the callback
    expect(screen.getByTestId("chain-columns").textContent).toContain("13");
  });
  it("a reordered layout moves the column next to the strike on both sides; an empty layout keeps the strike column", async () => {
    const moved = moveColumn(defaultLayout(), "delta", -4);
    const { rerender } = renderWithProviders(<ChainTable {...tableProps({ layout: moved })} />);
    expect(screen.getByTestId("chain-table").dataset["columns"]).toBe("delta,ask,mark,bid,oi");
    const putHeads = within(screen.getByTestId("chain-head-puts")).getAllByTitle(/./).map((e) => e.dataset["col"]);
    expect(putHeads[0]).toBe("delta");
    const callHeads = within(screen.getByTestId("chain-head-calls")).getAllByTitle(/./).map((e) => e.dataset["col"]);
    expect(callHeads[callHeads.length - 1]).toBe("delta");
    const onOpenColumns = vi.fn();
    rerender(<ChainTable {...tableProps({ layout: applyPreset(defaultLayout(), "none"), onOpenColumns })} />);
    expect(screen.getByTestId("chain-table").dataset["columns"]).toBe("");
    expect(screen.getAllByText("no columns").length).toBeGreaterThan(2);
    expect(screen.getAllByTestId("chain-row").length).toBeGreaterThan(5);
    await userEvent.setup().click(screen.getByTestId("chain-columns"));
    expect(onOpenColumns).toHaveBeenCalled();
  });
});

describe("HC-WS-108 ChainTable renders the venue strikes", () => {
  it("shows exact strikes on all three row lists, the ATM band on the strike bracketing spot and flashes", async () => {
    const props = tableProps({ range: 0 });
    const { rerender } = renderWithProviders(<ChainTable {...props} />);
    const table = screen.getByTestId("chain-table");
    expect(table.dataset["rows"]).toBe("52");
    expect(table.dataset["total"]).toBe("52");
    expect(within(table).getAllByText("Mark/IV")).toHaveLength(2);
    expect(within(table).getByText("Strike")).toBeTruthy();
    const rendered = screen.getAllByTestId("chain-row").map((r) => r.dataset["strike"]);
    const listed = strikesOf("BTC", EXPIRY);
    expect(rendered.every((s) => listed.includes(s!))).toBe(true);
    expect(rendered.length).toBeGreaterThan(5);
    // the calls and puts tracks carry the same strikes in the same order as the strike column
    expect(screen.getAllByTestId("chain-row-calls").map((r) => r.dataset["strike"])).toEqual(rendered);
    expect(screen.getAllByTestId("chain-row-puts").map((r) => r.dataset["strike"])).toEqual(rendered);
    const atm = screen.getAllByTestId("chain-row").find((r) => r.dataset["atm"] === "true");
    expect(atm?.dataset["strike"]).toBe("50000"); // last listed strike ≤ spot
    expect(within(atm!).getByText(/ATM · 50,500/)).toBeTruthy();
    // a delta on a visible instrument flashes the mark cell on the calls track (HC-WS-022)
    const first = screen.getAllByTestId("chain-row-calls")[0]!;
    const row = rows.find((r) => r.strike === first.dataset["strike"])!;
    const next = applyDeltas(props.chain, 1, [{ i: row.call!.instrumentId, mark: String(Number(row.call!.mark) + 10) }], 2);
    rerender(<ChainTable {...props} chain={next} />);
    await waitFor(() => expect(first.querySelector(".flash-up")).toBeTruthy());
  });
  it("quoteFlashes reports direction per field only for changed fields", () => {
    const prev = rows[5]!.call!;
    const next = { ...prev, mark: String(Number(prev.mark) + 1), bid: prev.bid };
    expect(quoteFlashes(prev, next, new Set(["mark", "bid"]))).toEqual({ bid: "", ask: "", mark: "flash-up" });
    expect(quoteFlashes(prev, { ...prev, ask: "0" }, new Set(["ask"])).ask).toBe("flash-down");
    expect(quoteFlashes(undefined, next, new Set(["mark"])).mark).toBe("");
    expect(quoteFlashes(prev, next, undefined).mark).toBe("");
  });
});

describe("HC-WS-015 / HC-WS-017 / HC-WS-018 / HC-WS-019 / HC-WS-020 chain layout", () => {
  it("HC-WS-015 renders the sticky two-row header with basis labels aligned to the tracks", () => {
    renderWithProviders(<ChainTable {...tableProps()} />);
    const table = screen.getByTestId("chain-table");
    expect(screen.getByTestId("chain-band-calls").textContent).toContain("Calls · ITM shaded · strikes ±12");
    expect(screen.getByTestId("chain-band-puts").textContent).toContain("Δ per unit · Puts");
    expect(screen.getByTestId("chain-band-expiry").textContent).toContain("25 Sep");
    expect(screen.getByTestId("chain-band-expiry").textContent).toContain("18d");
    expect(screen.getByTestId("chain-header").className).toContain("sticky");
    expect(screen.getByTestId("chain-head-calls").dataset["x"]).toBe(table.dataset["x"]);
    expect(screen.getByTestId("chain-head-puts").dataset["x"]).toBe(table.dataset["putsX"]);
    // calls columns read outer → inner and puts mirror them
    const heads = within(screen.getByTestId("chain-head-calls")).getAllByText(/./).map((e) => e.textContent);
    expect(heads).toEqual(["Δ", "OI", "Bid/IV", "Mark/IV", "Ask/IV"]);
    expect(within(screen.getByTestId("chain-head-puts")).getAllByText(/./).map((e) => e.textContent)).toEqual(["Ask/IV", "Mark/IV", "Bid/IV", "OI", "Δ"]);
  });
  it("HC-WS-016 the range control slices the venue list around ATM and the footer counts it", async () => {
    const onRange = vi.fn();
    renderWithProviders(<ChainTable {...tableProps({ onRange })} />);
    const table = screen.getByTestId("chain-table");
    // spot 50,500 → ATM index 2 → ±12 keeps rows 0..14
    expect(table.dataset["rows"]).toBe("15");
    expect(table.dataset["range"]).toBe("12");
    expect(screen.getByTestId("chain-count").textContent).toBe("15 of 52 strikes");
    expect(screen.getByTestId("chain-range-12").getAttribute("aria-pressed")).toBe("true");
    await userEvent.setup().click(screen.getByTestId("chain-range-6"));
    expect(onRange).toHaveBeenCalledWith(6);
    await userEvent.setup().click(screen.getByTestId("chain-range-0"));
    expect(onRange).toHaveBeenCalledWith(0);
  });
  it("HC-WS-017 / HC-WS-020 marks the ATM band on every row part and tints ITM cells only on the ITM side", () => {
    renderWithProviders(<ChainTable {...tableProps()} />);
    const atm = screen.getAllByTestId("chain-row").find((r) => r.dataset["atm"] === "true")!;
    expect(atm.className).toContain("atm-band");
    expect(atm.className).toContain("text-spot");
    const callsAtm = screen.getAllByTestId("chain-row-calls").find((r) => r.dataset["strike"] === atm.dataset["strike"])!;
    const putsAtm = screen.getAllByTestId("chain-row-puts").find((r) => r.dataset["strike"] === atm.dataset["strike"])!;
    expect(callsAtm.className).toContain("atm-band");
    expect(putsAtm.className).toContain("atm-band");
    // strikes below spot: calls ITM, puts not; above spot the other way round
    const below = screen.getAllByTestId("chain-row-calls").find((r) => Number(r.dataset["strike"]) < Number(SPOT))!;
    const belowPut = screen.getAllByTestId("chain-row-puts").find((r) => r.dataset["strike"] === below.dataset["strike"])!;
    expect(below.className).toContain("itm-tint");
    expect(belowPut.className).not.toContain("itm-tint");
    const above = screen.getAllByTestId("chain-row-puts").find((r) => Number(r.dataset["strike"]) > Number(SPOT))!;
    const aboveCall = screen.getAllByTestId("chain-row-calls").find((r) => r.dataset["strike"] === above.dataset["strike"])!;
    expect(above.className).toContain("itm-tint");
    expect(aboveCall.className).not.toContain("itm-tint");
  });
  it("HC-WS-018 / HC-WS-019 aligns price cells towards the strike and draws OI bars relative to the max OI", () => {
    renderWithProviders(<ChainTable {...tableProps()} />);
    const calls = screen.getAllByTestId("chain-row-calls")[0]!;
    const puts = screen.getAllByTestId("chain-row-puts")[0]!;
    expect(calls.querySelectorAll(".items-end").length).toBe(3);
    expect(calls.querySelector(".items-start")).toBeNull();
    expect(puts.querySelectorAll(".items-start").length).toBe(3);
    expect(puts.querySelector(".items-end")).toBeNull();
    const bars = screen.getAllByTestId("chain-oi").map((c) => Number(c.dataset["pct"]));
    expect(Math.max(...bars)).toBe(100);
    expect(bars.every((p) => p >= 0 && p <= 100)).toBe(true);
    const callBar = calls.querySelector(".oi-bar");
    const putBar = puts.querySelector(".oi-bar");
    if (callBar) expect(callBar.className).toContain("left-0");
    if (putBar) expect(putBar.className).toContain("right-0");
    // footer totals come from the visible rows
    expect(screen.getByTestId("chain-footer").textContent).toMatch(/Σ Call OI/);
    expect(screen.getByTestId("chain-footer").textContent).toMatch(/PCR/);
  });
  it("shows the stale state: dimmed rows, Stale dot and an 'as of' time", () => {
    const stale = { ...tableProps().chain, stale: true, updatedAt: 5 };
    renderWithProviders(<ChainTable {...tableProps({ chain: stale, live: false, asOf: "12:04:31" })} />);
    expect(screen.getByTestId("chain-table").className).toContain("opacity-60");
    expect(screen.getByTestId("chain-live").dataset["live"]).toBe("false");
    expect(screen.getByTestId("chain-live").textContent).toContain("Stale");
    expect(screen.getByTestId("chain-asof").textContent).toBe("as of 12:04:31");
  });
  it("HC-WS-009 the toolbar pill reads Live, Connecting, Stale or Paused from the feed state", () => {
    const { rerender } = renderWithProviders(<ChainTable {...tableProps({ feed: "connecting", live: false })} />);
    const pill = () => screen.getByTestId("chain-live");
    expect(pill().dataset["feed"]).toBe("connecting");
    expect(pill().textContent).toContain("Connecting");
    rerender(<ChainTable {...tableProps({ feed: "paused", live: false })} />);
    expect(pill().textContent).toContain("Paused");
    rerender(<ChainTable {...tableProps({ feed: "live", live: true })} />);
    expect(pill().textContent).toContain("Live");
    expect(pill().getAttribute("title")).toContain("gateway");
  });
});

describe("GAPS-2 calls and puts share the vertical scroll and mirror the horizontal scroll", () => {
  it("keeps one row list per side under one virtualiser and mirrors the offset from either side", () => {
    // 600 px panel: each side has (600 − 92) / 2 = 254 px for the 328 px essentials track → max offset 74
    renderWithProviders(<ChainTable {...tableProps({ initialWidth: 600 })} />);
    const table = screen.getByTestId("chain-table");
    expect(table.dataset["sides"]).toBe("both");
    expect(screen.getAllByTestId("chain-scroll")).toHaveLength(1);
    // initial: calls show their inner columns (offset at max), puts their inner columns (offset 0)
    expect(table.dataset["x"]).toBe("74");
    expect(table.dataset["putsX"]).toBe("0");
    expect(screen.getByTestId("chain-calls").dataset["x"]).toBe("74");
    expect(screen.getByTestId("chain-puts").dataset["x"]).toBe("0");
    // the calls scrollbar moves both sides
    const callsBar = screen.getByTestId("chain-scrollbar-calls");
    callsBar.scrollLeft = 20;
    fireEvent.scroll(callsBar);
    expect(table.dataset["x"]).toBe("20");
    expect(table.dataset["putsX"]).toBe("54");
    expect(screen.getByTestId("chain-head-calls").dataset["x"]).toBe("20");
    expect(screen.getByTestId("chain-head-puts").dataset["x"]).toBe("54");
    // the puts scrollbar moves the calls side the other way
    const putsBar = screen.getByTestId("chain-scrollbar-puts");
    putsBar.scrollLeft = 6;
    fireEvent.scroll(putsBar);
    expect(table.dataset["x"]).toBe("68");
    expect(table.dataset["putsX"]).toBe("6");
    // wheel on the puts track scrolls it and mirrors to calls; shift+wheel uses deltaY
    act(() => {
      screen.getByTestId("chain-puts").dispatchEvent(new WheelEvent("wheel", { deltaX: 10, bubbles: true, cancelable: true }));
    });
    expect(table.dataset["x"]).toBe("58");
    act(() => {
      screen.getByTestId("chain-calls").dispatchEvent(new WheelEvent("wheel", { deltaY: -10, shiftKey: true, bubbles: true, cancelable: true }));
    });
    expect(table.dataset["x"]).toBe("48");
    // a vertical wheel is left to the vertical scroller
    act(() => {
      screen.getByTestId("chain-calls").dispatchEvent(new WheelEvent("wheel", { deltaY: 30, bubbles: true, cancelable: true }));
    });
    expect(table.dataset["x"]).toBe("48");
  });
  it("has no horizontal offset when the track fits", () => {
    renderWithProviders(<ChainTable {...tableProps({ initialWidth: 1200 })} />);
    expect(screen.getByTestId("chain-table").dataset["x"]).toBe("0");
    expect(screen.getByTestId("chain-table").dataset["putsX"]).toBe("0");
    expect(screen.getByTestId("chain-scrollbar-calls").className).toContain("invisible");
  });
  it("shows one side at a time below 560 px with a toggle", async () => {
    renderWithProviders(<ChainTable {...tableProps({ initialWidth: 400 })} />);
    const table = screen.getByTestId("chain-table");
    expect(table.dataset["sides"]).toBe("calls");
    expect(screen.queryByTestId("chain-puts")).toBeNull();
    expect(screen.getByTestId("chain-side-calls").getAttribute("aria-pressed")).toBe("true");
    await userEvent.setup().click(screen.getByTestId("chain-side-puts"));
    expect(table.dataset["sides"]).toBe("puts");
    expect(screen.queryByTestId("chain-calls")).toBeNull();
    expect(screen.getByTestId("chain-puts")).toBeTruthy();
    expect(screen.getByTestId("chain-band-puts")).toBeTruthy();
  });
});

describe("HC-WS-016 keyboard: J / K / arrows / Home / End / A / E", () => {
  it("moves the highlighted strike, recentres on ATM, steps the expiry and shifts columns", async () => {
    const onExpiryStep = vi.fn();
    renderWithProviders(<ChainTable {...tableProps({ initialWidth: 600, onExpiryStep })} />);
    const user = userEvent.setup();
    const grid = screen.getByTestId("chain-scroll");
    const focused = () => screen.getAllByTestId("chain-row").find((r) => r.dataset["focus"] === "true")?.dataset["strike"];
    const atm = atmIndex(rows, SPOT);
    grid.focus();
    await user.keyboard("j");
    expect(focused()).toBe(rows[atm + 1]!.strike);
    await user.keyboard("{ArrowDown}");
    expect(focused()).toBe(rows[atm + 2]!.strike);
    await user.keyboard("k");
    expect(focused()).toBe(rows[atm + 1]!.strike);
    await user.keyboard("{Home}");
    expect(focused()).toBe(rows[0]!.strike);
    await user.keyboard("{ArrowUp}");
    expect(focused()).toBe(rows[0]!.strike);
    await user.keyboard("a");
    expect(focused()).toBe(rows[atm]!.strike);
    await user.keyboard("e");
    expect(onExpiryStep).toHaveBeenLastCalledWith(1);
    await user.keyboard("{Shift>}E{/Shift}");
    expect(onExpiryStep).toHaveBeenLastCalledWith(-1);
    const table = screen.getByTestId("chain-table");
    expect(table.dataset["x"]).toBe("74");
    await user.keyboard("{ArrowLeft}");
    expect(table.dataset["x"]).toBe("6");
    await user.keyboard("{ArrowRight}");
    expect(table.dataset["x"]).toBe("74");
    // clicking a strike focuses it; the recentre signal recentres
    await user.click(screen.getAllByTestId("chain-row")[0]!);
    expect(focused()).toBe(rows[0]!.strike);
  });
  it("centres on load without highlighting; the store signal recentres and highlights the ATM row", () => {
    const props = tableProps({ initialWidth: 600 });
    const { rerender } = renderWithProviders(<ChainTable {...props} recentreSignal={0} />);
    const focused = () => screen.getAllByTestId("chain-row").find((r) => r.dataset["focus"] === "true")?.dataset["strike"];
    expect(focused()).toBeUndefined();
    rerender(<ChainTable {...props} recentreSignal={1} />);
    expect(focused()).toBe(rows[atmIndex(rows, SPOT)]!.strike);
  });
});

describe("HC-WS-107 ChainPanel", () => {
  it("discovers expiries from the gateway, subscribes to the nearest, renders the snapshot and switches expiry", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true, expiries: { BTC: ["2026-09-25", "2026-10-30"] } }))),
    );
    vi.stubGlobal("fetch", fetch);
    renderWithProviders(<ChainPanel height={520} />);
    const ws = FakeSocket.last();
    await waitFor(() => expect(screen.getAllByTestId("expiry-chip")).toHaveLength(2));
    expect(screen.getByText("expiries · gateway")).toBeTruthy();
    expect(screen.getByTestId("chain-panel").dataset["topic"]).toBe(TOPIC);
    expect(screen.getByText("Connecting to the market-data gateway…")).toBeTruthy();
    act(() => {
      ws.open();
    });
    const subscribed = () => ws.sentFrames().flatMap((f) => (f as { op: string; topics?: string[] }).topics ?? []);
    await waitFor(() => expect(subscribed()).toContain(TOPIC));
    expect(screen.getByText("Waiting for the chain snapshot…")).toBeTruthy();
    act(() => {
      ws.receive({ t: "snap", topic: TOPIC, seq: 0, rows });
    });
    // no spot yet → no ATM → the range control cannot slice, every listed strike shows
    await waitFor(() => expect(screen.getByTestId("chain-table").dataset["rows"]).toBe("52"));
    expect(screen.getByText(/seq 0/)).toBeTruthy();
    expect(screen.getByTestId("chain-live").dataset["live"]).toBe("true");
    // the range control writes the store
    await userEvent.setup().click(screen.getByTestId("chain-range-6"));
    expect(useUiStore.getState().chainRange).toBe(6);
    // E steps the expiry through the panel
    screen.getByTestId("chain-scroll").focus();
    await userEvent.setup().keyboard("e");
    const topic2 = chainTopic("delta_india", "BTC", "2026-10-30");
    await waitFor(() => expect(screen.getByTestId("chain-panel").dataset["topic"]).toBe(topic2));
    await waitFor(() => expect(subscribed()).toContain(topic2));
    act(() => {
      ws.receive({ t: "snap", topic: topic2, seq: 0, rows: [] });
    });
    expect(await screen.findByText("No strikes listed for this expiry")).toBeTruthy();
    // clicking a chip still works
    await userEvent.setup().click(screen.getAllByTestId("expiry-chip")[0]!);
    await waitFor(() => expect(screen.getByTestId("chain-panel").dataset["topic"]).toBe(TOPIC));
    vi.unstubAllGlobals();
  });
  it("falls back to the default expiry list, shows the paused state and reconnects", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("down"))));
    useUiStore.getState().setFeedPaused(true);
    const { gateway } = renderWithProviders(<ChainPanel height={520} />);
    await waitFor(() => expect(screen.getAllByTestId("expiry-chip").length).toBeGreaterThan(0));
    expect(screen.getByText("expiries · default list")).toBeTruthy();
    expect(screen.getByText("Feed paused")).toBeTruthy();
    const reopen = vi.spyOn(gateway, "reopen");
    await userEvent.setup().click(screen.getByRole("button", { name: "Reconnect" }));
    expect(useUiStore.getState().feedPaused).toBe(false);
    expect(reopen).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it("asks the gateway for a fresh snapshot when the state goes stale and shows the stale footer", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("down"))));
    const { gateway } = renderWithProviders(<ChainPanel height={520} />);
    const refresh = vi.spyOn(gateway, "refresh");
    const ws = FakeSocket.last();
    await waitFor(() => expect(screen.getAllByTestId("expiry-chip").length).toBeGreaterThan(0));
    const topic = screen.getByTestId("chain-panel").dataset["topic"]!;
    act(() => {
      ws.open();
    });
    act(() => {
      ws.receive({ t: "snap", topic, seq: 0, rows });
    });
    act(() => {
      ws.receive({ t: "q", topic, seq: 9, d: [{ i: rows[0]!.call!.instrumentId, mark: "1" }] });
    });
    await waitFor(() => expect(refresh).toHaveBeenCalledWith(topic));
    await waitFor(() => expect(screen.getByTestId("chain-live").dataset["live"]).toBe("false"));
    expect(screen.getByTestId("chain-asof").textContent).toMatch(/^as of \d/);
    vi.unstubAllGlobals();
  });
});

describe("HC-WS-029 / HC-WS-074 / HC-WS-075 / HC-WS-080 footer stats, the Δ finder and the spot hairline", () => {
  it("footer shows max pain, skew and forward; a Δ chip focuses the call row and pulses both hits; the hairline sits between the bracketing strikes", async () => {
    const onRange = vi.fn();
    renderWithProviders(<ChainTable {...tableProps({ range: 0, onRange })} />);
    expect(screen.getByTestId("chain-max-pain").textContent).not.toBe("—");
    expect(screen.getByTestId("chain-fwd").textContent).not.toBe("—");
    expect(screen.getByTestId("chain-stats").textContent).toContain("hover a row for B / S"); // shown from 2xl up
    // spot 79,521 sits between 79,500 and 80,000: the hairline is one row boundary below the ATM row
    const line = screen.getByTestId("spot-hairline");
    expect(line.textContent).toContain("SPOT");
    const above = rows.findIndex((r) => Number(r.strike) > Number(SPOT));
    expect(above).toBeGreaterThan(0);
    expect(line.dataset["y"]).toBe(String(above * 36));
    const u = userEvent.setup();
    await u.click(screen.getByTestId("chain-delta-25"));
    const table = screen.getByTestId("chain-table");
    await waitFor(() => expect(table.dataset["pulse"]).toMatch(/^\d+\|\d+$/)); // call|put strikes of the hit
    const [callStrike, putStrike] = table.dataset["pulse"]!.split("|");
    expect(Number(callStrike)).toBeGreaterThan(Number(putStrike)); // OTM call above, OTM put below
    expect(Number(table.dataset["focusIndex"])).toBe(rows.findIndex((r) => r.strike === callStrike));
    const pulsing = screen.getAllByTestId("chain-row").filter((r) => r.dataset["pulse"] === "true");
    for (const r of pulsing) expect([callStrike, putStrike]).toContain(r.dataset["strike"]); // only the hits pulse
    expect(onRange).not.toHaveBeenCalled(); // every strike was already shown
    // a listed strike equal to spot has no hairline (the ATM band alone marks it)
    const { unmount } = renderWithProviders(<ChainTable {...tableProps({ spot: rows[above - 1]!.strike, range: 0 })} />);
    expect(screen.queryAllByTestId("spot-hairline")).toHaveLength(1); // only the first table's
    unmount();
  });
  it("a Δ hit outside the ±range widens the range to every strike first", async () => {
    const onRange = vi.fn();
    renderWithProviders(<ChainTable {...tableProps({ range: 6, onRange })} />);
    await userEvent.setup().click(screen.getByTestId("chain-delta-10"));
    expect(onRange).toHaveBeenCalledWith(0);
  });
});

describe("HC-SH-131 the chain on a touch screen (ADR-080)", () => {
  const touch = (el: Element, type: "touchstart" | "touchmove", x: number, y: number) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, "touches", { value: [{ clientX: x, clientY: y }] });
    el.dispatchEvent(e);
    return e;
  };

  it("a horizontal drag on a side track pans the mirrored offset like the wheel; a vertical drag is left to the page", () => {
    renderWithProviders(<ChainTable {...tableProps({ layout: applyPreset(defaultLayout(), "all"), range: 0 })} />);
    const calls = screen.getByTestId("chain-calls");
    const initial = calls.dataset["x"]; // the calls side opens on its inboard columns (mirrored), not at 0
    act(() => {
      touch(calls, "touchstart", 150, 100);
      touch(calls, "touchmove", 154, 101); // inside the slop: nothing yet
    });
    expect(calls.dataset["x"]).toBe(initial);
    let moved: Event | undefined;
    act(() => {
      moved = touch(calls, "touchmove", 200, 102); // 50 px to the right, clearly sideways: the outboard columns come into view
    });
    expect(moved!.defaultPrevented).toBe(true);
    expect(Number(calls.dataset["x"])).toBeLessThan(Number(initial)); // the same direction as a wheel with a negative deltaX
    // a gesture decided as vertical stays vertical even when the finger later drifts sideways
    const decided = calls.dataset["x"];
    let drift: Event | undefined;
    act(() => {
      touch(calls, "touchstart", 200, 100);
      touch(calls, "touchmove", 202, 140);
      drift = touch(calls, "touchmove", 260, 150);
    });
    expect(drift!.defaultPrevented).toBe(false);
    expect(calls.dataset["x"]).toBe(decided);
    // a mostly vertical gesture never pans and is not cancelled
    const before = calls.dataset["x"];
    let vertical: Event | undefined;
    act(() => {
      touch(calls, "touchstart", 200, 100);
      vertical = touch(calls, "touchmove", 203, 160);
    });
    expect(vertical!.defaultPrevented).toBe(false);
    expect(calls.dataset["x"]).toBe(before);
  });

  it("on a coarse pointer a tapped row carries finger-sized controls, and the tap alone adds nothing", () => {
    const spy = vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({ matches: query === "(pointer: coarse)", media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false }));
    try {
      const onAddLeg = vi.fn();
      renderWithProviders(<ChainTable {...tableProps({ onAddLeg, range: 0 })} />);
      expect(screen.queryByTestId("row-controls-calls")).toBeNull();
      const row = screen.getAllByTestId("chain-row-calls")[1]!;
      fireEvent.click(row);
      const controls = screen.getByTestId("row-controls-calls");
      expect(controls.dataset["strike"]).toBe(row.dataset["strike"]);
      expect(controls.dataset["coarse"]).toBe("true");
      expect(screen.getByTestId("row-buy-calls").className).toContain("h-9");
      expect(onAddLeg).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId("row-buy-calls"));
      expect(onAddLeg).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
