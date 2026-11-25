"use client";
// Autopilot (ADR-108, ADR-109, ADR-116, ADR-139, ADR-142; HC-TR-219, HC-TR-220, HC-TR-232, HC-TR-267, HC-TR-279): the master switch and a
// summary that stay on top, then four views that each take the full width: the trades Autopilot holds (worst first,
// with a health reading and an exit), the closed trades by day with the results, the strategies as rows (each with
// its switch, exits, backtest, paper result and what it is doing now) and the log. The expiry, the coin and the
// search narrow every view.
// Paper only. Figures in USD are shown in the trader's display currency.
import { type Playbook, type PlaybookCadence, playbookCadence } from "@hapiecoin/pricing";
import { AUTOPILOT_CHOSEN_EXIT_STYLES, AUTOPILOT_COOLDOWN_MINUTES, AUTOPILOT_EXIT_LABELS, type AutopilotExitStyle, type AutopilotRun, type AutopilotSettings, type PlaybookStatus, type Strategy } from "@hapiecoin/schema";
import { Badge, Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, Switch, cn, toast } from "@hapiecoin/ui";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { type KeyboardEvent, useMemo, useState } from "react";
import { StopPaperDialog } from "@/components/trading/StopPaperDialog";
import { AutopilotResultsPanel, count, dayOf } from "./AutopilotResultsPanel";
import { AUTOPILOT_POLL_MS, useAutopilot, useAutopilotResults, useSaveAutopilot } from "@/lib/api/autopilot";
import { recordFor, usePlaybookRecords } from "@/lib/api/playbooks";
import { strategyFetchers, strategyKeys, useStopStrategy, useStrategies } from "@/lib/api/strategies";
import { fmtDateTime, fmtExpiry, fmtStrike } from "@/lib/format";
import { useConnectionStatus } from "@/lib/gateway/hooks";
import { fmtMoney } from "@/lib/money";
import { useUiStore } from "@/lib/store";
import { HEALTH_LABELS, type TradeHealth, autopilotLevels, capitalInUse, capitalUnbounded, latestRun, tradeHealth } from "@/lib/strategy/autopilot";
import { catalogueOf } from "@/lib/strategy/autopilot-catalogue";
import { exitTags, hasWings, istClock, moveWords, nextDay, premiumWords } from "@/lib/strategy/autopilot-words";
import { dayPnl, openLegs, priceMap } from "@/lib/strategy/paper";
import { usePaperBook } from "@/lib/strategy/usePaper";

