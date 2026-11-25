// Public home page (ADR-140): the page renders HapieCoin's own sections from the content module, in the order a trade
// happens, with the product pictures, the right anchors and links, and none of the old claims.
import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeSocket, installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import LandingPage from "@/app/page";
import { AUTOPILOT, HERO, REVIEW, SAFETY, STEPS } from "@/content/landing";
import { TEMPLATE_COUNT } from "@/lib/strategy/templates";

let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
  FakeSocket.reset();
});
afterEach(() => mock.restore());

describe("HC-PB landing sections", () => {
  it("HC-PB-070 the hero states the promise, links to sign-up and the payoff preview, and promises no free plan", () => {
    renderWithProviders(<LandingPage />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(HERO.title);
    expect(screen.getByTestId("hero-cta").getAttribute("href")).toBe("/auth?tab=signup");
    expect(screen.getByTestId("hero-preview").getAttribute("href")).toBe("/payoff-preview");
    expect(screen.getByTestId("hero-note").textContent).toContain("Delta Exchange India");
    expect(screen.getByTestId("hero-note").textContent).toContain("risk of loss");
    // the Free plan is off (ADR-107): the page must not offer one
    expect(document.body.textContent).not.toMatch(/free plan|trading free|free account|risk-free/i);
  });

  it("HC-PB-070 build, protect and review come in that order, each step with its points; the template count is the catalogue's", () => {
    renderWithProviders(<LandingPage />);
    const steps = screen.getAllByTestId("home-step");
    expect(steps.map((s) => s.dataset["step"])).toEqual(["build", "protect", "review"]);
    for (const [i, s] of STEPS.entries()) {
      const el = steps[i]!;
      expect(within(el).getByRole("heading", { level: 3 }).textContent).toBe(s.title);
      for (const p of s.points) expect(within(el).getByText(p)).toBeTruthy();
      expect(within(el).getByTestId("product-shot").dataset["shot"]).toBe(s.shot.name);
    }
    expect(steps[0]!.textContent).toContain(`${TEMPLATE_COUNT} ready templates`);
    for (const p of REVIEW.points) expect(within(steps[2]!).getByText(p.title)).toBeTruthy();
  });

  it("HC-PB-070 every product picture has a dark and a light file, one described and one hidden from readers, with its size set", () => {
    const { container } = renderWithProviders(<LandingPage />);
    const shots = screen.getAllByTestId("product-shot");
    expect(shots.map((s) => s.dataset["shot"])).toEqual(["paper", "build", "protect", "autopilot"]);
    for (const s of shots) {
      const dark = s.querySelector<HTMLImageElement>("img[data-theme-shot=dark]")!;
      const light = s.querySelector<HTMLImageElement>("img[data-theme-shot=light]")!;
      expect(dark.getAttribute("src")).toBe(`/shots/${s.dataset["shot"]}-dark.png`);
      expect(light.getAttribute("src")).toBe(`/shots/${s.dataset["shot"]}-light.png`);
      expect(dark.getAttribute("alt")!.length).toBeGreaterThan(20);
      expect(light.getAttribute("alt")).toBe("");
      expect(light.getAttribute("aria-hidden")).toBe("true");
      expect(dark.getAttribute("width")).toBe(s.dataset["shot"] === "protect" ? "800" : "2000"); // the dialog is its own size
      expect(within(s).getByText("Sample trades · live market prices")).toBeTruthy();
    }
    // the hero picture loads at once, the rest when they come near
    expect(container.querySelectorAll("img[loading=eager]")).toHaveLength(2);
    expect(container.querySelectorAll("img[loading=lazy]")).toHaveLength(6);
  });

  it("HC-PB-070 Autopilot is marked paper today, safety lists its four points, one exchange is connected and the plans are marked coming soon with no link to buy", () => {
    const { container } = renderWithProviders(<LandingPage />);
    expect(screen.getByTestId("autopilot-paper-badge").textContent).toBe("Paper today · live next"); // it does not trade live yet (ADR-108), and the page says so
    expect(screen.getByText(AUTOPILOT.title)).toBeTruthy();
    for (const p of AUTOPILOT.points) expect(screen.getByText(p.title)).toBeTruthy();
    expect(screen.getByText("A paper record or a backtest is not a forecast of live results.")).toBeTruthy();
    for (const p of SAFETY) expect(screen.getByText(p.title)).toBeTruthy();
    // HC-PB-018 exchanges: only what is connected is named
    expect(screen.getAllByTestId("exchange-live")).toHaveLength(1);
    expect(screen.queryByTestId("exchange-coming")).toBeNull();
    expect(screen.getByTestId("home-plans-soon").textContent).toContain("Plans and pricing are coming soon");
    expect(screen.getByTestId("home-plans-soon").querySelector("a")!.getAttribute("href")).toBe("mailto:support@hapiecoin.com");
    expect(container.querySelector('a[href="/plans"]')).toBeNull();
    // HC-PB-021 section anchors with the sticky-header offset
    for (const id of ["how", "autopilot", "safety", "exchanges", "plans"]) expect(container.querySelector(`#${id}`)?.className).toContain("scroll-mt-16");
  });
});
