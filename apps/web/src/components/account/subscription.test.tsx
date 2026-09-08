// My Subscription (HC-AC-003..015, 056..058) and Upgrade Required (HC-SH-054) against the mock API (ADR-030).
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { ApiError } from "@/lib/api/client";
import { handleUpgradeRequired } from "@/lib/api/upgrade";
import { useUiStore } from "@/lib/store";
import { UpgradeRequiredDialog } from "@/components/dialogs/UpgradeRequiredDialog";
import { SubscriptionPage } from "./SubscriptionPage";

const EMAIL = "plans@example.com";
let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
  mock.loginAs(EMAIL);
  mock.state.accounts.get(EMAIL)!.subscription = null; // a free user
  useUiStore.setState({ dialog: null, upgradeMessage: "" });
});
afterEach(() => mock.restore());

describe("HC-AC-003..015 My Subscription", () => {
  it("a free user sees the Free plan's limits, the four plans, the interval toggle, a pinned diff and the matrix", async () => {
    renderWithProviders(<SubscriptionPage />);
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId("subscription-page").dataset["state"]).toBe("ready"));
    expect(screen.getByTestId("sub-none").textContent).toContain("No Active Subscription");
    const limits = screen.getByTestId("sub-limits");
    const paper = within(limits).getAllByTestId("limit-row").find((r) => r.dataset["key"] === "paper_trading")!;
    expect(paper.textContent).toContain("3 / month");
    expect(paper.textContent).toContain("0 of 3 used");
    const live = within(limits).getAllByTestId("limit-row").find((r) => r.dataset["key"] === "live_trading")!;
    expect(live.dataset["included"]).toBe("false");
    expect(live.textContent).toContain("Not included");
    const cards = screen.getAllByTestId("plan-card");
    expect(cards.map((c) => c.dataset["plan"])).toEqual(["Free", "Basic", "Pro", "Elite"]);
    expect(cards[0]!.dataset["current"]).toBe("true");
    // the next plan up is pinned by default with its diff
    expect(cards[1]!.dataset["pinned"]).toBe("true");
    expect(screen.getByTestId("plan-diff").textContent).toContain("upgrade to Basic");
    expect(screen.getAllByTestId("plan-diff-row").length).toBeGreaterThan(0);
    // interval toggle changes the card prices
    const proMonthly = within(cards[2]!).getByTestId("plan-price").textContent;
    await u.click(screen.getByTestId("interval-yearly"));
    expect(within(screen.getAllByTestId("plan-card")[2]!).getByTestId("plan-price").textContent).not.toBe(proMonthly);
    // pin Elite
    await u.click(screen.getAllByTestId("plan-card")[3]!);
    expect(screen.getByTestId("plan-diff").textContent).toContain("Elite");
    expect(screen.getByTestId("plan-matrix").textContent).toContain("∞");
  });

  it("Subscribe on a paid plan shows the breakdown with GST and an enabled Pay with Razorpay button; Activate on Free activates without payment", async () => {
    renderWithProviders(<SubscriptionPage />);
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId("subscription-page").dataset["state"]).toBe("ready"));
    await u.click(within(screen.getAllByTestId("plan-card")[2]!).getByTestId("plan-action"));
    const dlg = screen.getByTestId("subscribe-dialog");
    expect(dlg.textContent).toContain("Subscribe to Pro · Monthly");
    expect(within(dlg).getByTestId("price-breakdown").textContent).toContain("Tax (18% GST)");
    expect(within(dlg).getByTestId("price-total").textContent).toMatch(/₹/);
    expect(within(dlg).getByTestId("subscribe-pay").hasAttribute("disabled")).toBe(false);
    await u.click(within(dlg).getByText("Cancel"));
    await u.click(within(screen.getAllByTestId("plan-card")[0]!).getByTestId("plan-action"));
    const free = screen.getByTestId("subscribe-dialog");
    expect(within(free).getByTestId("price-total").textContent).toContain("₹0");
    await u.click(within(free).getByTestId("subscribe-activate"));
    await waitFor(() => expect(screen.getByTestId("sub-plan-name").textContent).toBe("Free"));
    expect(screen.getByTestId("sub-status").dataset["state"]).toBe("active");
    expect(screen.getByTestId("sub-valid-until").textContent).toContain("No end date");
    expect(mock.state.accounts.get(EMAIL)!.subscription?.planId).toBe("pln_free");
  });

  it("HC-SH-054 an UPGRADE_REQUIRED error opens the dialog with the API's reason; other errors are left to the caller", async () => {
    renderWithProviders(<UpgradeRequiredDialog open={useUiStore.getState().dialog === "upgrade"} onOpenChange={() => useUiStore.getState().openDialog(null)} />);
    expect(handleUpgradeRequired(new ApiError(403, "UPGRADE_REQUIRED", "Your Free plan allows 3 paper trades / month; you have used 3 this month. Upgrade for more."))).toBe(true);
    expect(useUiStore.getState().dialog).toBe("upgrade");
    expect(useUiStore.getState().upgradeMessage).toContain("3 paper trades");
    expect(handleUpgradeRequired(new ApiError(409, "CONFLICT", "nope"))).toBe(false);
    expect(handleUpgradeRequired(new Error("x"))).toBe(false);
    act(() => useUiStore.getState().openUpgrade("Live trading is not included in your Free plan. Upgrade to unlock it."));
    renderWithProviders(<UpgradeRequiredDialog open onOpenChange={() => useUiStore.getState().openDialog(null)} />);
    expect(screen.getByTestId("upgrade-message").textContent).toContain("Live trading is not included");
    expect(screen.getByTestId("upgrade-subscribe").getAttribute("href")).toBe("/subscription");
    await userEvent.setup().click(screen.getByTestId("upgrade-dismiss"));
    expect(useUiStore.getState().dialog).toBeNull();
  });
});

