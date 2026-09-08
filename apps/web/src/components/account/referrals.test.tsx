// My Referrals against the mock API (HC-AC-037..055, 067..074; ADR-031): link card, code chip, tiles, chart,
// filters / sort / paging, CSV, share dialog, and the empty and error states.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { referralFetchers, referralsCsv, shareTemplates } from "@/lib/api/referrals";
import { createApiClient } from "@/lib/api/client";
import { ReferralsPage } from "./ReferralsPage";

const RIA = "ria@example.com";
let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
});
afterEach(() => mock.restore());
// user-event installs its own clipboard stub on setup(); read what the page copied back through it
const clipboard = () => navigator.clipboard.readText();

async function seed(email: string, referrals: number, role?: "user" | "admin") {
  const res = await mock.app.request("http://localhost/__test/seed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, referrals, ...(role ? { role } : {}) }) });
  expect(res.status).toBe(200);
}

describe("HC-AC-037..055 My Referrals", () => {
  it("HC-AC-037 / 038 / 041 / 043 / 067 header meta, link card, code chip, tiles and the chart from six referrals", async () => {
    await seed(RIA, 6);
    mock.loginAs(RIA);
    const u = userEvent.setup();
    renderWithProviders(<ReferralsPage />);
    await waitFor(() => expect(screen.getByTestId("referrals-page").dataset["state"]).toBe("ready"));
    expect(screen.getByTestId("referrals-page").dataset["count"]).toBe("6");
    expect(screen.getByTestId("ref-meta").textContent).toBe("20% commission · 6 referrals");
    expect(screen.getByTestId("ref-link")).toHaveProperty("value", "http://localhost:3000/auth?tab=signup&ref=ASHA2026");
    expect(screen.getByTestId("ref-link-card").textContent).toContain("Get 20% commission on every paid referral");
    await u.click(screen.getByTestId("ref-copy"));
    expect(await clipboard()).toContain("ref=ASHA2026");
    await u.click(screen.getByTestId("ref-code"));
    expect(await clipboard()).toBe("ASHA2026");
    // 6 referrals: Pro 999 (pending), Free 0 (no purchase), Basic 499 (paid at seed), Elite 1999 (pending), Pro 999 (pending), Free 0
    const tiles = screen.getAllByTestId("ref-tile").map((t) => t.textContent);
    expect(tiles[0]).toContain("6");
    expect(tiles[1]).toContain("₹899.20"); // 20 % of 999 + 499 + 1999 + 999
    expect(tiles[2]).toContain("₹99.80");
    expect(tiles[3]).toContain("₹799.40");
    expect(screen.getByTestId("earnings-chart").dataset["bars"]).toBe("4");
    expect(screen.getAllByTestId("ref-row")).toHaveLength(6);
    expect(screen.getAllByTestId("ref-row").map((r) => r.dataset["status"])).toEqual(["pending", "pending", "not_paid", "not_paid", "paid", "pending"]); // newest joined first
  });

  it("HC-AC-044..048 / 050 / 069 / 070 / 071 filters, sort, Clear, CSV and the Share dialog", async () => {
    await seed(RIA, 6);
    mock.loginAs(RIA);
    const u = userEvent.setup();
    renderWithProviders(<ReferralsPage />);
    await waitFor(() => expect(screen.getAllByTestId("ref-row")).toHaveLength(6));
    await u.selectOptions(screen.getByTestId("ref-status-filter"), "pending");
    expect(screen.getAllByTestId("ref-row")).toHaveLength(3);
    await u.selectOptions(screen.getByTestId("ref-plan-filter"), "Pro");
    expect(screen.getAllByTestId("ref-row")).toHaveLength(2);
    expect(screen.getByTestId("ref-pager").textContent).toContain("2 referrals (filtered from 6)");
    await u.type(screen.getByTestId("ref-search"), "nobody");
    expect(screen.getByTestId("ref-no-results")).toBeTruthy();
    await u.click(screen.getByTestId("ref-clear"));
    expect(screen.getAllByTestId("ref-row")).toHaveLength(6);
    fireEvent.change(screen.getByTestId("ref-from"), { target: { value: "2026-09-01" } });
    expect(screen.getAllByTestId("ref-row")).toHaveLength(2); // joined in September: i = 0 and 4
    fireEvent.change(screen.getByTestId("ref-to"), { target: { value: "2026-09-04" } });
    expect(screen.getAllByTestId("ref-row")).toHaveLength(1);
    await u.click(screen.getByTestId("ref-clear"));
    // sort: name ascending on first click; commission descending on first click, ascending on the second
    await u.click(screen.getByTestId("ref-sort-name"));
    const names = screen.getAllByTestId("ref-row").map((r) => within(r).getByTitle(/.+/).textContent);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    await u.click(screen.getByTestId("ref-sort-commissionInr"));
    expect(screen.getAllByTestId("ref-row")[0]!.textContent).toContain("₹399.80");
    await u.click(screen.getByTestId("ref-sort-commissionInr"));
    expect(screen.getAllByTestId("ref-row")[0]!.textContent).toContain("₹0.00");
    await u.click(screen.getByTestId("ref-csv"));
    const csv = await clipboard();
    expect(csv.split("\n")).toHaveLength(7);
    expect(csv.startsWith("Name,Email,Joined,Plan,Interval,Amount,Commission,Status")).toBe(true);
    await u.click(screen.getByTestId("ref-share"));
    const dlg = screen.getByTestId("share-dialog");
    expect(within(dlg).getByTestId("share-whatsapp").textContent).toContain("ref=ASHA2026");
    await u.click(within(dlg).getByTestId("share-copy-x"));
    expect((await clipboard()).length).toBeLessThanOrEqual(200);
    await u.click(within(dlg).getByTestId("share-copy-link"));
    expect(await clipboard()).toContain("ref=ASHA2026");
  });

  it("HC-AC-053 pages ten at a time with a count footer", async () => {
    await seed(RIA, 12);
    mock.loginAs(RIA);
    const u = userEvent.setup();
    renderWithProviders(<ReferralsPage />);
    await waitFor(() => expect(screen.getAllByTestId("ref-row")).toHaveLength(10));
    expect(screen.getByTestId("ref-pager").textContent).toContain("12 referrals · Page 1 of 2");
    await u.click(screen.getByText("Next →"));
    expect(screen.getAllByTestId("ref-row")).toHaveLength(2);
    await u.click(screen.getByText("← Previous"));
    expect(screen.getAllByTestId("ref-row")).toHaveLength(10);
  });

  it("HC-AC-051 / 072 no referrals yet shows the share prompt; the rate hint appears when commission is unset", async () => {
    mock.loginAs("new@example.com");
    renderWithProviders(<ReferralsPage />);
    await waitFor(() => expect(screen.getByTestId("referrals-page").dataset["state"]).toBe("ready"));
    expect(screen.getByTestId("ref-empty")).toBeTruthy();
    expect(screen.getByTestId("ref-meta").textContent).toContain("commission rate not set");
    expect(screen.queryByTestId("earnings-chart")).toBeNull();
    expect(screen.queryByTestId("ref-pager")).toBeNull();
  });

  it("HC-AC-054 shows the error state with Retry when the API fails", async () => {
    mock.restore();
    mock = installMockFetch();
    renderWithProviders(<ReferralsPage />);
    await waitFor(() => expect(screen.getByTestId("referrals-page").dataset["state"]).toBe("error"));
    expect(screen.getByText("Retry")).toBeTruthy();
  });
});

describe("[API] referral fetchers and helpers", () => {
  it("mine / admin / detail / mark / bulkPay round-trip through the mock; CSV and share templates", async () => {
    await seed("boss@example.com", 3, "admin");
    mock.loginAs("boss@example.com", { role: "admin" });
    const f = referralFetchers(createApiClient());
    const mine = await f.mine();
    expect(mine.stats.referrals).toBe(3);
    const admin = await f.admin("", "");
    expect(admin.rows).toHaveLength(1);
    expect(admin.months.length).toBeGreaterThan(0);
    const detail = await f.detail(admin.rows[0]!.referrerId);
    expect(detail.rows).toHaveLength(3);
    expect(await f.mark(admin.rows[0]!.referrerId, { status: "not_paid", note: "bank details missing" })).toEqual({ rows: 1, amountInr: "199.80" });
    await expect(f.mark(admin.rows[0]!.referrerId, { status: "paid" })).rejects.toThrow(/pending/i);
    expect(await f.bulkPay({})).toEqual({ settledRows: 0, referrers: 0, amountInr: "0.00" });
    expect(referralsCsv(mine.rows).split("\n")).toHaveLength(4);
    expect(referralsCsv([{ ...mine.rows[0]!, name: 'Q "quote"' }])).toContain('"Q ""quote"""');
    const t = shareTemplates("https://x/auth?ref=A", "A", "20");
    expect(t.map((x) => x.key)).toEqual(["whatsapp", "x", "email"]);
    expect(t[0]!.href).toContain("wa.me");
  });
});
