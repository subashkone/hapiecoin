"use client";
// Autopilot (ADR-108, ADR-109; HC-TR-219, HC-TR-220): the master switch, one card per playbook with its switch, exit
// style, record and what it is doing now, the trades Autopilot holds with a health reading and an exit, and its log.
// Paper only. Figures in USD are shown in the trader's display currency.
import { AUTOPILOT_PLAYBOOKS } from "@hapiecoin/pricing";
import { AUTOPILOT_CHOSEN_EXIT_STYLES, AUTOPILOT_COOLDOWN_MINUTES, AUTOPILOT_EXIT_LABELS, type AutopilotExitStyle, type AutopilotRun, type AutopilotSettings, type PlaybookStatus, type Strategy } from "@hapiecoin/schema";
import { Badge, Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, Switch, cn, toast } from "@hapiecoin/ui";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { StopPaperDialog } from "@/components/trading/StopPaperDialog";
import { AutopilotResultsPanel } from "./AutopilotResultsPanel";
import { AUTOPILOT_POLL_MS, useAutopilot, useSaveAutopilot } from "@/lib/api/autopilot";
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
const ASSETS = ["BTC", "ETH"] as const;
// the recorded playbooks (never the control) and the ones entered by the clock (ADR-112)
const TRADABLE = AUTOPILOT_PLAYBOOKS;
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
          <p className="mt-1 max-w-[70ch] text-xs text-muted-foreground">Opens a paper trade when a strategy you switched on meets its conditions on the latest prices, with its exits attached. A strategy holds one trade per coin at a time and waits {AUTOPILOT_COOLDOWN_MINUTES} minutes after a trade ends. The evening strategies enter once a day, in their window. No real orders are placed.</p>
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

      <div className="flex flex-wrap items-start gap-4">
        <section className="flex min-w-0 flex-[999_1_560px] flex-col gap-2" aria-label="Strategies">
          <h2 className="text-sm">Strategies</h2>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-3">
            {TRADABLE.map((p) => {
              const on = switchedOn(p.id);
              return (
                <article key={p.id} className="flex flex-col gap-2 rounded border border-border p-3" data-testid="autopilot-card" data-playbook={p.id} data-on={Boolean(on)}>
                  <div className="flex items-start gap-2">
                    <Switch checked={Boolean(on)} disabled={save.isPending} onCheckedChange={(v) => toggle(p.id, v)} aria-label={`${p.name} on Autopilot`} data-testid="autopilot-card-switch" />
                    <div className="min-w-0 flex-1">
                      <h3 className="text-[13px] font-medium">{p.name}</h3>
                      <p className="text-2xs text-muted-foreground">{p.summary}</p>
                      {p.clock ? (
                        <p className="mt-1 text-2xs text-muted-foreground" data-testid="autopilot-card-how">Entered once an evening, {p.clock.window}, on the next expiry. {p.clock.takeProfitOfCredit ? `The whole trade is closed once it is up by ${Math.round(p.clock.takeProfitOfCredit * 100)} % of the premium collected. ` : ""}{p.clock.legStop ? `Each sold option is bought back if its price reaches ${p.clock.legStop} times what it was sold for.` : "Held to settlement: the bought wings cap the loss."} Backtest only so far: {p.evidence.claim}</p>
                      ) : (
                        <p className="mt-1 text-2xs text-muted-foreground" data-testid="autopilot-card-how">Autopilot enters as above and keeps the stop and the time exit. It takes profit its own way, chosen below, so the record shown is the playbook's own exits, not Autopilot's.</p>
                      )}
                    </div>
                  </div>
                  <label className="flex items-center justify-between gap-2 text-2xs">
                    <span className="text-muted-foreground">When it is winning</span>
                    {p.clock ? <span data-testid="autopilot-card-own">{AUTOPILOT_EXIT_LABELS.own}</span> : null}
                    <select hidden={Boolean(p.clock)} value={on?.exit ?? "trail"} disabled={!on || save.isPending} onChange={(e) => setExit(p.id, e.target.value as AutopilotExitStyle)} className="h-7 rounded border border-border bg-background px-1.5 text-2xs" aria-label={`${p.name}: how a winner is taken off`} data-testid="autopilot-card-exit">
                      {AUTOPILOT_CHOSEN_EXIT_STYLES.map((x) => <option key={x} value={x}>{AUTOPILOT_EXIT_LABELS[x]}</option>)}
                    </select>
                  </label>
                  {ASSETS.filter((a) => (p.assets as readonly string[]).includes(a)).map((asset) => {
                    const rec = recordFor(records.data, p.id, asset);
                    // a strategy may hold several trades on one coin, each on its own strikes (ADR-110): the card adds them up
                    const trades = open.filter((s) => s.autopilotPlaybookId === p.id && s.asset === asset);
                    const last = latestRun(runs, p.id, asset);
                    const pnl = trades.reduce((sum, s) => sum + book.pnlOf(s).total, 0);
                    const worst = trades.map((s) => tradeHealth(book.pnlOf(s).total, autopilotLevels(s).stopUsd).health).sort((a, b) => WORSE[b] - WORSE[a])[0] ?? "good";
                    const held = trades.length === 1 ? "In a trade" : `In ${trades.length} trades`;
                    return (
                      <div key={asset} className="flex flex-col gap-1 border-t border-border pt-2 text-2xs" data-testid="autopilot-card-asset" data-asset={asset}>
                        <div className="flex items-center gap-2">
                          <b className="font-mono">{asset}</b>
                          {rec ? <Badge variant={RECORD[rec.status].variant}>{RECORD[rec.status].label}</Badge> : <Badge variant="outline">{p.clock ? "Backtest only" : "No record yet"}</Badge>}
                          {rec ? <span className="ml-auto text-muted-foreground">{rec.stats.trades} past trades{rec.stats.winRate === null ? "" : ` · ${Math.round(rec.stats.winRate * 100)}% won`}</span> : null}
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
                </article>
              );
            })}
          </div>
        </section>

        <aside className="flex min-w-0 flex-[1_1_360px] flex-col gap-4">
          <section className="flex flex-col gap-3 rounded border border-border p-3" aria-label="Running trades" data-testid="autopilot-running">
            <h2 className="text-sm">Running now</h2>
            {open.length === 0 ? <EmptyState title="No Autopilot trade is open" description={settings.enabled ? "It enters when a strategy you switched on meets its conditions." : "Switch Autopilot on to let it enter."} className="py-4" /> : null}
            {open.map((s) => {
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
                  <div className="flex justify-between gap-2"><span className="text-muted-foreground">{lv.trails ? (lv.trailExitUsd !== null ? "Trailing: exits at" : "Starts trailing at") : "Closes in profit at"}</span><span className="num">{lv.trailExitUsd !== null ? fmtMoney(lv.trailExitUsd, money, { signed: true }) : lv.targetUsd !== null ? fmtMoney(lv.targetUsd, money, { signed: true }) : "no level: held to settlement"}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-muted-foreground">Stop closes it at</span><span className="num">{lv.stopUsd !== null ? fmtMoney(-lv.stopUsd, money, { signed: true }) : lv.legStop !== null ? `each sold option at ${lv.legStop} times its price` : "no stop: held to its exit or settlement"}</span></div>
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
            <ul className="max-h-[420px] overflow-y-auto">
              {runs.slice(0, 60).map((r) => (
                <li key={r.id} className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 border-t border-border py-1.5 text-2xs first:border-t-0" data-testid="autopilot-run" data-kind={r.kind}>
                  <Badge variant={KIND[r.kind].variant}>{KIND[r.kind].label}</Badge>
                  <span className="min-w-0 truncate font-medium">{nameOf(r.playbookId)} · {r.asset}</span>
                  <span className="num text-muted-foreground">{fmtDateTime(r.at)}</span>
                  <span className="text-muted-foreground">{r.reason}{r.detail.dte !== undefined ? ` · ${r.detail.dte}d to expiry` : ""}{r.kind === "entered" && r.detail.capital ? ` · capital ${fmtMoney(r.detail.capital, money)}` : ""}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      <AutopilotResultsPanel money={money} />

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