// (kept as exports of the screen: its tests and the admin page read them from here or from the shared file)
export { exitTags, istClock, moveWords };
const NONE: never[] = [];
const ASSETS = ["BTC", "ETH", "XAUT"] as const;
type Coin = (typeof ASSETS)[number];
// ADR-116: the strategies by how often they trade, in the order of the list; a family with no strategy is not shown
const CADENCE: Record<PlaybookCadence, { tab: string; title: string; note: string }> = {
  trend: { tab: "Trend", title: "Longer-dated strategies", note: "Entered whenever their market condition is met." },
  daily: { tab: "Daily", title: "Evening strangles, daily expiry", note: "Entered every evening for the next day's expiry." },
  weekly: { tab: "Weekly", title: "Weekly strangles, Friday expiry", note: "Entered once a week, on a Friday or a Tuesday evening, for the Friday expiry." },
  monthly: { tab: "Monthly", title: "Monthly strangles, month-end expiry", note: "Entered one to two months before the month-end expiry." },
};
/** How a strategy gets out, in a few words: the sentence behind the tags. */
const exitWords = (p: Playbook): string => {
  const c = p.clock;
  if (!c) return "Playbook stop and time exit";
  // with neither a stop nor bought options nothing limits the loss (a saved strategy may be so, HC-TR-279): never "wings"
  const guard = c.legStop ? `Stop at ${c.legStop}x on each sold option` : !hasWings(p) ? (c.takeProfitOfCredit ? "No stop and no wings: the loss is not limited" : "No stop and no wings: the loss is not limited, held to expiry") : c.takeProfitOfCredit ? "Wings cap the loss, no stop" : "Wings cap the loss, held to expiry";
  const parts = [guard];
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
const chip = (on: boolean) => cn("h-7 rounded border border-border px-2.5 text-xs", on ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground");
const HEAD = "micro hidden md:block";
// ADR-139: the views of the screen, each the full width; a view that is not shown stays mounted, so what was opened in it is kept
const TABS = ["open", "closed", "strategies", "activity"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { open: "Open trades", closed: "Closed trades", strategies: "Strategies", activity: "Log" };
type StrategyState = "all" | "on" | "in" | "off";
const STATE_LABEL: Record<StrategyState, string> = { all: "All", on: "Switched on", in: "In a trade", off: "Switched off" };
type Sort = "list" | "paper" | "backtest";
const LOG_PAGE = 100;
/** How far from its entry price to its own stop a sold option is "close to its stop": three quarters, as for a whole-trade stop. */
export const NEAR_LEG_STOP = 0.75;
const TH = "micro whitespace-nowrap px-1.5 py-2 text-left font-normal sm:px-2.5";
const THN = "micro whitespace-nowrap px-1.5 py-2 text-right font-normal sm:px-2.5";
const TD = "px-1.5 py-2 align-middle sm:px-2.5";
const TDN = "num whitespace-nowrap px-1.5 py-2 text-right align-middle sm:px-2.5";
// a figure with words or several strikes: it wraps, so that the open trades never need a sideways scroll (ADR-139)
const TDW = "num px-1.5 py-2 text-right align-middle sm:px-2.5";
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
// a shape beside the word, so that the health is not told by colour alone
const SHAPE: Record<TradeHealth, string> = { good: "●", watch: "▲", danger: "■" };
const SHAPE_TONE: Record<TradeHealth, string> = { good: "text-profit", watch: "text-warning", danger: "text-loss" };
const KIND_SHAPE: Record<AutopilotRun["kind"], string> = { entered: "✓", skipped: "–", noted: "i" };
/** The strikes and the expiry a trade sits on: what tells two trades of one strategy apart (ADR-110). */
const strikesOf = (s: Strategy) => `${[...new Set(s.legs.map((l) => fmtStrike(l.strike)))].join(" / ")}${s.legs.length ? ` · ${[...new Set(s.legs.map((l) => fmtExpiry(l.expiry)))].join(" / ")}` : ""}`;
const KIND: Record<AutopilotRun["kind"], { label: string; variant: "profit" | "outline" | "info" }> = { entered: { label: "Entered", variant: "profit" }, skipped: { label: "Skipped", variant: "outline" }, noted: { label: "Noted", variant: "info" } };
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
  const [tab, setTab] = useState<Tab>("open");
  const [search, setSearch] = useState("");
  const [state, setState] = useState<StrategyState>("all");
  const [sort, setSort] = useState<Sort>("list");
  const [more, setMore] = useState<ReadonlySet<string>>(new Set());
  const [kind, setKind] = useState<AutopilotRun["kind"] | "all">("all");
  const [logDay, setLogDay] = useState("all");
  const [logLimit, setLogLimit] = useState(LOG_PAGE);
  // the order of the open trades while the pointer is on their table: a row must not move under a press on Exit now
  const [held, setHeld] = useState<readonly string[] | null>(null);

  const mine = useMemo(() => (strategies.data ?? NONE).filter((s) => s.autopilotPlaybookId), [strategies.data]);
  const open = useMemo(() => mine.filter((s) => s.status === "paper"), [mine]);
  const book = usePaperBook(open);
  const money = book.money;
  const settings = view.data?.settings;
  const runs = view.data?.runs ?? NONE;
  // the built-in strategies (never the control), the ones entered by the clock (ADR-112), and beside them the saved
  // ones the server says this trader may use (ADR-142, HC-TR-279)
  const catalogue = useMemo(() => catalogueOf(view.data?.saved), [view.data?.saved]);

  // a list that is not read yet, or could not be read, is never shown as "no trades"
  if (view.isPending || strategies.isPending) return <main className="mx-auto max-w-[1280px] px-6 py-8" data-testid="autopilot-page" data-state="loading"><p className="text-xs text-muted-foreground">Loading Autopilot…</p></main>;
  if (view.isError || strategies.isError || !settings) return <main className="mx-auto max-w-[1280px] px-6 py-8" data-testid="autopilot-page" data-state="error"><EmptyState title="Autopilot could not be loaded" description="Check your connection and try again." action={<Button size="sm" onClick={() => { void view.refetch(); void strategies.refetch(); }}>Try again</Button>} /></main>;

  const TRADABLE = catalogue.tradable;
  const offered = new Set(TRADABLE.map((p) => p.id));
  const onCount = settings.strategies.filter((x) => offered.has(x.playbookId)).length;
  const gone = settings.strategies.filter((x) => !offered.has(x.playbookId)).map((x) => catalogue.nameOf(x.playbookId));
  const CADENCES = (["trend", "daily", "weekly", "monthly"] as const).filter((c) => TRADABLE.some((p) => playbookCadence(p) === c));
  const GROUPS = CADENCES.map((c) => ({ cadence: c, ...CADENCE[c], items: TRADABLE.filter((p) => playbookCadence(p) === c) }));
  const COINS = ASSETS.filter((a) => TRADABLE.some((p) => (p.assets as readonly string[]).includes(a)));
  const cadenceOfId = catalogue.cadenceOf;
  const nameOf = catalogue.nameOf;
  const update = (next: AutopilotSettings, done?: string) => save.mutate(next, { onSuccess: () => done && toast.success(done), onError: (e) => toast.error("Autopilot was not saved", { description: e.message }) });
  const switchedOn = (playbookId: string) => settings.strategies.find((s) => s.playbookId === playbookId);
  const toggle = (playbookId: string, on: boolean) => update({ ...settings, strategies: on ? [...settings.strategies, { playbookId, exit: catalogue.find(playbookId)?.clock ? "own" : "trail" }] : settings.strategies.filter((s) => s.playbookId !== playbookId) });
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
  const q = search.trim().toLowerCase();
  const shown = (playbookId: string | null | undefined, asset: string) => (cadence === "all" || cadenceOfId(playbookId) === cadence) && (coin === "all" || asset === coin) && (q === "" || nameOf(playbookId ?? "").toLowerCase().includes(q));
  const openShown = open.filter((s) => shown(s.autopilotPlaybookId, s.asset));
  const runsShown = runs.filter((r) => shown(r.playbookId, r.asset));
  const filtered = cadence !== "all" || coin !== "all" || q !== "";
  /** Paper so far for one strategy (on the coin shown): closed trades, wins and the net after the estimated fees. */
  const paperOf = (playbookId: string) => {
    // a results read that has not come, or failed with nothing to show, is not "no trade"
    if (!results.data) return null;
    const rows = results.data.rows.filter((r) => r.playbookId === playbookId && (coin === "all" || r.asset === coin));
    return { open: rows.reduce((n, r) => n + r.open, 0), closed: rows.reduce((n, r) => n + r.closed, 0), wins: rows.reduce((n, r) => n + r.wins, 0), net: rows.reduce((n, r) => n + Math.round(Number(r.netUsd) * 100), 0) / 100 };
  };
  /**
   * A sold option three quarters of the way from the price it was sold at to its own stop (ADR-112): the health reading
   * knows only a stop on the whole trade, and most strangles are stopped option by option.
   */
  const legNearStop = (s: Strategy, legStop: number | null): boolean =>
    legStop !== null &&
    openLegs(s).some((l) => {
      const now = book.priceOf(s, l);
      const entry = Number(l.entryPrice ?? l.price);
      return l.side === "sell" && now !== null && entry > 0 && Number(now) >= entry * (1 + NEAR_LEG_STOP * (legStop - 1));
    });
  const reading = (s: Strategy) => {
    const pnl = book.pnlOf(s).total;
    const lv = autopilotLevels(s);
    // no health without a price for every leg: a feed that is down must not read as "On track"
    const h = priced(s) ? tradeHealth(pnl, lv.stopUsd) : null;
    return { s, pnl, lv, h, near: h !== null && legNearStop(s, lv.legStop) };
  };
  // the open trades with their reading, worst first: no live price, close to a stop, losing, on track; then the largest loss
  const rank = (r: { h: { health: TradeHealth } | null; near: boolean }) => (r.h === null ? 0 : r.h.health === "danger" || r.near ? 1 : r.h.health === "watch" ? 2 : 3);
  const sorted = openShown.map(reading).sort((a, b) => rank(a) - rank(b) || a.pnl - b.pnl);
  const place = (id: string) => (held?.includes(id) ? held.indexOf(id) : Number.MAX_SAFE_INTEGER);
  // (a held order none of whose trades is left is a table that went away under the pointer: it holds nothing)
  const holding = held !== null && sorted.some((r) => held.includes(r.s.id));
  const rated = holding ? [...sorted].sort((a, b) => place(a.s.id) - place(b.s.id)) : sorted;
  const attention = open.map(reading).filter((r) => rank(r) <= 1).length;
  const openPnl = open.reduce((cents, s) => cents + (priced(s) ? Math.round(book.pnlOf(s).total * 100) : 0), 0) / 100;
  const stratShown = (p: Playbook) => (q === "" || p.name.toLowerCase().includes(q)) && (state === "all" || (state === "in" ? open.some((s) => s.autopilotPlaybookId === p.id && (coin === "all" || s.asset === coin)) : Boolean(switchedOn(p.id)) === (state === "on")));
  const score = (p: Playbook): number => {
    if (sort === "backtest") return catalogue.backtestOf(p.id)?.mean ?? -Infinity;
    const paper = paperOf(p.id);
    return paper && paper.closed ? paper.net : -Infinity;
  };
  const ordered = (items: Playbook[]) => (sort === "list" ? items : [...items].sort((a, b) => (score(a) === score(b) ? 0 : score(b) > score(a) ? 1 : -1)));
  const logDays = [...new Set(runsShown.map((r) => dayOf(r.at)))];
  // a day that has left the selection is not kept as an empty list
  const logDayShown = logDays.includes(logDay) ? logDay : "all";
  const runsOnDay = runsShown.filter((r) => logDayShown === "all" || dayOf(r.at) === logDayShown);
  const logList = runsOnDay.filter((r) => kind === "all" || r.kind === kind);
  const counts: Record<Tab, number | null> = {
    open: openShown.length,
    // a results read that has not come is not "0 closed"
    closed: !results.data ? null : filtered ? results.data.rows.filter((r) => shown(r.playbookId, r.asset)).reduce((n, r) => n + r.closed, 0) : results.data.total.closed,
    strategies: GROUPS.filter((g) => cadence === "all" || g.cadence === cadence).reduce((n, g) => n + g.items.filter((p) => (coin === "all" || (p.assets as readonly string[]).includes(coin)) && stratShown(p)).length, 0),
    activity: runsShown.length,
  };
  const panel = (t: Tab) => ({ role: "tabpanel" as const, id: `autopilot-panel-${t}`, "aria-labelledby": `autopilot-tab-${t}`, hidden: tab !== t, tabIndex: 0, "data-testid": "autopilot-panel", "data-value": t });
  // the arrow keys move along the views, as a tab list is expected to
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length]!;
    setTab(next);
    document.getElementById(`autopilot-tab-${next}`)?.focus();
  };
  const toDesk = (s: Strategy) => {
    useUiStore.getState().followStrategy(s.id, true);
    // HC-TR-268: the list on the Desk is paged and sorted; the link names the trade so that the list turns to its card
    router.push(`/desk?tab=paper&strategy=${encodeURIComponent(s.id)}`);
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
    <main className="mx-auto flex max-w-[1560px] flex-col gap-4 px-4 py-5 sm:px-6" data-testid="autopilot-page" data-state="ready" data-enabled={settings.enabled}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1>Autopilot</h1>
            <Badge variant="info">Paper</Badge>
          </div>
          <details className="mt-1" data-testid="autopilot-about">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">How Autopilot works</summary>
            <p className="mt-1 max-w-[80ch] text-xs text-muted-foreground">Opens a paper trade when a strategy you switched on meets its conditions on the latest prices, with its exits attached. A strategy holds one trade per coin at a time and waits {AUTOPILOT_COOLDOWN_MINUTES} minutes after a trade ends. The evening strategies enter once a day and the weekly ones once a week, in their window. No real orders are placed.</p>
          </details>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={settings.enabled} disabled={save.isPending} onCheckedChange={(on) => update({ ...settings, enabled: on }, on ? "Autopilot is on" : "Autopilot is paused: no new entries")} aria-label="Autopilot" data-testid="autopilot-enabled" />
            <span>{settings.enabled ? "On" : "Off: no new entries"}</span>
          </label>
          <Button size="sm" variant="destructive" onClick={() => { setNotClosed([]); setStopAll(true); }} disabled={!settings.enabled && open.length === 0} data-testid="autopilot-stop-all">Stop everything</Button>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-x-6 gap-y-3 rounded border border-border p-4 md:grid-cols-3 xl:grid-cols-6" aria-label="Summary" data-testid="autopilot-summary">
        <div><div className="micro">Open trades</div><div className="num text-lg font-medium" data-testid="autopilot-open-count">{open.length}</div><div className={cn("text-xs", attention ? "text-loss" : "text-muted-foreground")} data-testid="autopilot-attention">{!open.length ? "" : attention ? `■ ${attention} ${attention === 1 ? "needs" : "need"} attention` : "● none needs attention"}</div></div>
        <div><div className="micro">Open profit or loss</div><div className={cn("num text-lg font-medium", !open.length || unpriced === open.length ? "" : openPnl >= 0 ? "text-profit" : "text-loss")} data-testid="autopilot-open-pnl">{!open.length || unpriced === open.length ? "—" : fmtMoney(openPnl, money, { signed: true })}</div><div className="text-xs text-muted-foreground">{unpriced ? `${open.length - unpriced} of ${open.length} trades have a live price` : "the open trades at the live prices, before fees"}</div></div>
        <div><div className="micro">Today</div><div className={cn("num text-lg font-medium", today >= 0 ? "text-profit" : "text-loss")} data-testid="autopilot-today">{mine.length ? fmtMoney(today, money, { signed: true }) : "—"}</div><div className="text-xs text-muted-foreground" data-testid="autopilot-today-note">{unpriced ? `${unpriced} open ${unpriced === 1 ? "trade has" : "trades have"} no live price and ${unpriced === 1 ? "is" : "are"} not counted` : "today's change of the open trades and the result of those closed today, before fees"}</div></div>
        <div><div className="micro">Capital in use</div><div className="num text-lg font-medium" data-testid="autopilot-capital">{!open.length ? "—" : unbounded ? "not bounded" : fmtMoney(capital, money)}</div><div className="text-xs text-muted-foreground">{unbounded ? `a sold strangle with no wings has no maximum loss; the others ${fmtMoney(capital, money)}` : "the most the open trades can lose"}</div></div>
        <div><div className="micro">Closed trades, net</div><div className={cn("num text-lg font-medium", !results.data || !results.data.total.closed ? "" : Number(results.data.total.netUsd) >= 0 ? "text-profit" : "text-loss")} data-testid="autopilot-closed-net">{!results.data ? (results.isError ? "Not loaded" : "…") : results.data.total.closed ? fmtMoney(results.data.total.netUsd, money, { signed: true }) : "—"}</div><div className="text-xs text-muted-foreground">{results.data ? `${results.data.total.closed} closed · ${results.data.total.wins} won, after estimated fees` : "every closed paper trade, after estimated fees"}</div></div>
        <div><div className="micro">Strategies on</div><div className="num text-lg font-medium" data-testid="autopilot-on-count">{onCount} of {TRADABLE.length}</div>{gone.length > 0 ? <div className="text-xs text-muted-foreground" data-testid="autopilot-gone">{gone.length === 1 ? "1 strategy you had on is no longer offered and has stopped entering" : `${gone.length} strategies you had on are no longer offered and have stopped entering`}</div> : null}</div>
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
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search a strategy by name" aria-label="Search a strategy by name" className="h-7 min-w-[200px] max-w-[320px] flex-1 rounded border border-border bg-background px-2 text-xs" data-testid="autopilot-search" />
        {filtered ? <span className="text-xs text-muted-foreground" data-testid="autopilot-filter-note">The strategies, the running trades, the log and the results below show this selection. The summary above is everything.</span> : null}
      </div>

      <div className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border" role="tablist" aria-label="Autopilot views" data-testid="autopilot-tabs">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" id={`autopilot-tab-${t}`} aria-selected={tab === t} aria-controls={`autopilot-panel-${t}`} tabIndex={tab === t ? 0 : -1} onKeyDown={onTabKey} onClick={() => setTab(t)} className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm", tab === t ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")} data-testid="autopilot-tab" data-value={t}>
            {TAB_LABEL[t]} <span className="num ml-1 text-xs text-muted-foreground" data-testid="autopilot-tab-count">{counts[t] ?? (results.isError ? "not loaded" : "…")}</span>
          </button>
        ))}
      </div>

      <div {...panel("open")}>
        <section className="flex flex-col gap-3" aria-label="Running trades" data-testid="autopilot-running">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h2 className="text-sm">Running now</h2>
            {rated.length > 1 ? <p className="text-xs text-muted-foreground" data-testid="autopilot-running-order">What needs attention comes first: no live price, then close to a stop, then losing; within each, the largest loss first.</p> : null}
          </div>
          {open.length === 0 ? <EmptyState title="No Autopilot trade is open" description={settings.enabled ? "It enters when a strategy you switched on meets its conditions." : "Switch Autopilot on to let it enter."} className="py-4" /> : null}
          {open.length > 0 && openShown.length === 0 ? <p className="text-xs text-muted-foreground" data-testid="autopilot-running-none">No open trade in this selection ({open.length} open in all).</p> : null}
          {rated.length > 0 ? (
            <div className="rounded border border-border" onPointerEnter={() => setHeld(sorted.map((r) => r.s.id))} onPointerLeave={() => setHeld(null)} data-testid="autopilot-running-table" data-held={holding}>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className={cn(TH, "hidden lg:table-cell")}>Health</th>
                    <th scope="col" className={TH}>Strategy</th>
                    <th scope="col" className={cn(THN, "hidden sm:table-cell")}>Strikes and expiry</th>
                    <th scope="col" className={cn(TH, "hidden lg:table-cell")}>Opened</th>
                    <th scope="col" className={THN}>Profit or loss now</th>
                    <th scope="col" className={cn(THN, "hidden lg:table-cell")}>Loss used</th>
                    <th scope="col" className={cn(THN, "hidden xl:table-cell")}>Profit exit</th>
                    <th scope="col" className={cn(THN, "hidden xl:table-cell")}>Stop</th>
                    <th scope="col" className={TH}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                {rated.map(({ s, pnl, lv, h, near }) => (
                  <tbody key={s.id} className="border-b border-border last:border-b-0" data-testid="autopilot-trade" data-id={s.id} data-health={h?.health ?? "unknown"} data-near={near}>
                    {/* HC-TR-268: a press anywhere on the row (not on a button) opens the trade on the Desk; the button is the keyboard's way */}
                    <tr className="cursor-pointer hover:bg-muted/40" title="Open this trade on the Desk" onClick={(e) => { if (!(e.target as HTMLElement).closest("button")) toDesk(s); }} data-testid="autopilot-trade-row">
                      <td className={cn(TD, "hidden w-[1%] lg:table-cell")}>
                        <span className="flex flex-wrap items-center gap-1.5 whitespace-nowrap">
                          <span className={cn("text-[10px]", h ? SHAPE_TONE[h.health] : "text-muted-foreground")} aria-hidden="true">{h ? SHAPE[h.health] : "◆"}</span>
                          {h ? <Badge variant={h.health === "good" ? "profit" : h.health === "danger" ? "loss" : "warning"}>{HEALTH_LABELS[h.health]}</Badge> : <Badge variant="outline">No live price</Badge>}
                          {near ? <Badge variant="loss" data-testid="autopilot-trade-near">An option is close to its stop</Badge> : null}
                        </span>
                      </td>
                      <th scope="row" className={cn(TD, "text-left font-medium")}>
                        {nameOf(s.autopilotPlaybookId!)} · {s.asset}
                        {/* a narrower screen has no Health column, and the narrowest no Strikes column: they read under the name */}
                        <span className={cn("mt-0.5 block text-xs font-normal lg:hidden", h ? SHAPE_TONE[h.health] : "text-muted-foreground")} data-testid="autopilot-trade-narrow">{h ? `${SHAPE[h.health]} ${HEALTH_LABELS[h.health]}` : "◆ No live price"}{near ? " · an option is close to its stop" : ""}</span>
                        <span className="num block text-xs font-normal text-muted-foreground sm:hidden">{strikesOf(s)}</span>
                      </th>
                      <td className={cn(TDW, "hidden sm:table-cell")} data-testid="autopilot-trade-strikes">{strikesOf(s)}</td>
                      <td className={cn(TD, "num hidden w-[1%] text-muted-foreground lg:table-cell 2xl:whitespace-nowrap")}>{fmtDateTime(s.startedAt)}</td>
                      <td className={cn(h ? TDN : TDW, !h ? "text-muted-foreground" : pnl >= 0 ? "text-profit" : "text-loss")} data-testid="autopilot-trade-pnl">{h ? fmtMoney(pnl, money, { signed: true }) : "waiting for prices"}</td>
                      <td className={cn(TDN, "hidden lg:table-cell")}>
                        {h && h.usedPct !== null ? (
                          <span className="flex items-center justify-end gap-2"><span className="block h-1.5 w-16 overflow-hidden rounded bg-muted" role="img" aria-label={`${Math.round(h.usedPct)} percent of the allowed loss is used`}><span className={cn("block h-full", DOT[h.health])} style={{ width: `${h.usedPct}%` }} /></span>{Math.round(h.usedPct)}%</span>
                        ) : <span className="text-muted-foreground">{h ? "no stop level" : "—"}</span>}
                      </td>
                      <td className={cn(TDW, "hidden xl:table-cell")}>{lv.trailExitUsd !== null ? `trailing, out at ${fmtMoney(lv.trailExitUsd, money, { signed: true })}` : lv.targetUsd !== null ? `${lv.trails ? "trails from " : ""}${fmtMoney(lv.targetUsd, money, { signed: true })}` : lv.closesAtMs !== undefined ? "by the clock" : "held to settlement"}</td>
                      <td className={cn(TDW, "hidden xl:table-cell")}>{lv.stopUsd !== null ? fmtMoney(-lv.stopUsd, money, { signed: true }) : lv.legStop !== null ? `${lv.legStop}x on each sold option` : "no stop"}</td>
                      <td className={cn(TD, "w-[1%]")}>
                        <span className="flex flex-col items-stretch justify-end gap-1.5 whitespace-nowrap 2xl:flex-row 2xl:items-center">
                          <Button size="xs" variant="outline" aria-expanded={more.has(s.id)} onClick={() => setMore((m) => { const n = new Set(m); if (!n.delete(s.id)) n.add(s.id); return n; })} data-testid="autopilot-trade-more">{more.has(s.id) ? "Less" : "Levels"}</Button>
                          <Button size="xs" variant="destructive" onClick={() => setExitId(s.id)} data-testid="autopilot-trade-exit">Exit now</Button>
                          <Button size="xs" variant="outline" onClick={() => toDesk(s)} data-testid="autopilot-trade-desk">Open on the Desk</Button>
                        </span>
                      </td>
                    </tr>
                    <tr hidden={!more.has(s.id)} data-testid="autopilot-trade-detail">
                      <td colSpan={9} className="px-2.5 pb-3">
                        <div className="flex max-w-[640px] flex-col gap-1 rounded border border-border p-2.5 text-xs">
                          <div className="flex justify-between gap-2"><span className="text-muted-foreground">{lv.trails ? (lv.trailExitUsd !== null ? "Trailing: exits at" : "Starts trailing at") : "Closes in profit at"}</span><span className="num">{lv.trailExitUsd !== null ? fmtMoney(lv.trailExitUsd, money, { signed: true }) : lv.targetUsd !== null ? fmtMoney(lv.targetUsd, money, { signed: true }) : lv.closesAtMs !== undefined ? "no level: closed by the clock" : "no level: held to settlement"}</span></div>
                          {lv.closesAtMs === undefined ? null : (
                            <div className="flex justify-between gap-2" data-testid="autopilot-trade-closes-at"><span className="text-muted-foreground">Closes at</span><span>{fmtDateTime(new Date(lv.closesAtMs).toISOString())}, whatever the profit</span></div>
                          )}
                          <div className="flex justify-between gap-2"><span className="text-muted-foreground">Stop closes it at</span><span className="num">{lv.stopUsd !== null ? fmtMoney(-lv.stopUsd, money, { signed: true }) : lv.legStop !== null ? `each sold option at ${lv.legStop} times its price${lv.legStopTrailPct !== null ? ", then the other side is trailed" : ""}` : "no stop: held to its exit or settlement"}</span></div>
                          {lv.restTrailExitUsd !== undefined ? (
                            <div className="flex justify-between gap-2" data-testid="autopilot-trade-rest-trail"><span className="text-muted-foreground">Trailing what is left</span><span className="num">{lv.restTrailExitUsd === null ? "starts once it is in profit" : `closes if its profit falls to ${fmtMoney(lv.restTrailExitUsd, money, { signed: true })}`}</span></div>
                          ) : null}
                          {h && h.usedPct !== null ? <div className="flex justify-between gap-2" data-testid="autopilot-trade-used"><span className="text-muted-foreground">Loss used</span><span className="num">{Math.round(h.usedPct)}% of the loss the stop allows</span></div> : null}
                          <div className="flex justify-between gap-2"><span className="text-muted-foreground">Opened</span><span>{fmtDateTime(s.startedAt)}</span></div>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                ))}
              </table>
            </div>
          ) : null}
        </section>
      </div>

      <div {...panel("closed")}>
        <AutopilotResultsPanel nameOf={nameOf} money={money} show={filtered ? shown : undefined} />
      </div>

      <div {...panel("strategies")}>
        <section className="flex min-w-0 flex-col gap-3" aria-label="Strategies">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <h2 className="text-sm">Strategies</h2>
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Which strategies">
              <span className="micro mr-1" aria-hidden="true">Show</span>
              {(["all", "on", "in", "off"] as const).map((v) => (
                <button key={v} type="button" className={chip(state === v)} aria-pressed={state === v} onClick={() => setState(v)} data-testid="autopilot-filter-state" data-value={v}>{STATE_LABEL[v]}</button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs">
              <span className="micro">Sort by</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-7 rounded border border-border bg-background px-1.5 text-xs" data-testid="autopilot-sort">
                <option value="list">The catalogue's order</option>
                <option value="paper">Paper result, best first</option>
                <option value="backtest">Backtest average, best first</option>
              </select>
            </label>
          </div>
          {GROUPS.filter((g) => cadence === "all" || g.cadence === cadence).map((g) => {
            const onCoin = g.items.filter((p) => coin === "all" || (p.assets as readonly string[]).includes(coin));
            const items = ordered(onCoin.filter(stratShown));
            return (
              <div key={g.title} className="flex flex-col rounded border border-border" data-testid="autopilot-group" data-group={g.title}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 border-b border-border px-3 py-2">
                  <div>
                    <h3 className="text-sm font-medium">{g.title}</h3>
                    <p className="text-xs text-muted-foreground">{g.note}</p>
                  </div>
                  <p className="num text-xs text-muted-foreground" data-testid="autopilot-group-count">{items.length} shown · {items.filter((p) => switchedOn(p.id)).length} on</p>
                </div>
                <div className={cn(ROW, "hidden border-b border-border px-3 py-1.5 md:grid")} aria-hidden="true" title="Backtest figures: BTC, 100 lots per option, after fees, on the days, weeks or entries tested">
                  <span className={HEAD}>Strategy</span><span className={HEAD}>How it gets out</span><span className={HEAD}>Backtest</span><span className={HEAD}>Paper so far</span><span className={HEAD}>Now</span>
                </div>
                {onCoin.length === 0 ? <p className="px-3 py-3 text-xs text-muted-foreground" data-testid="autopilot-group-empty">No {g.tab.toLowerCase()} strategy trades {coin} yet.</p> : items.length === 0 ? <p className="px-3 py-3 text-xs text-muted-foreground" data-testid="autopilot-group-none">No {g.tab.toLowerCase()} strategy in this selection.</p> : null}
                {items.map((p) => {
                  const on = switchedOn(p.id);
                  const back = catalogue.backtestOf(p.id);
                  const paper = paperOf(p.id);
                  return (
                    <article key={p.id} className={cn(ROW, "border-b border-border px-3 py-2.5 text-xs last:border-b-0")} data-testid="autopilot-card" data-playbook={p.id} data-on={Boolean(on)}>
                      <div className="flex min-w-0 items-start gap-2">
                        <Switch checked={Boolean(on)} disabled={save.isPending} onCheckedChange={(v) => toggle(p.id, v)} aria-label={`${p.name} on Autopilot`} data-testid="autopilot-card-switch" />
                        <div className="min-w-0 flex-1">
                          <h4 className="text-sm font-medium">{p.name}</h4>
                          <p className="text-muted-foreground">{p.clock ? `Enters ${p.clock.describe}` : "Enters when its condition is met"}</p>
                          <details className="mt-1">
                            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">What it does</summary>
                            <p className="mt-1 text-muted-foreground">{p.summary}</p>
                            <p className="mt-1 text-muted-foreground" data-testid="autopilot-card-exit-words">How it gets out: {exitWords(p)}</p>
                            {p.clock ? (
                              <p className="mt-1 text-muted-foreground" data-testid="autopilot-card-how">Entered {p.clock.describe}. {p.clock.takeProfitOfCredit ? (p.clock.takeTrailPct ? `Once the trade is up by ${Math.round(p.clock.takeProfitOfCredit * 100)} % of the ${premiumWords(p) === "premium" ? "premium collected" : "net premium (collected less paid for the wings)"} it is not closed: it is trailed, and closed when the profit gives back ${p.clock.takeTrailPct} % of its best. ` : `The whole trade is closed once it is up by ${Math.round(p.clock.takeProfitOfCredit * 100)} % of the ${premiumWords(p) === "premium" ? "premium collected" : "net premium (collected less paid for the wings)"}. `) : ""}{p.clock.lock ? `Once the trade is up by ${Math.round(p.clock.lock.at * 100)} % of the premium a floor is set at ${Math.round(p.clock.lock.floor * 100)} %: the whole trade is closed if the profit falls back there. ` : ""}{p.clock.exitHourUtc !== undefined ? `Everything is closed at ${istClock(p.clock.exitHourUtc)} IST${nextDay(p.clock) ? " the next day" : ""}, whatever the profit. ` : ""}{p.clock.ladder ? `An equal part of the lots is closed each time the lots still open are up by ${p.clock.ladder.join(", ")} % of their premium, and the last part is held. ` : ""}{p.clock.legStop ? `Each sold option is bought back if its price reaches ${p.clock.legStop} times what it was sold for.` : !hasWings(p) ? "No stop and no bought options: nothing limits the loss, and it is held to settlement unless an exit above closes it." : p.clock.takeProfitOfCredit ? "No stop: the bought wings cap the loss, and it is held to settlement if the trail never closes it." : "Held to settlement: the bought wings cap the loss."}{p.clock.trailRestPct ? ` After that, the profit on the other one is trailed and it is closed when it gives back ${p.clock.trailRestPct} % of its best.` : ""} Backtest only so far: {p.evidence.claim}</p>
                            ) : (
                              <p className="mt-1 text-muted-foreground" data-testid="autopilot-card-how">Autopilot enters as above and keeps the stop and the time exit. It takes profit its own way, chosen below, so the record shown is the playbook's own exits, not Autopilot's.</p>
                            )}
                          </details>
                        </div>
                      </div>
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="micro md:sr-only">How it gets out</span>
                        <ul className="flex flex-wrap gap-1" data-testid="autopilot-card-tags">
                          {exitTags(p).map((t) => <li key={t} className="whitespace-nowrap rounded border border-border px-1.5 py-px">{t}</li>)}
                        </ul>
                        {p.clock ? <span className="text-muted-foreground" data-testid="autopilot-card-own">{AUTOPILOT_EXIT_LABELS.own}</span> : null}
                        <select hidden={Boolean(p.clock)} value={on?.exit ?? "trail"} disabled={!on || save.isPending} onChange={(e) => setExit(p.id, e.target.value as AutopilotExitStyle)} className="h-7 w-full rounded border border-border bg-background px-1.5 text-xs" aria-label={`${p.name}: how a winner is taken off`} data-testid="autopilot-card-exit">
                          {AUTOPILOT_CHOSEN_EXIT_STYLES.map((x) => <option key={x} value={x}>{AUTOPILOT_EXIT_LABELS[x]}</option>)}
                        </select>
                      </div>
                      <div className="flex min-w-0 flex-col gap-0.5" data-testid="autopilot-card-backtest">
                        <span className="micro md:sr-only">Backtest</span>
                        {back ? (
                          <>
                            <span className={cn("num", back.mean > 0 ? "text-profit" : back.mean < 0 ? "text-loss" : "")}>{fmtMoney(back.mean, money, { signed: true })} a {back.per}</span>
                            <span className="text-muted-foreground">{back.positivePct}% won · worst {fmtMoney(back.worst, money, { signed: true })}</span>
                            <span className="text-muted-foreground" data-testid="autopilot-card-basis">{catalogue.isSaved(p.id) ? `${back.samples} trades tested · figures entered by hand: ${back.basis}` : (back.basis ?? `${back.samples} ${back.per}s tested`)}</span>
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
      </div>

      <div {...panel("activity")}>
        <section className="flex flex-col gap-3" aria-label="Log" data-testid="autopilot-log">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <h2 className="text-sm">Log</h2>
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Kind of line">
              <span className="micro mr-1" aria-hidden="true">Show</span>
              {(["all", "entered", "skipped", "noted"] as const).map((k) => (
                <button key={k} type="button" className={chip(kind === k)} aria-pressed={kind === k} onClick={() => { setKind(k); setLogLimit(LOG_PAGE); }} data-testid="autopilot-log-kind" data-value={k}>{k === "all" ? "All" : KIND[k].label} · {k === "all" ? runsOnDay.length : runsOnDay.filter((r) => r.kind === k).length}</button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs">
              <span className="micro">Day</span>
              <select value={logDayShown} onChange={(e) => { setLogDay(e.target.value); setLogLimit(LOG_PAGE); }} className="h-7 rounded border border-border bg-background px-1.5 text-xs" data-testid="autopilot-log-day">
                <option value="all">All days · {count(runsShown.length, "line")}</option>
                {logDays.map((d) => <option key={d} value={d}>{d} · {count(runsShown.filter((r) => dayOf(r.at) === d).length, "line")}</option>)}
              </select>
            </label>
          </div>
          {runs.length === 0 ? <p className="text-xs text-muted-foreground">Nothing yet. A line appears for every entry and for every reason not to enter.</p> : null}
          {runs.length > 0 && logList.length === 0 ? <p className="text-xs text-muted-foreground" data-testid="autopilot-log-none">No log line in this selection.</p> : null}
          {logList.length > 0 ? (
            <div className="overflow-x-auto rounded border border-border">
              <table className="w-full border-collapse text-sm">
                <thead><tr className="border-b border-border"><th scope="col" className={TH}>Time</th><th scope="col" className={TH}>What</th><th scope="col" className={TH}>Strategy</th><th scope="col" className={TH}>Why</th></tr></thead>
                <tbody>
                  {logList.slice(0, logLimit).map((r) => (
                    <tr key={r.id} className="border-b border-border align-top last:border-b-0" data-testid="autopilot-run" data-kind={r.kind}>
                      <td className={cn(TD, "num whitespace-nowrap text-muted-foreground")}>{fmtDateTime(r.at)}</td>
                      <td className={TD}><span className="flex items-center gap-1.5 whitespace-nowrap"><span className="w-3 text-center text-muted-foreground" aria-hidden="true">{KIND_SHAPE[r.kind]}</span><Badge variant={KIND[r.kind].variant}>{KIND[r.kind].label}</Badge></span></td>
                      <td className={cn(TD, "font-medium")}>{nameOf(r.playbookId)} · {r.asset}</td>
                      <td className={cn(TD, "text-muted-foreground")}>{r.reason}{r.detail.dte !== undefined ? ` · ${r.detail.dte}d to expiry` : ""}{r.kind === "entered" && r.detail.capital ? ` · capital ${fmtMoney(r.detail.capital, money)}` : ""}{r.kind === "entered" && r.detail.move ? ` · ${moveWords(r.asset, r.detail.move)}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {logList.length > logLimit ? <div><Button size="sm" variant="outline" onClick={() => setLogLimit(logLimit + LOG_PAGE)} data-testid="autopilot-log-more">Show {Math.min(LOG_PAGE, logList.length - logLimit)} more of {logList.length}</Button></div> : null}
          {runs.length > 0 ? <p className="text-xs text-muted-foreground" data-testid="autopilot-log-note">This screen reads Autopilot&apos;s newest {runs.length} log lines; older ones are not shown here.</p> : null}
        </section>
      </div>

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
