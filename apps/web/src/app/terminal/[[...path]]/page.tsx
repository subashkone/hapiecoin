import type { Metadata } from "next";
import { SectionSoon } from "@/components/analytics/AnalyticsShell";

export const metadata: Metadata = { title: "Terminal · Market Analytics" };

/** Every /terminal/* page arrives with PR 5.5; until then the shell stays and nothing dead-ends (HC-SH-016). */
export default function Page() {
  return <SectionSoon title="Market Analytics terminal" release="PR 5.5" blurb="The sidebar terminal: dashboard, spot markets, sectors, exchanges, open interest, funding, long/short, liquidations, ETF, exchange balance, Fear & Greed and BTC cycle indicators." />;
}
