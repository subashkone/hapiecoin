import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeSocket, installMockFetch, makeGateway, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { useUiStore } from "@/lib/store";
import { VenueSwitchDialog } from "./VenueSwitchDialog";
import { CurrencyToggle, AssetSwitch, ExchangeChip, FeedStatus, FuturesPrice } from "./widgets";

let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
  FakeSocket.reset();
  useUiStore.setState({ venue: "delta_india", asset: "BTC", expiry: {}, feedPaused: false, dialog: null, dialogsTouched: false, paletteOpen: false, legs: { BTC: [], ETH: [], XAUT: [] } });
});
afterEach(() => mock.restore());

describe("HC-SH-003 asset switch", () => {
  it("selects BTC / ETH / XAUT and shows the venue", async () => {
    renderWithProviders(<AssetSwitch />);
    expect(screen.getByRole("tab", { name: "ETH" }).getAttribute("aria-selected")).toBe("false");
    await userEvent.setup().click(screen.getByTestId("asset-ETH"));
    expect(useUiStore.getState().asset).toBe("ETH");
    expect(screen.getByRole("tab", { name: "ETH" }).getAttribute("aria-selected")).toBe("true");
    await userEvent.setup().click(screen.getByTestId("asset-ETH")); // no-op
    expect(screen.getByTestId("venue-delta_india").textContent).toBe("Delta India"); // the venue chip names the venue (short label; the title carries the full one)
    expect(screen.getByTestId("venue-delta_india").getAttribute("title")).toBe("Delta Exchange India");
  });
});

describe("HC-SH-004 / HC-SH-005 futures price", () => {
  it("shows the label, the live price with a flash class on ticks and the signed 24h change", async () => {
    renderWithProviders(<FuturesPrice />);
    expect(screen.getByText("Futures · BTCUSD")).toBeTruthy();
    expect(screen.getByTestId("futures-price-value").textContent).toBe("—");
    const ws = FakeSocket.last();
    act(() => {
      ws.open();
    });
    expect(ws.sentFrames()).toContainEqual({ op: "sub", topics: ["spot:delta_india:BTC"] }); // the workspace venue's spot (ADR-071)
    act(() => {
      ws.receive({ t: "spot", s: "BTC", p: "79521.5", c24: -1.89 });
    });
    await waitFor(() => expect(screen.getByTestId("futures-price-value").textContent).toBe("79,521.5"));
    expect(screen.getByTestId("futures-change").textContent).toBe("-1.89%");
    expect(screen.getByTestId("futures-change").className).toContain("text-loss");
    act(() => {
      ws.receive({ t: "spot", s: "BTC", p: "79600", c24: 0.4 });
    });
    await waitFor(() => expect(screen.getByTestId("futures-price-value").className).toContain("flash-up"));
    expect(screen.getByTestId("futures-change").className).toContain("text-profit");
    act(() => {
      ws.receive({ t: "spot", s: "BTC", p: "79500", c24: 0.4 });
    });
    await waitFor(() => expect(screen.getByTestId("futures-price-value").className).toContain("flash-down"));
    // switching the asset re-subscribes
    act(() => {
      useUiStore.getState().setAsset("ETH");
    });
    await waitFor(() => expect(screen.getByText("Futures · ETHUSD")).toBeTruthy());
    await waitFor(() => expect(ws.sentFrames()).toContainEqual({ op: "sub", topics: ["spot:delta_india:ETH"] }));
  });
});

describe("HC-SH-006 feed status", () => {
  it("shows connecting → live with latency, pauses on click and reconnects", async () => {
    const gateway = makeGateway({ pingIntervalMs: 50, now: () => Date.now() });
    renderWithProviders(<FeedStatus />, { gateway });
    const el = () => screen.getByTestId("feed-status");
    expect(el().dataset["state"]).toBe("connecting");
    const ws = FakeSocket.last();
    act(() => {
      ws.open();
    });
    await waitFor(() => expect(el().dataset["state"]).toBe("live"));
    act(() => {
      ws.receive({ t: "pong" });
    });
    await waitFor(() => expect(el().textContent).toMatch(/Feed live· \d+ ms/));
    await userEvent.setup().click(el());
    await waitFor(() => expect(el().dataset["state"]).toBe("paused"));
    expect(ws.closed).toBe(true);
    expect(el().textContent).toContain("Feed paused");
    await userEvent.setup().click(el());
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
    expect(el().dataset["state"]).toBe("connecting");
  });
  it("shows offline when the socket is closed without a pause", async () => {
    const gateway = makeGateway();
    renderWithProviders(<FeedStatus />, { gateway });
    act(() => {
      gateway.close();
    });
    await waitFor(() => expect(screen.getByTestId("feed-status").dataset["state"]).toBe("offline"));
  });
});

