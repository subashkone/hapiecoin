import type { Metadata } from "next";
import { BalancePage } from "@/components/terminal/IndicatorPages";

export const metadata: Metadata = { title: "Exchange Balance · Terminal · Market Analytics" };

/** HC-MT-135..141, 171 */
export default function Page() {
  return <BalancePage />;
}