describe("HC-AC-008 / HC-AC-009 / HC-AC-064 current-plan actions and error state", () => {
  it("a subscribed user gets Renew and Upgrade opening the breakdown; Enter pins a card", async () => {
    const acc = mock.state.accounts.get(EMAIL)!;
    acc.subscription = { id: "sub_x", planId: "pln_basic", interval: "quarterly", startsAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 40 * 86_400_000).toISOString(), priceInr: "1299", paidInr: "1169" };
    renderWithProviders(<SubscriptionPage />);
    const u = userEvent.setup();
    await waitFor(() => expect(screen.getByTestId("subscription-page").dataset["state"]).toBe("ready"));
    expect(screen.getByTestId("sub-plan-name").textContent).toBe("Basic");
    expect(screen.getByTestId("sub-summary").textContent).toContain("Quarterly");
    expect(screen.getByTestId("sub-days-left").textContent).toContain("d left");
    await u.click(screen.getByTestId("sub-renew"));
    expect(screen.getByTestId("subscribe-dialog").textContent).toContain("Subscribe to Basic · Quarterly");
    await u.click(within(screen.getByTestId("subscribe-dialog")).getByText("Cancel"));
    await u.click(screen.getByTestId("sub-upgrade"));
    expect(screen.getByTestId("subscribe-dialog").textContent).toContain("Subscribe to Pro");
    await u.click(within(screen.getByTestId("subscribe-dialog")).getByText("Cancel"));
    screen.getAllByTestId("plan-card")[3]!.focus();
    await u.keyboard("{Enter}");
    expect(screen.getAllByTestId("plan-card")[3]!.dataset["pinned"]).toBe("true");
  });

  it("shows the error state with Retry when the API fails", async () => {
    mock.restore();
    mock = installMockFetch();
    renderWithProviders(<SubscriptionPage />);
    await waitFor(() => expect(screen.getByTestId("subscription-page").dataset["state"]).toBe("error"));
    expect(screen.getByText("Retry")).toBeTruthy();
  });
});
