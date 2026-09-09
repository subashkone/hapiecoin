import type { Metadata } from "next";
import { Suspense } from "react";
import { DerivativesPage } from "@/components/analytics/DerivativesPage";

export const metadata: Metadata = { title: "Derivatives · Market Analytics" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <DerivativesPage />
    </Suspense>
  );
}
