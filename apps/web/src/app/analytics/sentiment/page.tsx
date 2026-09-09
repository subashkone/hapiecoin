import type { Metadata } from "next";
import { SentimentPage } from "@/components/analytics/SentimentPage";

export const metadata: Metadata = { title: "Sentiment · Market Analytics" };

export default function Page() {
  return <SentimentPage />;
}
