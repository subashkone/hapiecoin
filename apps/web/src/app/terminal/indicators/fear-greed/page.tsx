import type { Metadata } from "next";
import { FearGreedPage } from "@/components/terminal/IndicatorPages";

export const metadata: Metadata = { title: "Fear & Greed · Terminal · Market Analytics" };

/** HC-MT-144..147, 172, 173 */
export default function Page() {
  return <FearGreedPage />;
}
