import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { PlanBanner, PlanBannerView, bannerFor } from "./PlanBanner";

let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
});
afterEach(() => mock.restore());

describe("HC-SH-014 plan banner", () => {
  it("bannerFor maps every plan state to the mock's copy", () => {
    expect(bannerFor({ state: "expired" })).toMatchObject({ text: "Your plan has expired.", button: "Renew Plan", dismissible: false });
    expect(bannerFor({ state: "expiring_soon", daysLeft: 1 }).text).toBe("Your plan expires soon — 1 day left.");
    expect(bannerFor({ state: "expiring_soon", daysLeft: 3 }).text).toBe("Your plan expires soon — 3 days left.");
    expect(bannerFor({ state: "expiring_soon" }).text).toContain("0 days");
    expect(bannerFor({ state: "active", expiresAt: "2026-12-31T00:00:00Z" })).toMatchObject({
      text: "Congratulations! Your plan is active until 31 Dec 2026",
      dismissible: true,
    });
    expect(bannerFor({ state: "active", expiresAt: null }).text).toBe("Congratulations! Your plan is active.");
    expect(bannerFor({ state: "free" })).toMatchObject({ text: "Your free plan is active.", button: "Upgrade" });
  });
  it("renders each kind with its tone, label and button", () => {
    const { rerender } = renderWithProviders(<PlanBannerView plan={{ state: "active", planName: "Pro plan", expiresAt: "2026-12-31T00:00:00Z" }} />);
    expect(screen.getByTestId("plan-banner").dataset["kind"]).toBe("active");
    expect(screen.getByText("PRO PLAN")).toBeTruthy();
    rerender(<PlanBannerView plan={{ state: "expired" }} />);
    expect(screen.getByRole("link", { name: "Renew Plan" }).getAttribute("href")).toBe("/subscription");
    rerender(<PlanBannerView plan={{ state: "expiring_soon", daysLeft: 2 }} />);
    expect(screen.getByTestId("plan-banner").dataset["kind"]).toBe("expiring");
    rerender(<PlanBannerView plan={{ state: "free" }} />);
    expect(screen.getByText("FREE PLAN")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Upgrade" })).toBeTruthy();
  });
  it("loads from /v1/plan and can be dismissed", async () => {
    mock.loginAs("asha@example.com");
    mock.state.accounts.get("asha@example.com")!.plan = { state: "active", planName: "Pro", expiresAt: "2026-12-31T00:00:00Z" };
    renderWithProviders(<PlanBanner />);
    await waitFor(() => expect(screen.getByTestId("plan-banner")).toBeTruthy());
    await userEvent.setup().click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("plan-banner")).toBeNull();
  });
  it("renders nothing while loading or when the API rejects", async () => {
    renderWithProviders(<PlanBanner />); // not logged in → 401
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId("plan-banner")).toBeNull();
  });
});
