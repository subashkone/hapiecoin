// A picture of the product on the public home page (ADR-140): the real screen with sample trades, one file per theme.
// Both are in the page and CSS shows the one that matches the theme, so there is no flash and no script.
import type { Shot } from "@/content/landing";

const W = 2000;
const H = 1250;

export function ProductShot({ shot, eager = false, caption = "Sample trades · live market prices" }: { shot: Shot; eager?: boolean; caption?: string }) {
  const img = (theme: "dark" | "light") => (
    <img
      src={`/shots/${shot.name}-${theme}.png`}
      alt={theme === "dark" ? shot.alt : ""}
      aria-hidden={theme === "light" ? true : undefined}
      width={shot.size?.w ?? W}
      height={shot.size?.h ?? H}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className={theme === "dark" ? "hidden h-auto w-full dark:block" : "block h-auto w-full dark:hidden"}
      data-theme-shot={theme}
    />
  );
  return (
    // a dialog is a tall picture: it keeps its own width instead of filling the column
    <figure className={"overflow-hidden rounded-lg border border-border bg-card shadow-sm" + (shot.size ? " mx-auto max-w-[480px]" : "")} data-testid="product-shot" data-shot={shot.name}>
      {img("dark")}
      {img("light")}
      <figcaption className="border-t border-border px-3 py-1.5 font-mono text-2xs uppercase tracking-[0.08em] text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}
