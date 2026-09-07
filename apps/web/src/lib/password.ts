// Live password rules (HC-PB-032): the same five checks as the mock, in the same order.
import { ReferralCode } from "@hapiecoin/schema";

export interface PasswordRule {
  id: "upper" | "lower" | "number" | "special" | "length";
  label: string;
  test: (password: string) => boolean;
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
  { id: "upper", label: "Uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { id: "lower", label: "Lowercase letter", test: (p) => /[a-z]/.test(p) },
  { id: "number", label: "Number", test: (p) => /\d/.test(p) },
  { id: "special", label: "Special character", test: (p) => /[^A-Za-z0-9]/.test(p) },
  { id: "length", label: "8+ characters", test: (p) => p.length >= 8 },
];

export interface PasswordStrength {
  /** Which rules pass, in PASSWORD_RULES order. */
  passed: boolean[];
  /** Count of passing rules, 0..5. */
  score: number;
  /** Bar colour tone: red ≤ 2, amber ≤ 4, green when all pass. */
  tone: "loss" | "warning" | "profit";
  /** True when every rule passes. */
  valid: boolean;
}

export function passwordStrength(password: string): PasswordStrength {
  const passed = PASSWORD_RULES.map((r) => r.test(password));
  const score = passed.filter(Boolean).length;
  const tone = score <= 2 ? "loss" : score <= 4 ? "warning" : "profit";
  return { passed, score, tone, valid: score === PASSWORD_RULES.length };
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns the inline error for an email field, or null when valid ("Email is required" / "Invalid email"). */
export function emailError(value: string): string | null {
  const v = value.trim();
  if (!v) return "Email is required";
  if (!EMAIL_RE.test(v)) return "Invalid email";
  return null;
}

/**
 * Referral codes typed on sign-up: the same shape the API issues (`ReferralCode`, e.g. REFK7P2Q9X),
 * case-insensitive because people type them by hand; empty is fine (GAPS #26).
 */
export function isReferralInput(value: string): boolean {
  return ReferralCode.safeParse(value.trim().toUpperCase()).success;
}
