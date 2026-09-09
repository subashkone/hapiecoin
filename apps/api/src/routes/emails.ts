/**
 * Admin · Promotional Emails (Phase 4 item 4c, ADR-035; HC-AD-071..085, 124..128).
 *
 *   GET  /v1/admin/emails/recipients?q&segment   active users for the Compose list, capped at 200
 *   POST /v1/admin/emails/send                  render per recipient, deliver, record the campaign (audited)
 *   POST /v1/admin/emails/test                  a test send to the acting admin, recorded nowhere
 *   GET  /v1/admin/emails/campaigns             history, newest first
 *   GET  /v1/admin/emails/campaigns/{id}        campaign with its delivery rows
 */
import { CampaignDetail, CampaignList, Id, RecipientList, RecipientsQuery, SendEmailBody, SendEmailResult, TestEmailBody } from "@hapiecoin/schema";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { auditFrom } from "../audit.js";
import { campaignDetail, listCampaigns, recipients, sendCampaign, sendTest } from "../emails.js";
import { type AppEnv, currentUser } from "../security/context.js";
import { errors } from "../security/errors.js";
import { requireAdmin } from "../security/guards.js";
import { type AppDeps, cookieAuth, errorResponses, jsonContent } from "./shared.js";

const IdParam = z.object({ id: Id });

export function registerEmailRoutes(app: OpenAPIHono<AppEnv>, deps: AppDeps, now: () => Date = () => new Date()): void {
  const db = deps.db;
  const admin = requireAdmin(deps.sessions);

  app.openapi(
    createRoute({ method: "get", path: "/v1/admin/emails/recipients", tags: ["admin"], summary: "Recipients by search and segment (HC-AD-073, 074, 076)", security: cookieAuth, middleware: admin, request: { query: RecipientsQuery }, responses: { 200: jsonContent(RecipientList, "Recipients"), 401: errorResponses[401], 403: errorResponses[403] } }),
    async (c) => c.json(await recipients(deps, c.req.valid("query"), now()), 200),
  );

  app.openapi(
    createRoute({ method: "post", path: "/v1/admin/emails/send", tags: ["admin"], summary: "Send a campaign (HC-AD-080, 081)", security: cookieAuth, middleware: admin, request: { body: { content: { "application/json": { schema: SendEmailBody } }, required: true } }, responses: { 201: jsonContent(SendEmailResult, "Sent"), 400: errorResponses[400], 401: errorResponses[401], 403: errorResponses[403] } }),
    async (c) => {
      const me = currentUser(c);
      const body = c.req.valid("json");
      const campaign = await sendCampaign(deps, body, me.name, now());
      await auditFrom(c, db)({ action: "admin.email.send", target: `campaign:${campaign.id}`, after: { subject: body.subject, segment: body.segment, recipients: campaign.recipients, delivered: campaign.delivered, failed: campaign.failed } });
      return c.json({ campaign }, 201);
    },
  );

  app.openapi(
    createRoute({ method: "post", path: "/v1/admin/emails/test", tags: ["admin"], summary: "Test send to me (HC-AD-125)", security: cookieAuth, middleware: admin, request: { body: { content: { "application/json": { schema: TestEmailBody } }, required: true } }, responses: { 200: jsonContent(z.object({ email: z.string(), subject: z.string() }), "Sent"), 400: errorResponses[400], 401: errorResponses[401], 403: errorResponses[403] } }),
    async (c) => c.json(await sendTest(deps, currentUser(c).id, c.req.valid("json"), now()), 200),
  );

  app.openapi(
    createRoute({ method: "get", path: "/v1/admin/emails/campaigns", tags: ["admin"], summary: "Campaign history (HC-AD-082)", security: cookieAuth, middleware: admin, responses: { 200: jsonContent(CampaignList, "Campaigns"), 401: errorResponses[401], 403: errorResponses[403] } }),
    async (c) => c.json({ items: await listCampaigns(deps) }, 200),
  );

  app.openapi(
    createRoute({ method: "get", path: "/v1/admin/emails/campaigns/{id}", tags: ["admin"], summary: "Campaign detail with deliveries (HC-AD-084, 085)", security: cookieAuth, middleware: admin, request: { params: IdParam }, responses: { 200: jsonContent(CampaignDetail, "Campaign"), 401: errorResponses[401], 403: errorResponses[403], 404: errorResponses[404] } }),
    async (c) => {
      const d = await campaignDetail(deps, c.req.valid("param").id);
      if (!d) throw errors.notFound("Campaign");
      return c.json(d, 200);
    },
  );
}
