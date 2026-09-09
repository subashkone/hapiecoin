import type { Metadata } from "next";
import { Footer } from "@/components/landing/Footer";
import { PublicHeader } from "@/components/landing/PublicHeader";
import { ShareLanding } from "@/components/share/ShareLanding";

export const metadata: Metadata = { title: "Shared strategy", description: "A HapieCoin options strategy shared by link: its legs, lots and entry prices open in Analyse." };

/** HC-WS-106: a public route; the link itself carries the strategy. */
export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return (
    <>
      <PublicHeader />
      <main className="pub-wrap py-8">
        <ShareLanding code={code} />
      </main>
      <Footer />
    </>
  );
}
