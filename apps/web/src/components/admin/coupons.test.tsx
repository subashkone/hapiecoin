// Admin · Coupon Code Master against the mock API (HC-AD-029..041, 115, 116; ADR-034).
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { CouponsAdmin } from "./CouponsAdmin";

const ADMIN = "boss@example.com";
let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
});
afterEach(() => mock.restore());
async function seed(email: string, extra: Record<string, unknown>) {
  const res = await mock.app.request("http://localhost/__test/seed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, ...extra }) });
  expect(res.status).toBe(200);
}

describe("HC-AD-029..034, 115, 116 coupon list", () => {
  it("lists with discount, type, validity, plans and uses; filters; switches; bulk deactivates and deletes with confirm", async () => {
    await seed(ADMIN, { role: "admin", coupons: true });
    mock.loginAs(ADMIN, { role: "admin" });
    const u = userEvent.setup();
    renderWithProviders(<CouponsAdmin />);
    await waitFor(() => expect(screen.getByTestId("admin-coupons").dataset["state"]).toBe("ready"));
    expect(screen.getAllByTestId("coupon-row")).toHaveLength(4);
    const basic = screen.getAllByTestId("coupon-row").find((r) => r.dataset["code"] === "BASIC20")!;
    expect(within(basic).getByTestId("coupon-uses").textContent).toBe("37 / 100");
    expect(basic.textContent).toContain("20%");
    expect(screen.getAllByTestId("coupon-row").find((r) => r.dataset["code"] === "DIWALI30")!.textContent).toContain("Expired");
    await u.selectOptions(screen.getByTestId("coupon-type-filter"), "community");
    expect(screen.getAllByTestId("coupon-row").map((r) => r.dataset["code"])).toEqual(["COMMUNITY25"]);
    await u.click(screen.getByTestId("coupon-clear"));
    await u.selectOptions(screen.getByTestId("coupon-status-filter"), "expired");
    expect(screen.getAllByTestId("coupon-row").map((r) => r.dataset["code"])).toEqual(["DIWALI30"]);
    await u.click(screen.getByTestId("coupon-clear"));
    await u.type(screen.getByTestId("coupon-search"), "zzz");
    expect(screen.getByTestId("coupon-empty-filtered")).toBeTruthy();
    await u.click(screen.getByText("Clear filters"));
    await u.click(within(screen.getAllByTestId("coupon-row").find((r) => r.dataset["code"] === "BASIC20")!).getByTestId("coupon-toggle"));
    await waitFor(() => expect(mock.state.coupons.find((c) => c.code === "BASIC20")?.active).toBe(false));
    await u.click(screen.getByTestId("coupon-csv"));
    expect((await navigator.clipboard.readText()).split("\n")).toHaveLength(5);
    // bulk: select two, deactivate, then delete with confirm
    const rows = () => screen.getAllByTestId("coupon-row");
    await u.click(within(rows().find((r) => r.dataset["code"] === "PRO500")!).getByTestId("coupon-select"));
    await u.click(within(rows().find((r) => r.dataset["code"] === "COMMUNITY25")!).getByTestId("coupon-select"));
    expect(screen.getByTestId("coupon-bulk-count").textContent).toBe("2 selected");
    await u.click(screen.getByTestId("coupon-bulk-deactivate"));
    await waitFor(() => expect(mock.state.coupons.filter((c) => !c.active)).toHaveLength(4));
    await u.click(within(rows().find((r) => r.dataset["code"] === "PRO500")!).getByTestId("coupon-select"));
    await u.click(screen.getByTestId("coupon-bulk-delete"));
    expect(screen.getByTestId("coupon-delete-dialog").textContent).toContain("PRO500");
    await u.click(screen.getByTestId("coupon-delete-confirm"));
    await waitFor(() => expect(rows()).toHaveLength(3));
    await u.click(within(rows().find((r) => r.dataset["code"] === "DIWALI30")!).getByTestId("coupon-delete"));
    await u.click(screen.getByTestId("coupon-delete-confirm"));
    await waitFor(() => expect(rows()).toHaveLength(2));
  });

  it("bulk activate, deselect all in the assign block, fixed-discount and window validation, refusals when a coupon is gone", async () => {
    await seed(ADMIN, { role: "admin", coupons: true });
    mock.loginAs("ria@example.com");
    mock.loginAs(ADMIN, { role: "admin" });
    const u = userEvent.setup();
    renderWithProviders(<CouponsAdmin />);
    await waitFor(() => expect(screen.getAllByTestId("coupon-row")).toHaveLength(4));
    await u.click(screen.getByTestId("coupon-select-all"));
    await u.click(screen.getByTestId("coupon-bulk-activate"));
    await waitFor(() => expect(mock.state.coupons.every((c) => c.active)).toBe(true));
    await u.click(screen.getByTestId("coupon-new"));
    await u.type(screen.getByTestId("coupon-code"), "FIX0");
    await u.selectOptions(screen.getByTestId("coupon-discount-type"), "fixed");
    await u.type(screen.getByTestId("coupon-discount-value"), "0");
    await u.click(screen.getByTestId("coupon-save"));
    expect(screen.getByTestId("coupon-error").textContent).toContain("above 0");
    await u.clear(screen.getByTestId("coupon-discount-value"));
    await u.type(screen.getByTestId("coupon-discount-value"), "10");
    await waitFor(() => expect(screen.getByTestId("coupon-cell-pln_pro-monthly")).toBeTruthy());
    await u.click(screen.getByTestId("coupon-cell-pln_pro-monthly"));
    await u.click(screen.getByTestId("coupon-cell-pln_pro-monthly")); // toggling off empties the plan again
    await u.click(screen.getByTestId("coupon-save"));
    expect(screen.getByTestId("coupon-error").textContent).toContain("at least one plan");
    await u.click(screen.getByTestId("coupon-cell-pln_pro-monthly"));
    fireEvent.change(screen.getByTestId("coupon-starts"), { target: { value: "2026-09-10T00:00" } });
    fireEvent.change(screen.getByTestId("coupon-ends"), { target: { value: "2026-09-01T00:00" } });
    await u.click(screen.getByTestId("coupon-save"));
    expect(screen.getByTestId("coupon-error").textContent).toContain("End must be after start");
    fireEvent.change(screen.getByTestId("coupon-ends"), { target: { value: "2026-12-01T00:00" } });
    await u.selectOptions(screen.getByTestId("coupon-scope"), "community");
    await waitFor(() => expect(screen.getAllByTestId("coupon-assign-user").length).toBeGreaterThan(0));
    await u.click(screen.getByTestId("coupon-assign-all"));
    await u.click(screen.getByTestId("coupon-assign-none"));
    expect(screen.getByTestId("coupon-assign").textContent).toContain("0 assigned");
    await u.click(screen.getAllByTestId("coupon-assign-user")[0]!);
    await u.click(screen.getAllByTestId("coupon-assign-user")[0]!);
    await u.click(screen.getByTestId("coupon-save"));
    await waitFor(() => expect(mock.state.coupons.find((c) => c.code === "FIX0")).toMatchObject({ discountType: "fixed", discountValue: "10", scope: "community", assignedUserIds: [] }));
    // the coupon vanishes under the admin: switch, edit and delete surface the API refusal
    const row = () => screen.getAllByTestId("coupon-row").find((r) => r.dataset["code"] === "FIX0")!;
    mock.state.coupons.splice(mock.state.coupons.findIndex((c) => c.code === "FIX0"), 1);
    await u.click(within(row()).getByTestId("coupon-toggle"));
    await waitFor(() => expect(screen.getAllByText("Failed").length).toBeGreaterThan(0));
    await u.click(within(row()).getByTestId("coupon-edit"));
    await u.click(screen.getByTestId("coupon-save"));
    await waitFor(() => expect(screen.getByTestId("coupon-error").textContent).toContain("not found"));
    await u.keyboard("{Escape}");
    await u.click(within(row()).getByTestId("coupon-delete"));
    await u.click(screen.getByTestId("coupon-delete-confirm"));
    await waitFor(() => expect(screen.getAllByText("Failed").length).toBeGreaterThan(1));
  });

  it("empty and error states", async () => {
    mock.loginAs(ADMIN, { role: "admin" });
    const view = renderWithProviders(<CouponsAdmin />);
    await waitFor(() => expect(screen.getByTestId("coupon-empty")).toBeTruthy());
    view.unmount();
    mock.restore();
    mock = installMockFetch();
    renderWithProviders(<CouponsAdmin />);
    await waitFor(() => expect(screen.getByTestId("coupon-load-error")).toBeTruthy());
    await userEvent.setup().click(screen.getByText("Retry"));
    await waitFor(() => expect(screen.getByTestId("coupon-load-error")).toBeTruthy());
  });
});

describe("HC-AD-035..041 coupon dialog", () => {
  it("validates the code, value and grid, assigns users for a community coupon, creates, refuses a duplicate, edits", async () => {
    await seed(ADMIN, { role: "admin", coupons: true });
    mock.loginAs("ria@example.com");
    mock.loginAs(ADMIN, { role: "admin" });
    const u = userEvent.setup();
    renderWithProviders(<CouponsAdmin />);
    await waitFor(() => expect(screen.getAllByTestId("coupon-row")).toHaveLength(4));
    await u.click(screen.getByTestId("coupon-new"));
    await u.click(screen.getByTestId("coupon-save"));
    expect(screen.getByTestId("coupon-error").textContent).toBe("Code is required");
    await u.type(screen.getByTestId("coupon-code"), "vip 50!");
    expect(screen.getByTestId("coupon-code")).toHaveProperty("value", "VIP50");
    await u.type(screen.getByTestId("coupon-discount-value"), "150");
    await u.click(screen.getByTestId("coupon-save"));
    expect(screen.getByTestId("coupon-error").textContent).toContain("1–100");
    await u.clear(screen.getByTestId("coupon-discount-value"));
    await u.type(screen.getByTestId("coupon-discount-value"), "50");
    await u.click(screen.getByTestId("coupon-save"));
    expect(screen.getByTestId("coupon-error").textContent).toContain("at least one plan");
    await waitFor(() => expect(screen.getByTestId("coupon-cell-pln_pro-yearly")).toBeTruthy());
    await u.click(screen.getByTestId("coupon-cell-pln_pro-yearly"));
    await u.click(screen.getByTestId("coupon-cell-pln_elite-yearly"));
    await u.selectOptions(screen.getByTestId("coupon-scope"), "community");
    await waitFor(() => expect(screen.getAllByTestId("coupon-assign-user").length).toBeGreaterThan(0));
    await u.type(screen.getByTestId("coupon-assign-search"), "ria");
    await waitFor(() => expect(screen.getAllByTestId("coupon-assign-user")).toHaveLength(1));
    await u.click(screen.getByTestId("coupon-assign-all"));
    expect(screen.getByTestId("coupon-assign").textContent).toContain("1 assigned");
    await u.click(screen.getByTestId("coupon-save"));
    await waitFor(() => expect(screen.queryByTestId("coupon-dialog")).toBeNull());
    const created = mock.state.coupons.find((c) => c.code === "VIP50")!;
    expect(created).toMatchObject({ scope: "community", discountValue: "50", planIds: ["pln_pro", "pln_elite"], intervals: ["yearly"] });
    expect(created.assignedUserIds).toEqual([mock.state.accounts.get("ria@example.com")!.user.id]);
    // duplicate code refused by the API
    await u.click(screen.getByTestId("coupon-new"));
    await u.type(screen.getByTestId("coupon-code"), "BASIC20");
    await u.type(screen.getByTestId("coupon-discount-value"), "5");
    await u.click(screen.getByTestId("coupon-cell-pln_pro-monthly"));
    await u.click(screen.getByTestId("coupon-save"));
    await waitFor(() => expect(screen.getByTestId("coupon-error").textContent).toContain("already exists"));
    await u.keyboard("{Escape}");
    // edit pre-fills and updates
    await u.click(within(screen.getAllByTestId("coupon-row").find((r) => r.dataset["code"] === "VIP50")!).getByTestId("coupon-edit"));
    expect(screen.getByTestId("coupon-code")).toHaveProperty("value", "VIP50");
    expect(screen.getByTestId("coupon-cell-pln_pro-yearly")).toHaveProperty("checked", true);
    await u.clear(screen.getByTestId("coupon-description"));
    await u.type(screen.getByTestId("coupon-description"), "VIP members");
    await u.click(screen.getByTestId("coupon-save"));
    await waitFor(() => expect(mock.state.coupons.find((c) => c.code === "VIP50")?.description).toBe("VIP members"));
  });
});
