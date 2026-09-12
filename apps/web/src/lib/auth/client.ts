// Better Auth browser client. Same-origin: Next rewrites /api/auth/* to apps/api, so the session cookie
// is first-party. Email OTP flows come from the email-otp plugin (sign-in, email-verification, forget-password).
import { createAuthClient } from "better-auth/react";
import { emailOTPClient, twoFactorClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  // ADR-078: the TOTP second factor; the forms read `twoFactorRedirect` themselves and move to the code step
  plugins: [emailOTPClient(), twoFactorClient()],
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
  if (err.code === "INVALID_CODE") return "That code is not right.";
  if (err.code === "INVALID_BACKUP_CODE") return "That backup code is not right, or it was used already.";
  if (err.code === "INVALID_TWO_FACTOR_COOKIE") return "The sign-in timed out. Start again with your password.";
  // passkeys (ADR-089)
  if (err.code === "TWO_FACTOR_REQUIRED") return "This account uses an authenticator app: sign in with your password and the code.";
  if (err.code === "AUTH_CANCELLED" || err.code === "ERROR_CEREMONY_ABORTED") return "The passkey prompt was closed. Try again, or sign in another way.";
  if (err.code === "PASSKEY_NOT_FOUND") return "No passkey for HapieCoin on this device. Sign in another way and add one in Security.";
  if (err.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") return "This device already holds a passkey for HapieCoin.";
  if (err.code === "SESSION_NOT_FRESH") return "Sign in again to add a passkey: it can be added within a day of signing in.";
  return err.message && err.message.length < 140 ? err.message : fallback;
}

/** Only in-app absolute paths may be used as a post-login destination (open-redirect guard). */
export function safeNext(next: string | null | undefined, fallback = "/analyse"): string {
  if (!next) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
