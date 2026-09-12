// A fresh authenticator code on a sensitive change (ADR-086, HC-SH-136): the routes read it from a header, so the
// bodies stay what the schemas say; a refusal comes back as one of three codes.
import { ApiError } from "./client";

export const SECOND_FACTOR_HEADER = "X-Second-Factor";
export const SECOND_FACTOR_CODES = new Set(["SECOND_FACTOR_REQUIRED", "SECOND_FACTOR_INVALID", "SECOND_FACTOR_LOCKED"]);

/** Request headers carrying the code, or none when the account has no authenticator (an empty code sends nothing). */
export function secondFactorHeaders(code: string | undefined): Record<string, string> | undefined {
  const c = code?.trim() ?? "";
  return c ? { [SECOND_FACTOR_HEADER]: c } : undefined;
}

/** The server refused for want of a (right) code. */
export function isSecondFactorError(e: unknown): e is ApiError {
  return e instanceof ApiError && SECOND_FACTOR_CODES.has(e.code);
}
