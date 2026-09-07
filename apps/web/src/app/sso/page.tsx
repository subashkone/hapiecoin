// /sso (HC-PB-038): "Signing you in…" spinner, then redirect to ?sso_return= (in-app path only) or /analyse.
import type { Metadata } from "next";
import { SsoReturn } from "@/components/auth/SsoReturn";
import { safeNext } from "@/lib/auth/client";

export const metadata: Metadata = { title: "Signing in" };

export default async function SsoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = sp["sso_return"];
  const target = safeNext(Array.isArray(raw) ? raw[0] : raw);
  return <SsoReturn target={target} />;
}
