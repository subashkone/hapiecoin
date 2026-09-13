"use client";
// The authenticator code asked before a sensitive change on an account with 2FA on (ADR-086, HC-SH-136): the same
// six boxes as sign-in, one sentence on why, and the server's refusal under it.
import { Field } from "@hapiecoin/ui";
import { OtpInput } from "@/components/auth/inputs";

export const SECOND_FACTOR_LEN = 6;

export function SecondFactorField({ value, onChange, error, name = "second-factor", what = "this change" }: { value: string; onChange: (v: string) => void; error?: string | null | undefined; name?: string; what?: string }) {
  return (
    <div className="mt-3 rounded border border-border bg-muted/30 p-2" data-testid="second-factor">
      <Field label="Authenticator code" hint={`Two-factor sign-in is on for this account: confirm ${what} with the code your app shows now`} error={error ? <span data-testid="second-factor-error">{error}</span> : undefined}>
        <OtpInput value={value} onChange={(v) => onChange(v.replace(/\D/g, "").slice(0, SECOND_FACTOR_LEN))} length={SECOND_FACTOR_LEN} invalid={Boolean(error)} autoFocus={false} name={name} />
      </Field>
    </div>
  );
}

/** True when a code is needed and not yet complete. */
export function secondFactorMissing(needed: boolean, code: string): boolean {
  return needed && code.trim().length < SECOND_FACTOR_LEN;
}

export const SECOND_FACTOR_MISSING_MESSAGE = "Enter the 6-digit code from your authenticator app first";
