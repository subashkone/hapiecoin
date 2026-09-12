// Public trader page (ADR-075; HC-PB-066): the handle rules and the projection that leaves the server for a visitor.
import { describe, expect, it } from "vitest";
import { DEFAULT_PUBLIC_PAGE, Handle, PublicTraderPage, mergeDays, monthsOf, publicTraderFrom } from "./public-page.js";
import type { VerifiedAccount, VerifiedPnl } from "./verified.js";

const account = (o: Partial<VerifiedAccount> = {}): VerifiedAccount => ({
  accountId: "crd_main", label: "Main", fills: 2, lastReadAt: "2026-09-12T08:00:00.000Z", lastFillAt: "2026-09-11T09:00:00.000Z", since: "2026-09-10T09:00:00.000Z",
  realizedUsd: "1.65", commissionUsd: "1.35", byDay: [{ day: "2026-09-11", pnl: "1.65" }], skipped: 0, partialProducts: 0, backfilling: false, error: null, ...o,
});
const verified = (accounts: VerifiedAccount[]): VerifiedPnl => ({
  accounts,
  total: { all: "2.05", gross: "3.50", d7: "2.05", d30: "2.05", commission: "1.45" },
  fills: accounts.reduce((n, a) => n + a.fills, 0),
  lastReadAt: "2026-09-12T08:00:00.000Z",
  since: "2026-08-30T09:00:00.000Z",
  journalRealizedUsd: "0.00",
  difference: "3.50",
});

describe("HC-PB-066 Handle", () => {
  it("lower-cases and trims, allows 3–20 letters, digits and underscores, and refuses reserved words", () => {
    expect(Handle.parse("  Asha_Trades ")).toBe("asha_trades");
    expect(Handle.safeParse("ab").success).toBe(false);
    expect(Handle.safeParse("a".repeat(21)).success).toBe(false);
    expect(Handle.safeParse("asha-trades").success).toBe(false);
    expect(Handle.safeParse("Admin").success).toBe(false);
    expect(Handle.safeParse("hapiecoin").success).toBe(false);
  });
});

describe("HC-PB-066 publicTraderFrom", () => {
  it("always gives totals, counts and dates and never the account ids, commissions or the Journal comparison", () => {
    const page = publicTraderFrom(verified([account()]), { ...DEFAULT_PUBLIC_PAGE, handle: "asha", enabled: true }, "Asha");
    expect(PublicTraderPage.parse(page)).toEqual(page); // the strict shape holds
    expect(page).toEqual({ handle: "asha", name: "Asha", total: { all: "2.05", d7: "2.05", d30: "2.05" }, fills: 2, since: "2026-08-30T09:00:00.000Z", lastReadAt: "2026-09-12T08:00:00.000Z", days: null, accounts: null, months: null, partial: false });
    expect(JSON.stringify(page)).not.toMatch(/crd_|gross|journal|commission|difference/);
  });

  it("merges days across accounts net of fees, rolls them into months, and lists accounts by label only when opted in", () => {
    const sub = account({ accountId: "crd_sub1", label: "Sub 1", fills: 3, since: "2026-08-30T09:00:00.000Z", realizedUsd: "0.40", byDay: [{ day: "2026-08-30", pnl: "-0.1" }, { day: "2026-09-11", pnl: "0.50" }], partialProducts: 1 });
    const v = verified([account(), sub]);
    expect(mergeDays(v.accounts)).toEqual([{ day: "2026-08-30", pnl: "-0.1" }, { day: "2026-09-11", pnl: "2.15" }]);
    expect(monthsOf(mergeDays(v.accounts))).toEqual([{ month: "2026-08", pnl: "-0.1" }, { month: "2026-09", pnl: "2.15" }]);
    const page = publicTraderFrom(v, { handle: "asha", enabled: true, showDays: true, showAccounts: true, showMonths: true }, "Asha");
    expect(page.days).toEqual([{ day: "2026-08-30", pnl: "-0.1" }, { day: "2026-09-11", pnl: "2.15" }]);
    expect(page.accounts).toEqual([{ label: "Main", realizedUsd: "1.65", fills: 2, since: "2026-09-10T09:00:00.000Z" }, { label: "Sub 1", realizedUsd: "0.40", fills: 3, since: "2026-08-30T09:00:00.000Z" }]);
    expect(page.months).toEqual([{ month: "2026-08", pnl: "-0.1" }, { month: "2026-09", pnl: "2.15" }]);
    expect(page.partial).toBe(true);
    expect(() => publicTraderFrom(v, DEFAULT_PUBLIC_PAGE, "Asha")).toThrow("needs a handle");
    expect(publicTraderFrom(verified([account({ error: "The exchange did not answer the fills read" })]), { ...DEFAULT_PUBLIC_PAGE, handle: "asha" }, "Asha").partial).toBe(true);
  });
});
