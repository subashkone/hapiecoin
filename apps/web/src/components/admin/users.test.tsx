// Admin · User Management against the mock API (HC-AD-086..101, 103..109; ADR-032): list, filters, sort, columns,
// CSV, bulk bar, the drawer's tabs and actions, Set plan and Invite.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { adminFetchers, userStatus } from "@/lib/api/admin";
import { createApiClient } from "@/lib/api/client";
import { useUiStore } from "@/lib/store";
import { UsersAdmin } from "./UsersAdmin";

const ADMIN = "boss@example.com";
let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
  useUiStore.setState({ adminCols: {} });
});
afterEach(() => mock.restore());
const clipboard = () => navigator.clipboard.readText();

describe("HC-AD-086..099 users list", () => {
  it("lists users with plan and status, searches, filters by plan and status, sorts, pages, hides and shows columns, copies CSV", async () => {
    mock.loginAs(ADMIN, { role: "admin" });
    for (let i = 1; i <= 11; i += 1) mock.loginAs(`user${i}@example.com`);
    mock.state.accounts.get("user3@example.com")!.subscription = null;
    mock.state.accounts.get("user4@example.com")!.active = false;
    mock.loginAs(ADMIN, { role: "admin" });
    const u = userEvent.setup();
    renderWithProviders(<UsersAdmin />);
    await waitFor(() => expect(screen.getByTestId("admin-users").dataset["state"]).toBe("ready"));
    expect(screen.getByTestId("admin-users").dataset["count"]).toBe("12");
    expect(screen.getAllByTestId("um-row")).toHaveLength(10);
    expect(screen.getByTestId("um-pager").textContent).toContain("Page 1 of 2 · 12 users");
    await u.click(screen.getByText("Next →"));
    await waitFor(() => expect(screen.getAllByTestId("um-row")).toHaveLength(2));
    await u.type(screen.getByTestId("um-search"), "user3");
    await waitFor(() => expect(screen.getAllByTestId("um-row")).toHaveLength(1));
    expect(within(screen.getByTestId("um-row")).getByTestId("user-plan").textContent).toBe("Free plan");
    expect(within(screen.getByTestId("um-row")).getByTestId("user-status").dataset["status"]).toBe("free");
    await u.click(screen.getByTestId("um-clear"));
    await u.selectOptions(screen.getByTestId("um-status"), "deactivated");
    await waitFor(() => expect(screen.getAllByTestId("um-row").map((r) => r.dataset["email"])).toEqual(["user4@example.com"]));
    await u.selectOptions(screen.getByTestId("um-status"), "all");
    await u.selectOptions(screen.getByTestId("um-plan"), "free");
    await waitFor(() => expect(screen.getAllByTestId("um-row").map((r) => r.dataset["email"])).toEqual(["user3@example.com"]));
    await u.selectOptions(screen.getByTestId("um-plan"), "pln_elite");
    await waitFor(() => expect(screen.getAllByTestId("um-row")).toHaveLength(10));
    await u.click(screen.getByTestId("um-clear"));
    // sort by name ascending
    await u.click(screen.getByTestId("um-sort-name"));
    await waitFor(() => expect(screen.getByTestId("um-sort-name").getAttribute("aria-sort")).toBe("ascending"));
    const names = screen.getAllByTestId("um-row").map((r) => within(r).getByTitle(/.+/).textContent);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    // columns: hide Email, show Mobile, reset
    await u.click(screen.getByTestId("um-columns-button"));
    await u.click(within(screen.getByTestId("um-columns-email")).getByRole("checkbox"));
    expect(screen.queryByTestId("um-sort-email")).toBeNull();
    await u.click(within(screen.getByTestId("um-columns-mobile")).getByRole("checkbox"));
    expect(within(screen.getByTestId("um-table")).getByText("Mobile")).toBeTruthy();
    expect(useUiStore.getState().adminCols["users"]).toContain("mobile");
    await u.click(screen.getByTestId("um-columns-reset"));
    expect(useUiStore.getState().adminCols["users"]).toBeNull();
    await waitFor(() => expect(screen.getByTestId("um-sort-email")).toBeTruthy());
    // HC-AD-129 (ADR-086): the 2FA column reads the authenticator state
    mock.state.accounts.get("user5@example.com")!.twoFactor = { enabled: true, pending: false, backupCodes: [] };
    await u.type(screen.getByTestId("um-search"), "user5");
    await waitFor(() => expect(screen.getAllByTestId("um-row")).toHaveLength(1));
    await waitFor(() => expect(within(screen.getByTestId("um-row")).getByTestId("user-2fa").dataset["on"]).toBe("true"));
    expect(within(screen.getByTestId("um-row")).getByTestId("user-2fa").textContent).toBe("on");
    await u.click(screen.getByTestId("um-clear"));
    await waitFor(() => expect(screen.getAllByTestId("um-row")).toHaveLength(10));
    // CSV of the page
    await u.click(screen.getByTestId("um-csv"));
    const csv = await clipboard();
    expect(csv.split("\n")).toHaveLength(11);
    expect(csv.startsWith('"Name","Email","Plan","Status"')).toBe(true);
  });

  it("empty states: no users match with Clear filters", async () => {
    mock.loginAs(ADMIN, { role: "admin" });
    const u = userEvent.setup();
    renderWithProviders(<UsersAdmin />);
    await waitFor(() => expect(screen.getAllByTestId("um-row")).toHaveLength(1));
    await u.type(screen.getByTestId("um-search"), "nobody");
    await waitFor(() => expect(screen.getByTestId("um-empty-filtered")).toBeTruthy());
    await u.click(screen.getByText("Clear filters"));
    await waitFor(() => expect(screen.getAllByTestId("um-row")).toHaveLength(1));
  });
});

