// Admin · Promotional Emails against the mock API (HC-AD-071..085, 124..128; ADR-035).
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { createApiClient } from "@/lib/api/client";
import { emailFetchers } from "@/lib/api/emails";
import { useUiStore } from "@/lib/store";
import { EmailsAdmin } from "./EmailsAdmin";

const ADMIN = "boss@example.com";
let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
  useUiStore.setState({ adminCols: {} });
});
afterEach(() => mock.restore());
async function seed(email: string, extra: Record<string, unknown>) {
  const res = await mock.app.request("http://localhost/__test/seed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, ...extra }) });
  expect(res.status).toBe(200);
}

describe("HC-AD-071..081, 124, 125, 128 compose", () => {
  it("picks recipients by search and segment, fills a template, inserts placeholders, previews, test-sends and sends with confirm", async () => {
    await seed(ADMIN, { role: "admin" });
    for (let i = 1; i <= 8; i += 1) mock.loginAs(`user${i}@example.com`);
    mock.state.accounts.get("user2@example.com")!.subscription = null; // a free user
    mock.loginAs(ADMIN, { role: "admin" });
    const u = userEvent.setup();
    renderWithProviders(<EmailsAdmin />);
    await waitFor(() => expect(screen.getAllByTestId("email-recipient")).toHaveLength(9));
    expect(screen.getByTestId("email-send")).toHaveProperty("disabled", true);
    await u.selectOptions(screen.getByTestId("email-segment"), "free");
    await waitFor(() => expect(screen.getAllByTestId("email-recipient")).toHaveLength(1));
    await u.selectOptions(screen.getByTestId("email-segment"), "paid");
    await waitFor(() => expect(screen.getAllByTestId("email-recipient")).toHaveLength(8));
    await u.type(screen.getByTestId("email-search"), "user7");
    await waitFor(() => expect(screen.getAllByTestId("email-recipient")).toHaveLength(1));
    await u.click(screen.getByTestId("email-recipient"));
    expect(screen.getByTestId("email-selected").textContent).toBe("1 selected");
    await u.clear(screen.getByTestId("email-search"));
    await waitFor(() => expect(screen.getAllByTestId("email-recipient")).toHaveLength(8));
    await u.click(screen.getByTestId("email-select-all"));
    expect(screen.getByTestId("email-selected").textContent).toBe("8 selected");
    await u.type(screen.getByTestId("email-search"), "zzz");
    await waitFor(() => expect(screen.getByTestId("email-no-users")).toBeTruthy());
    await u.clear(screen.getByTestId("email-search"));
    // template, placeholders and preview
    await u.click(screen.getByTestId("email-template-plan_expiring"));
    expect(screen.getByTestId("promo-subject")).toHaveProperty("value", "Your {{plan}} plan ends on {{expiry}}");
    expect(screen.getByTestId("email-preview-subject").textContent).toMatch(/^Your Elite plan ends on \d{2} \w{3} \d{4}$/);
    await u.click(screen.getByTestId("promo-subject"));
    await u.click(screen.getByTestId("email-insert-name"));
    await waitFor(() => expect(screen.getByTestId("promo-subject")).toHaveProperty("value", expect.stringContaining("{{name}}") as string));
    await u.click(screen.getByTestId("promo-message"));
    await u.click(screen.getByTestId("email-insert-email"));
    await waitFor(() => expect(screen.getByTestId("promo-message")).toHaveProperty("value", expect.stringContaining("{{email}}") as string));
    expect(screen.getByTestId("email-preview-message").textContent).toContain("user7@example.com");
    // test send to me
    await u.click(screen.getByTestId("email-test"));
    await waitFor(() => expect(screen.getByText("Test email sent")).toBeTruthy());
    expect(mock.state.campaigns).toHaveLength(0);
    // send with confirm → history
    expect(screen.getByTestId("email-send")).toHaveProperty("disabled", false);
    await u.click(screen.getByTestId("email-send"));
    expect(screen.getByTestId("email-confirm").textContent).toContain("Send to 8 users?");
    await u.click(screen.getByTestId("email-send-confirm"));
    await waitFor(() => expect(screen.getByTestId("admin-emails").dataset["tab"]).toBe("history"));
    expect(mock.state.campaigns[0]).toMatchObject({ recipients: 8, delivered: 7, failed: 1, segment: "paid" });
    await waitFor(() => expect(screen.getAllByTestId("campaign-row")).toHaveLength(1));
  });

  it("validation: test send without a message, empty preview with raw placeholders, clear selection", async () => {
    await seed(ADMIN, { role: "admin" });
    mock.loginAs(ADMIN, { role: "admin" });
    const u = userEvent.setup();
    renderWithProviders(<EmailsAdmin />);
    await waitFor(() => expect(screen.getAllByTestId("email-recipient")).toHaveLength(1));
    await u.click(screen.getByTestId("email-test"));
    await waitFor(() => expect(screen.getByText("Validation")).toBeTruthy());
    fireEvent.change(screen.getByTestId("promo-message"), { target: { value: "Hi {{name}}" } }); // user-event would eat the braces
    expect(screen.getByTestId("email-preview-message").textContent).toBe("Hi {{name}}"); // nobody selected: raw token
    expect(screen.getByTestId("email-preview-message").className).toContain("text-warning");
    await u.click(screen.getByTestId("email-recipient"));
    expect(screen.getByTestId("email-preview-message").textContent).toBe("Hi Asha Trader");
    await u.click(screen.getByTestId("email-clear"));
    expect(screen.getByTestId("email-selected").textContent).toBe("0 selected");
  });
});

describe("HC-AD-082..085, 126, 127 history", () => {
  it("lists campaigns newest first, searches, sorts, hides the Segment column, copies CSV, opens the detail with recipients and CSV", async () => {
    await seed(ADMIN, { role: "admin", campaigns: 3 });
    mock.loginAs(ADMIN, { role: "admin" });
    const u = userEvent.setup();
    renderWithProviders(<EmailsAdmin />);
    await u.click(await screen.findByTestId("emails-tab-history"));
    await waitFor(() => expect(screen.getAllByTestId("campaign-row")).toHaveLength(3));
    expect(screen.queryByTestId("email-send")).toBeNull(); // header primary hides on History
    expect(screen.getAllByTestId("campaign-row")[0]!.dataset["subject"]).toBe("Your weekly options report is ready");
    await u.click(screen.getByTestId("history-sort-failed"));
    expect(screen.getAllByTestId("campaign-row")[0]!.textContent).toContain("1");
    await u.click(screen.getByTestId("history-columns-button"));
    await u.click(within(screen.getByTestId("history-columns-segment")).getByRole("checkbox"));
    expect(within(screen.getByTestId("history-table")).getByText("Segment")).toBeTruthy();
    await u.keyboard("{Escape}");
    await u.type(screen.getByTestId("history-search"), "diwali");
    await waitFor(() => expect(screen.getAllByTestId("campaign-row")).toHaveLength(1));
    await u.click(screen.getByTestId("history-csv"));
    expect((await navigator.clipboard.readText()).split("\n")).toHaveLength(2);
    fireEvent.keyDown(screen.getByTestId("campaign-row"), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("campaign-detail").dataset["state"]).toBe("ready"));
    expect(screen.getByTestId("campaign-subject").textContent).toContain("Diwali");
    expect(screen.getAllByTestId("campaign-recipient")).toHaveLength(3);
    expect(screen.getAllByTestId("campaign-recipient").filter((r) => r.dataset["status"] === "failed")).toHaveLength(1);
    await u.click(screen.getByTestId("campaign-csv"));
    expect((await navigator.clipboard.readText()).split("\n")).toHaveLength(4);
    await u.click(screen.getByTestId("campaign-back"));
    await waitFor(() => expect(screen.getAllByTestId("campaign-row")).toHaveLength(1));
  });

  it("empty history and error state", async () => {
    mock.loginAs(ADMIN, { role: "admin" });
    const u = userEvent.setup();
    const view = renderWithProviders(<EmailsAdmin />);
    await u.click(await screen.findByTestId("emails-tab-history"));
    await waitFor(() => expect(screen.getByTestId("history-empty")).toBeTruthy());
    view.unmount();
    mock.restore();
    mock = installMockFetch();
    renderWithProviders(<EmailsAdmin />);
    await u.click(await screen.findByTestId("emails-tab-history"));
    await waitFor(() => expect(screen.getByTestId("email-history").dataset["state"]).toBe("error"));
    await u.click(screen.getByText("Retry"));
    await waitFor(() => expect(screen.getByTestId("email-history").dataset["state"]).toBe("error"));
  });
});

describe("[API] email fetchers", () => {
  it("recipients / send / test / campaigns / campaign round-trip", async () => {
    await seed(ADMIN, { role: "admin", campaigns: 1 });
    mock.loginAs(ADMIN, { role: "admin" });
    const f = emailFetchers(createApiClient());
    const rec = await f.recipients("", "all");
    expect(rec.items).toHaveLength(1);
    const sent = await f.send({ userIds: [rec.items[0]!.id], subject: "S", message: "M", segment: "all" });
    expect(sent.campaign.recipients).toBe(1);
    expect((await f.test({ subject: "T {{name}}", message: "m" })).subject).toBe("T Asha Trader");
    expect((await f.campaigns()).items).toHaveLength(2);
    expect((await f.campaign(sent.campaign.id)).recipients).toHaveLength(1);
    await expect(f.campaign("cmp_nope")).rejects.toThrow(/not found/i);
  });
});
