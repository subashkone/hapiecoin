// Terminal navigation model (HC-MT-011..030): the sidebar groups, the active rule and the sector slugs. Pure data
// so the shell, the palette and the tests read one source.

export interface NavItem {
  href: string;
  label: string;
  /** Active only on the exact path (the dashboard). */
  exact?: boolean;
  /** Leaves the terminal (the Markets Hub); never active inside it. */
  ext?: boolean;
  /** Indented under Spot Markets (the sectors). */
  sub?: boolean;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const SECTORS = [
  { slug: "layer-1", name: "Layer-1" },
  { slug: "layer-2", name: "Layer-2" },
  { slug: "defi", name: "DeFi" },
  { slug: "memes", name: "Memes" },
] as const;
export type SectorSlug = (typeof SECTORS)[number]["slug"];
export const SECTOR_SLUGS: readonly SectorSlug[] = SECTORS.map((s) => s.slug);
export const isSector = (slug: string): slug is SectorSlug => (SECTOR_SLUGS as readonly string[]).includes(slug);
export const sectorName = (slug: string): string => SECTORS.find((s) => s.slug === slug)?.name ?? slug;

/** Perpetual venues the ingest reports open interest and funding for (Delta only carries options). */
export const EXCHANGES = ["binance", "bybit", "okx"] as const;
export type Exchange = (typeof EXCHANGES)[number];
export const isExchange = (v: string): v is Exchange => (EXCHANGES as readonly string[]).includes(v);

export const TERMINAL_NAV: readonly NavGroup[] = [
  {
    label: "Markets",
    items: [
      { href: "/terminal", label: "Dashboard", exact: true },
      { href: "/analytics/hub", label: "Markets Hub", ext: true },
      { href: "/terminal/spot", label: "Spot Markets" },
      ...SECTORS.map((s) => ({ href: `/terminal/sectors/${s.slug}`, label: s.name, sub: true })),
      { href: "/terminal/exchanges", label: "Exchanges" },
    ],
  },
  {
    label: "Derivatives",
    items: [
      { href: "/terminal/derivatives/open-interest", label: "Open Interest" },
      { href: "/terminal/derivatives/funding", label: "Funding Rates" },
      { href: "/terminal/derivatives/long-short", label: "Long / Short" },
      { href: "/terminal/derivatives/liquidations", label: "Liquidations" },
    ],
  },
  { label: "ETF", items: [{ href: "/terminal/etf", label: "ETF Flows" }] },
  {
    label: "On-chain",
    items: [
      { href: "/terminal/onchain/exchange-balance", label: "Exchange Balance" },
      { href: "/terminal/onchain/unlocks", label: "Token Unlocks" },
    ],
  },
  {
    label: "Indicators",
    items: [
      { href: "/terminal/indicators/fear-greed", label: "Fear & Greed" },
      { href: "/terminal/indicators/cycle", label: "BTC Cycle" },
    ],
  },
];

export function navActive(item: NavItem, pathname: string): boolean {
  if (item.ext) return false;
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** The name shown on the mobile "Navigation" toggle: the active item, else the detail page's kind. */
export function terminalSection(pathname: string): string {
  for (const g of TERMINAL_NAV) for (const it of g.items) if (navActive(it, pathname)) return it.label;
  if (pathname.startsWith("/terminal/coin/")) return "Coin";
  return "Terminal";
}

export const navTestId = (href: string): string => `tnav-${href.replace(/^\/(terminal|analytics)\/?/, "").replace(/\//g, "-") || "dashboard"}`;
