// Public page settings dialog (ADR-075; HC-SH-127) against the in-memory mock API: the handle rules, on/off, the taken
// handle refusal, and the link and share bar once the page is live.
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { createAccount } from "../../../test/mock-api";
import { PublicPageDialog } from "./PublicPageDialog";

let mock: MockFetch;
const EMAIL = "asha@example.com";
beforeEach(() => {
  mock = installMockFetch();
  mock.loginAs(EMAIL, { connected: true });
});
afterEach(() => mock.restore());

describe("HC-SH-127 public page dialog", () => {
  it("starts off; the switch waits for a valid handle; a taken handle is refused; saving turns the page on and shows the link and share bar", async () => {
    const other = createAccount(mock.state, { email: "ravi@example.com", name: "Ravi" });
    other.publicPage = { handle: "ravi", enabled: true, showDays: false, showAccounts: false, showMonths: false };
    renderWithProviders(<PublicPageDialog open onOpenChange={() => undefined} />);
    await screen.findByTestId("public-handle");
    expect(screen.getByTestId("public-enabled").hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("public-off-note").textContent).toContain("Choose a handle and save");
    const user = userEvent.setup();
    await user.type(screen.getByTestId("public-handle"), "ab");
    expect(screen.getByTestId("public-enabled").hasAttribute("disabled")).toBe(true);
    await user.clear(screen.getByTestId("public-handle"));
    await user.type(screen.getByTestId("public-handle"), "Ravi");
    expect(screen.getByTestId("public-enabled").hasAttribute("disabled")).toBe(false);
    act(() => {
      fireEvent.click(screen.getByTestId("public-enabled"));
    });
    fireEvent.click(screen.getByTestId("public-save"));
    await waitFor(() => expect(screen.queryByText("Could not save")).not.toBeNull());
    expect(screen.queryByText("That handle is taken")).not.toBeNull();

    await user.clear(screen.getByTestId("public-handle"));
    await user.type(screen.getByTestId("public-handle"), "Asha_Trades");
    fireEvent.click(screen.getByTestId("public-showDays"));
    fireEvent.click(screen.getByTestId("public-save"));
    await waitFor(() => expect(screen.queryByText("Public page is on")).not.toBeNull());
    const acc = mock.state.accounts.get(EMAIL)!;
    expect(acc.publicPage).toEqual({ handle: "asha_trades", enabled: true, showDays: true, showAccounts: false, showMonths: false });
    await waitFor(() => expect(screen.getByTestId<HTMLInputElement>("public-link").value).toBe(`${window.location.origin}/t/asha_trades`));
    expect(screen.getByTestId("public-open").getAttribute("href")).toBe(`${window.location.origin}/t/asha_trades`);
    await waitFor(() => expect(screen.queryByTestId("share-bar")).not.toBeNull());
    expect(screen.getByTestId("share-x").getAttribute("href")).toContain("twitter.com/intent/tweet");
    // renaming warns about old links
    await user.type(screen.getByTestId("public-handle"), "2");
    expect(screen.getByTestId("public-rename-note").textContent).toContain("breaks links you already shared");
  });
});
