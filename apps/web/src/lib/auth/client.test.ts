import { describe, expect, it } from "vitest";
import { authClient, authErrorMessage, safeNext } from "./client";

describe("HC-PB-036 safeNext", () => {
  it("only allows in-app absolute paths", () => {
    expect(safeNext("/analyse")).toBe("/analyse");
    expect(safeNext("/subscription?x=1", "/")).toBe("/subscription?x=1");
    expect(safeNext(undefined)).toBe("/analyse");
    expect(safeNext(null, "/")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/analyse");
    expect(safeNext("//evil.example")).toBe("/analyse");
    expect(safeNext("/\\evil")).toBe("/analyse");
  });
});

describe("HC-PB-030 authErrorMessage", () => {
  it("maps Better Auth codes to the mock's copy and falls back sensibly", () => {
    expect(authErrorMessage({ code: "INVALID_OTP" }, "x")).toBe("Enter valid OTP");
    expect(authErrorMessage({ code: "OTP_EXPIRED" }, "x")).toContain("expired");
    expect(authErrorMessage({ code: "TOO_MANY_ATTEMPTS" }, "x")).toContain("Too many");
    expect(authErrorMessage({ code: "INVALID_EMAIL_OR_PASSWORD" }, "x")).toBe("Invalid credentials.");
    expect(authErrorMessage({ code: "INVALID_PASSWORD" }, "x")).toBe("Invalid credentials.");
    expect(authErrorMessage({ code: "USER_ALREADY_EXISTS" }, "x")).toContain("already exists");
    expect(authErrorMessage({ message: "short" }, "fallback")).toBe("short");
    expect(authErrorMessage({ message: "x".repeat(200) }, "fallback")).toBe("fallback");
    expect(authErrorMessage(null, "fallback")).toBe("fallback");
    expect(authErrorMessage({}, "fallback")).toBe("fallback");
  });
  it("exposes the email-otp plugin on the client", () => {
    expect(typeof authClient.emailOtp.sendVerificationOtp).toBe("function");
    expect(typeof authClient.signIn.emailOtp).toBe("function");
  });
});
