// Public footer (server component): quick links, legal, contact. Copy from the v2 mock footer chrome.
import Link from "next/link";
import { LogoMark } from "@/components/shell/Logo";
import { SUPPORT_EMAIL, SUPPORT_WHATSAPP } from "@/content/landing";

export function Footer({ year = new Date().getFullYear() }: { year?: number }) {
  return (
    <footer className="border-t border-border bg-surface-1">
      <div className="pub-wrap py-12">
        <div className="grid gap-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Link href="/" className="inline-flex items-center gap-2 font-display text-[15px] font-semibold">
              <LogoMark />
              HapieCoin
            </Link>
            <p className="mt-3 max-w-xs text-[13px] text-muted-foreground">
              Professional-grade crypto options analytics platform. Trade smarter with real-time data.
            </p>
          </div>
          <div>
            <h4 className="micro mb-3">Quick Links</h4>
            <ul className="space-y-2 text-[13px] text-muted-foreground">
              <li><a href="#features" className="hover:text-foreground">Features</a></li>
              <li><a href="#prices" className="hover:text-foreground">Markets</a></li>
              <li><a href="#exchanges" className="hover:text-foreground">Exchanges</a></li>
              <li><a href="#whats-new" className="hover:text-foreground">What&apos;s new in v2</a></li>
              <li><Link href="/payoff-preview" className="hover:text-foreground">Payoff chart preview</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="micro mb-3">Legal</h4>
            <ul className="space-y-2 text-[13px] text-muted-foreground">
              <li><Link href="/privacy" className="hover:text-foreground">Privacy Policy</Link></li>
              <li><Link href="/terms" className="hover:text-foreground">Terms of Service</Link></li>
              <li><Link href="/disclaimer" className="hover:text-foreground">Disclaimer</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="micro mb-3">Contact Us</h4>
            <ul className="space-y-2 text-[13px] text-muted-foreground">
              <li><a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-foreground">{SUPPORT_EMAIL}</a></li>
              <li>
                <a href={SUPPORT_WHATSAPP.href} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
                  {SUPPORT_WHATSAPP.label}
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-10 flex flex-wrap justify-between gap-2 border-t border-border pt-5 font-mono text-2xs text-muted-foreground">
          <span>© {year} HapieCoin. All rights reserved.</span>
          <span>Options on Delta Exchange India · Not financial advice · v2</span>
        </div>
      </div>
    </footer>
  );
}
