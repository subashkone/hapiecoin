import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeSocket, installMockFetch, makeGateway, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { useUiStore } from "@/lib/store";
import { AssetSwitch, ExchangeChip, FeedStatus, FuturesPrice } from "./widgets";

let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
  FakeSocket.reset();
  useUiStore.setState({ asset: "BTC", expiry: {}, feedPaused: false, dialog: null, dialogsTouched: false, paletteOpen: false });
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
    expect(screen.getByText("Delta India")).toBeTruthy();
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
    expect(ws.sentFrames()).toContainEqual({ op: "sub", topics: ["spot:BTC"] });
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
    await waitFor(() => expect(ws.sentFrames()).toContainEqual({ op: "sub", topics: ["spot:ETH"] }));
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
  it("turns green with a wallet placeholder when credentials exist", async () => {
    mock.loginAs("asha@example.com", { connected: true });
    renderWithProviders(<ExchangeChip />);
    await waitFor(() => expect(screen.getByTestId("exchange-chip").dataset["state"]).toBe("connected"));
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByTestId("wallet-chip")).toBeTruthy();
  });
});
