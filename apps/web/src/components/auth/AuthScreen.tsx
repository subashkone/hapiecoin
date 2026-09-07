"use client";
// Split auth layout (HC-PB-023): brand column (eyebrow, headline with amber word, feature rows, live futures
// ticker HC-PB-061, copyright) + the form card. Tab changes navigate to ?tab=… preserving next= and ref=
// (HC-PB-024) so browser back/forward moves between steps.
import { cn } from "@hapiecoin/ui";
import { UNDERLYINGS, type Underlying } from "@hapiecoin/schema";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AUTH_FEATURES } from "@/content/landing";
import { fmtPct, fmtPrice } from "@/lib/format";
import { useSpot } from "@/lib/gateway/hooks";
import { Logo } from "@/components/shell/Logo";
import { AuthForms } from "./AuthForms";

export type AuthTab = "login" | "otp-login" | "otp-verify" | "signup" | "verify-email" | "forgot" | "reset-password";

/** Sub-steps that need an email fall back to their parent on a cold visit. */
export const PARENT_TAB: Partial<Record<AuthTab, AuthTab>> = {
  "otp-verify": "otp-login",
  "verify-email": "signup",
  "reset-password": "forgot",
};

export function authHref(tab: AuthTab, next: string, ref: string): string {
  const parts = [`tab=${tab}`];
  if (next) parts.push(`next=${encodeURIComponent(next)}`);
  if (ref) parts.push(`ref=${encodeURIComponent(ref)}`);
  return `/auth?${parts.join("&")}`;
}

const EMAIL_KEY = "hapiecoin.auth.email";

function TickerItem({ asset }: { asset: Underlying }) {
  const spot = useSpot(asset);
  const c = spot?.c24;
  return (
    <span className="inline-flex items-baseline gap-1.5 font-mono text-xs" data-testid={`ticker-${asset}`}>
      <span className="text-muted-foreground">{asset}</span>
      <b className="font-medium">{spot ? fmtPrice(spot.price) : "—"}</b>
      <em className={cn("not-italic", c === undefined ? "text-muted-foreground" : c >= 0 ? "text-profit" : "text-loss")}>
        {fmtPct(c)}
      </em>
    </span>
  );
}

export interface AuthScreenProps {
  tab: AuthTab;
  next: string;
  referral: string;
  googleEnabled: boolean;
}

export function AuthScreen({ tab: requestedTab, next, referral, googleEnabled }: AuthScreenProps) {
  const router = useRouter();
  // Email that the current sub-step refers to; survives client navigations and (via sessionStorage) reloads.
  const [email, setEmailState] = useState<string>("");
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const v = window.sessionStorage.getItem(EMAIL_KEY);
      if (v) setEmailState(v);
    } catch {
      /* storage unavailable */
    }
    setHydrated(true);
  }, []);
  const setEmail = useCallback((v: string) => {
    setEmailState(v);
    try {
      window.sessionStorage.setItem(EMAIL_KEY, v);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const tab: AuthTab = useMemo(() => {
    const parent = PARENT_TAB[requestedTab];
    return parent && hydrated && !email ? parent : requestedTab;
  }, [requestedTab, hydrated, email]);

  const go = useCallback((t: AuthTab) => router.push(authHref(t, next, referral)), [router, next, referral]);
  const finish = useCallback(() => router.replace(next && next.startsWith("/") ? next : "/analyse"), [router, next]);

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(320px,44%)_1fr]" data-tab={tab}>
      <aside className="hidden flex-col justify-between border-r border-border bg-surface-1 p-10 lg:flex">
        <div>
          <Logo />
          <div className="mt-16 max-w-md">
            <p className="micro">Options analytics · Delta Exchange India</p>
            <h1 className="mt-3 text-4xl leading-[1.08]">
              Master Options
              <br />
              <span className="text-primary">Trading</span>
            </h1>
            <p className="mt-4 text-muted-foreground">
              Professional-grade crypto options analytics with real-time Greeks, strategy building, and paper trading.
            </p>
            <div className="mt-8 divide-y divide-border border-y border-border">
              {AUTH_FEATURES.map((f) => (
                <div key={f.title} className="flex items-start gap-3 py-3">
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                  <div>
                    <b className="block text-[13.5px] font-medium">{f.title}</b>
                    <small className="text-xs text-muted-foreground">{f.desc}</small>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-5" aria-label="Live futures">
              {UNDERLYINGS.map((a) => (
                <TickerItem key={a} asset={a} />
              ))}
            </div>
          </div>
        </div>
        <p className="font-mono text-2xs text-muted-foreground">© 2025 HapieCoin · Secure &amp; encrypted</p>
      </aside>
      <main className="flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <AuthForms
            tab={tab}
            email={email}
            setEmail={setEmail}
            referral={referral}
            googleEnabled={googleEnabled}
            next={next}
            go={go}
            finish={finish}
          />
        </div>
      </main>
    </div>
  );
}
