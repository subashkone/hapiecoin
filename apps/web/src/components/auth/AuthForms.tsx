"use client";
// The seven /auth views (HC-PB-026, 028..036): copy and validation messages follow the v2 mock verbatim;
// the network calls are Better Auth email/password + email-OTP plugin routes.
import { Button, Field, Input, Mail, toast, KeyRound } from "@hapiecoin/ui";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { authClient, authErrorMessage } from "@/lib/auth/client";
import { emailError, isReferralInput, passwordStrength } from "@/lib/password";
import type { AuthTab } from "./AuthScreen";
import { OtpInput, PasswordInput, PasswordRules, ResendCountdown } from "./inputs";

export interface AuthFormsProps {
  tab: AuthTab;
  email: string;
  setEmail: (email: string) => void;
  referral: string;
  googleEnabled: boolean;
  next: string;
  go: (tab: AuthTab) => void;
  finish: () => void;
}

type Errors = Record<string, string | undefined>;

function DeltaMark() {
  return (
    <svg viewBox="0 0 16 16" className="size-4 text-primary" aria-hidden="true">
      <path d="M8 2.2 14.2 13.3H1.8z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function Providers({ googleEnabled, next, onSignedIn }: { googleEnabled: boolean; next: string; /** Sign-in tabs only: with it the passkey button is offered, without it (Create account) it is not. */ onSignedIn?: (() => void) | undefined }) {
  const [busy, setBusy] = useState(false);
  // ADR-089: the passkey button appears only where the browser can answer a WebAuthn prompt (read after mount, never on the server)
  const [passkeys, setPasskeys] = useState(false);
  const [pkBusy, setPkBusy] = useState(false);
  useEffect(() => {
    setPasskeys(onSignedIn !== undefined && typeof window.PublicKeyCredential === "function" && typeof navigator.credentials?.get === "function");
  }, [onSignedIn]);
  const signInWithPasskey = async () => {
    setPkBusy(true);
    try {
      const { passkeyAuth } = await import("@/lib/auth/passkey");
      const { error } = await passkeyAuth().signIn.passkey();
      if (error) {
        toast.error("Passkey sign-in failed", { description: authErrorMessage(error, "The passkey was not accepted") });
        return;
      }
      toast.success("Welcome back!", { description: "Signed in with your passkey." });
      authClient.$store.notify("$sessionSignal"); // the main client's useSession learns of the cookie the passkey client set
      onSignedIn?.();
    } finally {
      setPkBusy(false);
    }
  };
  return (
    <div className="mb-5">
      {passkeys ? (
        <Button variant="outline" className="mb-2 w-full" size="lg" loading={pkBusy} onClick={() => void signInWithPasskey()} data-testid="continue-passkey">
          <KeyRound aria-hidden="true" />
          Sign in with a passkey
        </Button>
      ) : null}
      <Button asChild variant="outline" className="w-full" size="lg">
        <Link href="/auth/delta" data-testid="continue-delta">
          <DeltaMark />
          Continue with Delta Exchange
        </Link>
      </Button>
      {googleEnabled ? (
        <Button
          variant="outline"
          className="mt-2 w-full"
          size="lg"
          loading={busy}
          data-testid="continue-google"
          onClick={() => {
            setBusy(true);
            void authClient.signIn
              .social({ provider: "google", callbackURL: next && next.startsWith("/") ? next : "/analyse", errorCallbackURL: "/auth?tab=login" })
              .finally(() => setBusy(false));
          }}
        >
          Continue with Google
        </Button>
      ) : null}
      <div className="my-4 flex items-center gap-3 font-mono text-3xs uppercase tracking-[0.12em] text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}

function Title({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-2xl">{title}</h2>
      <p className="mt-1 text-muted-foreground">{desc}</p>
    </div>
  );
}

function LinkButton({ onClick, children, testId }: { onClick: () => void; children: React.ReactNode; testId?: string }) {
  return (
    <button type="button" onClick={onClick} data-testid={testId} className="text-[13px] text-primary hover:underline">
      {children}
    </button>
  );
}

export function AuthForms(props: AuthFormsProps) {
  const { tab } = props;
  switch (tab) {
    case "login":
      return <LoginForm {...props} />;
    case "otp-login":
      return <OtpLoginForm {...props} />;
    case "otp-verify":
      return <OtpVerifyForm {...props} />;
    case "signup":
      return <SignupForm {...props} />;
    case "verify-email":
      return <VerifyEmailForm {...props} />;
    case "forgot":
      return <ForgotForm {...props} />;
    case "reset-password":
      return <ResetPasswordForm {...props} />;
    case "totp":
      return <TotpForm {...props} />;
  }
}

/* ---------------- login ---------------- */
function LoginForm({ email, setEmail, googleEnabled, next, go, finish }: AuthFormsProps) {
  const [values, setValues] = useState({ email, password: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  // ADR-078: a social sign-in the server refused (a 2FA account through Google) comes back here with the reason in the URL
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("error");
    if (!code) return;
    setNotice(params.get("error_description") || (code === "TWO_FACTOR_REQUIRED" ? "This account uses an authenticator app: sign in with your password and the code" : "Sign-in did not go through. Try again."));
    params.delete("error");
    params.delete("error_description");
    const rest = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Errors = {};
    const ee = emailError(values.email);
    if (ee) errs["email"] = ee;
    if (!values.password) errs["password"] = "Password is required";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const { data, error } = await authClient.signIn.email({ email: values.email.trim(), password: values.password });
    setBusy(false);
    if (error) {
      const msg = authErrorMessage(error, "Invalid credentials.");
      setErrors({ password: msg });
      toast.error("Login failed", { description: msg });
      return;
    }
    setEmail(values.email.trim());
    // HC-PB-068 (ADR-078): an account with an authenticator app has no session yet; the code step finishes the sign-in
    if ((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
      go("totp");
      return;
    }
    toast.success("Welcome back!", { description: "Logged in successfully." });
    finish();
  };

  return (
    <div data-testid="auth-login">
      <Title title="Welcome back" desc="Sign in to your trading dashboard" />
      <Providers googleEnabled={googleEnabled} next={next} onSignedIn={finish} />
      {notice ? (
        <p className="mb-3 rounded border border-loss/40 px-2 py-1.5 text-xs text-loss" role="alert" data-testid="login-notice">
          {notice}
        </p>
      ) : null}
      <form onSubmit={(e) => void submit(e)} noValidate>
        <Field label="Email" error={errors["email"]}>
          <Input
            type="email"
            name="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={values.email}
            onChange={(e) => setValues({ ...values, email: e.target.value })}
            autoFocus
          />
        </Field>
        <Field label="Password" error={errors["password"]}>
          <PasswordInput
            name="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={values.password}
            onChange={(e) => setValues({ ...values, password: e.target.value })}
          />
        </Field>
        <Button type="submit" className="mt-2 w-full" size="lg" loading={busy}>
          Sign In
        </Button>
        <div className="mt-4 flex items-center justify-between">
          <LinkButton onClick={() => go("forgot")} testId="go-forgot">
            Forgot password?
          </LinkButton>
          <LinkButton onClick={() => go("otp-login")} testId="go-otp-login">
            <span className="inline-flex items-center gap-1">
              <Mail className="size-3.5" aria-hidden="true" /> Sign in with OTP
            </span>
          </LinkButton>
        </div>
      </form>
      <p className="mt-6 text-center text-[13px] text-muted-foreground">
        Don&apos;t have an account?{" "}
        <LinkButton onClick={() => go("signup")} testId="go-signup">
          Create account
        </LinkButton>
      </p>
    </div>
  );
}

/* ---------------- OTP login ---------------- */
function OtpLoginForm({ email, setEmail, go }: AuthFormsProps) {
  const [value, setValue] = useState(email);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ee = emailError(value);
    setError(ee ?? undefined);
    if (ee) return;
    setBusy(true);
    const { error: err } = await authClient.emailOtp.sendVerificationOtp({ email: value.trim(), type: "sign-in" });
    setBusy(false);
    if (err) {
      toast.error("Could not send OTP", { description: authErrorMessage(err, "Please try again.") });
      return;
    }
    setEmail(value.trim());
    toast("OTP Sent", { description: "Check your email for the OTP." });
    go("otp-verify");
  };
  return (
    <div data-testid="auth-otp-login">
      <Title title="Sign in with OTP" desc="We'll send a one-time code to your registered email" />
      <form onSubmit={(e) => void submit(e)} noValidate>
        <Field label="Email" error={error}>
          <Input type="email" name="email" autoComplete="email" placeholder="you@example.com" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        </Field>
        <Button type="submit" className="mt-2 w-full" size="lg" loading={busy}>
          Send OTP
        </Button>
      </form>
      <p className="mt-6 text-center text-[13px] text-muted-foreground">
        New here?{" "}
        <LinkButton onClick={() => go("signup")}>Create an account first</LinkButton>
      </p>
      <div className="mt-4 text-center">
        <LinkButton onClick={() => go("login")} testId="back-login">
          ← Back to login
        </LinkButton>
      </div>
    </div>
  );
}

/* ---------------- OTP verify (login) ---------------- */
function OtpVerifyForm({ email, go, finish }: AuthFormsProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (code.length < 6) {
      setError("Enter valid OTP");
      toast.error("Error", { description: "Enter valid OTP" });
      return;
    }
    setBusy(true);
    const { error: err } = await authClient.signIn.emailOtp({ email, otp: code });
    setBusy(false);
    if (err) {
      const msg = authErrorMessage(err, "Enter valid OTP");
      setError(msg);
      toast.error("Error", { description: msg });
      return;
    }
    toast.success("Welcome!", { description: "Logged in successfully" });
    finish();
  };
  const resend = async () => {
    const { error: err } = await authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
    if (err) toast.error("Could not resend", { description: authErrorMessage(err, "Please try again.") });
    else {
      toast("OTP Resent", { description: "A new OTP has been sent to your email." });
      setResetKey((k) => k + 1);
    }
  };
  return (
    <div data-testid="auth-otp-verify">
      <Title title="Enter OTP" desc={`Code sent to ${email}`} />
      <form onSubmit={(e) => void submit(e)} noValidate>
        <Field label="OTP Code" error={error}>
          {() => <OtpInput value={code} onChange={(c) => { setCode(c); setError(undefined); }} invalid={!!error} />}
        </Field>
        <Button type="submit" className="mt-2 w-full" size="lg" loading={busy}>
          Verify &amp; Login
        </Button>
      </form>
      <div className="mt-5 text-center">
        <ResendCountdown prefix="Resend OTP in " linkText="Resend OTP" onResend={resend} resetKey={resetKey} />
      </div>
      <div className="mt-4 text-center">
        <LinkButton onClick={() => go("otp-login")}>← Change email</LinkButton>
      </div>
    </div>
  );
}

/* ---------------- sign up ---------------- */
function SignupForm({ setEmail, referral, googleEnabled, next, go }: AuthFormsProps) {
  const [v, setV] = useState({ name: "", email: "", mobile: "", password: "", confirm: "", ref: referral });
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Errors = {};
    if (!v.name.trim()) errs["name"] = "Full name is required";
    const ee = emailError(v.email);
    if (ee) errs["email"] = ee;
    const mobile = v.mobile.replace(/\D/g, "").slice(-10);
    if (mobile.length < 10) errs["mobile"] = "Enter a valid mobile number";
    if (!passwordStrength(v.password).valid) errs["password"] = "Password does not meet all the requirements";
    if (!v.confirm || v.confirm !== v.password) errs["confirm"] = "Passwords do not match";
    if (v.ref.trim() && !isReferralInput(v.ref)) errs["ref"] = "Referral code looks invalid (10 characters, like REFK7P2Q9X)";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const email = v.email.trim();
    // `ref` is the inviter's code; the API stores it as referredBy and generates the new user's own code.
    const body: Record<string, string> = { name: v.name.trim(), email, password: v.password, mobile };
    if (v.ref.trim()) body["ref"] = v.ref.trim().toUpperCase();
    const res = await authClient.$fetch("/sign-up/email", { method: "POST", body });
    if (res.error) {
      setBusy(false);
      const err = res.error as { message?: string | undefined; code?: string | undefined };
      const msg = authErrorMessage(err, "Could not create your account.");
      toast.error("Sign up failed", { description: msg });
      if (err.code === "USER_ALREADY_EXISTS") setErrors({ email: msg });
      return;
    }
    // The API sends the verification OTP on sign-up (emailOTP sendVerificationOnSignUp); Resend covers retries.
    setBusy(false);
    setEmail(email);
    toast.success("Account created!", { description: "Please verify your email with the OTP sent." });
    go("verify-email");
  };

  return (
    <div data-testid="auth-signup">
      <Title title="Create account" desc="Start your options trading journey" />
      <Providers googleEnabled={googleEnabled} next={next} />
      <form onSubmit={(e) => void submit(e)} noValidate>
        <Field label="Full Name" error={errors["name"]}>
          <Input name="name" autoComplete="name" placeholder="John Doe" value={v.name} onChange={set("name")} autoFocus />
        </Field>
        <Field label="Email" error={errors["email"]}>
          <Input type="email" name="email" autoComplete="email" placeholder="you@example.com" value={v.email} onChange={set("email")} />
        </Field>
        <Field label="Mobile Number" error={errors["mobile"]}>
          <Input type="tel" name="mobile" inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210" className="font-mono" value={v.mobile} onChange={set("mobile")} />
        </Field>
        <Field label="Password" error={errors["password"]}>
          {(control) => (
            <>
              <PasswordInput {...control} name="password" autoComplete="new-password" placeholder="••••••••" value={v.password} onChange={set("password")} />
              <PasswordRules password={v.password} />
            </>
          )}
        </Field>
        <Field label="Confirm" error={errors["confirm"]}>
          <PasswordInput name="confirm" autoComplete="new-password" placeholder="••••••••" value={v.confirm} onChange={set("confirm")} />
        </Field>
        <Field label="Referral Code (Optional)" error={errors["ref"]}>
          <Input name="ref" placeholder="REFK7P2Q9X" className="font-mono" value={v.ref} onChange={set("ref")} />
        </Field>
        <Button type="submit" className="mt-2 w-full" size="lg" loading={busy}>
          Create Account
        </Button>
      </form>
      <p className="mt-6 text-center text-[13px] text-muted-foreground">
        Already have an account?{" "}
        <LinkButton onClick={() => go("login")} testId="go-login">
          Sign in
        </LinkButton>
      </p>
    </div>
  );
}

/* ---------------- verify email ---------------- */
function VerifyEmailForm({ email, go, finish }: AuthFormsProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (code.length < 6) {
      setError("Please enter the complete 6-digit OTP");
      toast.error("Verification failed", { description: "Please enter the complete 6-digit OTP" });
      return;
    }
    setBusy(true);
    const { error: err } = await authClient.emailOtp.verifyEmail({ email, otp: code });
    if (err) {
      setBusy(false);
      const msg = authErrorMessage(err, "Please enter the complete 6-digit OTP");
      setError(msg);
      toast.error("Verification failed", { description: msg });
      return;
    }
    toast.success("Email verified!", { description: "You can now sign in." });
    // The API signs the user in after verification when configured to; otherwise fall back to the login tab.
    const session = await authClient.getSession();
    setBusy(false);
    if (session.data?.user) finish();
    else go("login");
  };
  const resend = async () => {
    const { error: err } = await authClient.emailOtp.sendVerificationOtp({ email, type: "email-verification" });
    if (err) toast.error("Could not resend", { description: authErrorMessage(err, "Please try again.") });
    else {
      toast("OTP resent", { description: "A new OTP has been sent to your email." });
      setResetKey((k) => k + 1);
    }
  };
  return (
    <div data-testid="auth-verify-email">
      <Title title="Verify your email" desc={`We've sent a 6-digit OTP to ${email}`} />
      <form onSubmit={(e) => void submit(e)} noValidate>
        <Field label="OTP Code" error={error}>
          {() => <OtpInput value={code} onChange={(c) => { setCode(c); setError(undefined); }} invalid={!!error} />}
        </Field>
        <Button type="submit" className="mt-2 w-full" size="lg" loading={busy}>
          Verify Email
        </Button>
      </form>
      <p className="mt-5 text-center text-[13px] text-muted-foreground">
        Didn&apos;t receive the code?{" "}
        <ResendCountdown prefix="Resend in " linkText="Resend OTP" onResend={resend} resetKey={resetKey} />
      </p>
      <div className="mt-4 text-center">
        <LinkButton onClick={() => go("signup")}>← Back to sign up</LinkButton>
      </div>
    </div>
  );
}

/* ---------------- forgot ---------------- */
function ForgotForm({ email, setEmail, go }: AuthFormsProps) {
  const [value, setValue] = useState(email);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ee = emailError(value);
    setError(ee ?? undefined);
    if (ee) return;
    setBusy(true);
    const { error: err } = await authClient.emailOtp.sendVerificationOtp({ email: value.trim(), type: "forget-password" });
    setBusy(false);
    if (err) {
      toast.error("Could not send OTP", { description: authErrorMessage(err, "Please try again.") });
      return;
    }
    setEmail(value.trim());
    toast("OTP sent!", { description: "Check your email for the OTP." });
    go("reset-password");
  };
  return (
    <div data-testid="auth-forgot">
      <Title title="Reset password" desc="Enter your email and we'll send you an OTP" />
      <form onSubmit={(e) => void submit(e)} noValidate>
        <Field label="Email Address" error={error}>
          <Input type="email" name="email" autoComplete="email" placeholder="you@example.com" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        </Field>
        <Button type="submit" className="mt-2 w-full" size="lg" loading={busy}>
          Send OTP
        </Button>
      </form>
      <div className="mt-5 text-center">
        <LinkButton onClick={() => go("login")} testId="back-login">
          ← Back to sign in
        </LinkButton>
      </div>
    </div>
  );
}

