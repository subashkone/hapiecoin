// Banner contracts (ADR-033): create / patch validation, the schedule state and base64 sizing.
import { describe, expect, it } from "vitest";
import { BANNER_IMAGE_MAX_BYTES, BannerCreate, BannerPatch, ImageDataUrl, bannerSchedule, base64Bytes } from "./banners.js";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
describe("HC-AD-065 / 066 / 069 BannerCreate and BannerPatch", () => {
  it("requires a title and an image on create, an http(s) link, and an end after the start", () => {
    expect(BannerCreate.safeParse({ title: "Welcome", image: PNG }).success).toBe(true);
    expect(BannerCreate.parse({ title: " Welcome ", image: PNG })).toMatchObject({ title: "Welcome", description: "", linkUrl: null, frequency: "once_per_day", active: true });
    expect(BannerCreate.safeParse({ title: "", image: PNG }).success).toBe(false);
    expect(BannerCreate.safeParse({ title: "x" }).success).toBe(false);
    expect(BannerCreate.safeParse({ title: "x", image: "data:text/plain;base64,aGk=" }).success).toBe(false);
    expect(BannerCreate.safeParse({ title: "x", image: PNG, linkUrl: "ftp://x" }).success).toBe(false);
    expect(BannerCreate.safeParse({ title: "x", image: PNG, linkUrl: "https://hapiecoin.com/subscription" }).success).toBe(true);
    expect(BannerCreate.safeParse({ title: "x", image: PNG, startsAt: "2026-09-02T00:00:00.000Z", endsAt: "2026-09-01T00:00:00.000Z" }).success).toBe(false);
    expect(BannerPatch.safeParse({}).success).toBe(false);
    expect(BannerPatch.safeParse({ active: false }).success).toBe(true);
    expect(ImageDataUrl.safeParse("data:image/webp;base64,UklGRg==").success).toBe(true);
  });
});

describe("HC-AD-060 bannerSchedule and image size", () => {
  it("reads showing / scheduled / ended / hidden and sizes base64 without decoding", () => {
    const now = new Date("2026-09-08T12:00:00Z");
    expect(bannerSchedule({ active: false, startsAt: null, endsAt: null }, now)).toBe("hidden");
    expect(bannerSchedule({ active: true, startsAt: "2026-09-09T00:00:00Z", endsAt: null }, now)).toBe("scheduled");
    expect(bannerSchedule({ active: true, startsAt: null, endsAt: "2026-09-01T00:00:00Z" }, now)).toBe("ended");
    expect(bannerSchedule({ active: true, startsAt: "2026-09-01T00:00:00Z", endsAt: "2026-09-30T00:00:00Z" }, now)).toBe("showing");
    expect(base64Bytes("aGk=")).toBe(2);
    expect(base64Bytes("aGVsbG8=")).toBe(5);
    expect(base64Bytes("aGVsbA==")).toBe(4);
    expect(BANNER_IMAGE_MAX_BYTES).toBe(5_242_880);
  });
});
