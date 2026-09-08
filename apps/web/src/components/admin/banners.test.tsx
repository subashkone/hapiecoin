// Admin · Banner Master against the mock API (HC-AD-059..070, 121, 122; ADR-033): list with schedule badges, image
// rules, create / edit / switch / delete, preview as user, filters, CSV, error state; plus the fetchers.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installMockFetch, renderWithProviders, type MockFetch } from "../../../test/helpers";
import { bannerFetchers, checkImageFile, fmtBytes } from "@/lib/api/banners";
import { createApiClient } from "@/lib/api/client";
import { BannersAdmin } from "./BannersAdmin";

const ADMIN = "boss@example.com";
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
let mock: MockFetch;
beforeEach(() => {
  mock = installMockFetch();
});
afterEach(() => mock.restore());

async function seed(email: string, banners: number, role?: "user" | "admin") {
  const res = await mock.app.request("http://localhost/__test/seed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, banners, ...(role ? { role } : {}) }) });
  expect(res.status).toBe(200);
}
const pngFile = (name = "sale.png") => new File([Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0))], name, { type: "image/png" });

describe("HC-AD-059..064, 121, 122 banner list", () => {
  it("lists with schedule badges, filters by schedule and frequency, searches, previews as user, copies CSV, switches and deletes", async () => {
    await seed(ADMIN, 4, "admin");
    mock.loginAs(ADMIN, { role: "admin" });
    const u = userEvent.setup();
    renderWithProviders(<BannersAdmin />);
    await waitFor(() => expect(screen.getByTestId("admin-banners").dataset["state"]).toBe("ready"));
    expect(screen.getAllByTestId("banner-row")).toHaveLength(4);
    expect(screen.getAllByTestId("banner-row").map((r) => r.dataset["schedule"])).toEqual(["hidden", "scheduled", "showing", "showing"]); // newest first
    await u.selectOptions(screen.getByTestId("banner-schedule-filter"), "showing");
    expect(screen.getAllByTestId("banner-row")).toHaveLength(2);
    await u.selectOptions(screen.getByTestId("banner-frequency-filter"), "once_per_session");
    expect(screen.getAllByTestId("banner-row")).toHaveLength(1);
    expect(screen.getByTestId("banner-row").dataset["title"]).toBe("Live Trading is here");
    await u.click(screen.getByTestId("banner-clear"));
    await u.type(screen.getByTestId("banner-search"), "nothing here");
    expect(screen.getByTestId("banner-empty-filtered")).toBeTruthy();
    await u.click(screen.getByText("Clear filters"));
    expect(screen.getAllByTestId("banner-row")).toHaveLength(4);
    // preview as user from a row
    const welcome = screen.getAllByTestId("banner-row").find((r) => r.dataset["title"] === "Welcome Offer")!;
    await u.click(within(welcome).getByTestId("banner-row-preview"));
    expect(screen.getByTestId("flyer").dataset["preview"]).toBe("true");
    expect(screen.getByTestId("flyer-title").textContent).toBe("Welcome Offer");
    expect(screen.queryByTestId("flyer-never")).toBeNull(); // a preview never records anything
    await u.click(screen.getByTestId("flyer-dismiss"));
    await waitFor(() => expect(screen.queryByTestId("flyer")).toBeNull());
    // CSV
    await u.click(screen.getByTestId("banner-csv"));
    expect((await navigator.clipboard.readText()).split("\n")).toHaveLength(5);
    // switch off, then delete
    await u.click(within(welcome).getByTestId("banner-toggle"));
    await waitFor(() => expect(mock.state.banners.find((b) => b.title === "Welcome Offer")?.active).toBe(false));
    await u.click(within(welcome).getByTestId("banner-delete"));
    await u.click(screen.getByTestId("banner-delete-confirm"));
    await waitFor(() => expect(screen.getAllByTestId("banner-row")).toHaveLength(3));
    expect(mock.state.banners.some((b) => b.title === "Welcome Offer")).toBe(false);
  });

  it("surfaces API refusals on switch, edit and delete when the banner is gone", async () => {
    await seed(ADMIN, 1, "admin");
    mock.loginAs(ADMIN, { role: "admin" });
    const u = userEvent.setup();
    renderWithProviders(<BannersAdmin />);
    await waitFor(() => expect(screen.getAllByTestId("banner-row")).toHaveLength(1));
    const row = screen.getByTestId("banner-row");
    await u.click(within(row).getByTestId("banner-edit"));
    mock.state.banners.length = 0; // deleted elsewhere meanwhile
    await u.clear(screen.getByTestId("banner-title"));
    await u.type(screen.getByTestId("banner-title"), "Renamed");
    await u.click(screen.getByTestId("banner-save"));
    await waitFor(() => expect(screen.getByTestId("banner-error").textContent).toContain("not found"));
    await u.keyboard("{Escape}");
    await u.click(within(screen.getByTestId("banner-row")).getByTestId("banner-toggle"));
    await waitFor(() => expect(screen.getAllByText("Failed").length).toBeGreaterThan(0));
    await u.click(within(screen.getByTestId("banner-row")).getByTestId("banner-delete"));
    await u.click(screen.getByTestId("banner-delete-confirm"));
    await waitFor(() => expect(screen.getAllByText("Failed").length).toBeGreaterThan(1));
  });

  it("shows the empty state and the error state", async () => {
    mock.loginAs(ADMIN, { role: "admin" });
    const view = renderWithProviders(<BannersAdmin />);
    await waitFor(() => expect(screen.getByTestId("banner-empty")).toBeTruthy());
    view.unmount();
    mock.restore();
    mock = installMockFetch(); // nobody signed in → 401 → error state
    renderWithProviders(<BannersAdmin />);
    await waitFor(() => expect(screen.getByTestId("banner-load-error")).toBeTruthy());
    await userEvent.setup().click(screen.getByText("Retry"));
    await waitFor(() => expect(screen.getByTestId("banner-load-error")).toBeTruthy());
  });
});

