import { describe, expect, it } from "vitest";
import { createLogger } from "./logger.js";
import { INVITE_SUBJECT, MailCapture, OTP_SUBJECT, ResendMailer, createMailer, otpBody, type ResendLike } from "./mailer.js";

describe("[MAIL] OTP delivery", () => {
  it("dev mailer logs `[mail] to=<email> otp=<code>` and remembers the last code per address", async () => {
    const lines: string[] = [];
    const mail = new MailCapture((l) => lines.push(l));
    await mail.sendOtp({ email: "A@x.com", otp: "111111", type: "sign-in" });
    await mail.sendOtp({ email: "a@x.com", otp: "222222", type: "email-verification" });
    expect(lines[0]).toBe("[mail] to=A@x.com otp=111111 type=sign-in");
    expect(mail.last("a@x.com")?.otp).toBe("222222");
    expect(mail.last("a@x.com", "sign-in")?.otp).toBe("111111");
    expect(mail.last("nobody@x.com")).toBeUndefined();
    await expect(
      new MailCapture().sendOtp({ email: "q@x.com", otp: "1", type: "sign-in" }),
    ).resolves.toBeUndefined();
  });

  it("Resend mailer sends subject/text per purpose and surfaces delivery errors", async () => {
    const sent: unknown[] = [];
    let fail = false;
    const client: ResendLike = {
      emails: {
        send: (payload) => {
          sent.push(payload);
          return Promise.resolve({ error: fail ? { message: "quota" } : null });
        },
      },
    };
    const mailer = new ResendMailer(
      client,
      "HapieCoin <no-reply@hapiecoin.com>",
      createLogger({ level: "silent" }),
    );
    await mailer.sendOtp({ email: "u@x.com", otp: "123456", type: "forget-password" });
    expect(sent[0]).toEqual({
      from: "HapieCoin <no-reply@hapiecoin.com>",
      to: "u@x.com",
      subject: OTP_SUBJECT["forget-password"],
      text: otpBody({ email: "u@x.com", otp: "123456", type: "forget-password" }),
    });
    await mailer.sendInvite({ email: "new@x.com", name: "New Trader", invitedBy: "Demo Admin", link: "https://hapiecoin.com/auth?tab=login&email=new%40x.com" });
    expect(sent[1]).toMatchObject({ to: "new@x.com", subject: INVITE_SUBJECT, text: expect.stringContaining("Demo Admin") as string });
    expect(sent[1]).toMatchObject({ text: expect.stringContaining("https://hapiecoin.com/auth?tab=login&email=new%40x.com") as string });
    fail = true;
    await expect(mailer.sendOtp({ email: "u@x.com", otp: "1", type: "sign-in" })).rejects.toThrow(/quota/);
    await expect(mailer.sendInvite({ email: "new@x.com", name: "N", invitedBy: "A", link: "https://x" })).rejects.toThrow(/quota/);
    await expect(mailer.sendPromo({ email: "new@x.com", subject: "s", text: "t" })).rejects.toThrow(/quota/);
    const silent = new ResendMailer(client, "x");
    await expect(silent.sendOtp({ email: "u@x.com", otp: "1", type: "sign-in" })).rejects.toThrow();
    fail = false;
    await mailer.sendPromo({ email: "p@x.com", subject: "Hello", text: "Body" });
    expect(sent.at(-1)).toMatchObject({ to: "p@x.com", subject: "Hello", text: "Body" });
  });

  it("factory picks the capture mailer without a key (logging through the app logger) and Resend with one", async () => {
    const logger = createLogger({ level: "silent" });
    const dev = createMailer({ resendApiKey: undefined, from: "x", logger, nodeEnv: "development" });
    expect(dev).toBeInstanceOf(MailCapture);
    await dev.sendOtp({ email: "dev@x.com", otp: "654321", type: "sign-in" });
    await dev.sendInvite({ email: "dev2@x.com", name: "Dev Two", invitedBy: "Demo Admin", link: "https://x" });
    expect((dev as MailCapture).invites[0]?.email).toBe("dev2@x.com");
    await dev.sendPromo({ email: "dev3@x.com", subject: "s", text: "t" });
    expect((dev as MailCapture).promos[0]?.email).toBe("dev3@x.com");
    (dev as MailCapture).bounce.add("bad@x.com");
    await expect(dev.sendPromo({ email: "Bad@x.com", subject: "s", text: "t" })).rejects.toThrow(/550/);
    expect((dev as MailCapture).last("dev@x.com")?.otp).toBe("654321");
    expect(createMailer({ resendApiKey: "re_test", from: "x", logger, nodeEnv: "production" })).toBeInstanceOf(
      ResendMailer,
    );
  });

  it("[GAPS-23] refuses the OTP-logging capture mailer in production", () => {
    const logger = createLogger({ level: "silent" });
    expect(() => createMailer({ resendApiKey: undefined, from: "x", logger, nodeEnv: "production" })).toThrow(
      /RESEND_API_KEY/,
    );
    expect(createMailer({ resendApiKey: undefined, from: "x", logger, nodeEnv: "test" })).toBeInstanceOf(MailCapture);
  });
});
