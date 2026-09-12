// Replay tab (ADR-079; HC-WS-114) against the in-memory mock API's synthetic recorded instants: the expiries, the
// slider over daily and 5-minute steps, previous / next / play, the ladder and readout, the Builder's legs marked at
// the instant, and the honest empty state before any record.
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { expiriesOf } from "../../../test/fixtures/chain";
import { useUiStore } from "@/lib/store";
import { ReplayPanel, legsThen, markToMarket } from "./ReplayPanel";

let mock: MockFetch;
const EXPIRY = expiriesOf().BTC[0]!;
beforeEach(() => {
  mock = installMockFetch();
  mock.loginAs("replay@example.com");
  useUiStore.setState({ asset: "BTC", analysisTab: "replay" });
});
afterEach(() => {
  mock.restore();
  vi.useRealTimers();
});

const ready = async () => waitFor(() => expect(screen.getByTestId("replay-panel").dataset["state"]).toBe("ready"), { timeout: 8000 });

describe("HC-WS-114 the Replay tab", () => {
  it("HC-WS-114 opens on the most recent end of day of the first listed expiry, scrubs back a step, switches to 5-minute steps, plays from the start and pauses", async () => {
    renderWithProviders(<ReplayPanel />);
    await ready();
    const panel = screen.getByTestId("replay-panel");
    expect(screen.getByTestId<HTMLSelectElement>("replay-expiry").value).toBe(EXPIRY);
    expect(panel.dataset["steps"]).toBe("12");
    expect(panel.dataset["source"]).toBe("eod");
    expect(screen.getByTestId("replay-source").textContent).toContain("recorded end of day · 12 of 12");
    expect(Number(screen.getByTestId("replay-ladder").dataset["rows"])).toBeGreaterThan(5);
    expect(screen.getAllByTestId("replay-row").filter((r) => r.dataset["atm"] === "true")).toHaveLength(1);
    const atBefore = panel.dataset["at"];
    fireEvent.click(screen.getByTestId("replay-prev"));
    await waitFor(() => expect(screen.getByTestId("replay-source").textContent).toContain("11 of 12"));
    expect(panel.dataset["at"]).not.toBe(atBefore);
    fireEvent.click(screen.getByTestId("replay-res-fine"));
    await waitFor(() => expect(panel.dataset["steps"]).toBe("25"));
    await waitFor(() => expect(panel.dataset["source"]).toBe("marks"));
    expect(screen.getByTestId("replay-source").textContent).toContain("recorded 5-minute pass · 25 of 25");
    // play from the end restarts at the first instant and advances
    fireEvent.click(screen.getByTestId("replay-play"));
    await waitFor(() => expect(screen.getByTestId("replay-source").textContent).toContain("1 of 25"));
    expect(screen.getByTestId("replay-play").textContent).toBe("Pause");
    await waitFor(() => expect(screen.getByTestId("replay-source").textContent).toMatch(/[2-9] of 25/), { timeout: 4000 });
    fireEvent.click(screen.getByTestId("replay-play"));
    expect(screen.getByTestId("replay-play").textContent).toBe("Play");
    expect(mock.calls.some((c) => c.url.includes("/v1/replay/expiries?asset=BTC"))).toBe(true);
    expect(mock.calls.some((c) => c.url.includes(`/v1/replay/steps?asset=BTC&expiry=${EXPIRY}`))).toBe(true);
  });

  it("HC-WS-114 marks the Builder's legs on the replayed expiry and shows the mark-to-market versus entry", async () => {
    const s = useUiStore.getState();
    s.addLeg({ asset: "BTC", kind: "call", side: "buy", strike: "80000", expiry: EXPIRY, lots: 10, price: "1000", iv: 0.4 });
    s.addLeg({ asset: "BTC", kind: "put", side: "sell", strike: "79000", expiry: EXPIRY, lots: 10, price: "900", iv: 0.4 });
    renderWithProviders(<ReplayPanel />);
    await ready();
    expect(screen.getAllByTestId("replay-leg").map((l) => l.dataset["side"]).sort()).toEqual(["buy", "sell"]);
    expect(screen.getByTestId("replay-mtm").textContent).toMatch(/Your 2 option legs then .*vs entry/);
  });

  it("HC-WS-114 says so before anything is recorded, and the helpers value only legs with a recorded mark", async () => {
    mock.state.replayDays = 0;
    renderWithProviders(<ReplayPanel />);
    await waitFor(() => expect(screen.getByTestId("replay-panel").dataset["state"]).toBe("empty"), { timeout: 8000 });
    expect(screen.getByTestId("replay-empty").textContent).toContain("Nothing recorded yet");
    const leg = { id: "l1", asset: "BTC" as const, kind: "call" as const, side: "buy" as const, strike: "80000", expiry: EXPIRY, lots: 10, price: "1000", symbol: "C-BTC-80000", status: "open" as const, createdAt: 0 };
    const rows = [{ strike: "80000", call: { mark: 1250, iv: 0.4 }, put: null }];
    const then = legsThen([leg, { ...leg, id: "l2", strike: "81000" }, { ...leg, id: "l3", expiry: "2030-01-01" }], EXPIRY, rows);
    expect(then.map((x) => x.mark)).toEqual([1250, null]); // the 81 000 leg has no row; the other expiry is not on this ladder
    expect(markToMarket(then, 0.001)).toBeNull();
    expect(markToMarket([then[0]!], 0.001)).toBeCloseTo(10 * 0.001 * 250, 10);
    expect(markToMarket([then[0]!], 0)).toBeNull(); // no lot size, no figure
    const sold = legsThen([{ ...leg, side: "sell" }], EXPIRY, rows);
    expect(markToMarket(sold, 0.001)).toBeCloseTo(-10 * 0.001 * 250, 10); // a sold leg loses as the mark rises
    await act(async () => Promise.resolve());
  });
});
