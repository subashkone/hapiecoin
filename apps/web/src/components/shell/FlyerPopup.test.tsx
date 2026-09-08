// Flyer popup (HC-SH-055, HC-SH-056; ADR-033): frequency rules in browser storage, the carousel, View routing,
// "Don't show again", and the palette's "Show announcements" reopening everything.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Banner } from "@hapiecoin/schema";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { pathnameMock, routerMock } from "../../../test/next-mocks";
import { FLYER_SEEN_KEY, bannerRoute, dueBanners, markShown, neverShow, readSeen } from "@/lib/api/banners";
import { useUiStore } from "@/lib/store";
import { FlyerDialog, FlyerPopup } from "./FlyerPopup";

const banner = (id: string, frequency: Banner["frequency"], linkUrl: string | null = null): Banner => ({ id, title: `Banner ${id}`, description: "d", linkUrl, type: "popup", frequency, startsAt: null, endsAt: null, active: true, imageUrl: "", imageType: "image/png", imageBytes: 1, schedule: "showing", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" });
const NOW = new Date("2026-09-08T10:00:00Z");

describe("HC-SH-056 frequency rules", () => {
  it("every_time always shows; once_per_session hides after a session mark; once_per_day hides for the day; never hides for good", () => {
    const all = [banner("a", "every_time"), banner("b", "once_per_session"), banner("c", "once_per_day")];
    expect(dueBanners(all, NOW).map((b) => b.id)).toEqual(["a", "b", "c"]);
    markShown(all, NOW);
    expect(dueBanners(all, NOW).map((b) => b.id)).toEqual(["a"]);
    expect(dueBanners(all, new Date("2026-09-09T10:00:00Z")).map((b) => b.id)).toEqual(["a", "c"]);
    neverShow("a");
    expect(dueBanners(all, NOW)).toEqual([]);
    expect(dueBanners(all, NOW, true)).toHaveLength(3);
    expect(readSeen().never).toEqual(["a"]);
    localStorage.setItem(FLYER_SEEN_KEY, "{not json");
    expect(readSeen()).toEqual({ day: {}, never: [] });
  });

  it("routes hapiecoin.com links in place and others to a new tab", () => {
    expect(bannerRoute(null)).toBeNull();
    expect(bannerRoute("https://hapiecoin.com/subscription")).toEqual({ href: "/subscription", external: false });
    expect(bannerRoute("https://www.hapiecoin.com/analyse?tab=builder")).toEqual({ href: "/analyse?tab=builder", external: false });
    expect(bannerRoute("https://hapiecoin.com")).toEqual({ href: "/", external: false });
    expect(bannerRoute("https://www.deltaexchange.com/")).toEqual({ href: "https://www.deltaexchange.com/", external: true });
  });
});

describe("HC-SH-055 FlyerDialog", () => {
  it("cycles with arrows and dots, View follows the link, Don't show again hides the banner", async () => {
    const onClose = vi.fn();
    const u = userEvent.setup();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderWithProviders(<FlyerDialog banners={[banner("a", "once_per_day", "https://hapiecoin.com/subscription"), banner("b", "every_time", "https://x.example/"), banner("c", "every_time")]} onClose={onClose} />);
    expect(screen.getByTestId("flyer").dataset["count"]).toBe("3");
    expect(screen.getByTestId("flyer-title").textContent).toBe("Banner a");
    expect(screen.getByTestId("flyer-frequency").textContent).toBe("Once a day");
    await u.click(screen.getByTestId("flyer-next"));
    expect(screen.getByTestId("flyer-title").textContent).toBe("Banner b");
    await u.click(screen.getByTestId("flyer-view"));
    expect(open).toHaveBeenCalledWith("https://x.example/", "_blank", "noopener,noreferrer");
    expect(onClose).toHaveBeenCalledTimes(1);
    await u.click(screen.getByTestId("flyer-prev"));
    expect(screen.getByTestId("flyer-title").textContent).toBe("Banner a");
    await u.click(screen.getByTestId("flyer-view"));
    expect(routerMock.push).toHaveBeenCalledWith("/subscription");
    await u.click(screen.getByTestId("flyer-next"));
    await u.click(screen.getByTestId("flyer-next"));
    expect(screen.queryByTestId("flyer-view")).toBeNull(); // banner c has no link
    await u.click(screen.getByTestId("flyer-never"));
    expect(readSeen().never).toEqual(["c"]);
    await u.click(screen.getByTestId("flyer-dismiss"));
    expect(onClose).toHaveBeenCalledTimes(3);
    open.mockRestore();
  });
});

describe("HC-SH-055 FlyerPopup on /analyse", () => {
  let mock: MockFetch;
  beforeEach(() => {
    mock = installMockFetch();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    mock.restore();
  });
  it("shows the due banners 400 ms after landing, not again for session / day rules, and reopens all from the palette", async () => {
    const res = await mock.app.request("http://localhost/__test/seed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "t@example.com", banners: 4 }) });
    expect(res.status).toBe(200);
    mock.loginAs("t@example.com");
    pathnameMock.value = "/analyse";
    const view = renderWithProviders(<FlyerPopup />);
    await waitFor(() => expect(screen.getByTestId("flyer").dataset["count"]).toBe("2"));
    expect(Object.keys(readSeen().day)).toHaveLength(1); // the once-a-day banner is recorded for today
    expect(Object.keys(JSON.parse(sessionStorage.getItem(FLYER_SEEN_KEY) ?? "[]") as string[])).toHaveLength(1);
    view.unmount();
    // a second landing: the once-a-day one is recorded in localStorage and the session one in sessionStorage → nothing due
    const view2 = renderWithProviders(<FlyerPopup />);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(screen.queryByTestId("flyer")).toBeNull();
    // the palette asks: everything live reopens regardless of the rules
    useUiStore.getState().requestFlyers();
    await waitFor(() => expect(screen.getByTestId("flyer").dataset["count"]).toBe("2"));
    // leaving /analyse closes the flyer
    pathnameMock.value = "/subscription";
    view2.rerender(<FlyerPopup />);
    await waitFor(() => expect(screen.queryByTestId("flyer")).toBeNull());
  });

  it("toasts 'No active flyers' when the palette asks and nothing is live", async () => {
    mock.loginAs("quiet@example.com");
    pathnameMock.value = "/analyse";
    renderWithProviders(<FlyerPopup />);
    await vi.advanceTimersByTimeAsync(800);
    expect(screen.queryByTestId("flyer")).toBeNull();
    useUiStore.getState().requestFlyers();
    await waitFor(() => expect(screen.getByText("No active flyers")).toBeTruthy());
  });
});
