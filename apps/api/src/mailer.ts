/**
 * Transactional mail. With RESEND_API_KEY the Resend transport is used; without it (development,
 * tests) the OTP is logged as `[mail] to=<email> otp=<code>` so the developer can complete the flow.
 * The dev mailer also records deliveries so tests can read the code back (`MailCapture`).
 */
import { Resend } from "resend";
import type { Logger } from "./logger.js";

export type OtpPurpose = "sign-in" | "email-verification" | "forget-password" | "change-email";

export interface OtpMail {
  email: string;
  otp: string;
  type: OtpPurpose;
}

/** Admin invitation (HC-AD-108, ADR-032): the invitee signs in by OTP through `link`; no password is ever set for them. */
export interface InviteMail {
  email: string;
  name: string;
  invitedBy: string;
  link: string;
}

/** A promotional campaign message, already rendered for one recipient (ADR-035). Plain text. */
export interface PromoMail {
  email: string;
  subject: string;
  text: string;
}

/** A triggered alert (ADR-052): one plain-text line per alert, sent to the trader who set it. */
export interface AlertMail {
  email: string;
  subject: string;
  text: string;
}

export interface Mailer {
  sendOtp(mail: OtpMail): Promise<void>;
  sendInvite(mail: InviteMail): Promise<void>;
  sendPromo(mail: PromoMail): Promise<void>;
  sendAlert(mail: AlertMail): Promise<void>;
}

/** Records every OTP mail (dev/test). `last(email)` returns the most recent code for an address. */
export class MailCapture implements Mailer {
  readonly sent: OtpMail[] = [];
  readonly invites: InviteMail[] = [];
  readonly promos: PromoMail[] = [];
  readonly alerts: AlertMail[] = [];
  /** Addresses the capture mailer refuses (tests exercise the failed-delivery path). */
  readonly bounce = new Set<string>();

  constructor(private readonly log?: (line: string) => void) {}

  sendOtp(mail: OtpMail): Promise<void> {
    this.sent.push(mail);
    // Deliberately unscrubbed: this is the development delivery channel. Never enabled in production.
    this.log?.(`[mail] to=${mail.email} otp=${mail.otp} type=${mail.type}`);
    return Promise.resolve();
  }

  sendPromo(mail: PromoMail): Promise<void> {
    if (this.bounce.has(mail.email.toLowerCase())) return Promise.reject(new Error(`550 mailbox unavailable: ${mail.email}`));
    this.promos.push(mail);
    this.log?.(`[mail] promo to=${mail.email} subject=${mail.subject}`);
    return Promise.resolve();
  }

  sendAlert(mail: AlertMail): Promise<void> {
    if (this.bounce.has(mail.email.toLowerCase())) return Promise.reject(new Error(`550 mailbox unavailable: ${mail.email}`));
    this.alerts.push(mail);
    this.log?.(`[mail] alert to=${mail.email} subject=${mail.subject}`);
    return Promise.resolve();
  }

  sendInvite(mail: InviteMail): Promise<void> {
    this.invites.push(mail);
    this.log?.(`[mail] invite to=${mail.email} by=${mail.invitedBy}`);
    return Promise.resolve();
  }

  last(email: string, type?: OtpPurpose): OtpMail | undefined {
    const lower = email.toLowerCase();
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      const m = this.sent[i];
      if (m && m.email.toLowerCase() === lower && (type === undefined || m.type === type)) return m;
    }
    return undefined;
  }
}

export const OTP_SUBJECT: Record<OtpPurpose, string> = {
  "sign-in": "Your HapieCoin sign-in code",
  "email-verification": "Verify your HapieCoin email",
  "forget-password": "Reset your HapieCoin password",
  "change-email": "Confirm your new HapieCoin email",
};

export const INVITE_SUBJECT = "You are invited to HapieCoin";
export function inviteBody(mail: InviteMail): string {
  return `Hi ${mail.name},

${mail.invitedBy} has set up a HapieCoin account for you (${mail.email}). Sign in with a one-time code here: ${mail.link}

HapieCoin: options strategies for Delta Exchange India.`;
}

export function otpBody(mail: OtpMail): string {
  return `Your HapieCoin code is ${mail.otp}. It expires in 10 minutes. If you did not request it, ignore this email.`;
}

/** Minimal Resend surface so tests can pass a fake. */
export interface ResendLike {
  emails: {
    send(payload: {
      from: string;
      to: string;
      subject: string;
      text: string;
    }): Promise<{ error: { message: string } | null }>;
  };
}

export class ResendMailer implements Mailer {
  constructor(
    private readonly client: ResendLike,
    private readonly from: string,
    private readonly logger?: Logger,
  ) {}

  async sendOtp(mail: OtpMail): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to: mail.email,
      subject: OTP_SUBJECT[mail.type],
      text: otpBody(mail),
    });
    if (error) {
      this.logger?.error({ to: mail.email, type: mail.type, reason: error.message }, "otp mail failed");
      throw new Error(`mail delivery failed: ${error.message}`);
    }
  }

  async sendPromo(mail: PromoMail): Promise<void> {
    const { error } = await this.client.emails.send({ from: this.from, to: mail.email, subject: mail.subject, text: mail.text });
    if (error) {
      this.logger?.error({ to: mail.email, reason: error.message }, "promo mail failed");
      throw new Error(`mail delivery failed: ${error.message}`);
    }
  }

  async sendInvite(mail: InviteMail): Promise<void> {
    const { error } = await this.client.emails.send({ from: this.from, to: mail.email, subject: INVITE_SUBJECT, text: inviteBody(mail) });
    if (error) {
      this.logger?.error({ to: mail.email, reason: error.message }, "invite mail failed");
      throw new Error(`mail delivery failed: ${error.message}`);
    }
  }

  async sendAlert(mail: AlertMail): Promise<void> {
    const { error } = await this.client.emails.send({ from: this.from, to: mail.email, subject: mail.subject, text: mail.text });
    if (error) {
      this.logger?.error({ to: mail.email, reason: error.message }, "alert mail failed");
      throw new Error(`mail delivery failed: ${error.message}`);
    }
  }
}

export function createMailer(opts: {
  resendApiKey: string | undefined;
  from: string;
  logger: Logger;
  /** The capture mailer logs OTPs, so it is refused outright in production (GAPS #23). */
  nodeEnv: "development" | "test" | "production";
}): Mailer {
  if (opts.resendApiKey === undefined) {
    if (opts.nodeEnv === "production") {
      throw new Error("refusing to start the OTP-logging capture mailer in production; set RESEND_API_KEY");
    }
    return new MailCapture((line) => opts.logger.warn(line));
  }
  return new ResendMailer(new Resend(opts.resendApiKey), opts.from, opts.logger);
}
