import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { routerMock } from "../../../test/next-mocks";
import { useUiStore } from "@/lib/store";
import { CommandPalette, PaletteButton, buildCommands, filterCommands, scoreCommand } from "./CommandPalette";
import { Logo, LogoMark } from "./Logo";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "./Menu";
import { PhasePlaceholder } from "./PhasePlaceholder";
import { Providers } from "./Providers";
import { ThemeToggle } from "./ThemeToggle";

let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
  useUiStore.setState({ asset: "BTC", expiry: {}, feedPaused: false, dialog: null, dialogsTouched: false, paletteOpen: false });
});
afterEach(() => mock.restore());

describe("HC-PB-059 command palette", () => {
  it("buildCommands offers Sign in when logged out and Analyse when logged in", () => {
    const navigate = vi.fn();
    const out = buildCommands({ loggedIn: false, navigate, toggleTheme: vi.fn() });
    expect(out.map((c) => c.label)).toEqual(["Home", "Payoff chart preview", "Sign in", "Privacy Policy", "Terms of Service", "Disclaimer", "Toggle theme", "Keyboard shortcuts"]);
    const inn = buildCommands({ loggedIn: true, navigate, toggleTheme: vi.fn() });
    expect(inn[2]?.label).toBe("Analyse workspace"); // after Home and the public payoff preview
    expect(inn.find((c) => c.id === "act:referral-copy")).toBeUndefined();
    // HC-AD-091 the seven Admin commands exist only for admins
    expect(inn.find((c) => c.id === "nav:admin-users")).toBeUndefined();
    const adminCmds = buildCommands({ loggedIn: true, navigate, toggleTheme: vi.fn(), admin: true }).filter((c) => c.id.startsWith("nav:admin-"));
    expect(adminCmds.map((c) => c.label)).toEqual(["Admin: Users", "Admin: Subscription Plans", "Admin: Menu Pricing", "Admin: Coupon Codes", "Admin: User Subscriptions", "Admin: Banners", "Admin: Promotional Emails"]);
    adminCmds[0]?.run();
    expect(navigate).toHaveBeenCalledWith("/admin/users");
    // HC-AC-073 the copy-link command exists only once the referral code is known
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    buildCommands({ loggedIn: true, navigate, toggleTheme: vi.fn(), referralCode: "ASHA2026" }).find((c) => c.id === "act:referral-copy")?.run();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/auth?tab=signup&ref=ASHA2026`);
    inn[2]?.run();
    expect(navigate).toHaveBeenCalledWith("/analyse");
    // chain commands (HC-WS-016) act on the UI store
    const atm = inn.find((c) => c.id === "act:chain-atm");
    const all = inn.find((c) => c.id === "act:chain-all");
    const before = useUiStore.getState().chainRecentre;
    atm?.run();
    all?.run();
    expect(useUiStore.getState().chainRecentre).toBe(before + 1);
    expect(useUiStore.getState().chainRange).toBe(0);
    expect(out.some((c) => c.id === "act:chain-atm")).toBe(false);
    // HC-WS-010 / HC-WS-073 column commands
    inn.find((c) => c.id === "act:chain-columns")?.run();
    expect(useUiStore.getState().dialog).toBe("columns");
    inn.find((c) => c.id === "act:chain-greeks")?.run();
    expect(useUiStore.getState().chainColumns.visible).toEqual(expect.arrayContaining(["gamma", "theta", "vega"]));
    inn.find((c) => c.id === "act:chain-greeks")?.run();
    expect(useUiStore.getState().chainColumns.visible).not.toContain("gamma");
    // HC-WS-069 / HC-TR-140 one command per listed expiry and per template
    const withLists = buildCommands({ loggedIn: true, navigate, toggleTheme: vi.fn(), expiries: ["2026-09-25", "2026-10-30"], templates: ["Iron Condor", "Long Straddle"] });
    const exp = withLists.filter((c) => c.id.startsWith("act:expiry-"));
    expect(exp.map((c) => c.label)).toEqual(["Switch expiry → 25 Sep", "Switch expiry → 30 Oct"]);
    exp[1]?.run();
    expect(navigate).toHaveBeenCalledWith("/analyse");
    expect(useUiStore.getState().expiry[useUiStore.getState().asset]).toBe("2026-10-30");
    expect(useUiStore.getState().workspaceTab).toBe("chain");
    const tpl = withLists.filter((c) => c.id.startsWith("act:template-"));
    expect(tpl.map((c) => c.label)).toEqual(["Load template → Iron Condor", "Load template → Long Straddle"]);
    tpl[0]?.run();
    expect(useUiStore.getState()).toMatchObject({ workspaceTab: "builder", builderTab: "templates", templateRequest: "Iron Condor" });
    expect(inn.some((c) => c.id.startsWith("act:expiry-"))).toBe(false); // none without lists
    // HC-TR-178 the Strategy wizard from anywhere (ADR-072)
    const wizard = inn.find((c) => c.id === "act:builder-wizard");
    expect(wizard?.hint).toBe("W");
    wizard?.run();
    expect(navigate).toHaveBeenLastCalledWith("/analyse");
    expect(useUiStore.getState()).toMatchObject({ workspaceTab: "builder", builderTab: "wizard" });
    // HC-TR-140 trading commands
    useUiStore.setState({ legs: { BTC: [], ETH: [], XAUT: [] }, asset: "BTC", tradeFlow: null });
    inn.find((c) => c.id === "act:open-journal")?.run();
    expect(useUiStore.getState().workspaceTab).toBe("journal");
    inn.find((c) => c.id === "act:open-live")?.run();
    expect(useUiStore.getState().workspaceTab).toBe("live");
    inn.find((c) => c.id === "act:builder-paper")?.run();
    expect(useUiStore.getState().tradeFlow).toBeNull(); // no legs → a toast, no flow
    inn.find((c) => c.id === "act:builder-save")?.run();
    expect(useUiStore.getState()).toMatchObject({ workspaceTab: "builder", builderTab: "builder", saveDraftRequest: true });
    useUiStore.setState({ saveDraftRequest: false });
    // HC-SH-079 alerts commands: the center, and the form
    inn.find((c) => c.id === "act:alerts")?.run();
    expect(useUiStore.getState()).toMatchObject({ dialog: "alerts", alertPrefill: null });
    inn.find((c) => c.id === "act:alert-new")?.run();
    expect(useUiStore.getState()).toMatchObject({ dialog: "alerts", alertPrefill: {} });
    useUiStore.setState({ dialog: null, alertPrefill: null });
  });
  it("scores substrings above subsequences and filters/sorts", () => {
    const cmds = buildCommands({ loggedIn: false, navigate: vi.fn(), toggleTheme: vi.fn() });
    expect(filterCommands(cmds, "")).toHaveLength(cmds.length);
    expect(filterCommands(cmds, "legal").map((c) => c.label)).toEqual(["Privacy Policy", "Terms of Service", "Disclaimer"]);
    expect(filterCommands(cmds, "sgn")[0]?.label).toBe("Sign in");
    expect(filterCommands(cmds, "zzzz")).toHaveLength(0);
    expect(scoreCommand(cmds[0]!, "home")).toBeGreaterThan(scoreCommand(cmds[0]!, "hme"));
  });
  it("opens with Ctrl K, navigates with arrows + Enter, and runs on click", async () => {
    const u = userEvent.setup();
    renderWithProviders(<CommandPalette loggedIn={false} />);
    expect(screen.queryByRole("listbox")).toBeNull();
    await u.keyboard("{Control>}k{/Control}");
    expect(screen.getByRole("listbox")).toBeTruthy();
    await u.type(screen.getByRole("combobox"), "priv");
    await u.keyboard("{ArrowDown}{ArrowUp}{Enter}");
    expect(routerMock.push).toHaveBeenCalledWith("/privacy");
    expect(screen.queryByRole("listbox")).toBeNull();
    act(() => {
      useUiStore.getState().setPaletteOpen(true);
    });
    await u.hover(screen.getByText("Terms of Service"));
    await u.click(screen.getByText("Terms of Service"));
    expect(routerMock.push).toHaveBeenLastCalledWith("/terms");
    act(() => {
      useUiStore.getState().setPaletteOpen(true);
    });
    await u.type(screen.getByRole("combobox"), "nothing matches this");
    expect(screen.getByTestId("palette-empty")).toBeTruthy();
    await u.keyboard("{Enter}"); // nothing to run
    await u.keyboard("{Control>}k{/Control}"); // toggles closed
    expect(screen.queryByRole("listbox")).toBeNull();
  });
  it("HC-SH-086 / 087 / 088 / 092 / 093 groups, underlined matches, Settings commands, Tab, recents and the empty state", async () => {
    localStorage.removeItem("hapiecoin.palette.recent");
    mock.loginAs("asha@example.com");
    const u = userEvent.setup();
    renderWithProviders(<CommandPalette loggedIn />);
    await u.keyboard("{Control>}k{/Control}");
    const list = screen.getByRole("listbox");
    // groups in order, Settings present when signed in (HC-SH-087, 092)
    const groups = [...list.querySelectorAll(".micro")].map((el) => el.textContent);
    expect(groups.slice(0, 3)).toEqual(["Navigate", "Actions", "Settings"]);
    expect(screen.getByRole("option", { name: "Open P&L Settings" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Open Mindful trading" })).toBeTruthy(); // HC-TR-183
    expect(screen.getByRole("option", { name: /Options screener/ })).toBeTruthy(); // HC-WS-112 (a nav row reads its path as the hint)
    await waitFor(() => expect(screen.getByRole("option", { name: /Display currency → INR/ })).toBeTruthy());
    // typing underlines the matched characters (HC-SH-086); Tab moves (HC-SH-088)
    await u.type(screen.getByRole("combobox"), "jour");
    const opt = screen.getByRole("option", { name: "Open Journal" });
    expect([...opt.querySelectorAll("u")].map((x) => x.textContent).join("")).toBe("Jour");
    // Tab / Shift+Tab move through a list with several matches
    await u.clear(screen.getByRole("combobox"));
    await u.type(screen.getByRole("combobox"), "open");
    const first = screen.getByRole("combobox").getAttribute("aria-activedescendant");
    await u.keyboard("{Tab}");
    expect(screen.getByRole("combobox").getAttribute("aria-activedescendant")).not.toBe(first);
    await u.keyboard("{Shift>}{Tab}{/Shift}");
    expect(screen.getByRole("combobox").getAttribute("aria-activedescendant")).toBe(first);
    await u.clear(screen.getByRole("combobox"));
    await u.type(screen.getByRole("combobox"), "open journal");
    await u.keyboard("{Enter}");
    expect(useUiStore.getState().workspaceTab).toBe("journal");
    // the command ran lands in Recent on the next open (HC-SH-087)
    expect(JSON.parse(localStorage.getItem("hapiecoin.palette.recent") ?? "[]")).toEqual(["act:open-journal"]);
    act(() => useUiStore.getState().setPaletteOpen(true));
    expect([...screen.getByRole("listbox").querySelectorAll(".micro")][0]?.textContent).toBe("Recent");
    expect(screen.getAllByRole("option", { name: "Open Journal" })[0]?.id).toBe("hc-cmd-recent:act:open-journal");
    // empty state (HC-SH-093)
    await u.type(screen.getByRole("combobox"), "zzzz nothing");
    expect(screen.getByTestId("palette-empty").textContent).toContain("No commands match “zzzz nothing”");
    // Display currency → INR writes the setting
    await u.clear(screen.getByRole("combobox"));
    await u.type(screen.getByRole("combobox"), "display currency");
    // (jsdom spaces the underlined characters in the accessible name; browsers do not, so match on the text)
    const opt2 = screen.getAllByRole("option").find((o) => o.textContent?.startsWith("Display currency → INR"));
    expect(opt2).toBeTruthy();
    await u.click(opt2!);
    await waitFor(() => expect(mock.state.accounts.get("asha@example.com")!.settings.currency).toBe("INR"));
  });
  it("PaletteButton opens the palette", async () => {
    renderWithProviders(<PaletteButton />);
    await userEvent.setup().click(screen.getByTestId("palette-button"));
    expect(useUiStore.getState().paletteOpen).toBe(true);
  });
});

describe("[SHELL] Menu", () => {
  it("renders items, closes on outside click and supports keyboard focus movement", async () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    render(
      <div>
        <button>outside</button>
        <div className="relative">
          <Menu open onClose={onClose} label="Test" testId="m">
            <MenuLabel>Group</MenuLabel>
            <MenuItem onSelect={onSelect} testId="a">
              A
            </MenuItem>
            <MenuSeparator />
            <MenuItem href="/x" testId="b" value="v">
              B
            </MenuItem>
            <MenuItem href="https://ext" external testId="c" danger>
              C
            </MenuItem>
          </Menu>
        </div>
      </div>,
    );
    const menu = screen.getByTestId("m");
    expect(document.activeElement).toBe(screen.getByTestId("a"));
    const u = userEvent.setup();
    await u.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByTestId("b"));
    await u.keyboard("{ArrowUp}{ArrowUp}");
    expect(document.activeElement).toBe(screen.getByTestId("c"));
    expect(within(menu).getByText("v")).toBeTruthy();
    expect(screen.getByTestId("c").getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByTestId("b").getAttribute("href")).toBe("/x");
    await u.click(screen.getByTestId("a"));
    expect(onSelect).toHaveBeenCalled();
    await u.click(screen.getByText("outside"));
    expect(onClose).toHaveBeenCalled();
  });
  it("renders nothing when closed", () => {
    render(
      <Menu open={false} onClose={() => {}} label="x" testId="m">
        <MenuItem>Never</MenuItem>
      </Menu>,
    );
    expect(screen.queryByTestId("m")).toBeNull();
  });
});

describe("[SHELL] Logo, ThemeToggle, PhasePlaceholder, Providers", () => {
  it("Logo links home with the Δ mark and optional suffix", () => {
    render(<Logo href="/analyse" sub="Analyse" />);
    expect(screen.getByLabelText("HapieCoin home").getAttribute("href")).toBe("/analyse");
    expect(screen.getByText("Analyse")).toBeTruthy();
    const { container } = render(<LogoMark className="size-5" />);
    expect(container.querySelector("svg")?.getAttribute("class")).toContain("size-5");
  });
  it("HC-SH-011 ThemeToggle flips the html class and its title", async () => {
    renderWithProviders(<ThemeToggle className="x" />);
    const btn = screen.getByTestId("theme-toggle");
    expect(btn.getAttribute("title")).toBe("Switch to Light Mode");
    await userEvent.setup().click(btn);
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(btn.getAttribute("title")).toBe("Switch to Dark Mode");
  });
  it("PhasePlaceholder names the phase and links onward", () => {
    render(<PhasePlaceholder title="Referrals" phase={4} blurb="Soon." />);
    expect(screen.getByText("Coming in Phase 4")).toBeTruthy();
    expect(screen.getByText("Go to Analyse").closest("a")?.getAttribute("href")).toBe("/analyse");
  });
  it("Providers mounts theme, density, query and gateway contexts", () => {
    render(
      <Providers gatewayUrl="ws://test">
        <span>child</span>
      </Providers>,
    );
    expect(screen.getByText("child")).toBeTruthy();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
