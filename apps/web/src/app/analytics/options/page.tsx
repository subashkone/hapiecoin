import type { Metadata } from "next";
import { Suspense } from "react";
import { OptionsPage } from "@/components/analytics/OptionsPage";

export const metadata: Metadata = { title: "Options · Market Analytics" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <OptionsPage />
    </Suspense>
  );
}
