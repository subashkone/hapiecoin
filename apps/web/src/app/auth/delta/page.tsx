// /auth/delta (HC-PB-037). Phase 1: Delta Exchange login is not wired (it ships with live trading in a later
// phase), so after the spinner the page explains that and links back instead of faking a login.
import type { Metadata } from "next";
import { DeltaSignIn } from "@/components/auth/DeltaSignIn";

export const metadata: Metadata = { title: "Signing in with Delta" };

export default function DeltaAuthPage() {
  return <DeltaSignIn />;
}
