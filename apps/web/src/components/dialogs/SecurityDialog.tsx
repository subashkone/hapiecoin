"use client";
// Security (roadmap item 28, ADR-078; HC-SH-129): the TOTP second factor through an authenticator app. Turning it on
// is three acts: the password, the key into the app (shown in groups of four with the otpauth link; no QR image,
// GAPS #94), the first code; then the backup codes, shown once. Turning it off asks for the password. With it on,
// the account signs in with password + code only (the email-OTP and Google paths are refused for it, ADR-078).
// Design: docs/design/live-confirm-2fa.md.
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, cn, toast } from "@hapiecoin/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { queryKeys, useMe } from "@/lib/api/queries";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { OtpInput, PasswordInput } from "@/components/auth/inputs";
import type { DialogProps } from "./SettingsDialogs";

type Step = "idle" | "password" | "key" | "codes" | "off";

/** "JBSWY3DPEHPK3PXP" → "JBSW Y3DP EHPK 3PXP" for manual entry. */
export function groupKey(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

/** The base32 key inside an otpauth URI, or the whole string when it is not a URI. */
export function keyOf(totpURI: string): string {
  try {
    return new URL(totpURI).searchParams.get("secret") ?? totpURI;
  } catch {
    return totpURI;
  }
}

async function copy(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied", { description: what });
  } catch {
    toast.error("Could not copy", { description: "Clipboard blocked by the browser" });
  }
}

export function SecurityDialog({ open, onOpenChange }: DialogProps) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const loaded = me !== undefined;
  const on = me?.twoFactorEnabled === true;
  const [step, setStep] = useState<Step>("idle");
  const [password, setPassword] = useState("");
  const [uri, setUri] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setStep("idle");
      setPassword("");
      setUri("");
      setCodes([]);
      setCode("");
      setError(null);
    }
  }, [open]);
  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.me });

  const begin = async () => {
    if (!password) {
      setError("Your password is needed to change sign-in security");
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error: err } = await authClient.twoFactor.enable({ password, issuer: "HapieCoin" });
    setBusy(false);
    if (err || !data || data.method !== "totp") {
      setError(authErrorMessage(err, "Could not start"));
      return;
    }
    setUri(data.totpURI);
    setCodes(data.backupCodes);
    setCode("");
    setStep("key");
  };
  const verifyFirst = async () => {
    if (code.length < 6) {
      setError("Enter the 6-digit code from the app");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.twoFactor.verifyTotp({ code, trustDevice: false });
    setBusy(false);
    if (err) {
      setError(authErrorMessage(err, "That code is not right"));
      return;
    }
    await refresh();
    setStep("codes");
    toast.success("Two-factor sign-in is on", { description: "From now on you sign in with your password and a code from the app" });
  };
  const disable = async () => {
    if (!password) {
      setError("Your password is needed to turn two-factor sign-in off");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.twoFactor.disable({ password });
    setBusy(false);
    if (err) {
      setError(authErrorMessage(err, "Could not turn it off"));
      return;
    }
    await refresh();
    toast("Two-factor sign-in is off", { description: "Email codes and Google sign-in work again for this account" });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="security-dialog" data-step={step}>
        <DialogHeader>
          <DialogTitle>Security</DialogTitle>
          <DialogDescription>Two-factor sign-in with an authenticator app (Google Authenticator, Aegis, 1Password …). With it on, this account signs in with the password and a code; email codes and Google sign-in are refused for it.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex items-center justify-between gap-3 rounded border border-border px-2 py-1.5 text-xs">
            <span>Two-factor sign-in</span>
            {loaded ? (
              <span className={cn("micro rounded border px-1", on ? "border-profit text-profit" : "border-border")} data-testid="security-status">
                {on ? "on" : "off"}
              </span>
            ) : (
              <span className="micro text-muted-foreground" data-testid="security-loading">
                checking…
              </span>
            )}
          </div>
          {step === "idle" && loaded && !on ? (
            <Button size="sm" className="mt-3" onClick={() => setStep("password")} data-testid="security-enable">
              Turn on
            </Button>
          ) : null}
          {step === "idle" && loaded && on ? (
            <Button size="sm" variant="outline" className="mt-3" onClick={() => setStep("off")} data-testid="security-disable">
              Turn off
            </Button>
          ) : null}
          {step === "password" || step === "off" ? (
            <div className="mt-3">
              <Field label={step === "off" ? "Your password, to turn it off" : "1 · Your password"}>
                <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" data-testid="security-password" />
              </Field>
            </div>
          ) : null}
          {step === "key" ? (
            <div className="mt-3 flex flex-col gap-2 text-xs">
              <div className="micro">2 · Add HapieCoin to your authenticator app with this key</div>
              <div className="flex items-center gap-2">
                <code className="num rounded bg-surface-2 px-2 py-1 font-mono text-[13px] tracking-[0.12em]" data-testid="security-secret">
                  {groupKey(keyOf(uri))}
                </code>
                <Button size="sm" variant="outline" onClick={() => void copy(keyOf(uri), "the key")} data-testid="security-copy-secret">
                  Copy
                </Button>
              </div>
              <a href={uri} className="micro underline" data-testid="security-uri">
                or open the link in an app on this device
              </a>
              <div className="micro mt-1">3 · Enter the first code the app shows</div>
              <OtpInput value={code} onChange={setCode} autoFocus name="security-first-code" />
            </div>
          ) : null}
          {step === "codes" ? (
            <div className="mt-3 text-xs">
              <div className="micro">Backup codes · shown once · each works once · keep them where you keep your passwords</div>
              <ul className="num mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-[12.5px]" data-testid="security-backup-codes">
                {codes.map((c) => (
                  <li key={c} data-testid="security-backup-code">
                    {c}
                  </li>
                ))}
              </ul>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => void copy(codes.join("\n"), `${codes.length} backup codes`)} data-testid="security-copy-codes">
                Copy all
              </Button>
            </div>
          ) : null}
          {error ? (
            <p className="mt-2 text-2xs text-loss" role="alert" data-testid="security-error">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          {step === "codes" ? (
            <Button onClick={() => onOpenChange(false)} data-testid="security-done">
              Done
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => (step === "idle" ? onOpenChange(false) : setStep("idle"))}>
                {step === "idle" ? "Close" : "Back"}
              </Button>
              {step === "password" ? (
                <Button onClick={() => void begin()} loading={busy} data-testid="security-password-next">
                  Next →
                </Button>
              ) : null}
              {step === "key" ? (
                <Button onClick={() => void verifyFirst()} loading={busy} data-testid="security-verify">
                  Verify and turn on
                </Button>
              ) : null}
              {step === "off" ? (
                <Button variant="destructive" onClick={() => void disable()} loading={busy} data-testid="security-disable-confirm">
                  Turn off
                </Button>
              ) : null}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
