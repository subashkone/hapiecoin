// Banners (Phase 4 item 4b, ADR-033): admin-scheduled popups. Images are stored in Postgres (bytea, ≤ 5 MB) and
// served from /v1/banners/{id}/image with a version query so browsers cache them; list responses never carry bytes.
import { BANNER_IMAGE_MAX_BYTES, BANNER_IMAGE_TYPES, type Banner, type BannerCreate, type BannerPatch, bannerSchedule, base64Bytes } from "@hapiecoin/schema";
import { desc, eq } from "drizzle-orm";
import { banners } from "./db/schema.js";
import type { AppDeps } from "./routes/shared.js";
import { newId } from "./routes/shared.js";
import { errors } from "./security/errors.js";

type BannerRow = typeof banners.$inferSelect;
type Meta = Omit<BannerRow, "image">;
const meta = { id: banners.id, title: banners.title, description: banners.description, linkUrl: banners.linkUrl, frequency: banners.frequency, startsAt: banners.startsAt, endsAt: banners.endsAt, active: banners.active, imageType: banners.imageType, imageBytes: banners.imageBytes, createdAt: banners.createdAt, updatedAt: banners.updatedAt };

export function toBanner(r: Meta, now: Date): Banner {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    linkUrl: r.linkUrl,
    type: "popup",
    frequency: r.frequency,
    startsAt: r.startsAt?.toISOString() ?? null,
    endsAt: r.endsAt?.toISOString() ?? null,
    active: r.active,
    imageUrl: `/v1/banners/${r.id}/image?v=${r.updatedAt.getTime()}`,
    imageType: r.imageType,
    imageBytes: r.imageBytes,
    schedule: bannerSchedule({ active: r.active, startsAt: r.startsAt?.toISOString() ?? null, endsAt: r.endsAt?.toISOString() ?? null }, now),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Decode a validated data URL, refusing anything over the size cap or outside the allowed types (HC-AD-066). */
export function decodeImage(dataUrl: string): { type: string; bytes: Buffer } {
  const m = /^data:(image\/[a-z]+);base64,(.*)$/i.exec(dataUrl);
  if (!m || !m[1] || !m[2]) throw errors.badRequest("Only image files are allowed");
  const type = m[1].toLowerCase();
  if (!(BANNER_IMAGE_TYPES as readonly string[]).includes(type)) throw errors.badRequest("Only PNG, JPEG, WebP or GIF images are allowed");
  if (base64Bytes(m[2]) > BANNER_IMAGE_MAX_BYTES) throw errors.badRequest("Image must be 5 MB or smaller");
  return { type, bytes: Buffer.from(m[2], "base64") };
}

/** Every banner, newest first (admin, HC-AD-060). */
export async function listBanners(deps: AppDeps, now: Date): Promise<Banner[]> {
  const rows = await deps.db.select(meta).from(banners).orderBy(desc(banners.createdAt));
  return rows.map((r) => toBanner(r, now));
}

/** Banners a trader sees now: active and inside their window (HC-SH-055). */
export async function activeBanners(deps: AppDeps, now: Date): Promise<Banner[]> {
  return (await listBanners(deps, now)).filter((b) => b.schedule === "showing");
}

export async function createBanner(deps: AppDeps, input: BannerCreate, now: Date): Promise<Banner> {
  const img = decodeImage(input.image);
  const [row] = await deps.db
    .insert(banners)
    .values({ id: newId("bnr"), title: input.title, description: input.description, linkUrl: input.linkUrl, frequency: input.frequency, startsAt: input.startsAt ? new Date(input.startsAt) : null, endsAt: input.endsAt ? new Date(input.endsAt) : null, active: input.active, image: img.bytes, imageType: img.type, imageBytes: img.bytes.length, createdAt: now, updatedAt: now })
    .returning(meta);
  if (!row) throw new Error("banner insert returned no row");
  return toBanner(row, now);
}

export async function updateBanner(deps: AppDeps, id: string, patch: BannerPatch, now: Date): Promise<Banner | null> {
  const [current] = await deps.db.select(meta).from(banners).where(eq(banners.id, id)).limit(1);
  if (!current) return null;
  const startsAt = patch.startsAt === undefined ? current.startsAt : patch.startsAt ? new Date(patch.startsAt) : null;
  const endsAt = patch.endsAt === undefined ? current.endsAt : patch.endsAt ? new Date(patch.endsAt) : null;
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) throw errors.badRequest("end must be after start");
  const img = patch.image ? decodeImage(patch.image) : null;
  const [row] = await deps.db
    .update(banners)
    .set({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.linkUrl !== undefined ? { linkUrl: patch.linkUrl } : {}),
      ...(patch.frequency !== undefined ? { frequency: patch.frequency } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      startsAt,
      endsAt,
      ...(img ? { image: img.bytes, imageType: img.type, imageBytes: img.bytes.length } : {}),
      updatedAt: now,
    })
    .where(eq(banners.id, id))
    .returning(meta);
  return row ? toBanner(row, now) : null;
}

export async function deleteBanner(deps: AppDeps, id: string): Promise<boolean> {
  const rows = await deps.db.delete(banners).where(eq(banners.id, id)).returning({ id: banners.id });
  return rows.length > 0;
}

export async function bannerImage(deps: AppDeps, id: string): Promise<{ type: string; bytes: Buffer; updatedAt: Date } | null> {
  const [row] = await deps.db.select({ image: banners.image, imageType: banners.imageType, updatedAt: banners.updatedAt }).from(banners).where(eq(banners.id, id)).limit(1);
  return row ? { type: row.imageType, bytes: Buffer.from(row.image), updatedAt: row.updatedAt } : null;
}
