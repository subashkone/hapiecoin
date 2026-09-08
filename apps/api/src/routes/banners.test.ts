// Banners (Phase 4 item 4b, ADR-033): admin create / edit / switch / delete with the image rules, the image
// endpoint with caching headers, and the trader's "showing now" list.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Banner, BannerList } from "@hapiecoin/schema";
import { createTestApp, type TestApp } from "../test-support/harness.js";

let t: TestApp;
let admin: string;
let user: string;
const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;
// 1×1 PNG
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const big = () => `data:image/png;base64,${"A".repeat(Math.ceil((5 * 1024 * 1024 + 4) / 3) * 4)}`;

beforeAll(async () => {
  t = await createTestApp();
  admin = await t.adminCookie();
  user = (await t.signUp("viewer-bnr@hapiecoin.test")).cookie;
});
afterAll(() => t.close());

describe("HC-AD-059..069 admin banners", () => {
  it("creates with a data-URL image, lists newest first with a schedule, edits, switches, refuses bad images and windows, deletes", async () => {
    expect((await json<BannerList>(await t.request("/v1/admin/banners", { cookie: admin }))).items).toEqual([]);
    const res = await t.request("/v1/admin/banners", { cookie: admin, json: { title: "Welcome Offer", description: "Get 20% off your first plan", linkUrl: "https://hapiecoin.com/subscription", frequency: "once_per_day", image: PNG } });
    expect(res.status).toBe(201);
    const b = await json<Banner>(res);
    expect(b).toMatchObject({ title: "Welcome Offer", type: "popup", active: true, schedule: "showing", imageType: "image/png", imageBytes: 70 });
    expect(b.imageUrl).toMatch(new RegExp(`^/v1/banners/${b.id}/image\\?v=\\d+$`));
    const later = await json<Banner>(await t.request("/v1/admin/banners", { cookie: admin, json: { title: "Scheduled", image: PNG, startsAt: "2099-01-01T00:00:00.000Z", endsAt: "2099-02-01T00:00:00.000Z" } }));
    expect(later.schedule).toBe("scheduled");
    const ended = await json<Banner>(await t.request("/v1/admin/banners", { cookie: admin, json: { title: "Ended", image: PNG, startsAt: "2020-01-01T00:00:00.000Z", endsAt: "2020-02-01T00:00:00.000Z", active: false } }));
    expect(ended.schedule).toBe("hidden");
    const list = await json<BannerList>(await t.request("/v1/admin/banners", { cookie: admin }));
    expect(list.items.map((x) => x.title)).toEqual(["Ended", "Scheduled", "Welcome Offer"]);
    // validation: title, image type, size, link, window
    expect((await t.request("/v1/admin/banners", { cookie: admin, json: { title: "", image: PNG } })).status).toBe(400);
    expect((await t.request("/v1/admin/banners", { cookie: admin, json: { title: "x", image: "data:text/plain;base64,aGk=" } })).status).toBe(400);
    expect((await t.request("/v1/admin/banners", { cookie: admin, json: { title: "x", image: big() } })).status).toBe(400);
    expect((await t.request("/v1/admin/banners", { cookie: admin, json: { title: "x", image: PNG, linkUrl: "ftp://x" } })).status).toBe(400);
    expect((await t.request("/v1/admin/banners", { cookie: admin, json: { title: "x", image: PNG, startsAt: "2026-02-01T00:00:00.000Z", endsAt: "2026-01-01T00:00:00.000Z" } })).status).toBe(400);
    // edit: fields only, then a new image, then a bad window
    const edited = await json<Banner>(await t.request(`/v1/admin/banners/${b.id}`, { cookie: admin, method: "PATCH", json: { title: "Welcome!", active: false } }));
    expect(edited).toMatchObject({ title: "Welcome!", active: false, schedule: "hidden", imageBytes: 70 });
    const reimaged = await json<Banner>(await t.request(`/v1/admin/banners/${b.id}`, { cookie: admin, method: "PATCH", json: { image: "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", active: true } }));
    expect(reimaged.imageType).toBe("image/webp");
    expect(reimaged.imageUrl).not.toBe(b.imageUrl); // the version query moves so browsers refetch
    expect((await t.request(`/v1/admin/banners/${b.id}`, { cookie: admin, method: "PATCH", json: { startsAt: "2026-02-01T00:00:00.000Z", endsAt: "2026-01-01T00:00:00.000Z" } })).status).toBe(400);
    // every other field, set then cleared
    const full = await json<Banner>(await t.request(`/v1/admin/banners/${b.id}`, { cookie: admin, method: "PATCH", json: { description: "Now with text", linkUrl: "https://hapiecoin.com/analyse", frequency: "every_time", startsAt: "2026-01-01T00:00:00.000Z", endsAt: "2099-01-01T00:00:00.000Z" } }));
    expect(full).toMatchObject({ description: "Now with text", linkUrl: "https://hapiecoin.com/analyse", frequency: "every_time", startsAt: "2026-01-01T00:00:00.000Z", schedule: "showing" });
    const cleared = await json<Banner>(await t.request(`/v1/admin/banners/${b.id}`, { cookie: admin, method: "PATCH", json: { linkUrl: null, startsAt: null, endsAt: null } }));
    expect(cleared).toMatchObject({ linkUrl: null, startsAt: null, endsAt: null });
    // a body over the route's 7 MB limit is refused before parsing
    expect((await t.request("/v1/admin/banners", { cookie: admin, json: { title: "x", image: `data:image/png;base64,${"A".repeat(8 * 1024 * 1024)}` } })).status).toBe(400);
    expect((await t.request(`/v1/admin/banners/${b.id}`, { cookie: admin, method: "PATCH", json: {} })).status).toBe(400);
    expect((await t.request("/v1/admin/banners/bnr_nope", { cookie: admin, method: "PATCH", json: { title: "x" } })).status).toBe(404);
    // RBAC
    expect((await t.request("/v1/admin/banners", { cookie: user })).status).toBe(403);
    expect((await t.request("/v1/admin/banners", { cookie: user, json: { title: "x", image: PNG } })).status).toBe(403);
    // delete
    expect(await json<{ deleted: true }>(await t.request(`/v1/admin/banners/${ended.id}`, { cookie: admin, method: "DELETE" }))).toEqual({ deleted: true });
    expect((await t.request(`/v1/admin/banners/${ended.id}`, { cookie: admin, method: "DELETE" })).status).toBe(404);
    expect((await json<BannerList>(await t.request("/v1/admin/banners", { cookie: admin }))).items).toHaveLength(2);
  });
});

describe("HC-SH-055 trader list and the image", () => {
  it("lists only banners showing now, serves the image with cache headers to signed-in users, 404 for strangers", async () => {
    const mine = await json<BannerList>(await t.request("/v1/banners", { cookie: user }));
    expect(mine.items.map((x) => x.title)).toEqual(["Welcome!"]);
    expect(mine.items[0]?.schedule).toBe("showing");
    const img = await t.request(mine.items[0]!.imageUrl, { cookie: user });
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/webp");
    expect(img.headers.get("cache-control")).toContain("max-age=86400");
    expect((await img.arrayBuffer()).byteLength).toBeGreaterThan(10);
    expect((await t.request("/v1/banners/bnr_nope/image", { cookie: user })).status).toBe(404);
    expect((await t.request("/v1/banners", {})).status).toBe(401);
    expect((await t.request(mine.items[0]!.imageUrl, {})).status).toBe(401);
  });
});
