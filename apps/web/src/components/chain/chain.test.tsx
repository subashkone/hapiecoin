import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { chainTopic } from "@hapiecoin/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildChain, strikesOf } from "../../../test/fixtures/chain";
import { FakeSocket, renderWithProviders } from "../../../test/helpers";
import { applySnapshot, emptyChain, applyDeltas } from "@/lib/gateway/reducer";
import { useUiStore } from "@/lib/store";
import { ChainPanel } from "./ChainPanel";
import { ChainTable, quoteFlashes } from "./ChainTable";

const EXPIRY = "2026-09-25";
const TOPIC = chainTopic("delta_india", "BTC", EXPIRY);
const rows = buildChain("BTC", EXPIRY);

beforeEach(() => {
  FakeSocket.reset();
  useUiStore.setState({ asset: "BTC", expiry: {}, feedPaused: false, dialog: null, dialogsTouched: false, paletteOpen: false });
});
afterEach(() => vi.unstubAllGlobals());

describe("HC-WS-108 ChainTable renders the venue strikes", () => {
  it("shows mirrored columns, exact strikes, the ATM band on the strike bracketing spot and flashes", async () => {
    const state = applySnapshot(emptyChain(TOPIC), 0, rows, 1);
    // spot 50,500 puts the ATM row (50,000, index 2) inside jsdom's un-scrollable first viewport;
    // the bracketing rule itself is unit-tested against 79,521 in reducer.test.ts.
    const { rerender } = renderWithProviders(<ChainTable chain={state} spot="50500" height={520} />);
    const table = screen.getByTestId("chain-table");
    expect(table.dataset["rows"]).toBe("52");
    expect(within(table).getAllByText("Mark/IV")).toHaveLength(2);
    expect(within(table).getByText("Strike")).toBeTruthy();
    const rendered = screen.getAllByTestId("chain-row").map((r) => r.dataset["strike"]);
    const listed = strikesOf("BTC", EXPIRY);
    expect(rendered.every((s) => listed.includes(s!))).toBe(true);
    expect(rendered.length).toBeGreaterThan(5);
    const atm = screen.getAllByTestId("chain-row").find((r) => r.dataset["atm"] === "true");
    expect(atm?.dataset["strike"]).toBe("50000"); // last listed strike ≤ spot
    expect(within(atm!).getByText(/ATM · spot 50,500/)).toBeTruthy();
    // a delta on a visible instrument flashes the mark cell
    const first = screen.getAllByTestId("chain-row")[0]!;
    const row = rows.find((r) => r.strike === first.dataset["strike"])!;
    const next = applyDeltas(state, 1, [{ i: row.call!.instrumentId, mark: String(Number(row.call!.mark) + 10) }], 2);
    rerender(<ChainTable chain={next} spot="50500" height={520} />);
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
    await waitFor(() => expect(screen.getByTestId("chain-table").dataset["rows"]).toBe("52"));
    expect(screen.getByText(/seq 0/)).toBeTruthy();
    await userEvent.setup().click(screen.getAllByTestId("expiry-chip")[1]!);
    const topic2 = chainTopic("delta_india", "BTC", "2026-10-30");
    await waitFor(() => expect(screen.getByTestId("chain-panel").dataset["topic"]).toBe(topic2));
    await waitFor(() => expect(subscribed()).toContain(topic2));
    act(() => {
      ws.receive({ t: "snap", topic: topic2, seq: 0, rows: [] });
    });
    expect(await screen.findByText("No strikes listed for this expiry")).toBeTruthy();
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
  it("asks the gateway for a fresh snapshot when the state goes stale", async () => {
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
    vi.unstubAllGlobals();
  });
});