/* ---------------- reset password ---------------- */
function ResetPasswordForm({ email, go }: AuthFormsProps) {
  const [v, setV] = useState({ otp: "", password: "", confirm: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Errors = {};
    if (v.otp.length < 6) errs["otp"] = "Please enter the complete 6-digit OTP";
    if (!passwordStrength(v.password).valid) errs["password"] = "Password does not meet all the requirements";
    if (!v.confirm || v.confirm !== v.password) errs["confirm"] = "Passwords do not match";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const { error: err } = await authClient.emailOtp.resetPassword({ email, otp: v.otp, password: v.password });
    setBusy(false);
    if (err) {
      const msg = authErrorMessage(err, "Could not reset your password.");
      setErrors({ otp: msg });
      toast.error("Reset failed", { description: msg });
      return;
    }
    toast.success("Password reset!", { description: "You can now sign in with your new password." });
    go("login");
  };
  const resend = async () => {
    const { error: err } = await authClient.emailOtp.sendVerificationOtp({ email, type: "forget-password" });
    if (err) toast.error("Could not resend", { description: authErrorMessage(err, "Please try again.") });
    else {
      toast("OTP resent", { description: "A new OTP has been sent." });
      setResetKey((k) => k + 1);
    }
  };
  return (
    <div data-testid="auth-reset-password">
      <Title title="Set new password" desc={`Enter the OTP sent to ${email} and your new password`} />
      <form onSubmit={(e) => void submit(e)} noValidate>
        <Field label="OTP" error={errors["otp"]}>
          <Input
            name="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="Enter 6-digit code"
            className="font-mono"
            value={v.otp}
            onChange={(e) => setV({ ...v, otp: e.target.value.replace(/\D/g, "").slice(0, 6) })}
            autoFocus
          />
        </Field>
        <Field label="New Password" error={errors["password"]}>
          {(control) => (
            <>
              <PasswordInput {...control} name="password" autoComplete="new-password" placeholder="••••••••" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} />
              <PasswordRules password={v.password} />
            </>
          )}
        </Field>
        <Field label="Confirm Password" error={errors["confirm"]}>
          <PasswordInput name="confirm" autoComplete="new-password" placeholder="••••••••" value={v.confirm} onChange={(e) => setV({ ...v, confirm: e.target.value })} />
        </Field>
        <Button type="submit" className="mt-2 w-full" size="lg" loading={busy}>
          Reset Password
        </Button>
      </form>
      <p className="mt-5 text-center text-[13px] text-muted-foreground">
        Didn&apos;t receive the code?{" "}
        <ResendCountdown prefix="Resend in " linkText="Resend OTP" onResend={resend} resetKey={resetKey} />
      </p>
      <div className="mt-4 text-center">
        <LinkButton onClick={() => go("forgot")}>← Back</LinkButton>
      </div>
    </div>
  );
}

