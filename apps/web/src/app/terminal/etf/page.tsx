import type { Metadata } from "next";
import { EtfPage } from "@/components/analytics/EtfPage";

export const metadata: Metadata = { title: "ETF Flows · Terminal · Market Analytics" };

/** HC-MT-068..079, 163: the same ETF layout as /analytics/etf, its panels coming soon until a flows source exists (GAPS #55). */
export default function Page() {
  return <EtfPage />;
}
