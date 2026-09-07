// /auth (HC-PB-023..036, HC-PB-061, HC-PB-062). Tab state lives in ?tab=; ?next= and ?ref= are preserved.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthScreen, type AuthTab } from "@/components/auth/AuthScreen";
import { publicEnv } from "@/lib/env";
import { getServerUser } from "@/lib/auth/server";
import { safeNext } from "@/lib/auth/client";

const TABS: AuthTab[] = ["login", "otp-login", "otp-verify", "signup", "verify-email", "forgot", "reset-password"];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const tab = first((await searchParams)["tab"]);
  const title = tab === "signup" ? "Create account" : tab === "forgot" ? "Reset password" : "Sign in";
  return { title };
}

export default async function AuthPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const next = safeNext(first(sp["next"]));
  const user = await getServerUser();
  if (user) redirect(next); // HC-PB-025
  const rawTab = first(sp["tab"]);
  const tab: AuthTab = TABS.includes(rawTab as AuthTab) ? (rawTab as AuthTab) : "login";
  const ref = first(sp["ref"]) ?? "";
  const env = publicEnv();
  return (
    <AuthScreen
      tab={tab}
      next={first(sp["next"]) ?? ""}
      referral={ref}
      googleEnabled={env.NEXT_PUBLIC_GOOGLE_ENABLED === "true"}
    />
  );
}