describe("HC-AD-095, 100 bulk bar", () => {
  it("selects rows, deactivates them, sets a comped plan for the selection and exports the selection", async () => {
    mock.loginAs(ADMIN, { role: "admin" });
    mock.loginAs("a1@example.com");
    mock.loginAs("a2@example.com");
    mock.loginAs(ADMIN, { role: "admin" });
    const u = userEvent.setup();
    renderWithProviders(<UsersAdmin />);
    await waitFor(() => expect(screen.getAllByTestId("um-row")).toHaveLength(3));
    const rowOf = (email: string) => screen.getAllByTestId("um-row").find((r) => r.dataset["email"] === email)!;
    await u.click(within(rowOf("a1@example.com")).getByTestId("um-select"));
    await u.click(within(rowOf("a2@example.com")).getByTestId("um-select"));
    expect(screen.getByTestId("um-bulk-count").textContent).toBe("2 selected");
    await u.click(screen.getByTestId("um-bulk-csv"));
    expect((await clipboard()).split("\n")).toHaveLength(3);
    await u.click(screen.getByTestId("um-bulk-plan"));
    await u.selectOptions(screen.getByTestId("set-plan-plan"), "pln_basic");
    await u.selectOptions(screen.getByTestId("set-plan-interval"), "monthly");
    expect(screen.getByTestId("set-plan-summary").textContent).toContain("charged ₹0");
    await u.click(screen.getByTestId("set-plan-save"));
    await waitFor(() => expect(screen.queryByTestId("set-plan-dialog")).toBeNull());
    await waitFor(() => expect(within(rowOf("a1@example.com")).getByTestId("user-plan").textContent).toBe("Basic"));
    expect(mock.state.accounts.get("a1@example.com")!.subscription?.paidInr).toBe("0");
    expect(mock.state.accounts.get("a1@example.com")!.pastSubscriptions).toHaveLength(1);
    await u.click(within(rowOf("a1@example.com")).getByTestId("um-select"));
    await u.click(screen.getByTestId("um-bulk-deactivate"));
    await waitFor(() => expect(mock.state.accounts.get("a1@example.com")!.active).toBe(false));
    await waitFor(() => expect(screen.queryByTestId("um-bulk")).toBeNull());
  });
});

