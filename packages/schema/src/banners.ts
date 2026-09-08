// Banners (Phase 4 item 4b, ADR-033; docs/design/admin.md §4b): promotional popups an admin schedules and traders
// see as a flyer carousel on /analyse. The image travels as a data URL on write (≤ 5 MB decoded) and is served by
// its own URL on read; the JSON never carries bytes back.
import { z } from "zod";
import { Id } from "./accounts.js";
import { IsoDateTime } from "./primitives.js";

export const BannerFrequency = z.enum(["every_time", "once_per_session", "once_per_day"]);
export type BannerFrequency = z.infer<typeof BannerFrequency>;
export const BANNER_FREQUENCY_LABELS: Record<BannerFrequency, string> = { every_time: "Every visit", once_per_session: "Once per session", once_per_day: "Once a day" };
export const BANNER_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const BANNER_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

/** Where a banner stands today (HC-AD-060): showing, scheduled, ended, or hidden by the switch. */
export const BannerSchedule = z.enum(["showing", "scheduled", "ended", "hidden"]);
export type BannerSchedule = z.infer<typeof BannerSchedule>;

export const Banner = z.strictObject({
  id: Id,
  title: z.string(),
  description: z.string(),
  linkUrl: z.string().nullable(),
  type: z.literal("popup"),
  frequency: BannerFrequency,
  startsAt: IsoDateTime.nullable(),
  endsAt: IsoDateTime.nullable(),
  active: z.boolean(),
  /** Path of the image (same origin), e.g. /v1/banners/bnr_x/image; the browser adds the version query for caching. */
  imageUrl: z.string(),
  imageType: z.string(),
  imageBytes: z.number().int(),
  schedule: BannerSchedule,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Banner = z.infer<typeof Banner>;
export const BannerList = z.strictObject({ items: z.array(Banner) });
export type BannerList = z.infer<typeof BannerList>;

const HttpUrl = z.url().refine((u) => /^https?:\/\//i.test(u), { message: "link must start with http:// or https://" });
/** A data URL of an allowed image type; the decoded size is checked server-side against BANNER_IMAGE_MAX_BYTES. */
export const ImageDataUrl = z.string().regex(/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/, "expected a PNG, JPEG, WebP or GIF data URL");

const fields = {
  title: z.string().trim().min(1, "Title is required").max(120),
  description: z.string().trim().max(500).default(""),
  linkUrl: HttpUrl.nullable().default(null),
  frequency: BannerFrequency.default("once_per_day"),
  startsAt: IsoDateTime.nullable().default(null),
  endsAt: IsoDateTime.nullable().default(null),
  active: z.boolean().default(true),
};
const window = (b: { startsAt: string | null; endsAt: string | null }) => !b.startsAt || !b.endsAt || new Date(b.endsAt).getTime() > new Date(b.startsAt).getTime();

/** POST /v1/admin/banners (HC-AD-065, 066, 069): the image is required on create. */
export const BannerCreate = z.strictObject({ ...fields, image: ImageDataUrl }).refine(window, { message: "end must be after start", path: ["endsAt"] });
export type BannerCreate = z.infer<typeof BannerCreate>;
/** PATCH /v1/admin/banners/{id} (HC-AD-061, 062): every field optional; omit `image` to keep the current one. */
export const BannerPatch = z
  .strictObject({
    title: fields.title.optional(),
    description: z.string().trim().max(500).optional(),
    linkUrl: HttpUrl.nullable().optional(),
    frequency: BannerFrequency.optional(),
    startsAt: IsoDateTime.nullable().optional(),
    endsAt: IsoDateTime.nullable().optional(),
    active: z.boolean().optional(),
    image: ImageDataUrl.optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: "nothing to update" });
export type BannerPatch = z.infer<typeof BannerPatch>;

/** Decoded byte length of a base64 payload without decoding it. */
export function base64Bytes(b64: string): number {
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

export function bannerSchedule(b: { active: boolean; startsAt: string | null; endsAt: string | null }, now: Date): BannerSchedule {
  if (!b.active) return "hidden";
  const t = now.getTime();
  if (b.startsAt && new Date(b.startsAt).getTime() > t) return "scheduled";
  if (b.endsAt && new Date(b.endsAt).getTime() < t) return "ended";
  return "showing";
}
