import type { Metadata } from "next";
import { SpotPage } from "@/components/terminal/MarketPages";

export const metadata: Metadata = { title: "Spot Markets · Terminal · Market Analytics" };

/** HC-MT-052..062, 159..161 */
export default function Page() {
  return <SpotPage />;
}
