"use client";
// Journal tab (HC-TR-128..137): closed trades (archived strategies that were traded) newest first, the stats strip,
// the equity curve, filter chips + search, tags and notes per trade saved to the strategy, CSV export, the
// squared-off legs of active strategies, and the empty states. Rows open Strategy Details.
import type { Strategy } from "@hapiecoin/schema";
import { Button, EmptyState, cn, toast } from "@hapiecoin/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCredential } from "@/lib/api/queries";
import { usePatchStrategy, useStrategies } from "@/lib/api/strategies";
import { accountLabel } from "@/lib/accounts";
import { fmtMoney } from "@/lib/money";
import { useUiStore } from "@/lib/store";
import { FILTER_LABELS, JOURNAL_FILTERS, type JournalFilter, PRESET_TAGS, type Trade, closedLegs, closedTrades, copyText, equityCurve, filterTrades, journalCsv, journalStats, reasonLabel } from "@/lib/strategy/journal";
import { fmtLeg } from "@/lib/strategy/paper";
import type { PaperBook } from "@/lib/strategy/usePaper";
import { Chart } from "@/components/analytics/Chart";
import { Chips } from "@/components/analytics/Chips";
import { VerifiedPnlBlock } from "./VerifiedPnlBlock";

const dm = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
const dmy = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

function ModeTag({ mode }: { mode: "paper" | "live" }) {
  return <span className={cn("micro rounded border px-1.5", mode === "live" ? "border-loss bg-loss text-white" : "border-border")} data-testid="trade-mode" data-mode={mode}>{mode === "live" ? "LIVE" : "PAPER"}</span>;
}

/** Tags and notes of one closed trade; every change is saved on the strategy (HC-TR-132, 133). */
function TradeEditor({ s }: { s: Strategy }) {
  const patch = usePatchStrategy();
  const [custom, setCustom] = useState("");
  const [notes, setNotes] = useState(s.notes);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setNotes(s.notes), [s.notes]);
  const saveTags = (tags: string[], msg: string, tag: string) =>
    patch.mutate({ id: s.id, body: { tags } }, { onSuccess: () => toast(msg, { description: `#${tag} · ${s.name}` }), onError: (e) => toast.error("Could not save the tag", { description: e.message }) });
  const toggle = (tag: string) => (s.tags.includes(tag) ? saveTags(s.tags.filter((t) => t !== tag), "Tag removed", tag) : saveTags([...s.tags, tag], "Tag added", tag));
  const addCustom = () => {
    const tag = custom.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-").slice(0, 32);
    setCustom("");
    if (!tag || s.tags.includes(tag)) return;
    saveTags([...s.tags, tag], "Tag added", tag);
  };
  const saveNotes = (value: string) => {
    if (value === s.notes) return;
    patch.mutate({ id: s.id, body: { notes: value } }, { onSuccess: () => toast("Notes saved", { description: s.name }), onError: (e) => toast.error("Could not save the notes", { description: e.message }) });
  };
  const onNotes = (value: string) => {
    setNotes(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => saveNotes(value), 800);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const customTags = s.tags.filter((t) => !(PRESET_TAGS as readonly string[]).includes(t));
  return (
    <div className="mt-2 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div>
        <div className="micro mb-1">Tags</div>
        <div className="flex flex-wrap items-center gap-1" data-testid="trade-tags">
          {PRESET_TAGS.map((t) => (
            <button key={t} type="button" onClick={() => toggle(t)} aria-pressed={s.tags.includes(t)} className={cn("rounded border px-1.5 py-0.5 font-mono text-2xs", s.tags.includes(t) ? "border-foreground text-foreground" : "border-border text-muted-foreground hover:text-foreground")} data-testid={`tag-${t}`}>
              {t}
            </button>
          ))}
          {customTags.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded border border-foreground px-1.5 py-0.5 font-mono text-2xs" data-testid="tag-custom">
              {t}
              <button type="button" onClick={() => toggle(t)} aria-label={`Remove tag ${t}`} className="text-muted-foreground hover:text-foreground" data-testid="tag-remove">×</button>
            </span>
          ))}
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }}
            placeholder="+ custom"
            aria-label="Add a custom tag"
            className="h-6 w-[88px] rounded border border-dashed border-border bg-transparent px-1.5 font-mono text-2xs"
            data-testid="tag-input"
          />
        </div>
      </div>
      <div>
        <div className="micro mb-1">Notes</div>
        <textarea value={notes} onChange={(e) => onNotes(e.target.value)} onBlur={() => { if (timer.current) clearTimeout(timer.current); saveNotes(notes); }} rows={2} maxLength={2000} placeholder="What worked, what did not…" className="w-full resize-y rounded border border-border bg-background px-2 py-1 text-xs" aria-label={`Notes for ${s.name}`} data-testid="trade-notes" />
      </div>
    </div>
  );
}

