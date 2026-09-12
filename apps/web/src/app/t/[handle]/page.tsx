import type { Metadata } from "next";
import { Footer } from "@/components/landing/Footer";
import { PublicHeader } from "@/components/landing/PublicHeader";
import { TraderPage } from "@/components/public/TraderPage";
import { USD, fmtMoney } from "@/lib/money";

/** The API as the server sees it (the browser goes through the same-origin rewrite instead). */
const apiUrl = process.env["API_URL"] ?? "http://localhost:3001";

/** HC-PB-066: the title and description carry the figure when the page is on, so a shared link previews it. */
export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params;
  const fallback: Metadata = { title: `@${handle} · Verified P&L`, description: "A HapieCoin trader's realised options P&L, computed from their exchange's own fills." };
  try {
    const res = await fetch(`${apiUrl}/v1/public/traders/${encodeURIComponent(handle)}`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(2000) });
    if (!res.ok) return fallback;
    const page = (await res.json()) as { name?: string; total?: { d30?: string } };
    const figure = fmtMoney(Number(page.total?.d30 ?? 0), USD, { signed: true });
    const title = `${page.name ?? handle} · Verified P&L`;
    const description = `${figure} over the last 30 days, net of fees, from exchange fills. Verified by HapieCoin.`;
    return { title, description, openGraph: { title, description, type: "profile" } };
  } catch {
    return fallback;
  }
}

export default async function Page({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return (
    <>
      <PublicHeader />
      <main className="pub-wrap py-8">
        <TraderPage handle={handle} />
      </main>
      <Footer />
    </>
  );
}
