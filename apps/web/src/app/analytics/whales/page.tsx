import type { Metadata } from "next";
import { WhalesPage } from "@/components/analytics/WhalesPage";

export const metadata: Metadata = { title: "Whales · Market Analytics" };

export default function Page() {
  return <WhalesPage />;
}
