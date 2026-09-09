import type { Metadata } from "next";
import { ExchangePage } from "@/components/terminal/MarketPages";

export async function generateMetadata({ params }: { params: Promise<{ exchange: string }> }): Promise<Metadata> {
  const { exchange } = await params;
  return { title: `${exchange} · Exchange overview · Terminal` };
}

/** HC-MT-102..112, 166 */
export default async function Page({ params }: { params: Promise<{ exchange: string }> }) {
  const { exchange } = await params;
  return <ExchangePage exchange={exchange} />;
}
