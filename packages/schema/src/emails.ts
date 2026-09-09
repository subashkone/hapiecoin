// Promotional emails (Phase 4 item 4c, ADR-035; docs/design/admin.md §4c): recipients by segment, a plain-text
// campaign with per-recipient placeholders, the campaign history and the delivery rows behind it.
import { z } from "zod";
import { Id } from "./accounts.js";
import { IsoDateTime } from "./primitives.js";

export const EmailSegment = z.enum(["all", "paid", "free", "expired"]);
export type EmailSegment = z.infer<typeof EmailSegment>;
export const EMAIL_SEGMENT_LABELS: Record<EmailSegment, string> = { all: "All users", paid: "Paid users", free: "Free users", expired: "Expired" };

export const RecipientStatus = z.enum(["active", "free", "expired"]);
export type RecipientStatus = z.infer<typeof RecipientStatus>;
/** One user as the Compose list shows them (HC-AD-076); deactivated accounts are never offered. */
export const Recipient = z.strictObject({ id: Id, name: z.string(), email: z.string(), status: RecipientStatus, planName: z.string().nullable(), expiresAt: IsoDateTime.nullable() });
export type Recipient = z.infer<typeof Recipient>;
export const RECIPIENTS_CAP = 200;
export const RecipientList = z.strictObject({ items: z.array(Recipient), total: z.number().int(), capped: z.boolean() });
export type RecipientList = z.infer<typeof RecipientList>;
export const RecipientsQuery = z.object({ q: z.string().trim().max(80).optional(), segment: EmailSegment.default("all") });
export type RecipientsQuery = z.infer<typeof RecipientsQuery>;

export const SendEmailBody = z.strictObject({
  userIds: z.array(Id).min(1, "pick at least one recipient").max(5000),
  subject: z.string().trim().min(1, "Subject is required").max(200),
  message: z.string().trim().min(1, "Message is required").max(10_000),
  /** Recorded on the campaign for the History table; the recipients themselves are `userIds`. */
  segment: EmailSegment.default("all"),
});
export type SendEmailBody = z.infer<typeof SendEmailBody>;
export const TestEmailBody = z.strictObject({ subject: z.string().trim().min(1).max(200), message: z.string().trim().min(1).max(10_000) });
export type TestEmailBody = z.infer<typeof TestEmailBody>;

export const CampaignRecipient = z.strictObject({ userId: Id.nullable(), name: z.string(), email: z.string(), status: z.enum(["sent", "failed"]), sentAt: IsoDateTime, error: z.string().nullable() });
export type CampaignRecipient = z.infer<typeof CampaignRecipient>;
export const Campaign = z.strictObject({
  id: Id,
  subject: z.string(),
  message: z.string(),
  segment: EmailSegment,
  sentAt: IsoDateTime,
  sentBy: z.string(),
  recipients: z.number().int(),
  delivered: z.number().int(),
  failed: z.number().int(),
});
export type Campaign = z.infer<typeof Campaign>;
export const CampaignList = z.strictObject({ items: z.array(Campaign) });
export type CampaignList = z.infer<typeof CampaignList>;
export const CampaignDetail = z.strictObject({ campaign: Campaign, recipients: z.array(CampaignRecipient) });
export type CampaignDetail = z.infer<typeof CampaignDetail>;
export const SendEmailResult = z.strictObject({ campaign: Campaign });
export type SendEmailResult = z.infer<typeof SendEmailResult>;

/** Placeholder values for one recipient (HC-AD-078). */
export interface PlaceholderValues {
  name: string;
  email: string;
  plan: string;
  expiry: string;
}
export const PLACEHOLDERS = ["name", "email", "plan", "expiry"] as const;
/** Replace {{name}} {{email}} {{plan}} {{expiry}} (whitespace tolerant); unknown tokens stay as typed. */
export function renderTemplate(text: string, v: PlaceholderValues): string {
  return text.replace(/\{\{\s*(name|email|plan|expiry)\s*\}\}/g, (_m, key: keyof PlaceholderValues) => v[key]);
}
/** True when the text still carries a placeholder token after rendering (or before, with nobody selected). */
export const hasPlaceholders = (text: string): boolean => /\{\{\s*\w+\s*\}\}/.test(text);

export interface EmailTemplate {
  key: "weekly_report" | "plan_expiring" | "new_feature";
  label: string;
  subject: string;
  message: string;
}
/** The three starting points of the reference site (HC-AD-124), placeholders included. */
export const EMAIL_TEMPLATES: readonly EmailTemplate[] = [
  { key: "weekly_report", label: "Weekly report", subject: "Your weekly options report is ready", message: "Hi {{name}},\n\nYour HapieCoin report for the week is ready. Sign in to review your strategies and positions on the {{plan}} plan.\n\nHappy trading,\nHapieCoin" },
  { key: "plan_expiring", label: "Plan expiring", subject: "Your {{plan}} plan ends on {{expiry}}", message: "Hi {{name}},\n\nYour {{plan}} plan ends on {{expiry}}. Renew from My Subscription to keep live trading, analytics and your saved strategies without interruption.\n\nHapieCoin" },
  { key: "new_feature", label: "New feature", subject: "New on HapieCoin: live trading from the builder", message: "Hi {{name}},\n\nYou can now connect your Delta Exchange India API key in Settings → API Settings and place real orders straight from the strategy builder.\n\nHapieCoin" },
];
