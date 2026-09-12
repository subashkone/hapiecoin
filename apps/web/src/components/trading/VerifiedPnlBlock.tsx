"use client";
// Verified P&L on the Journal (ADR-073; HC-TR-180, HC-TR-181): realised P&L computed from the exchange's own fills,
// per account and in total, with when it was last read and how it agrees with the Journal's own figure. The Refresh
// button asks the server to re-read the accounts now (read-only). Shown once an exchange key is connected.
import { Button, cn, toast } from "@hapiecoin/ui";
import { useCredential } from "@/lib/api/queries";
import { useVerifiedPnl, useVerifiedRefresh } from "@/lib/api/verified";
import { fmtDate } from "@/lib/format";
import { type MoneyFormat, fmtMoney } from "@/lib/money";

const tone = (v: number) => (v > 0 ? "text-profit" : v < 0 ? "text-loss" : "text-muted-foreground");
const clock = (iso: string) => `${fmtDate(iso)} ${new Date(iso).toISOString().slice(11, 16)} UTC`;

export function VerifiedPnlBlock({ money }: { money: MoneyFormat }) {
  const { data: credential } = useCredential();
  const connected = (credential?.items.length ?? 0) > 0;
  const q = useVerifiedPnl(connected);
  const refresh = useVerifiedRefresh();
  if (!connected) return null;
  const v = q.data;
  const money$ = (s: string) => fmtMoney(Number(s), money, { signed: true });
  const diff = v ? Number(v.difference) : 0;
  // gross to gross: the Journal books live strategies before fees and at expiry through the settler
  const agree = v ? (Math.abs(diff) < 0.005 ? `before fees ${money$(v.total.gross)}, matches the Journal's realised figure` : `before fees ${money$(v.total.gross)}, differs from the Journal's ${money$(v.journalRealizedUsd)} by ${money$(v.difference)} (the Journal knows only the trades HapieCoin placed, books expiries through the settler and carries a paper phase)`) : "";
  const errors = v?.accounts.filter((a) => a.error !== null) ?? [];
  const state = q.isError ? "error" : !v ? "loading" : v.fills === 0 ? "empty" : "ready";
  return (
    <div className="mt-2 rounded border border-accent/40 p-2" data-testid="verified-block" data-state={state} data-fills={v?.fills ?? 0}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="micro">Verified P&amp;L</span>
        <span className="text-2xs text-muted-foreground" title="Computed from the fills the exchange reports for your keys, whether or not HapieCoin placed the orders: average cost per contract, commissions taken off">from exchange fills</span>
        {v?.lastReadAt ? <span className="text-2xs text-muted-foreground" data-testid="verified-read">last read {clock(v.lastReadAt)}</span> : null}
        <Button size="sm" variant="outline" className="ml-auto" loading={refresh.isPending} onClick={() => refresh.mutate(undefined, { onSuccess: (r) => (r.errors.length ? toast.error("Some accounts could not be read", { description: r.errors.join(" · ") }) : toast("Fills refreshed", { description: `${r.read} read · ${r.added} new across ${r.accounts} ${r.accounts === 1 ? "account" : "accounts"}` })), onError: (e) => toast.error("Could not refresh", { description: e.message }) })} title="Re-read your accounts' fills from the exchange now (read-only)" data-testid="verified-refresh">
          Refresh
        </Button>
      </div>
      {q.isError ? (
        <p className="mt-1 text-2xs text-loss">{q.error.message}</p>
      ) : !v ? (
        <p className="mt-1 text-2xs text-muted-foreground">Reading…</p>
      ) : v.fills === 0 ? (
        <p className="mt-1 text-2xs text-muted-foreground" data-testid="verified-empty">
          No fills read yet{errors.length ? ` · ${errors.map((a) => `${a.label}: ${a.error ?? ""}`).join(" · ")}` : " · press Refresh, or wait for the next read"}
        </p>
      ) : (
        <>
          <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                ["All time", v.total.all, "verified-total"],
                ["Last 7 days", v.total.d7, "verified-d7"],
                ["Last 30 days", v.total.d30, "verified-d30"],
                ["Commissions", v.total.commission, "verified-commission"],
              ] as const
            ).map(([label, value, id]) => (
              <div key={id} className="rounded border border-border px-2 py-1.5">
                <div className="micro">{label}</div>
                <div className={cn("num text-[15px] font-medium", id === "verified-commission" ? "text-muted-foreground" : tone(Number(value)))} data-testid={id}>
                  {id === "verified-commission" ? fmtMoney(Number(value), money) : money$(value)}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-2xs text-muted-foreground">
            <span data-testid="verified-since">
              {v.fills} {v.fills === 1 ? "fill" : "fills"}
              {v.since ? ` since ${fmtDate(v.since)}` : ""}
            </span>
            <span data-testid="verified-agree" data-diff={v.difference}>{agree}</span>
          </div>
          {v.accounts.length > 1 ? (
            <div className="mt-1 flex flex-col gap-0.5" data-testid="verified-accounts">
              {v.accounts.map((a) => (
                <div key={a.accountId} className="flex flex-wrap items-center gap-2 text-2xs" data-testid="verified-account" data-label={a.label}>
                  <b>{a.label}</b>
                  <span className={cn("num", tone(Number(a.realizedUsd)))}>{money$(a.realizedUsd)}</span>
                  <span className="text-muted-foreground">{a.fills} {a.fills === 1 ? "fill" : "fills"}</span>
                  {a.skipped ? <span className="text-warning">{a.skipped} skipped (no contract value)</span> : null}
                  {a.partialProducts ? <span className="text-warning" title="Products whose position on the exchange is not what the fills read add up to: opened before the read, or beyond the exchange's history" data-testid="verified-partial">{a.partialProducts} {a.partialProducts === 1 ? "product" : "products"} partial</span> : null}
                  {a.backfilling ? <span className="text-muted-foreground" data-testid="verified-backfilling">older fills still being read</span> : null}
                  {a.error ? <span className="text-loss">{a.error}</span> : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-1 flex flex-wrap gap-x-3 text-2xs">
              {errors.map((a) => <span key={a.accountId} className="text-loss">{a.error}</span>)}
              {v.accounts.some((a) => a.partialProducts) ? <span className="text-warning" title="Products whose position on the exchange is not what the fills read add up to: opened before the read, or beyond the exchange's history" data-testid="verified-partial">{v.accounts.reduce((n, a) => n + a.partialProducts, 0)} partial</span> : null}
              {v.accounts.some((a) => a.backfilling) ? <span className="text-muted-foreground" data-testid="verified-backfilling">older fills still being read</span> : null}
              {v.accounts.some((a) => a.skipped) ? <span className="text-warning">{v.accounts.reduce((n, a) => n + a.skipped, 0)} skipped (no contract value)</span> : null}
            </p>
          )}
        </>
      )}
    </div>
  );
}
