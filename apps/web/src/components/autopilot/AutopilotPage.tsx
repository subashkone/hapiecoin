"use client";
// Autopilot (ADR-108, ADR-109, ADR-116; HC-TR-219, HC-TR-220, HC-TR-232): the master switch, the strategies as rows
// narrowed by expiry family and by coin (each with its switch, exits, backtest, paper result and what it is doing
// now), the trades Autopilot holds with a health reading and an exit, its log, and its results.
// Paper only. Figures in USD are shown in the trader's display currency.
import { AUTOPILOT_PLAYBOOKS, type Playbook, type PlaybookCadence, playbookBacktest, playbookCadence, playbookTemplate } from "@hapiecoin/pricing";
import { AUTOPILOT_CHOSEN_EXIT_STYLES, AUTOPILOT_COOLDOWN_MINUTES, AUTOPILOT_EXIT_LABELS, type AutopilotExitStyle, type AutopilotRun, type AutopilotSettings, type PlaybookStatus, type Strategy } from "@hapiecoin/schema";
import { Badge, Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, Switch, cn, toast } from "@hapiecoin/ui";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { StopPaperDialog } from "@/components/trading/StopPaperDialog";
import { AutopilotResultsPanel } from "./AutopilotResultsPanel";
import { AUTOPILOT_POLL_MS, useAutopilot, useAutopilotResults, useSaveAutopilot } from "@/lib/api/autopilot";
import { recordFor, usePlaybookRecords } from "@/lib/api/playbooks";
import { strategyFetchers, strategyKeys, useStopStrategy, useStrategies } from "@/lib/api/strategies";
import { fmtDateTime, fmtExpiry, fmtStrike } from "@/lib/format";
import { useConnectionStatus } from "@/lib/gateway/hooks";
import { fmtMoney } from "@/lib/money";
import { useUiStore } from "@/lib/store";
import { HEALTH_LABELS, type TradeHealth, autopilotLevels, capitalInUse, capitalUnbounded, latestRun, tradeHealth } from "@/lib/strategy/autopilot";
import { dayPnl, openLegs, priceMap } from "@/lib/strategy/paper";
import { usePaperBook } from "@/lib/strategy/usePaper";

