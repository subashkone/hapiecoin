import type { Metadata } from "next";
import { TerminalLiquidationsPage } from "@/components/terminal/DerivativesPages";

export const metadata: Metadata = { title: "Liquidations · Terminal · Market Analytics" };

/** HC-MT-129..134, 170 */
export default function Page() {
  return <TerminalLiquidationsPage />;
}
