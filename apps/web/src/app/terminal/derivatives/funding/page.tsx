import type { Metadata } from "next";
import { FundingPage } from "@/components/terminal/DerivativesPages";

export const metadata: Metadata = { title: "Funding Rates · Terminal · Market Analytics" };

/** HC-MT-119..125, 168 */
export default function Page() {
  return <FundingPage />;
}