/** The second factor after a password sign-in (HC-PB-068, ADR-078): the 6-digit code from the authenticator app, or a backup code. */
function TotpForm({ email, go, finish }: AuthFormsProps) {
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!backup && trimmed.length < 6) {
      setError("Enter the 6-digit code from your authenticator app");
      return;
    }
    if (backup && trimmed.length < 6) {
      setError("Enter one of your backup codes");
      return;
    }
    setBusy(true);
    setError(undefined);
    const { error: err } = backup ? await authClient.twoFactor.verifyBackupCode({ code: trimmed }) : await authClient.twoFactor.verifyTotp({ code: trimmed, trustDevice: false });
    setBusy(false);
    if (err) {
      const msg = authErrorMessage(err, backup ? "That backup code is not right, or it was used already." : "That code is not right.");
      setError(msg);
      toast.error("Could not sign in", { description: msg });
      return;
    }
    toast.success("Welcome back!", { description: "Signed in with your authenticator." });
    finish();
  };
  return (
    <div data-testid="auth-totp">
      <h2 className="text-2xl">Two-factor code</h2>
      <p className="mt-1 text-sm text-muted-foreground">{backup ? "Enter one of the backup codes you saved when you turned two-factor sign-in on." : `Enter the 6-digit code your authenticator app shows for HapieCoin${email ? ` (${email})` : ""}.`}</p>
      <form onSubmit={(e) => void submit(e)} className="mt-6 flex flex-col gap-4" noValidate>
        {backup ? (
          <Field label="Backup code" error={error}>
            <Input value={code} onChange={(e) => setCode(e.target.value)} autoFocus autoComplete="off" spellCheck={false} className="font-mono" data-testid="totp-backup" />
          </Field>
        ) : (
          <div>
            <OtpInput value={code} onChange={setCode} invalid={Boolean(error)} autoFocus name="totp" />
            {error ? (
              <p className="mt-1 text-xs text-loss" role="alert" data-testid="totp-error">
                {error}
              </p>
            ) : null}
          </div>
        )}
        <Button type="submit" loading={busy} className="w-full" data-testid="totp-verify">
          Verify →
        </Button>
      </form>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <button type="button" onClick={() => { setBackup((b) => !b); setCode(""); setError(undefined); }} className="text-primary hover:underline" data-testid="totp-toggle-backup">
          {backup ? "Use the authenticator app instead" : "Use a backup code instead"}
        </button>
        <button type="button" onClick={() => go("login")} className="text-muted-foreground hover:underline" data-testid="totp-back">
          Back to sign in
        </button>
      </div>
    </div>
  );
}
