import type { Metadata } from "next";
import { PhasePlaceholder } from "@/components/shell/PhasePlaceholder";

export const metadata: Metadata = { title: "Market Analytics" };

export default function Page() {
  return <PhasePlaceholder title="Market Analytics" phase={3} blurb="Liquidations, exchange flows, open interest, ETF flows and whale alerts for BTC, ETH and 200+ assets." />;
}
