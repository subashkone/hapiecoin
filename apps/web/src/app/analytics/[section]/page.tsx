import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SectionSoon } from "@/components/analytics/AnalyticsShell";

/** Every analytics section now has its own page; this map is kept for the next deferred section (HC-SH-016). */
export const SOON: Record<string, { title: string; release: string; blurb: string }> = {};

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
