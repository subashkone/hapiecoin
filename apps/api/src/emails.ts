// Promotional emails (Phase 4 item 4c, ADR-035): recipients by segment from the same user rows as User Management,
// per-recipient placeholder rendering on the server, sequential delivery through the mailer with one recipient row
// per address, and the campaign history behind the admin's History tab.
import { type AdminUserRow, type Campaign, type CampaignDetail, type CampaignRecipient, type EmailSegment, type PlaceholderValues, RECIPIENTS_CAP, type Recipient, type RecipientList, type RecipientsQuery, renderTemplate } from "@hapiecoin/schema";
import { desc, eq } from "drizzle-orm";
import { adminRow } from "./admin-users.js";
import { campaignRecipients, campaigns, users } from "./db/schema.js";
import type { AppDeps } from "./routes/shared.js";
import { newId } from "./routes/shared.js";
import { errors } from "./security/errors.js";

type CampaignRow = typeof campaigns.$inferSelect;
const fmtExpiry = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "no end date");

function statusOf(u: AdminUserRow, at: Date): "active" | "free" | "expired" {
  if (u.planName === null) return "free";
  if (u.expiresAt !== null && new Date(u.expiresAt).getTime() <= at.getTime()) return "expired";
  return "active";
}
function inSegment(u: AdminUserRow, status: "active" | "free" | "expired", segment: EmailSegment): boolean {
  if (segment === "all") return true;
  if (segment === "expired") return status === "expired";
  if (segment === "free") return status === "free" || (status === "active" && u.planName === "Free");
  return status === "active" && u.planName !== "Free";
}
export function valuesFor(u: { name: string; email: string; planName: string | null; expiresAt: string | null }): PlaceholderValues {
  return { name: u.name, email: u.email, plan: u.planName ?? "Free", expiry: fmtExpiry(u.expiresAt) };
}

/** Active accounts matching the search and segment, capped for the list (HC-AD-073..076). */
export async function recipients(deps: AppDeps, q: RecipientsQuery, at: Date): Promise<RecipientList> {
  const needle = q.q?.toLowerCase() ?? "";
  const all = await deps.db.select().from(users).where(eq(users.active, true)).orderBy(users.name);
  const rows: Recipient[] = [];
  for (const u of all) {
    if (needle && !u.name.toLowerCase().includes(needle) && !u.email.toLowerCase().includes(needle)) continue;
    const row = await adminRow(deps, u, at);
    const status = statusOf(row, at);
    if (!inSegment(row, status, q.segment)) continue;
    rows.push({ id: u.id, name: u.name, email: u.email, status, planName: row.planName, expiresAt: row.expiresAt });
  }
  return { items: rows.slice(0, RECIPIENTS_CAP), total: rows.length, capped: rows.length > RECIPIENTS_CAP };
}

export function toCampaign(c: CampaignRow): Campaign {
  return { id: c.id, subject: c.subject, message: c.message, segment: c.segment, sentAt: c.sentAt.toISOString(), sentBy: c.sentBy, recipients: c.recipients, delivered: c.delivered, failed: c.failed };
}

/** Render per recipient, send one by one, record the campaign and every delivery (HC-AD-080, 081). */
export async function sendCampaign(deps: AppDeps, input: { userIds: string[]; subject: string; message: string; segment: EmailSegment }, sentBy: string, at: Date): Promise<Campaign> {
  const wanted = new Set(input.userIds);
  const all = await deps.db.select().from(users).where(eq(users.active, true));
  const targets = all.filter((u) => wanted.has(u.id));
  if (targets.length === 0) throw errors.badRequest("None of the selected users can be emailed");
  const deliveries: (typeof campaignRecipients.$inferInsert)[] = [];
  const campaignId = newId("cmp");
  for (const u of targets) {
    const row = await adminRow(deps, u, at);
    const v = valuesFor(row);
    const subject = renderTemplate(input.subject, v);
    const text = renderTemplate(input.message, v);
    try {
      await deps.mailer.sendPromo({ email: u.email, subject, text });
      deliveries.push({ campaignId, userId: u.id, name: u.name, email: u.email, status: "sent", sentAt: new Date(), error: null });
    } catch (e) {
      deliveries.push({ campaignId, userId: u.id, name: u.name, email: u.email, status: "failed", sentAt: new Date(), error: (e instanceof Error ? e.message : "delivery failed").slice(0, 300) });
    }
  }
  const delivered = deliveries.filter((d) => d.status === "sent").length;
  const [row] = await deps.db
    .insert(campaigns)
    .values({ id: campaignId, subject: input.subject, message: input.message, segment: input.segment, sentById: null, sentBy, sentAt: at, recipients: deliveries.length, delivered, failed: deliveries.length - delivered, createdAt: at, updatedAt: at })
    .returning();
  await deps.db.insert(campaignRecipients).values(deliveries);
  if (!row) throw new Error("campaign insert returned no row");
  return toCampaign(row);
}

/** A test send to the acting admin with their own values; records nothing (HC-AD-125). */
export async function sendTest(deps: AppDeps, adminId: string, input: { subject: string; message: string }, at: Date): Promise<{ email: string; subject: string }> {
  const [u] = await deps.db.select().from(users).where(eq(users.id, adminId)).limit(1);
  if (!u) throw errors.unauthenticated();
  const v = valuesFor(await adminRow(deps, u, at));
  const subject = renderTemplate(input.subject, v);
  await deps.mailer.sendPromo({ email: u.email, subject, text: renderTemplate(input.message, v) });
  return { email: u.email, subject };
}

export async function listCampaigns(deps: AppDeps): Promise<Campaign[]> {
  return (await deps.db.select().from(campaigns).orderBy(desc(campaigns.sentAt))).map(toCampaign);
}

export async function campaignDetail(deps: AppDeps, id: string): Promise<CampaignDetail | null> {
  const [c] = await deps.db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!c) return null;
  const rows = await deps.db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, id)).orderBy(campaignRecipients.email);
  const recipientsOut: CampaignRecipient[] = rows.map((r) => ({ userId: r.userId, name: r.name, email: r.email, status: r.status, sentAt: r.sentAt.toISOString(), error: r.error }));
  return { campaign: toCampaign(c), recipients: recipientsOut };
}
