import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeSocket, installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { authClient } from "@/lib/auth/client";
import { FeatureTabs } from "./FeatureTabs";
import { Footer } from "./Footer";
import { LegalPage } from "./LegalPage";
import { LiveMarkets, sparkPath } from "./LiveMarkets";
import { PublicHeader } from "./PublicHeader";
import { TerminalIllustration } from "./TerminalIllustration";

let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
  FakeSocket.reset();
});
afterEach(() => mock.restore());

describe("HC-PB-001 public header", () => {
  it("shows nav, Ctrl K, theme toggle and Get Started for guests", async () => {
    renderWithProviders(<PublicHeader />);
    const nav = screen.getByRole("navigation", { name: "Landing sections" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Features", "Market Analytics", "Markets", "Exchanges", "What's new"]);
    expect(screen.getByTestId("palette-button")).toBeTruthy();
    expect(screen.getByTestId("theme-toggle")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("get-started").getAttribute("href")).toBe("/auth"));
    expect(screen.getByText("Sign Up").getAttribute("href")).toBe("/auth?tab=signup");
  });
  it("shows Go to App once a session exists", async () => {
    mock.loginAs("asha@example.com");
    renderWithProviders(<PublicHeader />);
    act(() => {
      authClient.$store.notify("$sessionSignal"); // the session atom is a module singleton; force a refetch
    });
    await waitFor(() => expect(screen.getByTestId("go-to-app").getAttribute("href")).toBe("/analyse"));
  });
});

describe("HC-PB-009 live markets", () => {
  it("renders connecting tiles, then live prices with flash, change, H/L and a sparkline", async () => {
    renderWithProviders(<LiveMarkets />);
    expect(screen.getByTestId("live-badge").textContent).toContain("Connecting");
    expect(screen.getByTestId("tile-BTC").dataset["state"]).toBe("connecting");
    const ws = FakeSocket.last();
    act(() => {
      ws.open();
    });
    await waitFor(() => expect(screen.getByTestId("live-badge").textContent).toContain("Live"));
    expect(ws.sentFrames().flatMap((f) => (f as { topics?: string[] }).topics ?? [])).toEqual(
      expect.arrayContaining(["spot:BTC", "spot:ETH", "spot:XAUT"]),
    );
    act(() => {
      ws.receive({ t: "spot", s: "BTC", p: "79521.5", c24: -1.89 });
    });
    const tile = screen.getByTestId("tile-BTC");
    await waitFor(() => expect(tile.dataset["state"]).toBe("live"));
    expect(within(tile).getByTestId("tile-price").textContent).toBe("79,521.5");
    expect(within(tile).getByTestId("tile-change").textContent).toBe("-1.89%");
    act(() => {
      ws.receive({ t: "spot", s: "BTC", p: "79600", c24: 0.5 });
    });
    await waitFor(() => expect(within(tile).getByTestId("tile-price").className).toContain("flash-up"));
    expect(tile.textContent).toContain("H 79,600.0");
    expect(tile.textContent).toContain("L 79,521.5");
    expect(screen.getByTestId("tile-ETH").dataset["state"]).toBe("connecting");
  });
  it("sparkPath scales values into the box and needs at least two points", () => {
    expect(sparkPath(["1"])).toBe("");
    expect(sparkPath(["1", "x"])).toBe("");
    const d = sparkPath(["1", "3", "2"], 100, 40);
    expect(d.startsWith("M0.0 ")).toBe(true);
    expect(d.split("L")).toHaveLength(3);
    expect(sparkPath(["5", "5"])).toContain("L160.0");
  });
});

describe("[LANDING] static sections", () => {
  it("feature tabs switch panels", async () => {
    renderWithProviders(<FeatureTabs />);
    expect(screen.getByText("Live Greeks: Delta, Gamma, Theta, Vega")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("tab", { name: "Paper & Live Trading" }));
    expect(await screen.findByText("Risk-free paper trading mode")).toBeTruthy();
  });
  it("footer carries legal links and support contact", () => {
    render(<Footer year={2026} />);
    expect(screen.getByText("Privacy Policy").getAttribute("href")).toBe("/privacy");
    expect(screen.getByText("support@hapiecoin.com").getAttribute("href")).toBe("mailto:support@hapiecoin.com");
    expect(screen.getByText("© 2026 HapieCoin. All rights reserved.")).toBeTruthy();
  });
  it("legal pages render every section of the mock copy", () => {
    render(<LegalPage kind="disclaimer" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Disclaimer");
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(7);
    expect(screen.getByText("← Back").getAttribute("href")).toBe("/");
  });
  it("HC-PB-004 terminal illustration is built from design-system parts, no images", () => {
    const { container } = renderWithProviders(<TerminalIllustration />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[data-slot=table]")).toBeTruthy();
    expect(container.querySelectorAll("[data-slot=stat]")).toHaveLength(4);
    expect(container.querySelector("kbd")).toBeTruthy();
    expect(container.textContent).toContain("79,500");
  });
});
