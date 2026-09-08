// Banners through TanStack Query (Phase 4 item 4b, ADR-033): the trader's live list for the flyer popup and the
// admin's CRUD. Images travel as data URLs on write and by URL on read.
import { BANNER_IMAGE_MAX_BYTES, BANNER_IMAGE_TYPES, Banner, type BannerCreate, BannerList, type BannerPatch } from "@hapiecoin/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api, type ApiClient } from "./client";

const enc = encodeURIComponent;
export const bannerKeys = { live: ["banners", "live"] as const, admin: ["banners", "admin"] as const };

export function bannerFetchers(client: ApiClient = api) {
  return {
    live: () => client.get("/v1/banners", BannerList),
    admin: () => client.get("/v1/admin/banners", BannerList),
    create: (body: BannerCreate) => client.post("/v1/admin/banners", body, Banner),
    update: (id: string, body: BannerPatch) => client.patch(`/v1/admin/banners/${enc(id)}`, body, Banner),
    remove: (id: string) => client.delete(`/v1/admin/banners/${enc(id)}`),
  };
}
const f = bannerFetchers();

export function useLiveBanners(enabled = true) {
  return useQuery({ queryKey: bannerKeys.live, queryFn: async () => (await f.live()).items, staleTime: 5 * 60_000, enabled });
}
export function useAdminBanners() {
  return useQuery({ queryKey: bannerKeys.admin, queryFn: async () => (await f.admin()).items, staleTime: 10_000 });
}
function useBannerMutation<TVars, TResult>(run: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: bannerKeys.admin });
      void qc.invalidateQueries({ queryKey: bannerKeys.live });
    },
  });
}
export function useCreateBanner() {
  return useBannerMutation((body: BannerCreate) => f.create(body));
}
export function useUpdateBanner() {
  return useBannerMutation(({ id, body }: { id: string; body: BannerPatch }) => f.update(id, body));
}
export function useDeleteBanner() {
  return useBannerMutation((id: string) => f.remove(id));
}

/** Client-side image rules before any upload (HC-AD-066): only images, 5 MB or smaller. */
export function checkImageFile(file: { type: string; size: number }): string | null {
  if (!(BANNER_IMAGE_TYPES as readonly string[]).includes(file.type)) return "Only image files are allowed (PNG, JPEG, WebP, GIF)";
  if (file.size > BANNER_IMAGE_MAX_BYTES) return "Image must be 5 MB or smaller";
  return null;
}
export function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("Could not read the file"));
    r.onload = () => (typeof r.result === "string" ? resolve(r.result) : reject(new Error("Could not read the file")));
    r.readAsDataURL(file);
  });
}
export const fmtBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Which frequency rule hides a banner right now, from browser storage (HC-SH-056). */
export const FLYER_SEEN_KEY = "hapiecoin.flyers";
const SeenState = z.object({ day: z.record(z.string(), z.string()).default({}), never: z.array(z.string()).default([]) });
type SeenState = z.infer<typeof SeenState>;
const today = (now: Date) => now.toISOString().slice(0, 10);
export function readSeen(): SeenState {
  try {
    const raw = localStorage.getItem(FLYER_SEEN_KEY);
    return raw ? SeenState.parse(JSON.parse(raw)) : { day: {}, never: [] };
  } catch {
    return { day: {}, never: [] };
  }
}
function writeSeen(s: SeenState): void {
  try {
    localStorage.setItem(FLYER_SEEN_KEY, JSON.stringify(s));
  } catch {
    /* storage blocked: the banner simply shows again next time */
  }
}
function sessionSeen(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(FLYER_SEEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
/** Banners whose rule says show them on this visit (`force` ignores the rules, for the palette). */
export function dueBanners(all: readonly Banner[], now: Date, force = false): Banner[] {
  if (force) return [...all];
  const seen = readSeen();
  const session = sessionSeen();
  return all.filter((b) => {
    if (seen.never.includes(b.id)) return false;
    if (b.frequency === "once_per_day") return seen.day[b.id] !== today(now);
    if (b.frequency === "once_per_session") return !session.has(b.id);
    return true;
  });
}
/** Record that these banners were shown now (day and session rules). */
export function markShown(shown: readonly Banner[], now: Date): void {
  const seen = readSeen();
  const session = sessionSeen();
  for (const b of shown) {
    if (b.frequency === "once_per_day") seen.day[b.id] = today(now);
    if (b.frequency === "once_per_session") session.add(b.id);
  }
  writeSeen(seen);
  try {
    sessionStorage.setItem(FLYER_SEEN_KEY, JSON.stringify([...session]));
  } catch {
    /* ignore */
  }
}
export function neverShow(id: string): void {
  const seen = readSeen();
  if (!seen.never.includes(id)) seen.never.push(id);
  writeSeen(seen);
}
/** hapiecoin.com links navigate in place; anything else opens a new tab (HC-SH-056). */
export function bannerRoute(linkUrl: string | null): { href: string; external: boolean } | null {
  if (!linkUrl) return null;
  const m = /^https?:\/\/(?:www\.)?hapiecoin\.com(\/[^?#]*)?(\?[^#]*)?/i.exec(linkUrl);
  if (m) return { href: `${m[1] ?? "/"}${m[2] ?? ""}`, external: false };
  return { href: linkUrl, external: true };
}