const NONE: never[] = [];
const ASSETS = ["BTC", "ETH", "XAUT"] as const;
type Coin = (typeof ASSETS)[number];
// the recorded playbooks (never the control) and the ones entered by the clock (ADR-112)
const TRADABLE = AUTOPILOT_PLAYBOOKS;
// ADR-116: the strategies by how often they trade, in the order of the list; a family with no strategy is not shown
const CADENCE: Record<PlaybookCadence, { tab: string; title: string; note: string }> = {
  trend: { tab: "Trend", title: "Longer-dated strategies", note: "Entered whenever their market condition is met." },
  daily: { tab: "Daily", title: "Evening strangles, daily expiry", note: "Entered every evening for the next day's expiry." },
  weekly: { tab: "Weekly", title: "Weekly strangles, Friday expiry", note: "Entered once a week, on a Friday or a Tuesday evening, for the Friday expiry." },
  monthly: { tab: "Monthly", title: "Monthly strangles, month-end expiry", note: "Entered one to two months before the month-end expiry." },
};
const CADENCES = (["trend", "daily", "weekly", "monthly"] as const).filter((c) => TRADABLE.some((p) => playbookCadence(p) === c));
const GROUPS = CADENCES.map((c) => ({ cadence: c, ...CADENCE[c], items: TRADABLE.filter((p) => playbookCadence(p) === c) }));
const COINS = ASSETS.filter((a) => TRADABLE.some((p) => (p.assets as readonly string[]).includes(a)));
const cadenceOfId = (playbookId: string | null | undefined): PlaybookCadence | null => {
  const p = AUTOPILOT_PLAYBOOKS.find((x) => x.id === playbookId);
  return p ? playbookCadence(p) : null;
};
/** A whole hour on the UTC clock as IST reads it: 20 is "1:30 AM". */
export const istClock = (hourUtc: number): string => {
  const m = (hourUtc * 60 + 330) % 1440;
  const h = Math.floor(m / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
/** ADR-122: the move an entry was judged on and the side it left to sell: "BTC up 1.62 % over 24 hours: the put only". */
export const moveWords = (asset: string, move: { pct: string; side: "put" | "call" | "both" }): string => {
  const pct = Number(move.pct);
  return `${asset} ${pct < 0 ? "down" : "up"} ${Math.abs(pct).toFixed(2)} % over 24 hours: ${move.side === "both" ? "both sides" : `the ${move.side} only`}`;
};
/** A timed exit whose hour is not after the entry window's first hour is the next day's (HC-TR-263; the engine takes the next occurrence of the hour): a Friday entry at 9:30 PM closed at 5:30 PM is closed on Saturday. */
const nextDay = (c: { fromHourUtc: number; exitHourUtc?: number | undefined }): boolean => c.exitHourUtc !== undefined && c.exitHourUtc <= c.fromHourUtc;
/** A structure with bought options collects less than its sold options bring: its profit levels are on the net premium (ADR-138). */
const premiumWords = (p: Playbook): string => (playbookTemplate(p)?.legs.some((l) => l.side === "buy") ? "net premium" : "premium");
/** How a strategy gets out, in a few words: the column a trader compares rows by. */
const exitWords = (p: Playbook): string => {
  const c = p.clock;
  if (!c) return "Playbook stop and time exit";
  const parts = [c.legStop ? `Stop at ${c.legStop}x on each sold option` : c.takeProfitOfCredit ? "Wings cap the loss, no stop" : "Wings cap the loss, held to expiry"];
  if (c.takeProfitOfCredit) parts.push(c.takeTrailPct ? `trail from ${Math.round(c.takeProfitOfCredit * 100)} % of the ${premiumWords(p)}` : `take ${Math.round(c.takeProfitOfCredit * 100)} % of the ${premiumWords(p)}`);
  if (c.trailRestPct) parts.push("then trail the other side");
  if (c.ladder) parts.push(`profit in steps at ${c.ladder.join(" / ")} %`);
  if (c.lock) parts.push(`a floor at ${Math.round(c.lock.floor * 100)} % of the premium once it is up ${Math.round(c.lock.at * 100)} %`);
  if (c.exitHourUtc !== undefined) parts.push(`out at ${istClock(c.exitHourUtc)} IST${nextDay(c) ? " the next day" : ""}`);
  if (c.legBuyBackAt !== undefined) parts.push(`each sold option bought back once its price is down to ${c.legBuyBackAt} dollars`);
  if (c.legBuyBackShare !== undefined) parts.push(`each sold option bought back once its price is down to ${Math.round(c.legBuyBackShare * 100)} % of what it was sold for`);
  return parts.join(", ");
};
// (the pressed look of the chain's own toggles: amber stays for the spot, the money row and the primary action)
const chip = (on: boolean) => cn("h-7 rounded border border-border px-2.5 text-2xs", on ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground");
const HEAD = "micro hidden md:block";
const ROW = "grid grid-cols-1 gap-x-4 gap-y-2 md:grid-cols-[minmax(0,2.4fr)_minmax(0,1.5fr)_minmax(0,1.3fr)_minmax(0,1.1fr)_minmax(0,1.8fr)]";
const RECORD: Record<PlaybookStatus, { label: string; variant: "profit" | "loss" | "outline" | "warning" }> = {
  // the record is of the playbook run with its own exits, not Autopilot's profit exit (ADR-108): the card says so
  pass: { label: "Proven on history", variant: "profit" },
  fail: { label: "Lost on history", variant: "loss" },
  insufficient: { label: "Not enough trades yet", variant: "outline" },
  "control-ok": { label: "Control", variant: "outline" },
  "control-alarm": { label: "Control", variant: "warning" },
};
const DOT: Record<TradeHealth, string> = { good: "bg-profit", watch: "bg-warning", danger: "bg-loss" };
const WORSE: Record<TradeHealth, number> = { good: 0, watch: 1, danger: 2 };
/** The strikes and the expiry a trade sits on: what tells two trades of one strategy apart (ADR-110). */
const strikesOf = (s: Strategy) => `${[...new Set(s.legs.map((l) => fmtStrike(l.strike)))].join(" / ")}${s.legs.length ? ` · ${[...new Set(s.legs.map((l) => fmtExpiry(l.expiry)))].join(" / ")}` : ""}`;
const KIND: Record<AutopilotRun["kind"], { label: string; variant: "profit" | "outline" | "info" }> = { entered: { label: "Entered", variant: "profit" }, skipped: { label: "Skipped", variant: "outline" }, noted: { label: "Noted", variant: "info" } };
const nameOf = (playbookId: string) => AUTOPILOT_PLAYBOOKS.find((p) => p.id === playbookId)?.name ?? playbookId;
const isToday = (iso: string | null) => iso !== null && new Date(iso).toDateString() === new Date().toDateString();

export function AutopilotPage() {
  const router = useRouter();
  const view = useAutopilot();
  const save = useSaveAutopilot();
  const records = usePlaybookRecords();
  // the server opens and closes these trades by itself: the list is re-read as often as the log
  const strategies = useStrategies({ refetchInterval: AUTOPILOT_POLL_MS });
  const qc = useQueryClient();
  const stop = useStopStrategy();
  const feedLive = useConnectionStatus() === "open";
  const [exitId, setExitId] = useState<string | null>(null);
  const [stopAll, setStopAll] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [notClosed, setNotClosed] = useState<string[]>([]);
  // ADR-116: what the screen is narrowed to; both apply to the strategies, the running trades, the log and the results
  const [cadence, setCadence] = useState<PlaybookCadence | "all">("all");
  const [coin, setCoin] = useState<Coin | "all">("all");
  const results = useAutopilotResults();

  const mine = useMemo(() => (strategies.data ?? NONE).filter((s) => s.autopilotPlaybookId), [strategies.data]);
  const open = useMemo(() => mine.filter((s) => s.status === "paper"), [mine]);
  const book = usePaperBook(open);
  const money = book.money;
  const settings = view.data?.settings;
  const runs = view.data?.runs ?? NONE;

  // a list that is not read yet, or could not be read, is never shown as "no trades"
  if (view.isPending || strategies.isPending) return <main className="mx-auto max-w-[1280px] px-6 py-8" data-testid="autopilot-page" data-state="loading"><p className="text-xs text-muted-foreground">Loading Autopilot…</p></main>;
  if (view.isError || strategies.isError || !settings) return <main className="mx-auto max-w-[1280px] px-6 py-8" data-testid="autopilot-page" data-state="error"><EmptyState title="Autopilot could not be loaded" description="Check your connection and try again." action={<Button size="sm" onClick={() => { void view.refetch(); void strategies.refetch(); }}>Try again</Button>} /></main>;

  const update = (next: AutopilotSettings, done?: string) => save.mutate(next, { onSuccess: () => done && toast.success(done), onError: (e) => toast.error("Autopilot was not saved", { description: e.message }) });
  const switchedOn = (playbookId: string) => settings.strategies.find((s) => s.playbookId === playbookId);
  const toggle = (playbookId: string, on: boolean) => update({ ...settings, strategies: on ? [...settings.strategies, { playbookId, exit: AUTOPILOT_PLAYBOOKS.find((p) => p.id === playbookId)?.clock ? "own" : "trail" }] : settings.strategies.filter((s) => s.playbookId !== playbookId) });
  const setExit = (playbookId: string, exit: AutopilotExitStyle) => update({ ...settings, strategies: settings.strategies.map((s) => (s.playbookId === playbookId ? { ...s, exit } : s)) });

  /** Every open leg has a live price. Without one a leg reads as its entry price, which is neither a P&L nor a price to close at. */
  const priced = (s: Strategy) => feedLive && openLegs(s).every((l) => book.priceOf(s, l) !== null);
  const unpriced = open.filter((s) => !priced(s)).length;
  const today = mine.reduce((sum, s) => sum + (s.status === "paper" ? (priced(s) ? dayPnl(s, book.pnlOf(s).total) : 0) : isToday(s.closedAt) ? Number(s.realizedPnl) : 0), 0);
  const openIds = new Set(open.map((s) => s.id));
  const capital = capitalInUse(runs, openIds);
  // a sold strangle with no wings has no maximum loss: say so instead of adding it as nothing
  const unbounded = capitalUnbounded(runs, openIds);
  const exiting = open.find((s) => s.id === exitId);
  const shown = (playbookId: string | null | undefined, asset: string) => (cadence === "all" || cadenceOfId(playbookId) === cadence) && (coin === "all" || asset === coin);
  const openShown = open.filter((s) => shown(s.autopilotPlaybookId, s.asset));
  const runsShown = runs.filter((r) => shown(r.playbookId, r.asset));
  const filtered = cadence !== "all" || coin !== "all";
  /** Paper so far for one strategy (on the coin shown): closed trades, wins and the net after the estimated fees. */
  const paperOf = (playbookId: string) => {
    // a results read that has not come, or failed with nothing to show, is not "no trade"
    if (!results.data) return null;
    const rows = results.data.rows.filter((r) => r.playbookId === playbookId && (coin === "all" || r.asset === coin));
    return { open: rows.reduce((n, r) => n + r.open, 0), closed: rows.reduce((n, r) => n + r.closed, 0), wins: rows.reduce((n, r) => n + r.wins, 0), net: rows.reduce((n, r) => n + Math.round(Number(r.netUsd) * 100), 0) / 100 };
  };
  const toDesk = (s: Strategy) => {
    useUiStore.getState().followStrategy(s.id, true);
    router.push("/desk?tab=paper");
  };
  /**
   * Switch Autopilot off, then square off what it holds at the current prices, one trade after the other. The list is
   * read again once it is off (a pass may have entered since this page last read it); a trade with a leg that has no
   * live price is left open and named, and one refusal does not stop the rest.
   */
  const stopEverything = async () => {
    setStopping(true);
    setNotClosed([]);
    try {
      await save.mutateAsync({ ...settings, enabled: false });
      const held = (await qc.fetchQuery({ queryKey: strategyKeys.list(), queryFn: () => strategyFetchers().list(), staleTime: 0 })).filter((s) => s.autopilotPlaybookId && s.status === "paper");
      const left: string[] = [];
      for (const s of held) {
        if (!priced(s)) left.push(`${s.name} (${s.asset}): no live price for every leg`);
        else await stop.mutateAsync({ id: s.id, body: { archive: true, exits: priceMap(openLegs(s), (l) => book.priceOf(s, l)) } }).catch((e: Error) => left.push(`${s.name} (${s.asset}): ${e.message}`));
      }
      const closed = held.length - left.length;
      const said = held.length === 0 ? "It held no trades." : `${closed} of ${held.length} ${held.length === 1 ? "trade" : "trades"} closed at the current prices.`;
      setNotClosed(left);
      if (left.length) toast.error("Autopilot is off, but not every trade was closed", { description: said });
      else {
        toast.success("Autopilot is off", { description: said });
        setStopAll(false);
      }
    } catch (e) {
      toast.error("Autopilot was not switched off", { description: (e as Error).message });
    } finally {
      setStopping(false);
    }
  };

  return (
    <main className="mx-auto flex max-w-[1280px] flex-col gap-4 px-6 py-6" data-testid="autopilot-page" data-state="ready" data-enabled={settings.enabled}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <div className="flex items-center gap-2">
            <h1>Autopilot</h1>
            <Badge variant="info">Paper</Badge>
          </div>
          <p className="mt-1 max-w-[70ch] text-xs text-muted-foreground">Opens a paper trade when a strategy you switched on meets its conditions on the latest prices, with its exits attached. A strategy holds one trade per coin at a time and waits {AUTOPILOT_COOLDOWN_MINUTES} minutes after a trade ends. The evening strategies enter once a day and the weekly ones once a week, in their window. No real orders are placed.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs">
            <Switch checked={settings.enabled} disabled={save.isPending} onCheckedChange={(on) => update({ ...settings, enabled: on }, on ? "Autopilot is on" : "Autopilot is paused: no new entries")} aria-label="Autopilot" data-testid="autopilot-enabled" />
            <span>{settings.enabled ? "On" : "Off: no new entries"}</span>
          </label>
          <Button size="sm" variant="destructive" onClick={() => { setNotClosed([]); setStopAll(true); }} disabled={!settings.enabled && open.length === 0} data-testid="autopilot-stop-all">Stop everything</Button>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-x-6 gap-y-3 rounded border border-border p-4 sm:grid-cols-4" aria-label="Summary" data-testid="autopilot-summary">
        <div><div className="micro">Open trades</div><div className="num text-lg font-medium" data-testid="autopilot-open-count">{open.length}</div></div>
        <div><div className="micro">Capital in use</div><div className="num text-lg font-medium" data-testid="autopilot-capital">{!open.length ? "—" : unbounded ? "not bounded" : fmtMoney(capital, money)}</div><div className="text-2xs text-muted-foreground">{unbounded ? `a sold strangle with no wings has no maximum loss; the others ${fmtMoney(capital, money)}` : "the most the open trades can lose"}</div></div>
        <div><div className="micro">Today</div><div className={cn("num text-lg font-medium", today >= 0 ? "text-profit" : "text-loss")} data-testid="autopilot-today">{mine.length ? fmtMoney(today, money, { signed: true }) : "—"}</div><div className="text-2xs text-muted-foreground" data-testid="autopilot-today-note">{unpriced ? `${unpriced} open ${unpriced === 1 ? "trade has" : "trades have"} no live price and ${unpriced === 1 ? "is" : "are"} not counted` : "today's change of the open trades and the result of those closed today, before fees"}</div></div>
        <div><div className="micro">Strategies on</div><div className="num text-lg font-medium" data-testid="autopilot-on-count">{settings.strategies.length} of {TRADABLE.length}</div></div>
      </section>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded border border-border px-3 py-2" aria-label="Show" data-testid="autopilot-filters" data-filtered={filtered}>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Expiry">
          <span className="micro mr-1" aria-hidden="true">Expiry</span>
          <button type="button" className={chip(cadence === "all")} aria-pressed={cadence === "all"} onClick={() => setCadence("all")} data-testid="autopilot-filter-cadence" data-value="all">All · {TRADABLE.length}</button>
          {GROUPS.map((g) => (
            <button key={g.cadence} type="button" className={chip(cadence === g.cadence)} aria-pressed={cadence === g.cadence} onClick={() => setCadence(g.cadence)} data-testid="autopilot-filter-cadence" data-value={g.cadence}>{g.tab} · {g.items.length}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Coin">
          <span className="micro mr-1" aria-hidden="true">Coin</span>
          <button type="button" className={chip(coin === "all")} aria-pressed={coin === "all"} onClick={() => setCoin("all")} data-testid="autopilot-filter-coin" data-value="all">All</button>
          {COINS.map((a) => (
            <button key={a} type="button" className={chip(coin === a)} aria-pressed={coin === a} onClick={() => setCoin(a)} data-testid="autopilot-filter-coin" data-value={a}>{a} · {TRADABLE.filter((p) => (p.assets as readonly string[]).includes(a)).length}</button>
          ))}
        </div>
        {filtered ? <span className="text-2xs text-muted-foreground" data-testid="autopilot-filter-note">The strategies, the running trades, the log and the results below show this selection. The summary above is everything.</span> : null}
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <section className="flex min-w-0 flex-[999_1_640px] flex-col gap-3" aria-label="Strategies">
          <h2 className="text-sm">Strategies</h2>
          {GROUPS.filter((g) => cadence === "all" || g.cadence === cadence).map((g) => {
            const items = g.items.filter((p) => coin === "all" || (p.assets as readonly string[]).includes(coin));
            return (
              <div key={g.title} className="flex flex-col rounded border border-border" data-testid="autopilot-group" data-group={g.title}>
                <div className="border-b border-border px-3 py-2">
                  <h3 className="text-[13px] font-medium">{g.title}</h3>
                  <p className="text-2xs text-muted-foreground">{g.note}</p>
                </div>
                <div className={cn(ROW, "hidden border-b border-border px-3 py-1.5 md:grid")} aria-hidden="true" title="Backtest figures: BTC, 100 lots per option, after fees, on the days, weeks or entries tested">
                  <span className={HEAD}>Strategy</span><span className={HEAD}>How it gets out</span><span className={HEAD}>Backtest</span><span className={HEAD}>Paper so far</span><span className={HEAD}>Now</span>
                </div>
                {items.length === 0 ? <p className="px-3 py-3 text-2xs text-muted-foreground" data-testid="autopilot-group-empty">No {g.tab.toLowerCase()} strategy trades {coin} yet.</p> : null}
                {items.map((p) => {
                  const on = switchedOn(p.id);
                  const back = playbookBacktest(p.id);
                  const paper = paperOf(p.id);
                  return (
                    <article key={p.id} className={cn(ROW, "border-b border-border px-3 py-2.5 text-2xs last:border-b-0")} data-testid="autopilot-card" data-playbook={p.id} data-on={Boolean(on)}>
                      <div className="flex min-w-0 items-start gap-2">
                        <Switch checked={Boolean(on)} disabled={save.isPending} onCheckedChange={(v) => toggle(p.id, v)} aria-label={`${p.name} on Autopilot`} data-testid="autopilot-card-switch" />
                        <div className="min-w-0 flex-1">
                          <h4 className="text-[13px] font-medium">{p.name}</h4>
                          <p className="text-muted-foreground">{p.clock ? `Enters ${p.clock.describe}` : "Enters when its condition is met"}</p>
                          <details className="mt-1">
                            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">What it does</summary>
                            <p className="mt-1 text-muted-foreground">{p.summary}</p>
                            {p.clock ? (
                              <p className="mt-1 text-muted-foreground" data-testid="autopilot-card-how">Entered {p.clock.describe}. {p.clock.takeProfitOfCredit ? (p.clock.takeTrailPct ? `Once the trade is up by ${Math.round(p.clock.takeProfitOfCredit * 100)} % of the ${premiumWords(p) === "premium" ? "premium collected" : "net premium (collected less paid for the wings)"} it is not closed: it is trailed, and closed when the profit gives back ${p.clock.takeTrailPct} % of its best. ` : `The whole trade is closed once it is up by ${Math.round(p.clock.takeProfitOfCredit * 100)} % of the ${premiumWords(p) === "premium" ? "premium collected" : "net premium (collected less paid for the wings)"}. `) : ""}{p.clock.lock ? `Once the trade is up by ${Math.round(p.clock.lock.at * 100)} % of the premium a floor is set at ${Math.round(p.clock.lock.floor * 100)} %: the whole trade is closed if the profit falls back there. ` : ""}{p.clock.exitHourUtc !== undefined ? `Everything is closed at ${istClock(p.clock.exitHourUtc)} IST${nextDay(p.clock) ? " the next day" : ""}, whatever the profit. ` : ""}{p.clock.ladder ? `An equal part of the lots is closed each time the lots still open are up by ${p.clock.ladder.join(", ")} % of their premium, and the last part is held. ` : ""}{p.clock.legStop ? `Each sold option is bought back if its price reaches ${p.clock.legStop} times what it was sold for.` : p.clock.takeProfitOfCredit ? "No stop: the bought wings cap the loss, and it is held to settlement if the trail never closes it." : "Held to settlement: the bought wings cap the loss."}{p.clock.trailRestPct ? ` After that, the profit on the other one is trailed and it is closed when it gives back ${p.clock.trailRestPct} % of its best.` : ""} Backtest only so far: {p.evidence.claim}</p>
                            ) : (
                              <p className="mt-1 text-muted-foreground" data-testid="autopilot-card-how">Autopilot enters as above and keeps the stop and the time exit. It takes profit its own way, chosen below, so the record shown is the playbook's own exits, not Autopilot's.</p>
                            )}
                          </details>
                        </div>
                      </div>
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="micro md:sr-only">How it gets out</span>
                        <span>{exitWords(p)}</span>
                        {p.clock ? <span className="text-muted-foreground" data-testid="autopilot-card-own">{AUTOPILOT_EXIT_LABELS.own}</span> : null}
                        <select hidden={Boolean(p.clock)} value={on?.exit ?? "trail"} disabled={!on || save.isPending} onChange={(e) => setExit(p.id, e.target.value as AutopilotExitStyle)} className="h-7 w-full rounded border border-border bg-background px-1.5 text-2xs" aria-label={`${p.name}: how a winner is taken off`} data-testid="autopilot-card-exit">
                          {AUTOPILOT_CHOSEN_EXIT_STYLES.map((x) => <option key={x} value={x}>{AUTOPILOT_EXIT_LABELS[x]}</option>)}
                        </select>
                      </div>
                      <div className="flex min-w-0 flex-col gap-0.5" data-testid="autopilot-card-backtest">
                        <span className="micro md:sr-only">Backtest</span>
                        {back ? (
                          <>
                            <span className={cn("num", back.mean > 0 ? "text-profit" : back.mean < 0 ? "text-loss" : "")}>{fmtMoney(back.mean, money, { signed: true })} a {back.per}</span>
                            <span className="text-muted-foreground">{back.positivePct}% won · worst {fmtMoney(back.worst, money, { signed: true })}</span>
                            <span className="text-muted-foreground">{back.basis ?? `${back.samples} ${back.per}s tested`}</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">Recorded per coin, under Now</span>
                        )}
                      </div>
                      <div className="flex min-w-0 flex-col gap-0.5" data-testid="autopilot-card-paper">
                        <span className="micro md:sr-only">Paper so far</span>
                        {paper === null ? <span className="text-muted-foreground">{results.isError ? "Not loaded" : "…"}</span> : paper.closed + paper.open === 0 ? <span className="text-muted-foreground">No trade yet</span> : (
                          <>
                            <span className={cn("num", paper.closed === 0 ? "text-muted-foreground" : paper.net > 0 ? "text-profit" : paper.net < 0 ? "text-loss" : "")}>{paper.closed === 0 ? "Nothing closed yet" : `${fmtMoney(paper.net, money, { signed: true })} net`}</span>
                            <span className="text-muted-foreground">{paper.closed} closed{paper.closed ? ` · ${paper.wins} won` : ""}{paper.open ? ` · ${paper.open} open` : ""}</span>
                          </>
                        )}
                      </div>
                      <div className="flex min-w-0 flex-col gap-1.5">
                        <span className="micro md:sr-only">Now</span>
                        {ASSETS.filter((a) => (p.assets as readonly string[]).includes(a) && (coin === "all" || a === coin)).map((asset) => {
                          const rec = recordFor(records.data, p.id, asset);
                          // a strategy may hold several trades on one coin, each on its own strikes (ADR-110): the row adds them up
                          const trades = open.filter((s) => s.autopilotPlaybookId === p.id && s.asset === asset);
                          const last = latestRun(runs, p.id, asset);
                          const pnl = trades.reduce((sum, s) => sum + book.pnlOf(s).total, 0);
                          const worst = trades.map((s) => tradeHealth(book.pnlOf(s).total, autopilotLevels(s).stopUsd).health).sort((a, b) => WORSE[b] - WORSE[a])[0] ?? "good";
                          const held = trades.length === 1 ? "In a trade" : `In ${trades.length} trades`;
                          return (
                            <div key={asset} className="flex min-w-0 flex-col gap-0.5" data-testid="autopilot-card-asset" data-asset={asset}>
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                <b className="font-mono">{asset}</b>
                                {rec ? <Badge variant={RECORD[rec.status].variant}>{RECORD[rec.status].label}</Badge> : <Badge variant="outline">{p.clock ? "Backtest only" : "No record yet"}</Badge>}
                                {rec ? <span className="text-muted-foreground">{rec.stats.trades} past trades{rec.stats.winRate === null ? "" : ` · ${Math.round(rec.stats.winRate * 100)}% won`}</span> : null}
                              </div>
                              {trades.length > 0 && trades.every(priced) ? (
                                <div className="flex items-center gap-1.5" data-testid="autopilot-card-state"><span className={cn("size-2 rounded-full", DOT[worst])} aria-hidden="true" />{held} <span className={cn("num ml-auto", pnl >= 0 ? "text-profit" : "text-loss")}>{fmtMoney(pnl, money, { signed: true })}</span></div>
                              ) : trades.length > 0 ? (
                                <div className="flex items-center gap-1.5" data-testid="autopilot-card-state"><span className="size-2 rounded-full bg-muted-foreground" aria-hidden="true" />{held} <span className="ml-auto text-muted-foreground">waiting for prices</span></div>
                              ) : (
                                // only a skip is a reason for not being in a trade; an older "entered" or "noted" line is about a trade that has ended
                                <div className="text-muted-foreground" data-testid="autopilot-card-state">{!on ? "Switched off" : !settings.enabled ? "Autopilot is off" : !last ? "Watching: no decision logged yet" : last.kind !== "skipped" ? "Waiting for the next check" : `${last.reason}${last.detail.capital ? ` · needs ${fmtMoney(last.detail.capital, money)}` : ""}`}</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </article>
                  );
                })}
              </div>
            );
          })}
        </section>

        <aside className="flex min-w-0 flex-[1_1_360px] flex-col gap-4">
          <section className="flex flex-col gap-3 rounded border border-border p-3" aria-label="Running trades" data-testid="autopilot-running">
            <h2 className="text-sm">Running now</h2>
            {open.length === 0 ? <EmptyState title="No Autopilot trade is open" description={settings.enabled ? "It enters when a strategy you switched on meets its conditions." : "Switch Autopilot on to let it enter."} className="py-4" /> : null}
            {open.length > 0 && openShown.length === 0 ? <p className="text-2xs text-muted-foreground" data-testid="autopilot-running-none">No open trade in this selection ({open.length} open in all).</p> : null}
            {openShown.map((s) => {
              const pnl = book.pnlOf(s).total;
              const lv = autopilotLevels(s);
              // no health without a price for every leg: a feed that is down must not read as "On track"
              const h = priced(s) ? tradeHealth(pnl, lv.stopUsd) : null;
              return (
                <div key={s.id} className="flex flex-col gap-1.5 rounded border border-border p-2.5 text-xs" data-testid="autopilot-trade" data-id={s.id} data-health={h?.health ?? "unknown"}>
                  <div className="flex items-center gap-2">
                    <span className={cn("size-2.5 shrink-0 rounded-full", h ? DOT[h.health] : "bg-muted-foreground")} aria-hidden="true" />
                    <b className="min-w-0 flex-1 truncate font-medium">{nameOf(s.autopilotPlaybookId!)} · {s.asset}</b>
                    {h ? <Badge variant={h.health === "good" ? "profit" : h.health === "danger" ? "loss" : "warning"}>{HEALTH_LABELS[h.health]}</Badge> : <Badge variant="outline">No live price</Badge>}
                  </div>
                  {h && h.usedPct !== null ? (
                    <div className="h-1.5 overflow-hidden rounded bg-muted" role="img" aria-label={`${Math.round(h.usedPct)} percent of the allowed loss is used`}><div className={cn("h-full", DOT[h.health])} style={{ width: `${h.usedPct}%` }} /></div>
                  ) : null}
                  <div className="flex justify-between gap-2"><span className="text-muted-foreground">Strikes</span><span className="num" data-testid="autopilot-trade-strikes">{strikesOf(s)}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-muted-foreground">Now</span><span className={cn("num", !h ? "text-muted-foreground" : pnl >= 0 ? "text-profit" : "text-loss")} data-testid="autopilot-trade-pnl">{h ? fmtMoney(pnl, money, { signed: true }) : "waiting for prices"}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-muted-foreground">{lv.trails ? (lv.trailExitUsd !== null ? "Trailing: exits at" : "Starts trailing at") : "Closes in profit at"}</span><span className="num">{lv.trailExitUsd !== null ? fmtMoney(lv.trailExitUsd, money, { signed: true }) : lv.targetUsd !== null ? fmtMoney(lv.targetUsd, money, { signed: true }) : lv.closesAtMs !== undefined ? "no level: closed by the clock" : "no level: held to settlement"}</span></div>
                  {lv.closesAtMs === undefined ? null : (
                    <div className="flex justify-between gap-2" data-testid="autopilot-trade-closes-at"><span className="text-muted-foreground">Closes at</span><span>{fmtDateTime(new Date(lv.closesAtMs).toISOString())}, whatever the profit</span></div>
                  )}
                  <div className="flex justify-between gap-2"><span className="text-muted-foreground">Stop closes it at</span><span className="num">{lv.stopUsd !== null ? fmtMoney(-lv.stopUsd, money, { signed: true }) : lv.legStop !== null ? `each sold option at ${lv.legStop} times its price${lv.legStopTrailPct !== null ? ", then the other side is trailed" : ""}` : "no stop: held to its exit or settlement"}</span></div>
                  {lv.restTrailExitUsd !== undefined ? (
                    <div className="flex justify-between gap-2" data-testid="autopilot-trade-rest-trail"><span className="text-muted-foreground">Trailing what is left</span><span className="num">{lv.restTrailExitUsd === null ? "starts once it is in profit" : `closes if its profit falls to ${fmtMoney(lv.restTrailExitUsd, money, { signed: true })}`}</span></div>
                  ) : null}
                  <div className="flex justify-between gap-2"><span className="text-muted-foreground">Opened</span><span>{fmtDateTime(s.startedAt)}</span></div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <Button size="xs" variant="destructive" onClick={() => setExitId(s.id)} data-testid="autopilot-trade-exit">Exit now</Button>
                    <Button size="xs" variant="outline" onClick={() => toDesk(s)} data-testid="autopilot-trade-desk">Open on the Desk</Button>
                  </div>
                </div>
              );
            })}
          </section>

          <section className="flex flex-col gap-1 rounded border border-border p-3" aria-label="Log" data-testid="autopilot-log">
            <h2 className="mb-1 text-sm">Log</h2>
            {runs.length === 0 ? <p className="text-2xs text-muted-foreground">Nothing yet. A line appears for every entry and for every reason not to enter.</p> : null}
            {runs.length > 0 && runsShown.length === 0 ? <p className="text-2xs text-muted-foreground" data-testid="autopilot-log-none">No log line in this selection.</p> : null}
            <ul className="max-h-[420px] overflow-y-auto">
              {runsShown.slice(0, 60).map((r) => (
                <li key={r.id} className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 border-t border-border py-1.5 text-2xs first:border-t-0" data-testid="autopilot-run" data-kind={r.kind}>
                  <Badge variant={KIND[r.kind].variant}>{KIND[r.kind].label}</Badge>
                  <span className="min-w-0 truncate font-medium">{nameOf(r.playbookId)} · {r.asset}</span>
                  <span className="num text-muted-foreground">{fmtDateTime(r.at)}</span>
                  <span className="text-muted-foreground">{r.reason}{r.detail.dte !== undefined ? ` · ${r.detail.dte}d to expiry` : ""}{r.kind === "entered" && r.detail.capital ? ` · capital ${fmtMoney(r.detail.capital, money)}` : ""}{r.kind === "entered" && r.detail.move ? ` · ${moveWords(r.asset, r.detail.move)}` : ""}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      <AutopilotResultsPanel money={money} show={filtered ? shown : undefined} />

      {exiting ? <StopPaperDialog open onOpenChange={(o) => !o && setExitId(null)} strategy={exiting} priceOf={(l) => book.priceOf(exiting, l)} total={book.pnlOf(exiting).total} money={money} live={feedLive} onDone={() => setExitId(null)} /> : null}

      <Dialog open={stopAll} onOpenChange={(o) => !stopping && setStopAll(o)}>
        <DialogContent className="sm:max-w-[440px]" data-testid="autopilot-stop-dialog">
          <DialogHeader>
            <DialogTitle>Stop everything</DialogTitle>
            <DialogDescription>Autopilot is switched off and {open.length === 0 ? "it holds no trades to close" : `its ${open.length} open paper ${open.length === 1 ? "trade is" : "trades are"} closed at the current prices`}. A trade with no live price is left open and named here. Your own trades are not touched.</DialogDescription>
          </DialogHeader>
          <DialogBody className="text-xs">
            {open.length > 0 && !feedLive ? <p className="text-warning" role="alert" data-testid="autopilot-stop-wait">Waiting for live prices: the trades cannot be closed at a price yet.</p> : null}
            {notClosed.length ? (
              <div role="alert" data-testid="autopilot-stop-left">
                <p className="text-loss">Autopilot is off. Still open:</p>
                <ul className="mt-1 list-disc pl-4">{notClosed.map((n) => <li key={n}>{n}</li>)}</ul>
              </div>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStopAll(false)} disabled={stopping}>Cancel</Button>
            <Button variant="destructive" loading={stopping} disabled={open.length > 0 && !feedLive} onClick={() => void stopEverything()} data-testid="autopilot-stop-confirm">Stop everything</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
