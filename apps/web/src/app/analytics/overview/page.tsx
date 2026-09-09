import type { Metadata } from "next";
import { OverviewPage } from "@/components/analytics/OverviewPage";

export const metadata: Metadata = { title: "Futures · Market Analytics" };

export default function Page() {
  return <OverviewPage />;
}
