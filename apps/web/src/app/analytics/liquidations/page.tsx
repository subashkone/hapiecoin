import type { Metadata } from "next";
import { LiquidationsPage } from "@/components/analytics/LiquidationsPage";

export const metadata: Metadata = { title: "Liquidations · Market Analytics" };

export default function Page() {
  return <LiquidationsPage />;
}
