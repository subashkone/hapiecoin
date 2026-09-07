import type { Metadata } from "next";
import { LegalPage } from "@/components/landing/LegalPage";

export const metadata: Metadata = { title: "Disclaimer" };

export default function Page() {
  return <LegalPage kind="disclaimer" />;
}
