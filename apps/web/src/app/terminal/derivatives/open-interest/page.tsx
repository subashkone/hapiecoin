import type { Metadata } from "next";
import { OpenInterestPage } from "@/components/terminal/DerivativesPages";

export const metadata: Metadata = { title: "Open Interest · Terminal · Market Analytics" };

/** HC-MT-114..118, 167 */
export default function Page() {
  return <OpenInterestPage />;
}
