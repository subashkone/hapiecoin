"use client";
// Public header (HC-PB-001, HC-PB-059): sticky 56px panel-tone bar, section nav, Ctrl K, theme toggle,
// "Get Started" for guests / "Go to App" once a session exists.
import { ArrowRight, Button } from "@hapiecoin/ui";
import Link from "next/link";
import { authClient } from "@/lib/auth/client";
import { useMounted } from "@/lib/use-mounted";
import { CommandPalette, PaletteButton } from "@/components/shell/CommandPalette";
import { Logo } from "@/components/shell/Logo";
import { ThemeToggle } from "@/components/shell/ThemeToggle";

const NAV = [
  { href: "#features", label: "Features" },
  { href: "#crypto-analytics", label: "Market Analytics" },
  { href: "#prices", label: "Markets" },
  { href: "#exchanges", label: "Exchanges" },
  { href: "#whats-new", label: "What's new" },
] as const;

export function PublicHeader() {
  const { data: session, isPending } = authClient.useSession();
  const loggedIn = !!session?.user;
  // Server HTML and the first client render both show the guest buttons; the session is only known in the browser.
  const showApp = useMounted() && !isPending && loggedIn;
  return (
    <header className="sticky top-0 z-40 h-14 border-b border-border bg-header-bg/95 text-header-fg backdrop-blur">
      <div className="pub-wrap flex h-full items-center gap-6">
        <Logo />
        <nav aria-label="Landing sections" className="hidden items-center gap-5 text-[13px] text-muted-foreground md:flex">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="hover:text-foreground">
              {n.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <PaletteButton className="hidden sm:inline-flex" />
          <ThemeToggle />
          {showApp ? (
            <Button asChild size="md">
              <Link href="/analyse" data-testid="go-to-app">
                Go to App <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="md" className="hidden sm:inline-flex">
                <Link href="/auth?tab=signup">Sign Up</Link>
              </Button>
              <Button asChild size="md">
                <Link href="/auth" data-testid="get-started">
                  Get Started <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>
      <CommandPalette loggedIn={loggedIn} />
    </header>
  );
}
