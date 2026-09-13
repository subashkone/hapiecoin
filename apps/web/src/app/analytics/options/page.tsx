import type { Metadata } from "next";
import { OptionsPage } from "@/components/analytics/OptionsPage";

export const metadata: Metadata = { title: "Options · Market Analytics" };

// No Suspense boundary around the page (GAPS #106): see analytics/markets/page.tsx.
export default function Page() {
  return <OptionsPage />;
}