describe("HC-AD-065..069 banner dialog", () => {
  it("validates title, image, link and window; previews the chosen file; creates; edits keeping the image", async () => {
    mock.loginAs(ADMIN, { role: "admin" });
    const u = userEvent.setup({ applyAccept: false }); // let a text file through so the client-side type check runs
    renderWithProviders(<BannersAdmin />);
    await waitFor(() => expect(screen.getByTestId("banner-empty")).toBeTruthy());
    await u.click(screen.getByTestId("banner-new"));
    await u.click(screen.getByTestId("banner-save"));
    expect(screen.getByTestId("banner-error").textContent).toBe("Title is required");
    await u.type(screen.getByTestId("banner-title"), "Festive Sale");
    await u.click(screen.getByTestId("banner-save"));
    expect(screen.getByTestId("banner-error").textContent).toBe("Image is required");
    await u.upload(screen.getByTestId("banner-image"), new File(["nope"], "notes.txt", { type: "text/plain" }));
    expect(screen.getByTestId("banner-error").textContent).toContain("Only image files");
    await u.upload(screen.getByTestId("banner-image"), pngFile());
    await waitFor(() => expect(screen.getByTestId("banner-preview-img")).toBeTruthy());
    await u.type(screen.getByTestId("banner-link"), "ftp://nope");
    await u.click(screen.getByTestId("banner-save"));
    expect(screen.getByTestId("banner-error").textContent).toContain("http://");
    await u.clear(screen.getByTestId("banner-link"));
    await u.type(screen.getByTestId("banner-link"), "https://hapiecoin.com/subscription");
    fireEvent.change(screen.getByTestId("banner-starts"), { target: { value: "2026-09-10T00:00" } });
    fireEvent.change(screen.getByTestId("banner-ends"), { target: { value: "2026-09-01T00:00" } });
    await u.click(screen.getByTestId("banner-save"));
    expect(screen.getByTestId("banner-error").textContent).toContain("End must be after start");
    fireEvent.change(screen.getByTestId("banner-ends"), { target: { value: "2026-12-31T00:00" } });
    await u.selectOptions(screen.getByTestId("banner-frequency"), "every_time");
    // preview as user with the current values before saving
    await u.click(screen.getByTestId("banner-preview"));
    expect(screen.getByTestId("flyer-title").textContent).toBe("Festive Sale");
    expect(screen.getByTestId("flyer-frequency").textContent).toBe("Every visit");
    await u.click(screen.getByTestId("flyer-dismiss"));
    await u.click(screen.getByTestId("banner-save"));
    await waitFor(() => expect(screen.queryByTestId("banner-dialog")).toBeNull());
    await waitFor(() => expect(screen.getAllByTestId("banner-row")).toHaveLength(1));
    const created = mock.state.banners[0]!;
    expect(created).toMatchObject({ title: "Festive Sale", linkUrl: "https://hapiecoin.com/subscription", frequency: "every_time", imageType: "image/png", imageBytes: 70 });
    expect(created.startsAt).toBe("2026-09-10T00:00:00.000Z");
    // edit without a new image keeps the stored one
    await u.click(screen.getByTestId("banner-edit"));
    expect(screen.getByTestId("banner-dialog").textContent).toContain("leave empty to keep current");
    await u.clear(screen.getByTestId("banner-title"));
    await u.type(screen.getByTestId("banner-title"), "Festive Sale 2");
    await u.click(screen.getByTestId("banner-save"));
    await waitFor(() => expect(mock.state.banners[0]!.title).toBe("Festive Sale 2"));
    expect(mock.state.banners[0]!.image).toContain(PNG_B64);
  });
});

describe("[API] banner fetchers and helpers", () => {
  it("live / admin / create / update / remove round-trip; image checks; byte formatting", async () => {
    await seed(ADMIN, 2, "admin");
    mock.loginAs(ADMIN, { role: "admin" });
    const f = bannerFetchers(createApiClient());
    expect((await f.live()).items).toHaveLength(2);
    const created = await f.create({ title: "New", description: "", linkUrl: null, frequency: "once_per_day", startsAt: null, endsAt: null, active: false, image: `data:image/png;base64,${PNG_B64}` });
    expect(created.schedule).toBe("hidden");
    expect((await f.admin()).items).toHaveLength(3);
    expect((await f.update(created.id, { active: true })).schedule).toBe("showing");
    await f.remove(created.id);
    expect((await f.admin()).items).toHaveLength(2);
    await expect(f.remove(created.id)).rejects.toThrow(/not found/i);
    expect(checkImageFile({ type: "image/png", size: 10 })).toBeNull();
    expect(checkImageFile({ type: "text/plain", size: 10 })).toContain("Only image");
    expect(checkImageFile({ type: "image/png", size: 6 * 1024 * 1024 })).toContain("5 MB");
    expect(fmtBytes(70)).toBe("1 KB");
    expect(fmtBytes(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
});
