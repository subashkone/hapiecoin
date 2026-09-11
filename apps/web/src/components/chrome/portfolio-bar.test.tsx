// Portfolio status bar against the in-memory API and the fake gateway (ADR-053; HC-SH-105..108, HC-WS-004).
import { chainTopic, type Strategy } from "@hapiecoin/schema";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSocket, installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { buildChain } from "../../../test/fixtures/chain";
import { useUiStore } from "@/lib/store";
import { PortfolioBar } from "./PortfolioBar";

const EMAIL = "bar@example.com";
const EXPIRY = "2026-09-25";
const TOPIC = chainTopic("delta_india", "BTC", EXPIRY);
const rows = buildChain("BTC", EXPIRY);
let mock: MockFetch;

function paperStrategy(): Strategy {
  const at = "2026-09-10T00:00:00.000Z";
  const atm = rows.findIndex((r) => Number(r.strike) >= 79521);
  const row = rows[atm]!;
  return {
    id: "strat_bar",
    name: "Bar call",
    venue: "delta_india",
    asset: "BTC",
    status: "paper",
    tradingMode: "paper",
    templateName: "Long Call",
    brokerId: "brk_delta",
    legs: [{ id: "leg_1", kind: "call", side: "buy", strike: row.strike, expiry: EXPIRY, symbol: `C-BTC-${row.strike}-250926`, lots: 10, price: row.call!.mark, entryPrice: row.call!.mark, exitPrice: null, iv: row.call!.markIv ?? null, status: "open", isAdjustment: false, position: 0, openedAt: at, closedAt: null, orderId: null }],
    realizedPnl: "0",
    pnlHistory: [{ day: "2026-09-01", pnl: "-2.5" }],
    notes: "",
    tags: [],
    orders: [],
    adjustments: [],
    orderBatchId: null,
    startedAt: at,
    closedAt: null,
    createdAt: at,
    updatedAt: at,
  };
}

beforeEach(() => {
  FakeSocket.reset();
  mock = installMockFetch();
  mock.loginAs(EMAIL);
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null);
  useUiStore.setState({ asset: "BTC", dialog: null, alertPrefill: null, workspaceTab: "chain", dialogsTouched: false });
});
afterEach(() => mock.restore());

describe("HC-SH-105..108 portfolio bar", () => {
  it("shows the open count, net greeks from the worker, day P&L, alerts, basis and currency; every item opens its place", async () => {
    mock.state.accounts.get(EMAIL)!.strategies.push(paperStrategy());
    renderWithProviders(<PortfolioBar />);
    const bar = screen.getByTestId("portfolio-bar");
    const ws = FakeSocket.last();
    act(() => {
      ws.open();
      ws.receive({ t: "spot", s: "BTC", p: "79521", c24: 0.4 });
      ws.receive({ t: "snap", topic: TOPIC, seq: 0, rows });
    });
    await waitFor(() => expect(screen.getByTestId("bar-portfolio").textContent).toContain("1 open strategy"));
    await waitFor(() => expect(bar.dataset["portfolio"]).toBe("ready"), { timeout: 8000 });
    expect(screen.getByTestId("bar-net-delta").textContent).toMatch(/[+-]\d\.\d\d$/);
    expect(screen.getByTestId("bar-net-theta").textContent).toContain("$");
    expect(screen.getByTestId("bar-margin").textContent).toContain("$");
    // day P&L: total − yesterday's −2.50 on the P&L history (HC-SH-106)
    expect(screen.getByTestId("bar-day-pnl").textContent).toMatch(/[+−]\$\d/);
    expect(screen.getByTestId("bar-alerts").textContent).toContain("0 armed");
    await waitFor(() => expect(screen.getByTestId("bar-basis").textContent).toContain("mark"));
    expect(screen.getByTestId("bar-ccy").textContent).toContain("USD");
    // HC-SH-108 clicks
    const u = userEvent.setup();
    await u.click(screen.getByTestId("bar-portfolio"));
    expect(useUiStore.getState().workspaceTab).toBe("paper");
    await u.click(screen.getByTestId("bar-alerts"));
    expect(useUiStore.getState().dialog).toBe("alerts");
    await u.click(screen.getByTestId("bar-basis"));
    expect(useUiStore.getState().dialog).toBe("pnl");
    await u.click(screen.getByTestId("bar-ccy"));
    expect(useUiStore.getState().dialog).toBe("currency");
    await u.click(screen.getByTestId("bar-margin"));
    expect(useUiStore.getState().dialog).toBe("api");
  });

  it("reads empty without strategies and counts armed alerts", async () => {
    mock.state.accounts.get(EMAIL)!.alerts.push({ id: "alr_1", kind: "price", asset: "BTC", venue: "delta_india", strategyId: null, strategyName: null, op: ">=", value: "1", channels: ["push"], state: "armed", lastValue: null, triggeredAt: null, createdAt: "2026-09-10T00:00:00.000Z", updatedAt: "2026-09-10T00:00:00.000Z" });
    renderWithProviders(<PortfolioBar />);
    await waitFor(() => expect(screen.getByTestId("bar-alerts").textContent).toContain("1 armed"));
    expect(screen.getByTestId("portfolio-bar").dataset["portfolio"]).toBe("empty");
    expect(screen.getByTestId("bar-portfolio").textContent).toContain("0 open strategies");
    expect(screen.getByTestId("bar-net-delta").textContent).toContain("—");
  });
});
