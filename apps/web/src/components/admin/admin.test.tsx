// Admin masters (HC-AD-001..028, 042..051, 110..117) against the mock API: the admin guard, plans and menu items
// with dialogs, switches and bulk, and the user subscriptions table with inline edits and per-user dialogs.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { AdminShell } from "./AdminShell";
import { MenuItemsAdmin } from "./MenuItemsAdmin";
import { PlansAdmin } from "./PlansAdmin";
import { UserSubscriptionsAdmin } from "./UserSubscriptionsAdmin";

const ADMIN = "boss@example.com";
let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
});
afterEach(() => mock.restore());

describe("HC-AD-002 / HC-AD-003 admin shell", () => {
  it("denies a plain user and shows the rail with counts and the admin email for an admin", async () => {
    mock.loginAs("plain@example.com");
    const view = renderWithProviders(<AdminShell><div data-testid="inner" /></AdminShell>);
    await waitFor(() => expect(screen.getByTestId("admin-shell").dataset["state"]).toBe("denied"));
    expect(screen.queryByTestId("inner")).toBeNull();
    view.unmount();
    mock.restore();
    mock = installMockFetch();
    mock.loginAs(ADMIN, { role: "admin" });
    renderWithProviders(<AdminShell><div data-testid="inner" /></AdminShell>);
    await waitFor(() => expect(screen.getByTestId("admin-shell").dataset["state"]).toBe("ready"));
    expect(screen.getByTestId("inner")).toBeTruthy();
    expect(screen.getByTestId("admin-nav-plans").getAttribute("href")).toBe("/admin/plans");
    await waitFor(() => expect(screen.getByTestId("admin-nav-plans").textContent).toContain("4"));
    expect(screen.getByTestId("admin-email").textContent).toBe(ADMIN);
  });
});

describe("HC-AD-004..019, 110..112 subscription plans", () => {
  it("lists the seeded plans, validates the dialog, creates a plan, toggles status, filters and bulk-deactivates", async () => {
    mock.loginAs(ADMIN, { role: "admin" });
    renderWithProviders(<PlansAdmin />);
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId("plan-row")).toHaveLength(4));
    expect(screen.getAllByTestId("plan-row").map((r) => r.dataset["plan"])).toEqual(["Free", "Basic", "Pro", "Elite"]);
    await u.click(screen.getByTestId("plan-new"));
    const dlg = screen.getByTestId("plan-dialog");
    await u.click(within(dlg).getByTestId("plan-save"));
    expect(screen.getByText("Plan name is required")).toBeTruthy();
    await u.type(within(dlg).getByTestId("plan-name"), "Starter");
    await u.type(within(dlg).getByTestId("plan-feature-input"), "One feature{Enter}");
    expect(within(dlg).getByTestId("plan-features").textContent).toContain("One feature");
    fireEvent.change(within(dlg).getByTestId("plan-price-monthly"), { target: { value: "199" } });
    fireEvent.change(within(dlg).getByTestId("plan-limit-monthly-paper_trading"), { target: { value: "10" } });
    await u.click(within(dlg).getAllByRole("checkbox")[0]!);
    await u.click(within(dlg).getByTestId("plan-save"));
    await waitFor(() => expect(screen.queryByTestId("plan-dialog")).toBeNull());
    await waitFor(() => expect(screen.getAllByTestId("plan-row")).toHaveLength(5));
    const starterPlan = mock.state.plans.find((p) => p.name === "Starter")!;
    expect(starterPlan.intervals.monthly.priceInr).toBe("199");
    expect(starterPlan.intervals.monthly.limits).toEqual({ paper_trading: 10 });
    expect(starterPlan.features).toEqual(["One feature"]);
    // status switch on the new plan
    const starter = screen.getAllByTestId("plan-row").find((r) => r.dataset["plan"] === "Starter")!;
    await u.click(within(starter).getByTestId("plan-toggle"));
    await waitFor(() => expect(mock.state.plans.find((p) => p.name === "Starter")?.active).toBe(false));
    // filter and search
    await u.selectOptions(screen.getByTestId("plans-status"), "inactive");
    await waitFor(() => expect(screen.getAllByTestId("plan-row")).toHaveLength(1));
    await u.selectOptions(screen.getByTestId("plans-status"), "all");
    await u.type(screen.getByTestId("plans-search"), "pro");
    expect(screen.getAllByTestId("plan-row").map((r) => r.dataset["plan"])).toEqual(["Pro"]);
    await u.clear(screen.getByTestId("plans-search"));
    // bulk
    await u.click(screen.getByTestId("plans-select-all"));
    expect(screen.getByTestId("bulk-bar").textContent).toContain("5 selected");
    await u.click(screen.getByTestId("bulk-deactivate"));
    await waitFor(() => expect(mock.state.plans.every((p) => !p.active)).toBe(true));
    // edit dialog opens with the plan's values
    await u.click(within(screen.getAllByTestId("plan-row")[0]!).getByTestId("plan-edit"));
    expect(screen.getByTestId<HTMLInputElement>("plan-name").value).toBe("Free");
  });
});

