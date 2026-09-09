import type { Metadata } from "next";
import { SectorPage } from "@/components/terminal/MarketPages";
import { sectorName } from "@/lib/terminal/nav";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return { title: `${sectorName(slug)} Sector · Terminal · Market Analytics` };
}

/** HC-MT-063..066, 162 */
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <SectorPage slug={slug} />;
}
