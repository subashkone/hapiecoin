// Landing page sections (HC-PB-005, 008, 010, 012, 013, 015..017, 019, 021, 053, 058): the full page renders every
// section from the content module with the right anchors, counts and links. Evidence for the Phase 1 build (item 5c audit).
import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeSocket, installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import LandingPage from "@/app/page";
import { CAPABILITIES, FEATURE_LIST, STATS, WITH, WITHOUT } from "@/content/landing";

let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
  FakeSocket.reset();
});
afterEach(() => mock.restore());

describe("HC-PB landing sections", () => {
  it("renders hero buttons, stats strip, comparison table, features, capabilities, analytics teaser, feature list, what's new and the CTA", () => {
    const { container } = renderWithProviders(<LandingPage />);
    // HC-PB-005 hero buttons
    expect(screen.getByTestId("hero-cta").getAttribute("href")).toBe("/auth");
    expect(screen.getByText("Explore Features").getAttribute("href")).toBe("#features");
    // HC-PB-058 hero meta line
    expect(screen.getByText("Free plan · paper trading included")).toBeTruthy();
    // HC-PB-008 stats strip: every value and label from the content module
    for (const s of STATS) {
      expect(screen.getAllByText(s.value).length).toBeGreaterThan(0);
      expect(screen.getAllByText(s.label).length).toBeGreaterThan(0);
    }
    // HC-PB-010 comparison table: 5 × / ✓ rows in one table
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(WITHOUT.length + 1);
    expect(within(table).getByText(WITH[0])).toBeTruthy();
    expect(within(table).getByText("Without HapieCoin")).toBeTruthy();
    // HC-PB-011 feature tabs
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Real-time Options Chain", "Strategy Builder & Payoff", "Paper & Live Trading"]);
    // HC-PB-012 capabilities: six cells, the wide ones span two columns
    expect(screen.getByText("Built for Serious Traders")).toBeTruthy();
    for (const c of CAPABILITIES) expect(screen.getAllByText(c.title).length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".lg\\:col-span-2")).toHaveLength(CAPABILITIES.filter((c) => "large" in c && c.large).length);
    // HC-PB-013 / HC-PB-015 analytics teaser with Explore Analytics → /analytics
    expect(screen.getByText("Liquidations & Market Pulse")).toBeTruthy();
    expect(screen.getByText("Explore Analytics →").getAttribute("href")).toBe("/analytics");
    // HC-PB-016 full feature list: 6 groups × 6 bullets
    expect(screen.getByText("Full Feature List")).toBeTruthy();
    for (const g of FEATURE_LIST) {
      expect(screen.getAllByText(g.title).length).toBeGreaterThan(0);
      for (const f of g.features) expect(screen.getAllByText(f).length).toBeGreaterThan(0);
    }
    // HC-PB-017 / HC-PB-053 what's new strip with "new" tags
    expect(screen.getAllByText("What's new in v2").length).toBeGreaterThan(0); // section eyebrow and footer link
    expect(screen.getAllByText("new").length).toBeGreaterThanOrEqual(6);
    // HC-PB-019 CTA
    expect(screen.getByText("Ready to Trade Smarter?")).toBeTruthy();
    expect(screen.getByText("Create Free Account →").getAttribute("href")).toBe("/auth?tab=signup");
    // HC-PB-021 section anchors with the sticky-header offset
    for (const id of ["whats-new", "features", "crypto-analytics", "exchanges"]) {
      const el = container.querySelector(`#${id}`);
      expect(el?.className).toContain("scroll-mt-16");
    }
    // HC-PB-018 exchanges: one live, three coming soon
    expect(screen.getAllByTestId("exchange-coming")).toHaveLength(3);
  });
});
