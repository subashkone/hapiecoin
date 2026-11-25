// Public home page (HC-PB-001, HC-PB-004, HC-PB-009, HC-PB-018, HC-PB-058, HC-PB-059; ADR-140).
// HapieCoin's own page, in the order a trade happens: build, protect, review, then Autopilot, safety and plans. The
// pictures are the product itself with sample trades. Server component: the header and the market tiles are client
// islands.
import Link from "next/link";
import type { Metadata } from "next";
import { Badge, Button } from "@/components/ui";
import { PublicHeader } from "@/components/landing/PublicHeader";
import { ProductShot } from "@/components/landing/ProductShot";
import { LiveMarkets } from "@/components/landing/LiveMarkets";
import { Footer } from "@/components/landing/Footer";
import { AUTOPILOT, EXCHANGES, HERO, HERO_SHOT, REVIEW, SAFETY, STEPS, SUPPORT_EMAIL } from "@/content/landing";

export const metadata: Metadata = {
  title: "HapieCoin · Know your worst case before you place the trade",
  description: "A desk for BTC, ETH and gold options on Indian exchanges: build a strategy, see what it can make and lose, practise on paper, and let stop and target rules watch it.",
};

function Tick() {
  return (
    <svg viewBox="0 0 24 24" className="mt-0.5 size-4 shrink-0 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m5 12 5 5 9-10" />
    </svg>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">{children}</p>;
}

export default function LandingPage() {
  return (
    <>
      <PublicHeader />
      <main>
        {/* Hero: the promise, then the product */}
        <section className="pub-wrap pb-10 pt-14 lg:pt-20" data-testid="home-hero">
          <div className="max-w-3xl">
            <Eyebrow>{HERO.eyebrow}</Eyebrow>
            <h1 className="mt-4 text-balance text-4xl leading-[1.08] sm:text-5xl">{HERO.title}</h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">{HERO.lede}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/auth?tab=signup" data-testid="hero-cta">
                  Request early access →
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/payoff-preview" data-testid="hero-preview">
                  Try the payoff preview
                </Link>
              </Button>
            </div>
            <p className="mt-5 text-[13px] text-muted-foreground" data-testid="hero-note">
              {HERO.note}
            </p>
          </div>
          <div className="mt-12">
            <ProductShot shot={HERO_SHOT} eager />
          </div>
        </section>

        <LiveMarkets />

        {/* How it works: build, protect, review */}
        <section id="how" className="scroll-mt-16 py-16">
          <div className="pub-wrap">
            <Eyebrow>How it works</Eyebrow>
            <h2 className="mt-2 text-3xl">Three things, in the order a trade happens.</h2>
          </div>
          <div className="pub-wrap mt-12 flex flex-col gap-20">
            {STEPS.map((s, i) => (
              <div key={s.id} className={"grid items-center gap-8 lg:gap-12 " + (i % 2 === 1 ? "lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]" : "lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]")} data-testid="home-step" data-step={s.id}>
                <div className={i % 2 === 1 ? "lg:order-2" : undefined}>
                  <p className="font-mono text-xs uppercase tracking-[0.08em] text-primary">{s.step}</p>
                  <h3 className="mt-2 text-2xl">{s.title}</h3>
                  <p className="mt-3 leading-relaxed text-muted-foreground">{s.body}</p>
                  <ul className="mt-5 space-y-2.5 text-[15px]">
                    {s.points.map((p) => (
                      <li key={p} className="flex gap-2.5">
                        <Tick />
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="min-w-0">
                  <ProductShot shot={s.shot} />
                </div>
              </div>
            ))}
            <div data-testid="home-step" data-step="review">
              <p className="font-mono text-xs uppercase tracking-[0.08em] text-primary">{REVIEW.step}</p>
              <h3 className="mt-2 text-2xl">{REVIEW.title}</h3>
              <div className="mt-6 grid gap-x-10 gap-y-6 border-t border-border pt-6 md:grid-cols-3">
                {REVIEW.points.map((p) => (
                  <div key={p.title}>
                    <h4 className="text-base font-medium">{p.title}</h4>
                    <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{p.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Autopilot */}
        <section id="autopilot" className="scroll-mt-16 border-y border-border bg-surface-1 py-16">
          <div className="pub-wrap">
            <div className="flex flex-wrap items-center gap-3">
              <Eyebrow>Autopilot</Eyebrow>
              <Badge variant="outline" data-testid="autopilot-paper-badge">
                Paper today · live next
              </Badge>
            </div>
            <h2 className="mt-2 max-w-3xl text-balance text-3xl">{AUTOPILOT.title}</h2>
            <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">{AUTOPILOT.lede}</p>
            <div className="mt-10">
              <ProductShot shot={AUTOPILOT.shot} />
            </div>
            <div className="mt-10 grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
              {AUTOPILOT.points.map((p) => (
                <div key={p.title}>
                  <h3 className="text-base font-medium">{p.title}</h3>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{p.body}</p>
                </div>
              ))}
            </div>
            <p className="mt-8 text-[13px] text-muted-foreground">A paper record or a backtest is not a forecast of live results.</p>
          </div>
        </section>

        {/* Safety */}
        <section id="safety" className="pub-wrap scroll-mt-16 py-16">
          <Eyebrow>Safety</Eyebrow>
          <h2 className="mt-2 text-3xl">Built so a mistake is hard to make.</h2>
          <div className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {SAFETY.map((p) => (
              <div key={p.title} className="border-t border-border pt-4">
                <h3 className="text-base font-medium">{p.title}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{p.body}</p>
              </div>
            ))}
          </div>
          <div id="exchanges" className="mt-12 flex scroll-mt-16 flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-border bg-card px-5 py-4">
            <span className="micro">Exchanges</span>
            {EXCHANGES.map((e) => (
              <span key={e.name} className="inline-flex items-center gap-2 text-[15px]" data-testid={`exchange-${e.status}`}>
                <span className="grid size-7 place-items-center rounded bg-muted font-mono text-xs font-medium" aria-hidden="true">
                  {e.mark}
                </span>
                {e.name}
                <Badge variant="profit">Connected</Badge>
              </span>
            ))}
            <span className="text-[13px] text-muted-foreground">More Indian exchanges follow as they open an options API.</span>
          </div>
        </section>

        {/* Plans */}
        <section id="plans" className="pub-wrap scroll-mt-16 pb-20">
          <div className="flex flex-wrap items-center justify-between gap-6 rounded-lg border border-border bg-surface-1 p-8">
            <div>
              <h2 className="text-2xl">Start on paper. Go live only when you choose to.</h2>
              <p className="mt-2 max-w-xl text-muted-foreground" data-testid="home-plans-soon">
                Plans and pricing are coming soon. For early access, write to{" "}
                <a href={`mailto:${SUPPORT_EMAIL}`} className="text-foreground underline underline-offset-4">
                  {SUPPORT_EMAIL}
                </a>
                .
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="outline">Plans · coming soon</Badge>
              <Button asChild size="lg" variant="outline">
                <Link href="/auth">Sign in</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
