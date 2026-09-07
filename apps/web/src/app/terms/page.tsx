import type { Metadata } from "next";
import { LegalPage } from "@/components/landing/LegalPage";

export const metadata: Metadata = { title: "Terms of Service" };

export default function Page() {
  return <LegalPage kind="terms" />;
}