describe("HC-AD-090, 101..107 drawer and HC-AD-108 invite", () => {
  it("opens the drawer from a row, walks the tabs, toggles role and account, saves limits and lot sizes, comps a plan; invites a user", async () => {
    mock.loginAs(ADMIN, { role: "admin" });
    mock.loginAs("ria@example.com");
    mock.loginAs(ADMIN, { role: "admin" });
    const u = userEvent.setup();
    renderWithProviders(<UsersAdmin />);
    await waitFor(() => expect(screen.getAllByTestId("um-row")).toHaveLength(2));
    const ria = screen.getAllByTestId("um-row").find((r) => r.dataset["email"] === "ria@example.com")!;
    fireEvent.keyDown(ria, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("user-drawer").dataset["stateLoad"]).toBe("ready"));
    expect(screen.getByTestId("drawer-name").textContent).toBe("Asha Trader");
    expect(screen.getByTestId("drawer-pill-plan").textContent).toBe("Elite");
    await u.click(screen.getByTestId("drawer-copy-email"));
    expect(await clipboard()).toBe("ria@example.com");
    await u.click(screen.getByTestId("drawer-toggle-role"));
    await waitFor(() => expect(mock.state.accounts.get("ria@example.com")!.user.role).toBe("admin"));
    await waitFor(() => expect(screen.getByTestId("drawer-pill-admin")).toBeTruthy());
    await u.click(screen.getByTestId("drawer-toggle-role"));
    await waitFor(() => expect(mock.state.accounts.get("ria@example.com")!.user.role).toBe("user"));
    await u.click(screen.getByTestId("drawer-toggle-active"));
    await waitFor(() => expect(mock.state.accounts.get("ria@example.com")!.active).toBe(false));
    await waitFor(() => expect(screen.getByTestId("drawer-pill-status").textContent).toBe("Deactivated"));
    await u.click(screen.getByTestId("drawer-toggle-active"));
    await waitFor(() => expect(mock.state.accounts.get("ria@example.com")!.active).toBe(true));
    // subscription tab: comp a plan
    await u.click(screen.getByTestId("drawer-tab-subscription"));
    expect(screen.getByTestId("drawer-panel-subscription").textContent).toContain("Elite");
    await u.click(screen.getByTestId("drawer-set-plan"));
    await u.click(screen.getByTestId("set-plan-save"));
    expect(screen.getByTestId("set-plan-error").textContent).toContain("Pick a plan");
    await u.selectOptions(screen.getByTestId("set-plan-plan"), "pln_pro");
    await u.click(screen.getByTestId("set-plan-save"));
    await waitFor(() => expect(screen.queryByTestId("set-plan-dialog")).toBeNull());
    await waitFor(() => expect(screen.getByTestId("drawer-pill-plan").textContent).toBe("Pro"));
    await waitFor(() => expect(screen.getByTestId("drawer-sub-history")).toBeTruthy());
    // referrals, limits, lots, history
    await u.click(screen.getByTestId("drawer-tab-referrals"));
    expect(screen.getByTestId("drawer-panel-referrals").textContent).toContain("No referrals yet");
    await u.click(screen.getByTestId("drawer-tab-limits"));
    fireEvent.change(screen.getByTestId("drawer-limit-paper_trading"), { target: { value: "7" } });
    await u.click(screen.getByTestId("drawer-limits-save"));
    await waitFor(() => expect(mock.state.accounts.get("ria@example.com")!.limitOverrides).toEqual({ paper_trading: 7 }));
    await u.click(screen.getByTestId("drawer-tab-lots"));
    fireEvent.change(screen.getByTestId("drawer-lot-ETH"), { target: { value: "0" } });
    await u.click(screen.getByTestId("drawer-lots-save"));
    expect(screen.getByRole("alert").textContent).toContain("greater than zero");
    fireEvent.change(screen.getByTestId("drawer-lot-ETH"), { target: { value: "0.02" } });
    await u.click(screen.getByTestId("drawer-lots-save"));
    await waitFor(() => expect(mock.state.accounts.get("ria@example.com")!.settings.lotSizes.ETH).toBe("0.02"));
    await u.click(screen.getByTestId("drawer-tab-history"));
    await waitFor(() => expect(screen.getByTestId("drawer-history").textContent).toContain("set_plan"));
    await u.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("user-drawer")).toBeNull());
    // the acting admin sees no self-destructive buttons
    fireEvent.keyDown(screen.getAllByTestId("um-row").find((r) => r.dataset["email"] === ADMIN)!, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("drawer-self")).toBeTruthy());
    expect(screen.queryByTestId("drawer-toggle-role")).toBeNull();
    await u.keyboard("{Escape}");
    // invite
    await u.click(screen.getByTestId("users-invite"));
    await u.click(screen.getByTestId("invite-send"));
    expect(screen.getByTestId("invite-error").textContent).toContain("Name is required");
    await u.type(screen.getByTestId("invite-name"), "New Trader");
    await u.type(screen.getByTestId("invite-email"), "new@example.com");
    await u.type(screen.getByTestId("invite-mobile"), "12");
    await u.click(screen.getByTestId("invite-send"));
    expect(screen.getByTestId("invite-error").textContent).toContain("10 digits");
    await u.clear(screen.getByTestId("invite-mobile"));
    await u.selectOptions(screen.getByTestId("invite-plan"), "pln_basic");
    await u.click(screen.getByTestId("invite-send"));
    await waitFor(() => expect(screen.queryByTestId("invite-dialog")).toBeNull());
    expect(mock.state.invites[0]).toMatchObject({ email: "new@example.com", name: "New Trader" });
    expect(mock.state.accounts.get("new@example.com")!.subscription?.planId).toBe("pln_basic");
    await waitFor(() => expect(screen.getByTestId("user-drawer").dataset["stateLoad"]).toBe("ready")); // the drawer opens on the invitee
    expect(screen.getByTestId("drawer-name").textContent).toBe("New Trader");
    await u.keyboard("{Escape}");
    await u.click(screen.getByTestId("users-invite"));
    await u.type(screen.getByTestId("invite-name"), "Dup");
    await u.type(screen.getByTestId("invite-email"), "new@example.com");
    await u.click(screen.getByTestId("invite-send"));
    await waitFor(() => expect(screen.getByTestId("invite-error").textContent).toContain("already has an account"));
  });
});

