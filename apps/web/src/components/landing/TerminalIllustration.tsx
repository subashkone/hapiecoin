"use client";
// Static hero illustration (HC-PB-004): a miniature of the analyse workspace built only from design-system
// components (Tabs, Table, Badge, Kbd, Stat). Numbers are illustrative fixtures from the recorded Delta
// snapshot of 03 Sep 2026, not live data; the live tiles further down are the real feed.
import { Badge, Kbd, Stat, TBody, THead, Table, Tabs, TabsList, TabsTrigger, Td, Th, Tr } from "@hapiecoin/ui";
import { LogoMark } from "@/components/shell/Logo";

const ROWS = [
  ["0.65", "5.69K", "4,477.7", "77,000", "1,956.7", "6.86K", "-0.35"],
  ["0.60", "7.17K", "3,877.8", "78,000", "2,366.8", "10.76K", "-0.40"],
  ["0.55", "10.28K", "3,331.2", "79,000", "2,810.2", "10.47K", "-0.45"],
  ["0.52", "6.20K", "3,078.1", "79,500", "3,067.1", "7.07K", "-0.48"],
  ["0.49", "10.88K", "2,839.4", "80,000", "3,317.4", "9.46K", "-0.51"],
  ["0.44", "10.50K", "2,399.1", "81,000", "3,878.1", "7.88K", "-0.56"],
] as const;

export function TerminalIllustration() {
  return (
    <div
      aria-hidden="true"
      className="select-none overflow-hidden rounded-lg border border-border bg-card text-2xs shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)]"
    >
      <div className="flex h-9 items-center gap-2 border-b border-border px-3">
        <LogoMark className="size-3.5" />
        <span className="font-display font-semibold">HapieCoin</span>
        <span className="text-muted-foreground">Analyse</span>
        <span className="ml-2 inline-flex overflow-hidden rounded border border-border">
          {["BTC", "ETH", "XAUT"].map((a, i) => (
            <span key={a} className={i === 0 ? "bg-foreground px-1.5 py-px font-mono text-background" : "px-1.5 py-px font-mono text-muted-foreground"}>
              {a}
            </span>
          ))}
        </span>
        <span className="micro ml-2">Futures</span>
        <span className="num font-medium">79,521.0</span>
        <span className="num text-loss">-3.74%</span>
        <span className="ml-auto inline-flex items-center gap-1 text-profit">
          <i className="live-dot" /> LIVE 84 ms
        </span>
        <Kbd>Ctrl</Kbd>
        <Kbd>K</Kbd>
      </div>
      <div className="grid grid-cols-[1.35fr_1fr]">
        <div className="border-r border-border">
          <Tabs value="chain" className="gap-0">
            <TabsList className="px-2">
              <TabsTrigger value="chain" className="py-1.5 text-2xs">
                Chain
              </TabsTrigger>
              <TabsTrigger value="builder" className="py-1.5 text-2xs">
                Builder
              </TabsTrigger>
              <TabsTrigger value="paper" className="py-1.5 text-2xs">
                Paper <Badge variant="outline">3</Badge>
              </TabsTrigger>
              <TabsTrigger value="live" className="py-1.5 text-2xs">
                Live <Badge variant="outline">1</Badge>
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex gap-1 border-b border-border px-2 py-1.5 font-mono text-3xs text-muted-foreground">
            {["07 Sep", "11 Sep", "18 Sep", "25 Sep", "30 Oct", "27 Nov"].map((e) => (
              <span key={e} className={e === "25 Sep" ? "rounded bg-muted px-1.5 py-px text-foreground" : "px-1.5 py-px"}>
                {e}
              </span>
            ))}
          </div>
          <Table compact wrapperClassName="[&_tr]:h-6">
            <THead>
              <Tr>
                <Th numeric>Δ</Th>
                <Th numeric>OI</Th>
                <Th numeric>Mark/IV</Th>
                <Th className="text-center">Strike</Th>
                <Th numeric>Mark/IV</Th>
                <Th numeric>OI</Th>
                <Th numeric>Δ</Th>
              </Tr>
            </THead>
            <TBody>
              {ROWS.map((r) => (
                <Tr key={r[3]} className={r[3] === "79,500" ? "atm-band" : ""}>
                  <Td numeric>{r[0]}</Td>
                  <Td numeric>{r[1]}</Td>
                  <Td numeric>{r[2]}</Td>
                  <Td className={"num text-center font-medium" + (r[3] === "79,500" ? " text-spot" : "")}>
                    {r[3]}
                  </Td>
                  <Td numeric>{r[4]}</Td>
                  <Td numeric>{r[5]}</Td>
                  <Td numeric>{r[6]}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
        <div className="flex flex-col gap-2 p-2">
          <div className="grid grid-cols-2 gap-1.5">
            <Stat label="Max profit" value="+$5.34" tone="profit" sub="at expiry" className="px-2 py-1.5 [&_[data-slot=stat-value]]:text-[13px]" />
            <Stat label="Max loss" value="-$4.66" tone="loss" sub="capped" className="px-2 py-1.5 [&_[data-slot=stat-value]]:text-[13px]" />
            <Stat label="Breakeven" value="79,966" sub="+0.6% from spot" className="px-2 py-1.5 [&_[data-slot=stat-value]]:text-[13px]" />
            <Stat label="POP" value="48%" sub="R:R 1 : 0.87" className="px-2 py-1.5 [&_[data-slot=stat-value]]:text-[13px]" />
          </div>
          <svg viewBox="0 0 220 90" className="h-24 w-full" role="presentation">
            <line x1="0" y1="55" x2="220" y2="55" stroke="hsl(var(--border))" strokeWidth="1" />
            <line x1="110" y1="4" x2="110" y2="86" stroke="hsl(var(--spot))" strokeDasharray="3 3" strokeWidth="1" />
            <path d="M0 78 L90 78 L150 22 L220 22" fill="none" stroke="hsl(var(--curve))" strokeWidth="1.6" />
            <path d="M0 78 L90 78 L102 55 L0 55 Z" fill="hsl(var(--loss) / 0.18)" />
            <path d="M102 55 L150 22 L220 22 L220 55 Z" fill="hsl(var(--profit) / 0.18)" />
          </svg>
          <div className="micro">Bull call spread · 25 Sep · 2 legs</div>
          <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-2 font-mono text-3xs">
            <span className="text-buy">BUY</span>
            <span>C-BTC-79500-25SEP26</span>
            <span>3,078.1</span>
            <span className="text-loss">-90.7</span>
            <span className="text-sell">SELL</span>
            <span>C-BTC-80500-25SEP26</span>
            <span>2,612.1</span>
            <span className="text-profit">80.3</span>
          </div>
        </div>
      </div>
    </div>
  );
}
