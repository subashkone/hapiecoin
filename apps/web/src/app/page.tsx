// Landing page (HC-PB-001, HC-PB-004, HC-PB-009, HC-PB-018, HC-PB-058, HC-PB-059).
// Server component: static copy renders on the server; the header, terminal, tabs and market tiles are
// client islands.
import Link from "next/link";
import type { Metadata } from "next";
import { Badge, Button } from "@/components/ui";
import { PublicHeader } from "@/components/landing/PublicHeader";
import { TerminalIllustration } from "@/components/landing/TerminalIllustration";
import { LiveMarkets } from "@/components/landing/LiveMarkets";
import { FeatureTabs } from "@/components/landing/FeatureTabs";
import { Footer } from "@/components/landing/Footer";
import {
  CAPABILITIES,
  EXCHANGES,
  FEATURE_LIST,
  HERO_BULLETS,
  STATS,
  WHATS_NEW,
  WITH,
  WITHOUT,
} from "@/content/landing";

export const metadata: Metadata = { title: "Trade Crypto Options Like a Pro · HapieCoin" };

function Check() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-profit" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
function Cross() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-loss" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </svg>
  );
}

function SectionHead({ eyebrow, title, sub }: { eyebrow: string; title: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-8">
      <p className="micro">{eyebrow}</p>
      <h2 className="mt-1 text-2xl">{title}</h2>
      {sub ? <p className="mt-2 max-w-2xl text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export default function LandingPage() {
  return (
    <>
      <PublicHeader />
      <main>
        {/* Hero */}
        <section className="pub-wrap grid items-center gap-12 py-16 lg:grid-cols-[1fr_1.15fr] lg:py-24">
          <div>
            <span className="inline-flex items-center gap-2 font-mono text-2xs uppercase tracking-[0.12em] text-profit">
              <i className="live-dot" />
              Live on Delta Exchange
            </span>
            <h1 className="mt-4 text-4xl leading-[1.05] sm:text-[44px]">
              Trade Crypto Options
              <br />
              <span className="text-muted-foreground">Like a Pro</span>
            </h1>
            <p className="mt-4 max-w-lg text-lg text-muted-foreground">
              Professional-grade options analytics, strategy builder, and paper trading — everything you need to
              master BTC &amp; ETH options.
            </p>
            <ul className="mt-6 grid gap-2 sm:grid-cols-2">
              {HERO_BULLETS.map((b) => (
                <li key={b} className="flex items-center gap-2 text-[13px]">
                  <Check />
                  {b}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/auth" data-testid="hero-cta">
                  Start Trading Free →
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href="#features">Explore Features</a>
              </Button>
            </div>
            <div className="mt-6 flex flex-wrap gap-x-4 gap-y-1">
              <span className="micro">Free plan · paper trading included</span>
              <span className="micro">BTC · ETH · XAUT options</span>
              <span className="micro">Delta Exchange India</span>
            </div>
          </div>
          <TerminalIllustration />
        </section>

        {/* Stats strip */}
        <section className="border-y border-border bg-surface-1">
          <div className="pub-wrap grid grid-cols-2 divide-border py-6 md:grid-cols-4 md:divide-x">
            {STATS.map((s) => (
              <div key={s.label} className="px-4 py-2">
                <div className="num text-xl font-medium">{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* What's new */}
        <section id="whats-new" className="pub-wrap scroll-mt-16 py-16">
          <SectionHead
            eyebrow="What's new in v2"
            title={
              <>
                Built like an instrument, <span className="text-muted-foreground">not a dashboard</span>
              </>
            }
            sub="The same chain, builder and paper-trading engine — now with a dark-first workspace, keyboard-driven flow, and the scenario tools traders asked for most."
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {WHATS_NEW.map((n) => (
              <div key={n.title} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center gap-2 text-[13.5px] font-medium">
                  {n.title}
                  <Badge variant="warning">new</Badge>
                </div>
                <p className="mt-1.5 text-[13px] text-muted-foreground">{n.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <LiveMarkets />

        {/* Why */}
        <section className="pub-wrap py-16">
          <SectionHead
            eyebrow="Why HapieCoin?"
            title={
              <>
                Stop Guessing. Start <span className="text-muted-foreground">Trading Smart</span>
              </>
            }
          />
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-[13px]">
              <thead className="bg-surface-1">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium text-loss">Without HapieCoin</th>
                  <th className="px-4 py-2.5 text-left font-medium text-profit">With HapieCoin</th>
                </tr>
              </thead>
              <tbody>
                {WITHOUT.map((w, i) => (
                  <tr key={w} className="border-t border-border">
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-2 text-muted-foreground">
                        <Cross />
                        {w}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-2">
                        <Check />
                        {WITH[i]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="pub-wrap scroll-mt-16 py-16">
          <SectionHead
            eyebrow="Platform Features"
            title={
              <>
                Everything You Need to <span className="text-muted-foreground">Trade Smarter</span>
              </>
            }
          />
          <FeatureTabs />
        </section>

        {/* Capabilities */}
        <section className="pub-wrap py-16">
          <SectionHead eyebrow="Capabilities" title="Built for Serious Traders" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map((c) => (
              <div key={c.title} className={"rounded-lg border border-border bg-card p-5" + ("large" in c && c.large ? " lg:col-span-2" : "")}>
                <h3 className="text-[15px]">{c.title}</h3>
                <p className="mt-1.5 text-[13px] text-muted-foreground">{c.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Market analytics teaser */}
        <section id="crypto-analytics" className="pub-wrap scroll-mt-16 py-16">
          <SectionHead
            eyebrow="Market Analytics"
            title="Liquidations & Market Pulse"
            sub="Professional-grade analytics inside your dashboard — track liquidations, exchange flows, and large orders in real time across BTC, ETH, and 200+ assets."
          />
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-card p-5">
            <p className="text-[13px] text-muted-foreground">Dive into per-exchange breakdowns, historical charts, and a live order feed.</p>
            <Button asChild variant="outline">
              <Link href="/analytics">Explore Analytics →</Link>
            </Button>
          </div>
        </section>

        {/* Full feature list */}
        <section className="pub-wrap py-16">
          <SectionHead
            eyebrow="Everything You Need"
            title="Full Feature List"
            sub="A comprehensive toolkit designed for crypto options traders — from analytics to execution."
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURE_LIST.map((g) => (
              <div key={g.title} className="rounded-lg border border-border bg-card p-5">
                <h3 className="text-[15px]">{g.title}</h3>
                <ul className="mt-3 space-y-1.5 text-[13px] text-muted-foreground">
                  {g.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <Check />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* Exchanges */}
        <section id="exchanges" className="pub-wrap scroll-mt-16 py-16">
          <SectionHead
            eyebrow="Integrations"
            title="Supported Exchanges"
            sub="Trade on leading crypto exchanges with more integrations coming soon."
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {EXCHANGES.map((e) => (
              <div
                key={e.name}
                data-testid={`exchange-${e.status}`}
                className={
                  "rounded-lg border bg-card p-5" +
                  (e.status === "live" ? " border-primary/50" : " border-border opacity-60")
                }
              >
                <div className="flex items-center justify-between">
                  <div className="grid size-10 place-items-center rounded-md bg-muted font-mono text-sm font-medium">{e.mark}</div>
                  {e.status === "live" ? (
                    <span className="inline-flex items-center gap-1.5 font-mono text-2xs uppercase text-profit">
                      <i className="live-dot" /> Live
                    </span>
                  ) : (
                    <span className="micro">Coming soon</span>
                  )}
                </div>
                <h3 className="mt-4 text-[15px]">{e.name}</h3>
                <div className="mt-2">
                  {e.status === "live" ? <Badge variant="profit">Connected via API</Badge> : <Badge variant="outline">Coming Soon</Badge>}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="pub-wrap pb-20 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-6 rounded-lg border border-border bg-surface-1 p-8">
            <div>
              <h2 className="text-2xl">Ready to Trade Smarter?</h2>
              <p className="mt-2 max-w-xl text-muted-foreground">
                Join thousands of traders using HapieCoin for professional-grade crypto options analytics. Free paper
                trading included.
              </p>
            </div>
            <Button asChild size="lg">
              <Link href="/auth?tab=signup">Create Free Account →</Link>
            </Button>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
