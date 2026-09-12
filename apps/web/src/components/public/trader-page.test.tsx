// A trader's public page (ADR-075; HC-PB-066 the page, HC-PB-067 the share bar) against the in-memory mock API: opened
// without a session; totals, the sections the trader turned on, the missing state, the intent links and the card.
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { createAccount } from "../../../test/mock-api";
import { TraderPage } from "./TraderPage";

let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
});
afterEach(() => {
  mock.restore();
  vi.restoreAllMocks();
});

function seedAsha(opts: { showDays?: boolean; showAccounts?: boolean; showMonths?: boolean } = {}) {
  const acc = createAccount(mock.state, { email: "asha@example.com", name: "Asha" });
  acc.credentials.push({ id: "crd_main", brokerId: "brk_delta", label: "Main", apiKeyMasked: "****ab12", connectedAt: "2026-09-07T10:00:00.000Z", whitelistedIp: "172.236.179.136" });
  const day = 86_400_000;
  acc.fills = [
    { id: "f-1", accountId: "crd_main", productId: 101, symbol: "C-BTC-80000-250926", side: "buy", size: 10, price: "1200", commission: "0.6", filledAt: new Date(Date.now() - 2 * day).toISOString() },
    { id: "f-2", accountId: "crd_main", productId: 101, symbol: "C-BTC-80000-250926", side: "sell", size: 10, price: "1500", commission: "0.75", filledAt: new Date(Date.now() - day).toISOString() },
  ];
  acc.verifiedReads = 1;
  acc.publicPage = { handle: "asha_trades", enabled: true, showDays: opts.showDays ?? false, showAccounts: opts.showAccounts ?? false, showMonths: opts.showMonths ?? false };
  return acc;
}

describe("HC-PB-066 the public page", () => {
  it("shows the trader's totals net of fees with no session, and only the sections turned on", async () => {
    seedAsha();
    renderWithProviders(<TraderPage handle="Asha_Trades" />);
    await waitFor(() => expect(screen.getByTestId("trader-page").dataset["state"]).toBe("ready"));
    expect(screen.getByTestId("trader-name").textContent).toContain("Asha");
    expect(screen.getByTestId("trader-handle").textContent).toContain("@asha_trades");
    expect(screen.getByTestId("trader-total").textContent).toContain("+$1.65");
    expect(screen.getByTestId("trader-d30").textContent).toContain("+$1.65");
    expect(screen.getByTestId("trader-since").textContent).toContain("2 fills since");
    expect(screen.getByTestId("trader-basis").textContent).toContain("net of fees");
    expect(screen.queryByTestId("trader-days")).toBeNull();
    expect(screen.queryByTestId("trader-accounts")).toBeNull();
    expect(screen.queryByTestId("trader-months")).toBeNull();
    expect(mock.calls.some((c) => c.url.includes("/v1/public/traders/Asha_Trades"))).toBe(true);
  });

  it("with every section on: the daily bars, the accounts by label and the months", async () => {
    seedAsha({ showDays: true, showAccounts: true, showMonths: true });
    renderWithProviders(<TraderPage handle="asha_trades" />);
    await waitFor(() => expect(screen.getByTestId("trader-page").dataset["state"]).toBe("ready"));
    expect(screen.getByTestId("trader-days").dataset["count"]).toBe("2"); // the buy day (commission off) and the closing day
    expect(screen.getAllByTestId("trader-account")).toHaveLength(1);
    expect(screen.getByTestId("trader-account").textContent).toContain("Main");
    expect(screen.getByTestId("trader-account").textContent).toContain("+$1.65");
    expect(screen.getAllByTestId("trader-month").length).toBeGreaterThanOrEqual(1);
  });

  it("an unknown handle, or a page that is off, says so", async () => {
    const acc = seedAsha();
    acc.publicPage.enabled = false;
    renderWithProviders(<TraderPage handle="asha_trades" />);
    await waitFor(() => expect(screen.getByTestId("trader-page").dataset["state"]).toBe("missing"));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("No public page here");
    expect(screen.queryByText(/no trader at @asha_trades, or their page is switched off/)).not.toBeNull();
  });
});

describe("HC-PB-067 the share bar", () => {
  it("X and Telegram intents carry the 30-day figure and the link; the card downloads as a PNG named after the handle", async () => {
    seedAsha();
    const png = "data:image/png;base64,AAAA";
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(new Proxy({}, { get: () => () => undefined, set: () => true }) as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(png);
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(`${this.download}|${this.href}`);
    });
    renderWithProviders(<TraderPage handle="asha_trades" />);
    await waitFor(() => expect(screen.getByTestId("trader-page").dataset["state"]).toBe("ready"));
    const url = `${window.location.origin}/t/asha_trades`;
    const x = screen.getByTestId("share-x").getAttribute("href") ?? "";
    expect(x.startsWith("https://twitter.com/intent/tweet?text=")).toBe(true);
    expect(decodeURIComponent(x)).toContain("+$1.65 over the last 30 days (net of fees, from exchange fills). " + url);
    const tg = screen.getByTestId("share-telegram").getAttribute("href") ?? "";
    expect(tg.startsWith(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=`)).toBe(true);
    fireEvent.click(screen.getByTestId("share-image"));
    expect(clicks).toEqual([`hapiecoin-asha_trades-verified-pnl.png|${png}`]);
    await waitFor(() => expect(screen.queryByText("Card saved")).not.toBeNull());
  });
});
