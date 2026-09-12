"use client";
// Auth form primitives: password field with eye toggle (HC-PB-027), live rules + strength bar (HC-PB-032,
// HC-PB-062), 6-box OTP input (HC-PB-030) and the 30 s resend countdown.
import { Button, Eye, EyeOff, Input, cn, type InputProps } from "@hapiecoin/ui";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { PASSWORD_RULES, passwordStrength } from "@/lib/password";

export function PasswordInput({ className, ...props }: Omit<InputProps, "type">) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input type={show ? "text" : "password"} className={cn("pr-9", className)} {...props} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        className="absolute right-1 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground hover:text-foreground"
      >
        {show ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
      </button>
    </div>
  );
}

export function PasswordRules({ password }: { password: string }) {
  const s = passwordStrength(password);
  const barTone = s.tone === "profit" ? "bg-profit" : s.tone === "warning" ? "bg-warning" : "bg-loss";
  return (
    <div className="mt-2" data-testid="password-rules" data-valid={s.valid}>
      <div className="h-1 w-full overflow-hidden rounded bg-muted" aria-hidden="true">
        <i
          data-testid="strength-bar"
          data-tone={s.tone}
          className={cn("block h-full transition-[width]", barTone)}
          style={{ width: `${(s.score / PASSWORD_RULES.length) * 100}%` }}
        />
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-3xs">
        {PASSWORD_RULES.map((r, i) => (
          <li
            key={r.id}
            data-rule={r.id}
            data-ok={s.passed[i]}
            className={s.passed[i] ? "text-profit" : "text-muted-foreground"}
          >
            ✓ {r.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface OtpInputProps {
  value: string;
  onChange: (code: string) => void;
  length?: number;
  invalid?: boolean;
  autoFocus?: boolean;
  name?: string;
}

/** Six DM Mono boxes: auto-advance, backspace moves back, paste fills all. */
export function OtpInput({ value, onChange, length = 6, invalid = false, autoFocus = true, name = "otp" }: OtpInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? "");

  const focus = useCallback((i: number) => refs.current[Math.max(0, Math.min(length - 1, i))]?.focus(), [length]);

  useEffect(() => {
    if (autoFocus) focus(0);
  }, [autoFocus, focus]);

  // The value is the typed digits in order with no gaps: a digit typed over a filled box replaces it, a box past the
  // typed digits appends, and Backspace clears from that box on. (Clearing one middle box used to shift the rest left,
  // and a box's one-character limit refused a digit typed over a filled box unless it was selected.)
  const write = (i: number, ch: string) => {
    const pos = Math.min(i, value.length);
    onChange(value.slice(0, pos) + ch + value.slice(pos + 1));
    focus(pos + 1);
  };

  const onInput = (i: number, raw: string) => {
    const ch = raw.replace(/\D/g, "").slice(-1);
    if (ch) write(i, ch);
  };

  const onKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const pos = digits[i] ? i : i - 1;
      if (pos < 0) return;
      onChange(value.slice(0, pos));
      focus(pos);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focus(i - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focus(i + 1);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!text) return;
    e.preventDefault();
    onChange(text.padEnd(0));
    focus(Math.min(text.length, length - 1));
  };

  return (
    <div className="flex gap-2" data-testid="otp-input" role="group" aria-label="OTP Code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          name={i === 0 ? name : undefined}
          value={d}
          onChange={(e) => onInput(i, e.target.value)}
          onKeyDown={(e) => onKeyDown(i, e)}
          onPaste={onPaste}
          onFocus={(e) => e.target.select()}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${i + 1}`}
          aria-invalid={invalid || undefined}
          className={cn(
            "num h-11 w-10 rounded border border-input bg-background text-center text-lg outline-none",
            "focus:border-ring focus:ring-2 focus:ring-ring/22",
            invalid && "border-destructive",
          )}
        />
      ))}
    </div>
  );
}

export interface ResendCountdownProps {
  /** Text before the seconds, e.g. "Resend OTP in " or "Resend in ". */
  prefix: string;
  linkText: string;
  onResend: () => void | Promise<void>;
  seconds?: number;
  /** Bump to restart the countdown (e.g. after a successful resend). */
  resetKey?: number;
}

export function ResendCountdown({ prefix, linkText, onResend, seconds = 30, resetKey = 0 }: ResendCountdownProps) {
  const [left, setLeft] = useState(seconds);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setLeft(seconds);
    const id = setInterval(() => setLeft((n) => (n > 0 ? n - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [seconds, resetKey]);
  if (left > 0) {
    return (
      <span className="font-mono text-xs text-muted-foreground" data-testid="resend-countdown">
        {prefix}
        {left}s
      </span>
    );
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      loading={busy}
      data-testid="resend-otp"
      onClick={() => {
        setBusy(true);
        void Promise.resolve(onResend())
          .then(() => setLeft(seconds))
          .finally(() => setBusy(false));
      }}
    >
      {linkText}
    </Button>
  );
}