export function JournalPanel({ book }: { book: PaperBook }) {
  const { data, isLoading, isError, refetch } = useStrategies();
  const openDetails = useUiStore((s) => s.openDetails);
  const setTab = useUiStore((s) => s.setWorkspaceTab);
  const [filter, setFilter] = useState<JournalFilter>("all");
  const [search, setSearch] = useState("");
  // ADR-068: with several keys on an exchange the journal can be read per account
  const { data: credential } = useCredential();
  const accounts = useMemo(() => credential?.items ?? [], [credential]);
  const [account, setAccount] = useState<string | null>(null);
  const labelOf = (id: string | null) => accountLabel(accounts, id) ?? "";
  const money = book.money;
  const all = useMemo(() => closedTrades(data ?? []), [data]);
  const trades = useMemo(() => filterTrades(all, filter, search, account), [all, filter, search, account]);
  const legs = useMemo(() => closedLegs(data ?? [], book.lotSizeOf), [data, book.lotSizeOf]);
  const stats = useMemo(() => journalStats(trades), [trades]);
  const curve = useMemo(() => equityCurve(trades), [trades]);
  const net = curve.at(-1)?.v ?? 0;
  const pf = stats.profitFactor;
  const exportCsv = async () => {
    const ok = await copyText(journalCsv(trades, labelOf));
    if (ok) toast(`CSV copied · ${trades.length} ${trades.length === 1 ? "row" : "rows"}`, { description: "Paste into a spreadsheet" });
    else toast.error("Could not copy", { description: "Clipboard blocked by the browser" });
  };
  const money$ = (v: number | null) => (v === null ? "—" : fmtMoney(v, money, { signed: true }));
  const tone = (v: number | null) => (v === null ? "text-muted-foreground" : v >= 0 ? "text-profit" : "text-loss");
  return (
    <section className="flex h-full min-h-0 flex-col" data-testid="journal-panel" data-count={all.length} data-shown={trades.length}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Chips items={JOURNAL_FILTERS} labels={FILTER_LABELS} value={filter} onChange={setFilter} testId="journal-filter" />
        {accounts.length > 1 ? (
          <select value={account ?? ""} onChange={(e) => setAccount(e.target.value || null)} className="h-7 rounded border border-input bg-background px-2 text-xs" aria-label="Account" title="Trades through one exchange key (ADR-068)" data-testid="journal-account">
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        ) : null}
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search trades, tags, notes…" className="h-7 w-full rounded sm:w-[220px] border border-input bg-background px-2 text-xs" aria-label="Search the journal" data-testid="journal-search" />
        <Button size="sm" variant="outline" className="ml-auto" disabled={trades.length === 0} onClick={() => void exportCsv()} title="Copy the filtered trades as CSV" data-testid="journal-csv">
          Export CSV
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
        <VerifiedPnlBlock money={money} />
        {isLoading ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Loading the journal…</p>
        ) : isError ? (
          <EmptyState title="Could not load the journal" description="Check your connection and try again." action={<Button size="sm" variant="outline" onClick={() => void refetch()}>Retry</Button>} />
        ) : all.length === 0 && legs.length === 0 ? (
          <EmptyState title="No closed trades yet" description="Stop a paper strategy or square off a live one and it lands here with its realised P&L, tags and notes." className="py-16" action={<Button size="sm" variant="outline" onClick={() => setTab("paper")} data-testid="journal-open-paper">Open Paper trades</Button>} data-testid="journal-empty" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 py-2 sm:grid-cols-3 md:grid-cols-6" data-testid="journal-stats">
              <div className="rounded border border-border px-2 py-1.5"><div className="micro">Trades</div><div className="num text-[15px] font-medium" data-testid="stat-trades">{stats.trades}</div><div className="micro">{stats.wins} wins · {stats.losses} losses</div></div>
              <div className="rounded border border-border px-2 py-1.5"><div className="micro">Win rate</div><div className="num text-[15px] font-medium" data-testid="stat-winrate">{stats.winRate === null ? "—" : `${Math.round(stats.winRate * 100)}%`}</div><div className="micro">closed strategies</div></div>
              <div className="rounded border border-border px-2 py-1.5"><div className="micro">Avg P&amp;L</div><div className={cn("num text-[15px] font-medium", tone(stats.avg))} data-testid="stat-avg">{money$(stats.avg)}</div><div className="micro">per trade</div></div>
              <div className="rounded border border-border px-2 py-1.5"><div className="micro">Best</div><div className={cn("num text-[15px] font-medium", tone(stats.best))} data-testid="stat-best">{money$(stats.best)}</div><div className="micro">single trade</div></div>
              <div className="rounded border border-border px-2 py-1.5"><div className="micro">Worst</div><div className={cn("num text-[15px] font-medium", tone(stats.worst))} data-testid="stat-worst">{money$(stats.worst)}</div><div className="micro">single trade</div></div>
              <div className="rounded border border-border px-2 py-1.5"><div className="micro">Profit factor</div><div className="num text-[15px] font-medium" data-testid="stat-pf">{pf === null ? "—" : Number.isFinite(pf) ? pf.toFixed(2) : "∞"}</div><div className="micro">profit ÷ loss</div></div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-2xs" data-testid="journal-equity" data-points={curve.length}>
              <span className="micro">Equity curve · cumulative realised P&amp;L · {trades.length} {trades.length === 1 ? "trade" : "trades"}</span>
              <span className={cn("num ml-auto font-medium", tone(net))} data-testid="journal-net">Net {money$(net)}</span>
            </div>
            <Chart
              h={150}
              tight
              zero
              x={curve.map((p) => dm(new Date(p.t).toISOString()))}
              xTip={curve.map((p) => (p.trade ? `${dmy(new Date(p.t).toISOString())} · ${p.trade.s.name}` : `${dmy(new Date(p.t).toISOString())} · first trade opened`))}
              series={[{ label: "Cumulative P&L", type: "area", data: curve.map((p) => p.v), color: net >= 0 ? "hsl(var(--profit))" : "hsl(var(--loss))", fmt: (v) => fmtMoney(v, money, { signed: true }) }]}
              labels={curve.map((p, i) => (p.trade ? { i, y: p.v, text: "●", color: p.trade.pnl >= 0 ? "hsl(var(--profit))" : "hsl(var(--loss))" } : null)).filter((x): x is { i: number; y: number; text: string; color: string } => x !== null)}
              yFmt={(v) => fmtMoney(v, money, { signed: true })}
              legend={false}
              empty={all.length ? "No trades match this filter" : "Nothing closed yet"}
              testId="chart-equity"
            />
            {trades.length === 0 ? (
              <EmptyState title={search ? "No trades match" : `No ${FILTER_LABELS[filter].toLowerCase()} trades`} description={search ? "Try a different search" : "Pick another chip"} className="py-8" data-testid="journal-empty-filter" />
            ) : (
              <div className="mt-2 flex flex-col gap-2" data-testid="journal-trades">
                {trades.map((t) => (
                  <div key={t.s.id} className="rounded border border-border p-2" data-testid="journal-trade" data-id={t.s.id} data-mode={t.mode} data-win={t.pnl > 0 ? "true" : t.pnl < 0 ? "false" : "flat"}>
                    <div role="button" tabIndex={0} onClick={() => openDetails(t.s.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetails(t.s.id); } }} className="flex flex-wrap items-start gap-3 rounded outline-none focus-visible:ring-1 focus-visible:ring-ring" title="Open Strategy Details" data-testid="trade-row">
                      <div className="w-12 shrink-0 text-center"><div className="num text-[13px] font-medium leading-tight">{dm(t.closedAt)}</div><div className="micro">{new Date(t.closedAt).getFullYear()}</div></div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium"><span className="truncate">{t.s.name}</span><ModeTag mode={t.mode} /><span className="micro rounded border border-border px-1">{t.s.asset}</span>{accounts.length > 1 && labelOf(t.accountId) ? <span className="micro rounded border border-border px-1" title="The exchange key it traded through (ADR-068)" data-testid="trade-account">{labelOf(t.accountId)}</span> : null}</div>
                        <div className="micro flex flex-wrap gap-x-2">
                          <span>{t.s.templateName}</span>
                          <span><b>{t.s.legs.length}</b> {t.s.legs.length === 1 ? "leg" : "legs"}</span>
                          <span><b>{t.days}</b> days</span>
                          <span>{dm(t.openedAt)} → {dm(t.closedAt)}</span>
                          {t.reason ? <span className="rounded border border-border px-1" title="Why it closed (ADR-059)" data-testid="trade-reason" data-reason={t.reason}>{reasonLabel(t.reason)}</span> : null}
                          {t.s.tags.map((tag) => <span key={tag} className="text-accent">#{tag}</span>)}
                        </div>
                      </div>
                      <div className="ml-auto text-right">
                        <div className={cn("num text-[15px] font-medium", t.pnl >= 0 ? "text-profit" : "text-loss")} data-testid="trade-pnl">{fmtMoney(t.pnl, money, { signed: true })}</div>
                        <div className="micro">realised</div>
                      </div>
                    </div>
                    <TradeEditor s={t.s} />
                  </div>
                ))}
              </div>
            )}
            <div className="micro mt-3 flex items-center gap-2" data-testid="journal-closed-legs" data-count={legs.length}>
              <span>Closed legs from active strategies</span>
              <b className="num">{legs.length}</b>
            </div>
            {legs.length ? (
              <div className="mt-1 flex flex-col gap-1">
                {legs.map((r) => (
                  <button key={r.leg.id} type="button" onClick={() => openDetails(r.s.id)} className="flex flex-wrap items-center gap-2 rounded border border-border px-2 py-1 text-left text-2xs hover:border-foreground/30" title="Open Strategy Details" data-testid="closed-leg" data-id={r.s.id}>
                    <span className="num w-12 text-muted-foreground">{r.closedAt ? dm(r.closedAt) : "—"}</span>
                    <span className={cn("micro rounded border px-1", r.leg.side === "sell" ? "border-loss text-loss" : "border-profit text-profit")}>{r.leg.side.toUpperCase()}</span>
                    <span className="num font-medium">{r.leg.symbol}</span>
                    <span className="text-muted-foreground">· {r.s.asset} {r.s.name} · {fmtLeg(r.leg).split(" × ")[1]} lots</span>
                    <span className="num ml-auto text-muted-foreground">{Number(r.leg.entryPrice ?? r.leg.price).toLocaleString("en-US")} → {Number(r.leg.exitPrice ?? 0).toLocaleString("en-US")}</span>
                    <span className={cn("num font-medium", r.pnl >= 0 ? "text-profit" : "text-loss")} data-testid="closed-leg-pnl">{fmtMoney(r.pnl, money, { signed: true })}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

export type { Trade };
