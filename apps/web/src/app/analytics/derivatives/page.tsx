import type { Metadata } from "next";
import { DerivativesPage } from "@/components/analytics/DerivativesPage";

export const metadata: Metadata = { title: "Derivatives · Market Analytics" };

// No Suspense boundary around the page (GAPS #106): see analytics/markets/page.tsx.
export default function Page() {
  return <DerivativesPage />;
}
