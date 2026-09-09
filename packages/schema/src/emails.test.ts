// Promotional email contracts (ADR-035): placeholder rendering, the send body rules, templates.
import { describe, expect, it } from "vitest";
import { EMAIL_TEMPLATES, SendEmailBody, hasPlaceholders, renderTemplate } from "./emails.js";

describe("HC-AD-078 renderTemplate", () => {
  it("fills the four placeholders, tolerates spaces, leaves unknown tokens", () => {
    const v = { name: "Ria", email: "ria@x.test", plan: "Pro", expiry: "31 Dec 2026" };
    expect(renderTemplate("Hi {{name}} ({{ email }}), {{plan}} ends {{expiry}}. {{foo}}", v)).toBe("Hi Ria (ria@x.test), Pro ends 31 Dec 2026. {{foo}}");
    expect(hasPlaceholders("plain")).toBe(false);
    expect(hasPlaceholders("{{ name }}")).toBe(true);
    expect(EMAIL_TEMPLATES.map((t) => t.key)).toEqual(["weekly_report", "plan_expiring", "new_feature"]);
    expect(EMAIL_TEMPLATES.every((t) => hasPlaceholders(t.message))).toBe(true);
  });
});

describe("HC-AD-077, 080 SendEmailBody", () => {
  it("needs recipients, a subject and a message", () => {
    expect(SendEmailBody.safeParse({ userIds: ["usr_1"], subject: "s", message: "m" }).success).toBe(true);
    expect(SendEmailBody.parse({ userIds: ["usr_1"], subject: " s ", message: "m" })).toMatchObject({ subject: "s", segment: "all" });
    expect(SendEmailBody.safeParse({ userIds: [], subject: "s", message: "m" }).success).toBe(false);
    expect(SendEmailBody.safeParse({ userIds: ["usr_1"], subject: "", message: "m" }).success).toBe(false);
    expect(SendEmailBody.safeParse({ userIds: ["usr_1"], subject: "s", message: "   " }).success).toBe(false);
  });
});