describe("HC-SH-007 / HC-SH-008 exchange chip", () => {
  it("shows Not connected and opens the API dialog", async () => {
    mock.loginAs("asha@example.com");
    renderWithProviders(<ExchangeChip />);
    await waitFor(() => expect(screen.getByTestId("exchange-chip").dataset["state"]).toBe("disconnected"));
    expect(screen.getByText("Not connected")).toBeTruthy();
    expect(screen.queryByTestId("wallet-chip")).toBeNull();
    await userEvent.setup().click(screen.getByTestId("exchange-chip"));
    expect(useUiStore.getState().dialog).toBe("api");
  });
  it("turns green and shows the exchange wallet's available balance when credentials exist (HC-SH-011)", async () => {
    mock.loginAs("asha@example.com", { connected: true });
    renderWithProviders(<ExchangeChip />);
    await waitFor(() => expect(screen.getByTestId("exchange-chip").dataset["state"]).toBe("connected"));
    expect(screen.getByText("Connected")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("wallet-chip").dataset["state"]).toBe("ready"));
    expect(screen.getByTestId("wallet-chip").textContent).toContain("4,000 USD");
  });
  it("HC-SH-012 the currency toggle flips USD / INR in the settings", async () => {
    mock.loginAs("asha@example.com");
    renderWithProviders(<CurrencyToggle />);
    await waitFor(() => expect(screen.getByTestId("currency-toggle").dataset["currency"]).toBe("USD"));
    await userEvent.setup().click(screen.getByTestId("currency-toggle"));
    await waitFor(() => expect(screen.getByTestId("currency-toggle").dataset["currency"]).toBe("INR"));
    expect(screen.getByTestId("currency-toggle").textContent).toContain("INR");
  });
});

describe("HC-SH-124 venue chip (ADR-069)", () => {
  it("switches the workspace venue, greys the assets the venue does not list, and asks before clearing Builder legs", async () => {
    const u = userEvent.setup();
    useUiStore.setState({ asset: "XAUT", venueSwitch: null });
    renderWithProviders(
      <>
        <AssetSwitch />
        <VenueSwitchDialog />
      </>,
    );
    expect(screen.getByTestId("header-venue").dataset["venue"]).toBe("delta_india");
    await u.click(screen.getByTestId("venue-deribit"));
    expect(useUiStore.getState().venue).toBe("deribit");
    expect(useUiStore.getState().asset).toBe("BTC"); // XAUT is not listed on Deribit
    expect(screen.getByTestId("asset-XAUT").getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByTestId("asset-XAUT").getAttribute("title")).toContain("not listed on Deribit");
    await u.click(screen.getByTestId("asset-XAUT")); // a no-op
    expect(useUiStore.getState().asset).toBe("BTC");
    // with legs in the Builder the switch asks first
    expect(useUiStore.getState().addLeg({ asset: "BTC", kind: "call", side: "buy", strike: "70000", expiry: "2026-09-12", lots: 1, price: "800", iv: 0.5 }).ok).toBe(true);
    await u.click(screen.getByTestId("venue-delta_india"));
    expect(screen.getByTestId("venue-switch-confirm")).toBeTruthy();
    await u.click(screen.getByTestId("venue-switch-keep"));
    expect(useUiStore.getState().venue).toBe("deribit");
    expect(useUiStore.getState().legs.BTC).toHaveLength(1);
    await u.click(screen.getByTestId("venue-delta_india"));
    await u.click(screen.getByTestId("venue-switch-go"));
    expect(useUiStore.getState().venue).toBe("delta_india");
    expect(useUiStore.getState().legs.BTC).toEqual([]);
    await u.click(screen.getByTestId("venue-delta_india")); // the same venue: nothing happens
    expect(screen.queryByTestId("venue-switch-confirm")).toBeNull();
  });
});
