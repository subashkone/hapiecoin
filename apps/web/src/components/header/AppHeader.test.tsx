import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { User } from "@hapiecoin/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, screen as scr } from "@testing-library/react";
import { chainTopic } from "@hapiecoin/schema";
import { FakeSocket, installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { buildChain } from "../../../test/fixtures/chain";
import { pathnameMock } from "../../../test/next-mocks";
import { useUiStore } from "@/lib/store";
import { AppHeader, Avatar } from "./AppHeader";

const user: User = {
  id: "usr_1",
  email: "asha@example.com",
  name: "Asha Trader",
  role: "user",
  avatar: "diamond",
  referralCode: "ASHA2026",
  createdAt: "2026-09-01T10:00:00Z",
};

let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
  useUiStore.setState({ asset: "BTC", expiry: {}, feedPaused: false, dialog: null, dialogsTouched: false, paletteOpen: false });
});
afterEach(() => mock.restore());

describe("HC-SH-001 analyse header", () => {
  it("renders logo + Analyse, asset switch, price, feed, exchange chip, gear and avatar; admin chip only for admins", async () => {
    mock.loginAs("asha@example.com");
    renderWithProviders(<AppHeader variant="analyse" initialUser={user} />);
    const header = screen.getByTestId("app-header");
    expect(header.dataset["variant"]).toBe("analyse");
    expect(within(header).getByText("Analyse")).toBeTruthy();
    expect(within(header).getByRole("tablist", { name: "Asset" })).toBeTruthy();
    expect(screen.getByTestId("futures-price")).toBeTruthy();
    expect(screen.getByTestId("feed-status")).toBeTruthy();
    expect(screen.getByTestId("exchange-chip")).toBeTruthy();
    expect(screen.getByTestId("settings-gear")).toBeTruthy();
    expect(screen.queryByTestId("admin-chip")).toBeNull();
    // HC-SH-014 plan banner appears under the header
    await waitFor(() => expect(screen.getByTestId("plan-banner")).toBeTruthy());
  });
  it("HC-SH-002 shows the admin chip for admins; HC-SH-024 the settings menu gains the Admin section", async () => {
    renderWithProviders(<AppHeader variant="analyse" initialUser={{ ...user, role: "admin" }} />);
    await userEvent.setup().click(screen.getByTestId("settings-gear"));
    expect(screen.getByTestId("menu-admin-users").getAttribute("href")).toBe("/admin/users");
    expect(screen.getByText("Promotional Emails")).toBeTruthy();
    expect(screen.getByTestId("admin-chip").getAttribute("href")).toBe("/admin/users");
  });
  it("HC-SH-013 / HC-SH-022 / HC-SH-026 settings menu opens dialogs and the logout confirm", async () => {
    mock.loginAs("asha@example.com");
    const u = userEvent.setup();
    renderWithProviders(<AppHeader variant="analyse" initialUser={user} />);
    await u.click(screen.getByTestId("settings-gear"));
    const menu = screen.getByTestId("settings-menu");
    expect(within(menu).getByText("Account")).toBeTruthy();
    expect(within(menu).getByText("Preferences")).toBeTruthy();
    expect(within(menu).getByText("My Subscription").closest("a")?.getAttribute("href")).toBe("/subscription");
    await waitFor(() => expect(within(menu).getByText("USD")).toBeTruthy()); // currency value from settings
    await u.click(screen.getByTestId("menu-profile"));
    expect(useUiStore.getState().dialog).toBe("profile");
    expect(screen.queryByTestId("settings-menu")).toBeNull();
    for (const [id, kind] of [
      ["menu-api", "api"],
      ["menu-currency", "currency"],
      ["menu-lot", "lot"],
      ["menu-pnl", "pnl"],
      ["menu-exchanges", "exchanges"],
      ["menu-alerts", "alerts"],
      ["menu-shortcuts", "shortcuts"],
      ["menu-logout", "logout"],
    ] as const) {
      await u.click(screen.getByTestId("settings-gear"));
      await u.click(screen.getByTestId(id));
      expect(useUiStore.getState().dialog).toBe(kind);
    }
    // density + theme toggles from the menu
    await u.click(screen.getByTestId("settings-gear"));
    await u.click(within(screen.getByTestId("settings-menu")).getByText("Density"));
    expect(document.documentElement.classList.contains("compact")).toBe(true);
    await u.click(screen.getByTestId("settings-gear"));
    await u.click(within(screen.getByTestId("settings-menu")).getByText("Switch to Light Mode"));
    expect(document.documentElement.classList.contains("light")).toBe(true);
    // Escape closes
    await u.click(screen.getByTestId("settings-gear"));
    await u.keyboard("{Escape}");
    expect(screen.queryByTestId("settings-menu")).toBeNull();
    // HC-SH-079 the bell opens the Alerts center; the menu row carries the armed count
    useUiStore.setState({ dialog: null });
    await u.click(screen.getByTestId("alerts-bell"));
    expect(useUiStore.getState()).toMatchObject({ dialog: "alerts", alertPrefill: null });
    await u.click(screen.getByTestId("settings-gear"));
    expect(within(screen.getByTestId("menu-alerts")).getByText("0 armed")).toBeTruthy();
    // HC-SH-023 Command palette and Market Analytics rows
    await u.click(screen.getByTestId("menu-palette"));
    expect(useUiStore.getState().paletteOpen).toBe(true);
    useUiStore.setState({ paletteOpen: false });
    await u.click(screen.getByTestId("settings-gear"));
    expect(within(screen.getByTestId("settings-menu")).getByText("Market Analytics").closest("a")?.getAttribute("href")).toBe("/analytics");
  });

  it("HC-SH-077 / HC-SH-078 header stats read the ATM IV and the expected move of the shown expiry from the chain", async () => {
    FakeSocket.reset();
    mock.loginAs("asha@example.com");
    useUiStore.setState({ asset: "BTC", expiry: {} });
    renderWithProviders(<AppHeader variant="analyse" initialUser={user} />);
    expect(scr.getByTestId("header-atm-iv").dataset["state"]).toBe("pending");
    const ws = FakeSocket.last();
    const expiry = "2026-09-11"; // the first default expiry
    const topic = chainTopic("delta_india", "BTC", expiry);
    act(() => {
      ws.open();
      ws.receive({ t: "spot", s: "BTC", p: "79521", c24: 0.4 });
    });
    // the chain subscription follows the (async) expiry discovery: serve the snapshot once it is requested
    await waitFor(() => expect(ws.sentFrames().some((f) => JSON.stringify(f).includes(topic))).toBe(true));
    act(() => {
      ws.receive({ t: "snap", topic, seq: 0, rows: buildChain("BTC", expiry) });
    });
    await waitFor(() => expect(scr.getByTestId("header-atm-iv").dataset["state"]).toBe("ready"));
    expect(scr.getByTestId("header-atm-iv").textContent).toMatch(/ATM IV\d+\.\d%IV rank (\d+|—)/);
    // ADR-056: the rank arrives from the market history route
    await waitFor(() => expect(scr.getByTestId("header-iv-rank").textContent).toMatch(/^IV rank \d+$/));
    expect(scr.getByTestId("header-exp-move").dataset["state"]).toBe("ready");
    expect(scr.getByTestId("header-exp-move").textContent).toMatch(/Exp\. move · 11 Sep± [\d,]+1σ/);
  });
  it("HC-SH-020 account menu shows name/email and Logout", async () => {
    const u = userEvent.setup();
    renderWithProviders(<AppHeader variant="analyse" initialUser={user} />);
    await u.click(screen.getByTestId("account-avatar"));
    const menu = screen.getByTestId("account-menu");
    expect(within(menu).getByText("Asha Trader")).toBeTruthy();
    expect(within(menu).getByText("asha@example.com")).toBeTruthy();
    await u.keyboard("{ArrowDown}{ArrowDown}");
    await u.click(screen.getByTestId("account-logout"));
    expect(useUiStore.getState().dialog).toBe("logout");
    await u.click(screen.getByTestId("account-avatar"));
    await u.click(within(screen.getByTestId("account-menu")).getByText("My Profile"));
    expect(useUiStore.getState().dialog).toBe("profile");
  });
});

