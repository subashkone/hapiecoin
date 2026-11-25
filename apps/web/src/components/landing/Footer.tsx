// Public footer (server component): quick links, legal, contact (ADR-140: the links follow the home page).
import Link from "next/link";
import { LogoMark } from "@/components/shell/Logo";
import { PLANS_ON_SALE, SUPPORT_EMAIL, SUPPORT_WHATSAPP } from "@/content/landing";

export function Footer({ year = new Date().getFullYear(), plansOnSale = PLANS_ON_SALE }: { year?: number; plansOnSale?: boolean }) {
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
              A desk for BTC, ETH and gold options: build, protect and review every trade. Options trading carries risk of loss.
            </p>
          </div>
          <div>
            <h4 className="micro mb-3">Quick Links</h4>
            <ul className="space-y-2 text-[13px] text-muted-foreground">
              <li><a href="/#how" className="hover:text-foreground">How it works</a></li>
              <li><a href="/#autopilot" className="hover:text-foreground">Autopilot</a></li>
              <li><a href="/#safety" className="hover:text-foreground">Safety</a></li>
              <li><a href={plansOnSale ? "/plans" : "/#plans"} className="hover:text-foreground">Plans</a></li>
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
          <span>Options on Delta Exchange India · Not investment advice</span>
        </div>
      </div>
    </footer>
  );
}
