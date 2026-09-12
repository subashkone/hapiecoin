"use client";
// Portfolio status bar (Phase 5 item 3, ADR-053; HC-SH-105..108, HC-WS-004): a 32 px strip under the analyse
// workspace with the open-strategy count, net greeks, margin used against the wallet, day P&L, the alerts count,
// the P&L basis and the display currency. Every item is a button to the place that changes it.
import { alertCounts } from "@hapiecoin/schema";
import { cn } from "@hapiecoin/ui";
import { useMemo } from "react";
import { useAlerts } from "@/lib/api/alerts";
import { useLivePositions } from "@/lib/api/live";
import { useSettings } from "@/lib/api/queries";
import { useStrategies } from "@/lib/api/strategies";
import { fmtMoney, fmtMoneyCompact } from "@/lib/money";
import { useUiStore } from "@/lib/store";
import { dayPnl } from "@/lib/strategy/paper";
import { useCurrentAccount } from "@/lib/accounts";
import { usePaperBook } from "@/lib/strategy/usePaper";
import { usePortfolio } from "@/lib/strategy/usePortfolio";

const NONE: never[] = [];
const item = "inline-flex h-8 items-center gap-1.5 whitespace-nowrap px-2.5 font-mono text-2xs hover:bg-muted";

export function PortfolioBar() {
  const { data: strategies } = useStrategies();
  const { data: settings } = useSettings();
  const { data: alerts } = useAlerts();
  const setWorkspaceTab = useUiStore((s) => s.setWorkspaceTab);
  const openDialog = useUiStore((s) => s.openDialog);
  const openAlerts = useUiStore((s) => s.openAlerts);
  const active = useMemo(() => (strategies ?? NONE).filter((s) => s.status === "paper" || s.status === "live"), [strategies]);
  const book = usePaperBook(active);
  const portfolio = usePortfolio(strategies, book, "active");
  const live = active.filter((s) => s.status === "live").length;
  const day = active.reduce((acc, s) => acc + dayPnl(s, book.pnlOf(s).total), 0);
  const { account } = useCurrentAccount();
  const wallet = useLivePositions(account?.brokerId ?? null, account !== null, account?.id ?? null);
  const balances = wallet.data?.balances ?? [];
  const walletRow = ["USD", "USDT", "INR"].map((a) => balances.find((b) => b.asset === a)).find((b) => b !== undefined) ?? balances[0];
  const walletTotal = walletRow ? Number(walletRow.balance) : null;
  const marginPct = walletTotal ? Math.min(100, Math.max(0, (portfolio.marginUsed / walletTotal) * 100)) : 0;
  const counts = alertCounts(alerts ?? NONE);
  const money = book.money;
  const basis = settings ? (settings.pnlBasis === "bid_ask" ? "bid/ask" : "mark") : "—";
  const ccy = settings?.currency ?? "USD";
  const signed = (v: number) => (v >= 0 ? "text-profit" : "text-loss");
  return (
    <footer
      className="sticky bottom-0 z-20 flex h-8 items-stretch overflow-x-auto border-t border-border bg-header-bg text-header-fg"
      data-testid="portfolio-bar"
      data-open={portfolio.open}
      data-portfolio={portfolio.pending ? "pending" : portfolio.open ? "ready" : "empty"}
      aria-label="Portfolio status"
    >
      <button type="button" className={item} onClick={() => setWorkspaceTab("paper")} title="Open the Paper tab" data-testid="bar-portfolio">
        <span className="micro">Portfolio</span>
        <b className="font-medium">{active.length} open {active.length === 1 ? "strategy" : "strategies"}</b>
        {live ? <span className="text-loss">· {live} live</span> : null}
      </button>
      <span className={cn(item, "hover:bg-transparent")} title="Net position delta across the open strategies (units of the underlying)" data-testid="bar-net-delta">
        <span className="micro">Net Δ</span>
        <b className={cn("num", signed(portfolio.netDelta))}>{portfolio.open ? `${portfolio.netDelta >= 0 ? "+" : ""}${portfolio.netDelta.toFixed(2)}` : "—"}</b>
      </span>
      <span className={cn(item, "hidden hover:bg-transparent lg:inline-flex")} title="Net theta per day across the open strategies" data-testid="bar-net-theta">
        <span className="micro">Net Θ/day</span>
        <b className={cn("num", signed(portfolio.netTheta))}>{portfolio.open ? fmtMoney(portfolio.netTheta, money, { signed: true }) : "—"}</b>
      </span>
      <span className={cn(item, "hidden hover:bg-transparent lg:inline-flex")} title="Net vega per vol point across the open strategies" data-testid="bar-net-vega">
        <span className="micro">Net ν</span>
        <b className={cn("num", signed(portfolio.netVega))}>{portfolio.open ? fmtMoney(portfolio.netVega, money, { signed: true }) : "—"}</b>
      </span>
      <button type="button" className={cn(item, "hidden md:inline-flex")} onClick={() => openDialog("api")} title={walletTotal === null ? "Σ worst expiry loss of the defined-risk strategies · connect your exchange for the wallet balance" : "Margin used of the exchange wallet balance · click for API settings"} data-testid="bar-margin">
        <span className="micro">Margin used</span>
        <b className="num">{portfolio.open ? fmtMoneyCompact(portfolio.marginUsed, money) : "—"}</b>
        {walletTotal !== null ? (
          <>
            <span className="text-muted-foreground">/ {fmtMoneyCompact(walletTotal, money)}</span>
            <span className="relative h-1 w-10 overflow-hidden rounded bg-muted" aria-hidden="true">
              <span className="absolute inset-y-0 left-0 bg-primary" style={{ width: `${marginPct}%` }} />
            </span>
          </>
        ) : null}
      </button>
      <span className={cn(item, "hover:bg-transparent")} title="Today's P&L across the open strategies" data-testid="bar-day-pnl">
        <span className="micro">Day P&amp;L</span>
        <b className={cn("num", signed(day))}>{active.length ? fmtMoney(day, money, { signed: true }) : "—"}</b>
      </span>
      <button type="button" className={item} onClick={() => openAlerts()} title="Open the Alerts center" data-testid="bar-alerts" data-triggered={counts.triggered}>
        <span className="micro">Alerts</span>
        <b>{counts.armed} armed</b>
        {counts.triggered ? <span className="rounded bg-warning-bg px-1 text-warning">{counts.triggered} fired</span> : null}
      </button>
      <span className="flex-1" />
      <button type="button" className={item} onClick={() => openDialog("pnl")} title="P&L basis · click for P&L settings" data-testid="bar-basis">
        <span className="micro">Basis</span>
        <b>{basis}</b>
      </button>
      <button type="button" className={item} onClick={() => openDialog("currency")} title="Display currency · click for currency settings" data-testid="bar-ccy">
        <span className="micro">CCY</span>
        <b>{ccy}</b>
      </button>
    </footer>
  );
}
