import type { Metadata } from "next";
import { HubPage } from "@/components/analytics/HubPage";

export const metadata: Metadata = { title: "Markets Hub · Market Analytics" };

export default function Page() {
  return <HubPage />;
}
