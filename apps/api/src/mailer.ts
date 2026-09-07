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

export interface Mailer {
  sendOtp(mail: OtpMail): Promise<void>;
}

/** Records every OTP mail (dev/test). `last(email)` returns the most recent code for an address. */
export class MailCapture implements Mailer {
  readonly sent: OtpMail[] = [];

  constructor(private readonly log?: (line: string) => void) {}

  sendOtp(mail: OtpMail): Promise<void> {
    this.sent.push(mail);
    // Deliberately unscrubbed: this is the development delivery channel. Never enabled in production.
    this.log?.(`[mail] to=${mail.email} otp=${mail.otp} type=${mail.type}`);
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
