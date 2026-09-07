import type { Metadata } from "next";
import { LegalPage } from "@/components/landing/LegalPage";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function Page() {
  return <LegalPage kind="privacy" />;
}
