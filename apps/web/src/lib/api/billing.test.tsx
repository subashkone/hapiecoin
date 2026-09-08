// Billing fetchers and hooks against the mock API (ADR-030): every route the pages call, with the response schemas.
import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { billingFetchers, useActivatePlan, useBulkAdminUsers, useBulkMenuItems, useBulkPlans, usePlans, useSubscription } from "./billing";
import { createApiClient } from "./client";

const ADMIN = "boss@example.com";
let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
  mock.loginAs(ADMIN, { role: "admin" });
});
afterEach(() => mock.restore());

function Probe() {
  const sub = useSubscription();
  const plans = usePlans();
  const activate = useActivatePlan();
  const bulkPlans = useBulkPlans();
  const bulkMenu = useBulkMenuItems();
  const bulkUsers = useBulkAdminUsers();
  return (
    <div data-testid="probe" data-plans={plans.data?.length ?? 0} data-plan={sub.data?.effectivePlan?.name ?? ""}>
      <button type="button" onClick={() => activate.mutate({ planId: "pln_free", interval: "monthly" })}>activate</button>
      <button type="button" onClick={() => bulkPlans.mutate({ ids: ["pln_basic"], active: false })}>bulk-plans</button>
      <button type="button" onClick={() => bulkMenu.mutate({ ids: ["mnu_alerts"], active: false })}>bulk-menu</button>
      <button type="button" onClick={() => bulkUsers.mutate({ ids: ["nope"], active: false })}>bulk-users</button>
    </div>
  );
}

describe("[API] billing fetchers", () => {
  it("subscription, plans, activate, admin plans / menu items / users, patch and bulk", async () => {
    const f = billingFetchers(createApiClient());
    const view = await f.subscription();
    expect(view.effectivePlan?.name).toBe("Elite");
    expect((await f.plans()).items.map((p) => p.name)).toEqual(["Free", "Basic", "Pro", "Elite"]);
    const admin = await f.adminPlans();
    expect(admin.items).toHaveLength(4);
    const created = await f.createPlan({ name: "Fetch plan", description: "", features: [], intervals: admin.items[0]!.intervals, menuItemIds: [], active: true, sortOrder: 50 });
    expect(created.name).toBe("Fetch plan");
    expect((await f.updatePlan(created.id, { name: "Fetch plan", description: "x", features: [], intervals: created.intervals, menuItemIds: [], active: false, sortOrder: 50 })).active).toBe(false);
    expect((await f.bulkPlans({ ids: [created.id], active: true })).items[0]!.active).toBe(true);
    const items = await f.adminMenuItems();
    expect(items.items).toHaveLength(3);
    const item = await f.createMenuItem({ displayName: "Fetch item", category: "Data", priceInr: "10", active: true });
    expect((await f.updateMenuItem(item.id, { displayName: "Fetch item", category: "Data", priceInr: "20", active: true })).priceInr).toBe("20");
    expect((await f.bulkMenuItems({ ids: [item.id], active: false })).items[0]!.active).toBe(false);
    const users = await f.adminUsers("boss", "all", 1);
    expect(users.items[0]!.email).toBe(ADMIN);
    expect((await f.patchUser(users.items[0]!.id, { commissionPct: "5" })).commissionPct).toBe("5");
    expect(await f.bulkUsers({ ids: [users.items[0]!.id], active: false })).toEqual({ updated: 0 }); // never the acting admin
    expect((await f.activate({ planId: "pln_free", interval: "monthly" })).current?.planName).toBe("Free");
  });

  it("hooks resolve through the query client and mutations invalidate", async () => {
    renderWithProviders(<Probe />);
    await waitFor(() => expect(screen.getByTestId("probe").dataset["plans"]).toBe("4"));
    await waitFor(() => expect(screen.getByTestId("probe").dataset["plan"]).toBe("Elite"));
    screen.getByText("activate").click();
    await waitFor(() => expect(screen.getByTestId("probe").dataset["plan"]).toBe("Free"));
    screen.getByText("bulk-plans").click();
    await waitFor(() => expect(mock.state.plans.find((p) => p.id === "pln_basic")?.active).toBe(false));
    screen.getByText("bulk-menu").click();
    await waitFor(() => expect(mock.state.menuItems.find((m) => m.id === "mnu_alerts")?.active).toBe(false));
    screen.getByText("bulk-users").click();
    await waitFor(() => expect(mock.calls.some((c) => c.url.endsWith("/v1/admin/users/bulk"))).toBe(true));
  });
});
