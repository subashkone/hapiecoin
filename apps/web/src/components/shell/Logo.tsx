// Amber Δ mark + wordmark (HC-PB-001, HC-SH-001). Pure SVG, no image asset.
import { cn } from "@hapiecoin/ui";
import Link from "next/link";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={cn("size-4 text-primary", className)}>
      <path d="M8 2.2 14.2 13.3H1.8z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M8 7.2v6" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

export interface LogoProps {
  href?: string;
  /** Small muted suffix such as "Analyse". */
  sub?: string;
  className?: string;
}

export function Logo({ href = "/", sub, className }: LogoProps) {
  return (
    <Link
      href={href}
      className={cn("inline-flex items-center gap-2 font-display text-[15px] font-semibold text-foreground", className)}
      aria-label="HapieCoin home"
      title="HapieCoin"
    >
      <LogoMark />
      <span className={sub ? "hidden md:inline" : undefined}>HapieCoin</span>
      {sub ? <span className="hidden text-[13px] font-normal text-muted-foreground md:inline">{sub}</span> : null}
    </Link>
  );
}
