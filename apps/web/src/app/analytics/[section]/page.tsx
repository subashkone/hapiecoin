import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SectionSoon } from "@/components/analytics/AnalyticsShell";

/** Sections that arrive with PR 5.4b keep a real page inside the shell (HC-SH-016). */
export const SOON: Record<string, { title: string; release: string; blurb: string }> = {
  whales: { title: "Whales", release: "PR 5.4b", blurb: "Hyperliquid whale positions, large resting orders and exchange reserves." },
};

export async function generateMetadata({ params }: { params: Promise<{ section: string }> }): Promise<Metadata> {
  const { section } = await params;
  return { title: `${SOON[section]?.title ?? "Market Analytics"} · Market Analytics` };
}

export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const s = SOON[section];
  if (!s) notFound();
  return <SectionSoon title={s.title} release={s.release} blurb={s.blurb} />;
}