describe("HC-SH-015..021 default header", () => {
  it("HC-SH-018 shows text tabs with the active underline and admin link for admins", () => {
    pathnameMock.value = "/subscription";
    renderWithProviders(<AppHeader variant="default" initialUser={{ ...user, role: "admin" }} />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByText("Subscription").getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByText("Analyse").getAttribute("aria-current")).toBeNull();
    expect(within(nav).getByText("Market Analytics").getAttribute("href")).toBe("/analytics");
    expect(within(nav).getByText("Admin").getAttribute("href")).toBe("/admin/users");
    expect(screen.getByLabelText("HapieCoin home").getAttribute("href")).toBe("/analyse");
  });
  it("HC-SH-017 Market Analytics is active on /terminal/* too", () => {
    pathnameMock.value = "/terminal/coin/BTC";
    renderWithProviders(<AppHeader variant="default" initialUser={user} />);
    expect(screen.getByText("Market Analytics").getAttribute("aria-current")).toBe("page");
  });
  it("HC-SH-021 shows Home / Market Analytics and Sign In when logged out", async () => {
    pathnameMock.value = "/";
    renderWithProviders(<AppHeader variant="default" initialUser={null} />);
    expect(screen.getByTestId("header-sign-in").getAttribute("href")).toBe("/auth");
    expect(screen.getByText("Home").getAttribute("aria-current")).toBe("page");
    expect(screen.getByLabelText("HapieCoin home").getAttribute("href")).toBe("/");
    await new Promise((r) => setTimeout(r, 20)); // useMe 401 settles without changing the view
    expect(screen.queryByTestId("account-avatar")).toBeNull();
  });
  it("falls back to the default header when the analyse variant has no user", () => {
    renderWithProviders(<AppHeader variant="analyse" initialUser={null} />);
    expect(screen.getByTestId("app-header").dataset["variant"]).toBe("default");
  });
  it("Avatar renders each glyph", () => {
    const { container } = renderWithProviders(
      <>
        <Avatar avatar="rocket" />
        <Avatar avatar="diamond" />
        <Avatar avatar="lightning" />
      </>,
    );
    expect(container.querySelectorAll("svg")).toHaveLength(3);
  });
});