describe("[API] admin fetchers and helpers", () => {
  it("list / detail / setPlan / bulkPlan / invite round-trip; userStatus reads a row", async () => {
    mock.loginAs(ADMIN, { role: "admin" });
    const f = adminFetchers(createApiClient());
    const page = await f.users({ q: "", status: "all", plan: "all", sort: "createdAt", dir: "desc", page: 1 });
    const me = page.items[0]!;
    expect(me.referralCode).toBe("ASHA2026");
    expect((await f.detail(me.id)).planDefaults.planName).toBe("Elite");
    expect((await f.setPlan(me.id, { planId: "pln_pro", interval: "monthly" })).planName).toBe("Pro");
    expect(await f.bulkPlan({ ids: [me.id], planId: "pln_free", interval: "monthly" })).toEqual({ updated: 1, planName: "Free" });
    expect((await f.invite({ name: "Inv", email: "inv@example.com" })).planName).toBeNull();
    await expect(f.detail("usr_nope")).rejects.toThrow(/not found/i);
    expect(userStatus({ ...me, active: false }).key).toBe("deactivated");
    expect(userStatus({ ...me, planName: null }).key).toBe("free");
    expect(userStatus({ ...me, expiresAt: "2000-01-01T00:00:00.000Z" }).key).toBe("expired");
    expect(userStatus({ ...me, expiresAt: null }).key).toBe("active");
  });
});
