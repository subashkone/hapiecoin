import type { Metadata } from "next";
import { DashboardPage } from "@/components/terminal/MarketPages";

export const metadata: Metadata = { title: "Dashboard · Terminal · Market Analytics" };

/** HC-MT-040..051, 156..158 */
export default function Page() {
  return <DashboardPage />;
}
