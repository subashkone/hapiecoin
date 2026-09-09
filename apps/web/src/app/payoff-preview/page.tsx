import type { Metadata } from "next";
import { Footer } from "@/components/landing/Footer";
import { PayoffPreview } from "@/components/landing/PayoffPreview";
import { PublicHeader } from "@/components/landing/PublicHeader";

export const metadata: Metadata = { title: "Payoff chart preview", description: "See how HapieCoin charts an options strategy: expiry and target-date P&L, breakevens, expected move and open interest." };

export default function Page() {
  return (
    <>
      <PublicHeader />
      <main className="pub-wrap py-8">
        <PayoffPreview />
      </main>
      <Footer />
    </>
  );
}
