import type { Metadata } from "next";
import { CoinPage } from "@/components/analytics/CoinPage";

export async function generateMetadata({ params }: { params: Promise<{ symbol: string }> }): Promise<Metadata> {
  const { symbol } = await params;
  return { title: `${symbol.toUpperCase()} · Market Analytics` };
}

export default async function Page({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  return <CoinPage symbol={symbol} />;
}
