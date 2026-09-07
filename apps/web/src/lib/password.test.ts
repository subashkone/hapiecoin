import { describe, expect, it } from "vitest";
import { EMAIL_RE, PASSWORD_RULES, emailError, isReferralInput, passwordStrength } from "./password";

describe("HC-PB-032 password rules", () => {
  it("lists the five rules in the mock's order", () => {
    expect(PASSWORD_RULES.map((r) => r.label)).toEqual([
      "Uppercase letter",
      "Lowercase letter",
      "Number",
      "Special character",
      "8+ characters",
    ]);
  });
  it("scores and tones: red ≤ 2, amber ≤ 4, green when all pass", () => {
    expect(passwordStrength("")).toMatchObject({ score: 0, tone: "loss", valid: false });
    expect(passwordStrength("ab")).toMatchObject({ score: 1, tone: "loss" });
    expect(passwordStrength("Ab1")).toMatchObject({ score: 3, tone: "warning" });
    expect(passwordStrength("Ab1!")).toMatchObject({ score: 4, tone: "warning", valid: false });
    expect(passwordStrength("Ab1!efgh")).toMatchObject({ score: 5, tone: "profit", valid: true });
    expect(passwordStrength("Ab1!efgh").passed).toEqual([true, true, true, true, true]);
  });
});

describe("HC-PB-026 email validation", () => {
  it("returns the mock's inline messages", () => {
    expect(emailError("")).toBe("Email is required");
    expect(emailError("   ")).toBe("Email is required");
    expect(emailError("nope")).toBe("Invalid email");
    expect(emailError("a@b.co")).toBeNull();
    expect(EMAIL_RE.test("x@y.z")).toBe(true);
  });
});

describe("HC-PB-031 referral pattern", () => {
  it("[GAPS-26] accepts the codes the API issues (REF + 7 base32, case-insensitive) and rejects the rest", () => {
    expect(isReferralInput("REFK7P2Q9X")).toBe(true);
    expect(isReferralInput("refk7p2q9x")).toBe(true);
    expect(isReferralInput(" REFDEMO001 ")).toBe(true);
    expect(isReferralInput("REF_ABC123")).toBe(false);
    expect(isReferralInput("REF")).toBe(false);
    expect(isReferralInput("REF-K7P2Q9X")).toBe(false);
  });
});