describe("HC-AD-020..028 menu pricing", () => {
  it("lists items with linked-plan counts, creates and edits an item, filters by category", async () => {
    mock.loginAs(ADMIN, { role: "admin" });
    renderWithProviders(<MenuItemsAdmin />);
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId("menu-row")).toHaveLength(3));
    const alerts = screen.getAllByTestId("menu-row").find((r) => r.dataset["name"] === "Price & P&L Alerts")!;
    expect(within(alerts).getByTestId("menu-linked").textContent).toBe("3");
    await u.click(screen.getByTestId("menu-new"));
    await u.click(within(screen.getByTestId("menu-item-dialog")).getByTestId("menu-save"));
    expect(screen.getByText("Display Name is required")).toBeTruthy();
    await u.type(screen.getByTestId("menu-name"), "Backtests");
    fireEvent.change(screen.getByTestId("menu-price"), { target: { value: "399" } });
    await u.click(screen.getByTestId("menu-save"));
    await waitFor(() => expect(screen.getAllByTestId("menu-row")).toHaveLength(4));
    await u.selectOptions(screen.getByTestId("menu-category-filter"), "Data");
    expect(screen.getAllByTestId("menu-row")).toHaveLength(1);
    await u.selectOptions(screen.getByTestId("menu-category-filter"), "all");
    await u.click(within(screen.getAllByTestId("menu-row").find((r) => r.dataset["name"] === "Backtests")!).getByTestId("menu-edit"));
    fireEvent.change(screen.getByTestId("menu-price"), { target: { value: "449" } });
    await u.click(screen.getByTestId("menu-save"));
    await waitFor(() => expect(mock.state.menuItems.find((m) => m.displayName === "Backtests")?.priceInr).toBe("449"));
  });
});

describe("HC-AD-042..051 user subscriptions", () => {
  it("searches, edits validity and commission inline, toggles the account, saves limit overrides and lot sizes, pages", async () => {
    mock.loginAs(ADMIN, { role: "admin" });
    const acc = mock.state.accounts.get(ADMIN)!;
    acc.subscription = { id: "sub_1", planId: "pln_pro", interval: "yearly", startsAt: new Date(Date.now() - 5 * 86_400_000).toISOString(), expiresAt: new Date(Date.now() + 360 * 86_400_000).toISOString(), priceInr: "8999", paidInr: "0" };
    for (let i = 1; i <= 11; i += 1) mock.loginAs(`user${i}@example.com`);
    mock.loginAs(ADMIN, { role: "admin" });
    renderWithProviders(<UserSubscriptionsAdmin />);
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId("user-row")).toHaveLength(10));
    expect(screen.getByTestId("users-pager").textContent).toContain("Page 1 of 2 · 12 users");
    await u.type(screen.getByTestId("users-search"), "boss");
    await waitFor(() => expect(screen.getAllByTestId("user-row")).toHaveLength(1));
    const row = screen.getByTestId("user-row");
    expect(within(row).getByTestId("user-plan").textContent).toBe("Pro");
    expect(within(row).getByTestId("user-expiry").textContent).toContain("d left");
    expect(within(row).getByTestId("user-validity").textContent).toBe("365 d");
    await u.click(within(row).getByTestId("user-validity"));
    fireEvent.change(screen.getByTestId("user-validity-input"), { target: { value: "400" } });
    fireEvent.keyDown(screen.getByTestId("user-validity-input"), { key: "Enter" });
    await waitFor(() => expect(within(screen.getByTestId("user-row")).getByTestId("user-validity").textContent).toBe("400 d"));
    await u.click(within(screen.getByTestId("user-row")).getByTestId("user-commission"));
    fireEvent.change(screen.getByTestId("user-commission-input"), { target: { value: "12.5" } });
    fireEvent.keyDown(screen.getByTestId("user-commission-input"), { key: "Enter" });
    await waitFor(() => expect(acc.commissionPct).toBe("12.5"));
    await u.click(within(screen.getByTestId("user-row")).getByTestId("user-limits"));
    fireEvent.change(screen.getByTestId("limit-paper_trading"), { target: { value: "99" } });
    await u.click(screen.getByTestId("limits-save"));
    await waitFor(() => expect(acc.limitOverrides).toEqual({ paper_trading: 99 }));
    await u.click(within(screen.getByTestId("user-row")).getByTestId("user-lots"));
    fireEvent.change(screen.getByTestId("lot-BTC"), { target: { value: "0.002" } });
    await u.click(screen.getByTestId("lot-save"));
    await waitFor(() => expect(acc.settings.lotSizes.BTC).toBe("0.002"));
    await u.clear(screen.getByTestId("users-search"));
    await u.type(screen.getByTestId("users-search"), "user1@");
    await waitFor(() => expect(screen.getAllByTestId("user-row")).toHaveLength(1));
    await u.click(within(screen.getByTestId("user-row")).getByTestId("user-toggle"));
    await waitFor(() => expect(mock.state.accounts.get("user1@example.com")!.active).toBe(false));
    await u.selectOptions(screen.getByTestId("users-status"), "deactivated");
    await waitFor(() => expect(screen.getAllByTestId("user-row").map((r) => r.dataset["email"])).toEqual(["user1@example.com"]));
    await u.click(screen.getByTestId("subs-tab-commissions"));
    expect(screen.getByTestId("commissions-placeholder")).toBeTruthy();
  });
});

