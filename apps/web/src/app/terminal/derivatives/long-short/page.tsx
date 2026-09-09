import type { Metadata } from "next";
import { LongShortPage } from "@/components/terminal/DerivativesPages";

export const metadata: Metadata = { title: "Long / Short · Terminal · Market Analytics" };

/** HC-MT-126..128, 169 */
export default function Page() {
  return <LongShortPage />;
}
