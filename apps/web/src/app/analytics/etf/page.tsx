import type { Metadata } from "next";
import { EtfPage } from "@/components/analytics/EtfPage";

export const metadata: Metadata = { title: "ETF · Market Analytics" };

export default function Page() {
  return <EtfPage />;
}
