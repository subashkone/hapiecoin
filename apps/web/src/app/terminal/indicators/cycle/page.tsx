import type { Metadata } from "next";
import { CyclePage } from "@/components/terminal/IndicatorPages";

export const metadata: Metadata = { title: "BTC Cycle · Terminal · Market Analytics" };

/** HC-MT-148..150, 174 */
export default function Page() {
  return <CyclePage />;
}
