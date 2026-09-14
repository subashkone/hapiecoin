import type { Metadata } from "next";
import { MarketsPage } from "@/components/analytics/MarketsPage";

export const metadata: Metadata = { title: "Markets · Market Analytics" };

// No Suspense boundary around the page: the route is dynamic (the root layout reads headers()), so useSearchParams
// needs none, and a boundary here made the page hydrate after the analytics shell had already fetched the markets
// snapshot, so it hydrated "ready" against a server render of "loading" (GAPS #106).
export default function Page() {
  return <MarketsPage />;
}