describe("admin · the rest of the handlers", () => {
  it("plans dialog: remove a feature chip, discount and quarterly price, link a menu item, dialog switch, cancel; bulk clear", async () => {
    mock.loginAs(ADMIN, { role: "admin" });
    renderWithProviders(<PlansAdmin />);
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId("plan-row")).toHaveLength(4));
    await u.click(within(screen.getAllByTestId("plan-row")[1]!).getByTestId("plan-edit"));
    const dlg = screen.getByTestId("plan-dialog");
    const chips = within(dlg).getByTestId("plan-features");
    const before = chips.querySelectorAll("span").length;
    await u.click(within(chips).getAllByRole("button")[0]!);
    expect(chips.querySelectorAll("span").length).toBeLessThan(before);
    fireEvent.change(within(dlg).getByTestId("plan-discount-monthly"), { target: { value: "" } });
    fireEvent.change(within(dlg).getByTestId("plan-price-quarterly"), { target: { value: "1300" } });
    fireEvent.change(within(dlg).getByTestId("plan-limit-monthly-alerts"), { target: { value: "" } });
    fireEvent.change(within(dlg).getByTestId("plan-sort"), { target: { value: "11" } });
    fireEvent.change(within(dlg).getByTestId("plan-description"), { target: { value: "edited" } });
    const boxes = within(within(dlg).getByTestId("plan-menu-items")).getAllByRole("checkbox");
    await u.click(boxes[boxes.length - 1]!);
    await u.click(within(dlg).getByTestId("plan-active"));
    await u.click(within(dlg).getByTestId("plan-feature-add"));
    await u.click(within(dlg).getByTestId("plan-save"));
    await waitFor(() => expect(mock.state.plans.find((p) => p.name === "Basic")).toMatchObject({ description: "edited", active: false, sortOrder: 11 }));
    expect(mock.state.plans.find((p) => p.name === "Basic")!.intervals.quarterly.priceInr).toBe("1300");
    expect(mock.state.plans.find((p) => p.name === "Basic")!.intervals.monthly.discountPriceInr).toBeNull();
    await u.click(within(screen.getAllByTestId("plan-row")[0]!).getByTestId("plan-select"));
    await u.click(screen.getByTestId("bulk-clear"));
    expect(screen.queryByTestId("bulk-bar")).toBeNull();
    await u.click(screen.getByTestId("plan-new"));
    await u.click(within(screen.getByTestId("plan-dialog")).getByText("Cancel"));
    await waitFor(() => expect(screen.queryByTestId("plan-dialog")).toBeNull());
  });

  it("menu items: status filter, select-all + bulk, switch, empty search, cancel", async () => {
    mock.loginAs(ADMIN, { role: "admin" });
    renderWithProviders(<MenuItemsAdmin />);
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId("menu-row")).toHaveLength(3));
    await u.click(within(screen.getAllByTestId("menu-row")[0]!).getByTestId("menu-toggle"));
    await waitFor(() => expect(mock.state.menuItems.filter((m) => !m.active)).toHaveLength(1));
    await u.selectOptions(screen.getByTestId("menu-status"), "inactive");
    await waitFor(() => expect(screen.getAllByTestId("menu-row")).toHaveLength(1));
    await u.selectOptions(screen.getByTestId("menu-status"), "all");
    await u.type(screen.getByTestId("menu-search"), "zzz");
    expect(screen.getByTestId("menu-empty")).toBeTruthy();
    await u.clear(screen.getByTestId("menu-search"));
    await u.click(screen.getAllByRole("checkbox")[0]!);
    expect(screen.getByTestId("bulk-bar").textContent).toContain("3 selected");
    await u.click(screen.getByTestId("bulk-activate"));
    await waitFor(() => expect(mock.state.menuItems.every((m) => m.active)).toBe(true));
    await u.click(within(screen.getAllByTestId("menu-row")[0]!).getByTestId("menu-select"));
    await u.click(screen.getByTestId("bulk-deactivate"));
    await waitFor(() => expect(mock.state.menuItems.filter((m) => !m.active)).toHaveLength(1));
    await u.click(screen.getByTestId("menu-new"));
    await u.click(within(screen.getByTestId("menu-item-dialog")).getByText("Cancel"));
    await waitFor(() => expect(screen.queryByTestId("menu-item-dialog")).toBeNull());
  });

  it("users: select-all + bulk deactivate, pager, dialog cancels, Escape on an inline edit, status filters", async () => {
    mock.loginAs(ADMIN, { role: "admin" });
    for (let i = 1; i <= 11; i += 1) mock.loginAs(`u${i}@example.com`);
    mock.loginAs(ADMIN, { role: "admin" });
    renderWithProviders(<UserSubscriptionsAdmin />);
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId("user-row")).toHaveLength(10));
    await u.click(screen.getByText("Next →"));
    await waitFor(() => expect(screen.getByTestId("users-pager").textContent).toContain("Page 2 of 2"));
    await u.click(screen.getByText("← Previous"));
    await waitFor(() => expect(screen.getByTestId("users-pager").textContent).toContain("Page 1 of 2"));
    await u.click(screen.getAllByRole("checkbox")[0]!);
    expect(screen.getByTestId("bulk-bar").textContent).toContain("10 selected");
    await u.click(screen.getByTestId("bulk-deactivate"));
    await waitFor(() => expect([...mock.state.accounts.values()].filter((a) => !a.active).length).toBeGreaterThan(0));
    await u.selectOptions(screen.getByTestId("users-status"), "active");
    await waitFor(() => expect(screen.getByTestId("users-pager").textContent).toMatch(/users/));
    await u.selectOptions(screen.getByTestId("users-status"), "expired");
    await waitFor(() => expect(screen.getByTestId("users-empty")).toBeTruthy());
    await u.selectOptions(screen.getByTestId("users-status"), "free");
    await waitFor(() => expect(screen.getByTestId("users-empty")).toBeTruthy());
    await u.selectOptions(screen.getByTestId("users-status"), "all");
    await waitFor(() => expect(screen.getAllByTestId("user-row").length).toBeGreaterThan(0));
    await u.click(within(screen.getAllByTestId("user-row")[0]!).getByTestId("user-validity"));
    fireEvent.keyDown(screen.getByTestId("user-validity-input"), { key: "Escape" });
    expect(screen.queryByTestId("user-validity-input")).toBeNull();
    await u.click(within(screen.getAllByTestId("user-row")[0]!).getByTestId("user-limits"));
    await u.click(within(screen.getByTestId("limits-dialog")).getByText("Cancel"));
    await waitFor(() => expect(screen.queryByTestId("limits-dialog")).toBeNull());
    await u.click(within(screen.getAllByTestId("user-row")[0]!).getByTestId("user-lots"));
    await u.click(within(screen.getByTestId("lot-sizes-dialog")).getByText("Cancel"));
    await waitFor(() => expect(screen.queryByTestId("lot-sizes-dialog")).toBeNull());
  });
});
