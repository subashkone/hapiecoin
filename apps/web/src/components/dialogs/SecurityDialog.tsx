"use client";
// Security (roadmap item 28, ADR-078; HC-SH-129): the TOTP second factor through an authenticator app. Turning it on
// is three acts: the password, the key into the app (shown in groups of four with the otpauth link; no QR image,
// GAPS #94), the first code; then the backup codes, shown once. Turning it off asks for the password. With it on,
// the account signs in with password + code only (the email-OTP and Google paths are refused for it, ADR-078).
// Passkeys (GAPS #12, ADR-089; HC-SH-137): listed from the plugin, added with a name, renamed, removed; the client and
// its WebAuthn library load on first use. Design: docs/design/live-confirm-2fa.md.
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, cn, toast } from "@hapiecoin/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { queryKeys, useMe } from "@/lib/api/queries";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import type { PasskeyRow } from "@/lib/auth/passkey";
import { fmtDate } from "@/lib/format";
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

  // passkeys (ADR-089)
  const [passkeys, setPasskeys] = useState<PasskeyRow[] | null>(null);
  const [pkSupported, setPkSupported] = useState(true);
  const [pkName, setPkName] = useState("This device");
  const [pkBusy, setPkBusy] = useState<string | null>(null); // "add" or the passkey id being renamed / removed
  const [pkError, setPkError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const loadPasskeys = async () => {
    const { passkeyAuth, passkeysSupported } = await import("@/lib/auth/passkey");
    setPkSupported(passkeysSupported());
    const { data, error: err } = await passkeyAuth().passkey.listUserPasskeys();
    if (err) {
      setPkError(authErrorMessage(err, "Could not read your passkeys"));
      return;
    }
    setPasskeys((data ?? []) as PasskeyRow[]);
  };
  useEffect(() => {
    if (open) {
      setPasskeys(null);
      setPkError(null);
      setRenaming(null);
      setRemoving(null);
      setPkName("This device");
      setPkSupported(typeof window.PublicKeyCredential === "function"); // known before the client loads, so an unsupported browser never sees Add
      void loadPasskeys();
    }
  }, [open]);
  const addPasskey = async () => {
    setPkBusy("add");
    setPkError(null);
    try {
      const { passkeyAuth } = await import("@/lib/auth/passkey");
      const { error: err } = await passkeyAuth().passkey.addPasskey({ name: pkName.trim() || "This device" });
      if (err) {
        setPkError(authErrorMessage(err, "Could not add the passkey"));
        return;
      }
      toast.success("Passkey added", { description: "This device can sign you in without the password" });
      setPkName("This device");
      await loadPasskeys();
    } finally {
      setPkBusy(null);
    }
  };
  const renamePasskey = async () => {
    if (!renaming) return;
    const name = renaming.name.trim();
    if (!name) {
      setPkError("Give the passkey a name");
      return;
    }
    setPkBusy(renaming.id);
    setPkError(null);
    try {
      const { passkeyAuth } = await import("@/lib/auth/passkey");
      const { error: err } = await passkeyAuth().passkey.updatePasskey({ id: renaming.id, name });
      if (err) {
        setPkError(authErrorMessage(err, "Could not rename the passkey"));
        return;
      }
      setRenaming(null);
      await loadPasskeys();
    } finally {
      setPkBusy(null);
    }
  };
  const removePasskey = async (id: string) => {
    setPkBusy(id);
    setPkError(null);
    try {
      const { passkeyAuth } = await import("@/lib/auth/passkey");
      const { error: err } = await passkeyAuth().passkey.deletePasskey({ id });
      if (err) {
        setPkError(authErrorMessage(err, "Could not remove the passkey"));
        return;
      }
      setRemoving(null);
      toast("Passkey removed", { description: "That device signs in with the password again" });
      await loadPasskeys();
    } finally {
      setPkBusy(null);
    }
  };

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
          <DialogDescription>Two-factor sign-in with an authenticator app (Google Authenticator, Aegis, 1Password …), and passkeys for the devices you trust. With two-factor on, this account signs in with the password and a code; email codes, Google and passkey sign-in are refused for it.</DialogDescription>
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
          {step === "idle" ? (
            <div className="mt-4 rounded border border-border p-2 text-xs" data-testid="passkeys">
              <div className="flex items-center justify-between gap-2">
                <span>Passkeys</span>
                <span className="micro text-muted-foreground">Face ID · Touch ID · Windows Hello · a security key</span>
              </div>
              <p className="micro mt-1 text-muted-foreground">A passkey signs you in without the password on the device that holds it. It never signs in an account with two-factor on: the password and the code are asked instead.</p>
              {passkeys === null && !pkError ? (
                <div className="micro mt-2 text-muted-foreground" data-testid="passkey-loading">
                  reading…
                </div>
              ) : null}
              {passkeys && passkeys.length === 0 ? (
                <div className="micro mt-2 text-muted-foreground" data-testid="passkey-empty">
                  No passkey yet
                </div>
              ) : null}
              {passkeys?.map((p) => (
                <div key={p.id} className="mt-1 flex flex-wrap items-center gap-2 rounded border border-border px-2 py-1" data-testid="passkey-row" data-id={p.id}>
                  {renaming?.id === p.id ? (
                    <>
                      <Input size="sm" className="w-40" value={renaming.name} onChange={(e) => setRenaming({ id: p.id, name: e.target.value })} aria-label="Passkey name" data-testid="passkey-rename-input" />
                      <Button size="sm" onClick={() => void renamePasskey()} loading={pkBusy === p.id} data-testid="passkey-rename-save">
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="font-medium" data-testid="passkey-name">
                        {p.name || "Passkey"}
                      </span>
                      <span className="micro text-muted-foreground">added {fmtDate(typeof p.createdAt === "string" ? p.createdAt : p.createdAt.toISOString())}</span>
                      <span className="ml-auto flex items-center gap-1">
                        <Button size="sm" variant="ghost" onClick={() => { setRemoving(null); setRenaming({ id: p.id, name: p.name ?? "" }); }} aria-label={`Rename ${p.name || "passkey"}`} data-testid="passkey-rename">
                          Rename
                        </Button>
                        {removing === p.id ? (
                          <>
                            <Button size="sm" variant="destructive" onClick={() => void removePasskey(p.id)} loading={pkBusy === p.id} data-testid="passkey-delete-confirm">
                              Remove this passkey
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setRemoving(null)} data-testid="passkey-delete-cancel">
                              Keep it
                            </Button>
                          </>
                        ) : (
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setRemoving(p.id)} aria-label={`Remove ${p.name || "passkey"}`} data-testid="passkey-delete">
                            Remove
                          </Button>
                        )}
                      </span>
                    </>
                  )}
                </div>
              ))}
              {pkSupported ? (
                <div className="mt-2 flex items-center gap-2">
                  <Input size="sm" value={pkName} onChange={(e) => setPkName(e.target.value)} placeholder="Name this passkey" aria-label="New passkey name" data-testid="passkey-add-name" />
                  <Button size="sm" onClick={() => void addPasskey()} loading={pkBusy === "add"} data-testid="passkey-add">
                    Add a passkey
                  </Button>
                </div>
              ) : (
                <div className="micro mt-2 text-warning" data-testid="passkey-unsupported">
                  This browser cannot create passkeys; use a recent Chrome, Safari or Edge.
                </div>
              )}
              {pkError ? (
                <p className="mt-2 text-2xs text-loss" role="alert" data-testid="passkey-error">
                  {pkError}
                </p>
              ) : null}
            </div>
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
