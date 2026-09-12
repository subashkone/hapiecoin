"use client";
// A trader's public verified P&L page (ADR-075; HC-PB-066, HC-PB-067): totals net of fees always; a daily chart, the
// accounts and a monthly table when the trader chose to show them; the share bar. Anyone can open it; nothing here is
// private beyond what the trader turned on. USD only: a visitor has no currency preference.
import type { PublicTraderPage } from "@hapiecoin/schema";
import { cn } from "@hapiecoin/ui";
import { fmtDate } from "@/lib/format";
import { USD, fmtMoney } from "@/lib/money";
import { ApiError } from "@/lib/api/client";
import { usePublicTrader } from "@/lib/api/public-page";
import { pageUrl } from "@/lib/public/share";
import { ShareBar } from "./ShareBar";

const tone = (v: number) => (v > 0 ? "text-profit" : v < 0 ? "text-loss" : "text-muted-foreground");
const money = (v: string) => fmtMoney(Number(v), USD, { signed: true });
const clock = (iso: string) => `${fmtDate(iso)} ${new Date(iso).toISOString().slice(11, 16)} UTC`;

export function TraderPage({ handle }: { handle: string }) {
  const q = usePublicTrader(handle);
  if (q.isError) {
    const gone = q.error instanceof ApiError && q.error.status === 404;
    return (
      <section className="mx-auto max-w-lg py-16 text-center" data-testid="trader-page" data-state="missing">
        <h1 className="text-xl font-semibold">{gone ? "No public page here" : "Could not load this page"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{gone ? `There is no trader at @${handle.toLowerCase()}, or their page is switched off.` : q.error.message}</p>
      </section>
    );
  }
  if (!q.data) return <section className="py-16 text-center text-sm text-muted-foreground" data-testid="trader-page" data-state="loading">Loading…</section>;
  const p = q.data;
  const url = pageUrl(typeof window === "undefined" ? "" : window.location.origin, p.handle);
  return (
    <section className="mx-auto max-w-3xl" data-testid="trader-page" data-state="ready" data-handle={p.handle}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="micro">Verified P&amp;L</div>
          <h1 className="text-2xl font-semibold" data-testid="trader-name">{p.name}</h1>
          <div className="text-sm text-muted-foreground" data-testid="trader-handle">@{p.handle}</div>
        </div>
        <ShareBar page={p} url={url} money={USD} compact />
      </header>
      <p className="mt-3 text-xs text-muted-foreground" data-testid="trader-basis">
        Realised P&amp;L computed by HapieCoin from the fills reported by the trader&apos;s exchange, net of fees, whether or not HapieCoin placed the orders. USD.
        {p.lastReadAt ? ` Last read ${clock(p.lastReadAt)}.` : ""}
      </p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(
          [
            ["Last 30 days", p.total.d30, "trader-d30"],
            ["Last 7 days", p.total.d7, "trader-d7"],
            ["All time", p.total.all, "trader-total"],
          ] as const
        ).map(([label, value, id]) => (
          <div key={id} className="rounded border border-border px-3 py-2">
            <div className="micro">{label}</div>
            <div className={cn("num text-xl font-semibold", tone(Number(value)))} data-testid={id}>
              {money(value)}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 text-xs text-muted-foreground" data-testid="trader-since">
        <span>
          {p.fills} {p.fills === 1 ? "fill" : "fills"}
          {p.since ? ` since ${fmtDate(p.since)}` : ""}
        </span>
        {p.partial ? <span className="text-warning" data-testid="trader-partial">some figures are partial: a position was open before the fills read, or older fills are still being read</span> : null}
      </div>
      {p.days && p.days.length ? <DaysChart days={p.days} /> : null}
      {p.accounts ? (
        <div className="mt-5" data-testid="trader-accounts">
          <div className="micro mb-1">Accounts</div>
          <table className="w-full text-sm">
            <tbody>
              {p.accounts.map((a) => (
                <tr key={a.label} className="border-t border-border" data-testid="trader-account" data-label={a.label}>
                  <td className="py-1 pr-3 font-medium">{a.label}</td>
                  <td className={cn("num py-1 pr-3 text-right", tone(Number(a.realizedUsd)))}>{money(a.realizedUsd)}</td>
                  <td className="py-1 text-right text-xs text-muted-foreground">
                    {a.fills} {a.fills === 1 ? "fill" : "fills"}
                    {a.since ? ` since ${fmtDate(a.since)}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {p.months ? (
        <div className="mt-5" data-testid="trader-months">
          <div className="micro mb-1">By month</div>
          <table className="w-full text-sm">
            <tbody>
              {[...p.months].reverse().map((m) => (
                <tr key={m.month} className="border-t border-border" data-testid="trader-month" data-month={m.month}>
                  <td className="py-1 pr-3">{m.month}</td>
                  <td className={cn("num py-1 text-right", tone(Number(m.pnl)))}>{money(m.pnl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="mt-8 text-2xs text-muted-foreground">
        Verified P&amp;L is computed from exchange fills; it is not investment advice and past results do not predict future ones. Get your own page at hapiecoin.com.
      </p>
    </section>
  );
}

/** Realised per day as bars; a simple SVG so the page needs no chart library and prints in a screenshot. */
export function DaysChart({ days }: { days: PublicTraderPage["days"] & object }) {
  const W = 640;
  const H = 160;
  const pad = 8;
  const values = days.map((d) => Number(d.pnl));
  const max = Math.max(...values.map(Math.abs), 0.01);
  const zero = H / 2;
  const bw = Math.max(2, (W - pad * 2) / days.length - 2);
  return (
    <figure className="mt-5" data-testid="trader-days" data-count={days.length}>
      <figcaption className="micro mb-1">Realised per day</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-full" role="img" aria-label={`Realised P&L per day over ${days.length} days`}>
        <line x1={pad} x2={W - pad} y1={zero} y2={zero} className="stroke-border" strokeWidth={1} />
        {days.map((d, i) => {
          const v = Number(d.pnl);
          const h = (Math.abs(v) / max) * (zero - pad);
          const x = pad + i * ((W - pad * 2) / days.length);
          return <rect key={d.day} x={x} y={v >= 0 ? zero - h : zero} width={bw} height={h} className={v >= 0 ? "fill-profit" : "fill-loss"} data-day={d.day} data-pnl={d.pnl} />;
        })}
      </svg>
    </figure>
  );
}
