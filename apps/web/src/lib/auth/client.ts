// Better Auth browser client. Same-origin: Next rewrites /api/auth/* to apps/api, so the session cookie
// is first-party. Email OTP flows come from the email-otp plugin (sign-in, email-verification, forget-password).
import { createAuthClient } from "better-auth/react";
import { emailOTPClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [emailOTPClient()],
  // Resolve `fetch` per call rather than at module load so test stubs and instrumentation apply.
  fetchOptions: { customFetchImpl: (input, init) => globalThis.fetch(input, init) },
});

export type AuthClient = typeof authClient;

/** Map a Better Auth / fetch error to a short user-facing message. */
export function authErrorMessage(
  err: { message?: string | undefined; code?: string | undefined } | null | undefined,
  fallback: string,
) {
  if (!err) return fallback;
  if (err.code === "INVALID_OTP") return "Enter valid OTP";
  if (err.code === "OTP_EXPIRED") return "This code has expired. Request a new one.";
  if (err.code === "TOO_MANY_ATTEMPTS") return "Too many attempts. Request a new code.";
  if (err.code === "INVALID_EMAIL_OR_PASSWORD" || err.code === "INVALID_PASSWORD") return "Invalid credentials.";
  if (err.code === "USER_ALREADY_EXISTS") return "An account with this email already exists.";
  return err.message && err.message.length < 140 ? err.message : fallback;
}

/** Only in-app absolute paths may be used as a post-login destination (open-redirect guard). */
export function safeNext(next: string | null | undefined, fallback = "/analyse"): string {
  if (!next) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
