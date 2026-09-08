/**
 * Banners (Phase 4 item 4b, ADR-033).
 *
 *   GET    /v1/banners                 banners showing now, for the flyer carousel (HC-SH-055)
 *   GET    /v1/banners/{id}/image      the image bytes (signed-in users; cached by version query)
 *   admin  GET  /v1/admin/banners      every banner, newest first (HC-AD-060)
 *   admin  POST /v1/admin/banners      create with a data-URL image ≤ 5 MB (HC-AD-065, 066, 069)
 *   admin  PATCH /v1/admin/banners/{id}  edit any field, switch active, replace the image (HC-AD-061, 062)
 *   admin  DELETE /v1/admin/banners/{id} (HC-AD-063)
 */
import { Banner, BannerCreate, BannerList, BannerPatch, Id } from "@hapiecoin/schema";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { auditFrom } from "../audit.js";
import { activeBanners, bannerImage, createBanner, deleteBanner, listBanners, updateBanner } from "../banners.js";
import type { AppEnv } from "../security/context.js";
import { errors } from "../security/errors.js";
import { requireAdmin, requireUser } from "../security/guards.js";
import { type AppDeps, cookieAuth, errorResponses, jsonContent } from "./shared.js";

const IdParam = z.object({ id: Id });
/** A 5 MB image is ~6.7 MB as base64; leave room for the other fields. */
const IMAGE_BODY_LIMIT = 7 * 1024 * 1024;

export function registerBannerRoutes(app: OpenAPIHono<AppEnv>, deps: AppDeps, now: () => Date = () => new Date()): void {
  const db = deps.db;
  const guard = requireUser(deps.sessions);
  const admin = requireAdmin(deps.sessions);
  const limit = bodyLimit({ maxSize: IMAGE_BODY_LIMIT, onError: () => { throw errors.badRequest("Image must be 5 MB or smaller"); } });

  app.openapi(
    createRoute({ method: "get", path: "/v1/banners", tags: ["banners"], summary: "Banners showing now (HC-SH-055)", security: cookieAuth, middleware: guard, responses: { 200: jsonContent(BannerList, "Banners"), 401: errorResponses[401] } }),
    async (c) => c.json({ items: await activeBanners(deps, now()) }, 200),
  );

  // Raw bytes, so plain Hono rather than an OpenAPI JSON route.
  app.get("/v1/banners/:id/image", guard, async (c) => {
    const img = await bannerImage(deps, c.req.param("id"));
    if (!img) throw errors.notFound("Banner");
    c.header("Content-Type", img.type);
    c.header("Cache-Control", "private, max-age=86400, immutable");
    c.header("Last-Modified", img.updatedAt.toUTCString());
    return c.body(new Uint8Array(img.bytes));
  });

  app.openapi(
    createRoute({ method: "get", path: "/v1/admin/banners", tags: ["admin"], summary: "Every banner (HC-AD-060)", security: cookieAuth, middleware: admin, responses: { 200: jsonContent(BannerList, "Banners"), 401: errorResponses[401], 403: errorResponses[403] } }),
    async (c) => c.json({ items: await listBanners(deps, now()) }, 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/admin/banners",
      tags: ["admin"],
      summary: "Create a banner (HC-AD-065, 066, 069)",
      security: cookieAuth,
      middleware: [...admin, limit],
      request: { body: { content: { "application/json": { schema: BannerCreate } }, required: true } },
      responses: { 201: jsonContent(Banner, "Created"), 400: errorResponses[400], 401: errorResponses[401], 403: errorResponses[403] },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const b = await createBanner(deps, body, now());
      await auditFrom(c, db)({ action: "admin.banner.create", target: `banner:${b.id}`, after: { ...body, image: `${b.imageType} ${b.imageBytes} bytes` } });
      return c.json(b, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/v1/admin/banners/{id}",
      tags: ["admin"],
      summary: "Edit a banner, switch it, replace the image (HC-AD-061, 062)",
      security: cookieAuth,
      middleware: [...admin, limit],
      request: { params: IdParam, body: { content: { "application/json": { schema: BannerPatch } }, required: true } },
      responses: { 200: jsonContent(Banner, "Updated"), 400: errorResponses[400], 401: errorResponses[401], 403: errorResponses[403], 404: errorResponses[404] },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const b = await updateBanner(deps, id, body, now());
      if (!b) throw errors.notFound("Banner");
      await auditFrom(c, db)({ action: "admin.banner.update", target: `banner:${id}`, after: { ...body, ...(body.image ? { image: `${b.imageType} ${b.imageBytes} bytes` } : {}) } });
      return c.json(b, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/v1/admin/banners/{id}",
      tags: ["admin"],
      summary: "Delete a banner (HC-AD-063)",
      security: cookieAuth,
      middleware: admin,
      request: { params: IdParam },
      responses: { 200: jsonContent(z.object({ deleted: z.literal(true) }), "Deleted"), 401: errorResponses[401], 403: errorResponses[403], 404: errorResponses[404] },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      if (!(await deleteBanner(deps, id))) throw errors.notFound("Banner");
      await auditFrom(c, db)({ action: "admin.banner.delete", target: `banner:${id}` });
      return c.json({ deleted: true as const }, 200);
    },
  );
}
