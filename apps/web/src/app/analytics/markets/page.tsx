import type { Metadata } from "next";
import { Suspense } from "react";
import { MarketsPage } from "@/components/analytics/MarketsPage";

export const metadata: Metadata = { title: "Markets · Market Analytics" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <MarketsPage />
    </Suspense>
  );
}
