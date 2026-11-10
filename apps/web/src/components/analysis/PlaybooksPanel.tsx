"use client";
// Playbooks tab (ADR-101; HC-WS-119): one card per playbook, a structure from the catalogue with the plan around it,
// with its own record on our recorded chain history (net of fees, in-sample and out-of-sample halves, losing years,
// the trial count behind its parameters) and a status against stated thresholds. Hero-or-zero is the control: it
// ships to fail. Decision support, never a recommendation; a backtest is not a forecast, and every card says so.
import { PLAYBOOKS, type Playbook, playbookTemplate } from "@hapiecoin/pricing";
import type { PlaybookRecord, PlaybookStatus } from "@hapiecoin/schema";
import { Button, EmptyState, cn } from "@hapiecoin/ui";
import { ApiError } from "@/lib/api/client";
import { recordFor, usePlaybookRecords } from "@/lib/api/playbooks";
import { useSettings } from "@/lib/api/queries";
import { fmtDate } from "@/lib/format";
import { type MoneyFormat, USD, fmtMoney } from "@/lib/money";
import { useUiStore } from "@/lib/store";
import { useTemplateLoader } from "@/components/builder/TemplatesPanel";

const STATUS: Record<PlaybookStatus, { label: string; cls: string; hint: string }> = {
  pass: { label: "Passes its thresholds", cls: "bg-profit/15 text-profit", hint: "Twenty or more closed trades, a positive net total and a positive out-of-sample half on our recorded history. A backtest, not a forecast." },
  fail: { label: "Fails its thresholds", cls: "bg-loss/15 text-loss", hint: "Enough trades, but the net total or the out-of-sample half is not positive." },
  insufficient: { label: "Not enough trades yet", cls: "bg-muted text-muted-foreground", hint: "Fewer than twenty closed trades on the recorded history: nothing can be said either way." },
  "control-ok": { label: "Control: fails as it should", cls: "bg-muted text-muted-foreground", hint: "This card exists to lose. It losing means the engine and the data agree with every published study." },
  "control-alarm": { label: "Control passed: suspect the engine", cls: "bg-warning/20 text-warning", hint: "A strategy every study says loses has passed here. Distrust every other card until this is explained." },
};

const tone = (v: number) => (v > 0 ? "text-profit" : v < 0 ? "text-loss" : "text-muted-foreground");
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

/** The plan in words, from the playbook's conditions, exits and minimum days to expiry. */
export function planLine(p: Playbook): string {
  const parts: string[] = [];
  if (p.conditions?.sma) parts.push(`spot ${p.conditions.sma.side} its ${p.conditions.sma.days}-day average`);
  if (p.conditions?.ivRank) parts.push(`IV rank ${p.conditions.ivRank.min ?? 0} to ${p.conditions.ivRank.max ?? 100}`);
  if (p.conditions?.weekdays?.length) parts.push(`${p.conditions.weekdays.length} weekdays`);
  parts.push(`${p.minDte}+ days to expiry`);
  if (p.exits?.targetPct !== undefined) parts.push(`target ${Math.round(p.exits.targetPct * 100)}% of max profit`);
  if (p.exits?.stopPct !== undefined) parts.push(`stop at ${Math.round(p.exits.stopPct * 100)}% of max loss`);
  if (p.exits?.timeStopDte !== undefined) parts.push(`leave ${p.exits.timeStopDte} ${p.exits.timeStopDte === 1 ? "day" : "days"} before settlement`);
  if (!p.exits) parts.push("hold to settlement");
  return parts.join(" · ");
}

export function PlaybooksPanel() {
  const asset = useUiStore((s) => s.asset);
  const setAnalysisTab = useUiStore((s) => s.setAnalysisTab);
  const setBacktestPreset = useUiStore((s) => s.setBacktestPreset);
  const { data: settings } = useSettings();
  const money: MoneyFormat = settings ? { currency: settings.currency, rate: settings.conversionRate } : USD;
  const m = (v: string | null | undefined, signed = true) => (v === null || v === undefined ? "—" : fmtMoney(Number(v), money, { signed }));
  const q = usePlaybookRecords();
  const loader = useTemplateLoader();
  const notYet = q.isError && q.error instanceof ApiError && q.error.status === 503;
  const playbooks = PLAYBOOKS.filter((p) => p.assets.includes(asset));
  const openInBacktest = (p: Playbook) => {
    if (typeof p.template !== "string") return; // an inline template is not in the Backtest tab's catalogue
    setBacktestPreset({
      template: p.template,
      lots: p.lots,
      range: "1Y",
      folds: 2,
      minDte: p.minDte,
      smaDays: p.conditions?.sma?.days,
      smaSide: p.conditions?.sma?.side,
      ivRankMin: p.conditions?.ivRank?.min,
      ivRankMax: p.conditions?.ivRank?.max,
      targetPct: p.exits?.targetPct === undefined ? undefined : Math.round(p.exits.targetPct * 100),
      stopPct: p.exits?.stopPct === undefined ? undefined : Math.round(p.exits.stopPct * 100),
      timeStopDte: p.exits?.timeStopDte,
    });
    setAnalysisTab("backtest");
  };
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-auto p-2" data-testid="playbooks-panel" data-state={q.isError ? (notYet ? "empty" : "error") : q.data ? "ready" : "loading"}>
      <p className="text-2xs text-muted-foreground" data-testid="playbooks-intro">
        A playbook is a structure from the catalogue with the plan around it: when to enter, how large, when to leave. Each card carries its own record on our recorded {asset} chain history, net of the venue's fees where the venue publishes a rule, split into the half it was judged on and the half it was not, with the years it lost and the number of parameter configurations looked at before its own were fixed. Decision support, never a recommendation: a backtest is not a forecast, and most of these records are still short.
      </p>
      {q.isError && !notYet ? (
        <p className="text-xs text-loss" data-testid="playbooks-error">
          {q.error instanceof Error ? q.error.message : String(q.error)}
        </p>
      ) : null}
      {notYet ? <EmptyState title="No records yet" description="A record needs a recorded day and the records job to have run once; the cards below show the plans without a record until then." data-testid="playbooks-empty" /> : null}
      {playbooks.length === 0 ? <EmptyState title={`No playbook covers ${asset} yet`} description="The first playbooks are written for BTC and ETH; their records and evidence do not transfer to another underlying." data-testid="playbooks-none" /> : null}
      <div className="grid gap-2 lg:grid-cols-2">
        {playbooks.map((p) => {
          const record = recordFor(q.data, p.id, asset);
          return <PlaybookCard key={p.id} playbook={p} record={record} m={m} onLoad={() => loader.load(playbookTemplate(p)!)} onBacktest={typeof p.template === "string" ? () => openInBacktest(p) : null} chainReady={loader.chainReady} />;
        })}
      </div>
    </div>
  );
}

function PlaybookCard({ playbook: p, record: r, m, onLoad, onBacktest, chainReady }: { playbook: Playbook; record: PlaybookRecord | null; m: (v: string | null | undefined, signed?: boolean) => string; onLoad: () => void; onBacktest: (() => void) | null; chainReady: boolean }) {
  const status = r ? STATUS[r.status] : null;
  const inSample = r?.folds[0];
  const outOfSample = r?.folds[1];
  return (
    <div className={cn("flex flex-col gap-1.5 rounded border border-border p-2 text-xs", p.control ? "border-dashed" : "")} data-testid="playbook-card" data-playbook={p.id} data-status={r?.status ?? "none"}>
      <div className="flex flex-wrap items-start justify-between gap-1">
        <div>
          <div className="text-[13px] font-medium">{p.name}</div>
          <div className="text-2xs text-muted-foreground">{typeof p.template === "string" ? p.template : p.template.name} · {planLine(p)}</div>
        </div>
        {status ? (
          <span className={cn("rounded px-1.5 py-0.5 text-2xs", status.cls)} title={status.hint} data-testid="playbook-status">
            {status.label}
          </span>
        ) : (
          <span className="rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground" data-testid="playbook-status">
            No record yet
          </span>
        )}
      </div>
      <p>{p.summary}</p>
      <p className="text-2xs text-muted-foreground">
        <span className="font-medium">Why.</span> {p.rationale}
      </p>
      <p className="text-2xs text-muted-foreground">
        <span className="font-medium">Evidence.</span> {p.evidence.claim} <span className="italic">({p.evidence.source})</span>
      </p>
      {r ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-2xs sm:grid-cols-4" data-testid="playbook-record">
          <div>
            <div className="micro">Record</div>
            <div>
              {r.entries} {r.entries === 1 ? "entry" : "entries"}, {r.stats.trades} closed
            </div>
            <div className="text-muted-foreground">
              {r.firstDay && r.lastDay ? `${fmtDate(r.firstDay)} to ${fmtDate(r.lastDay)}` : "nothing recorded"} · {r.days} days{r.reconstructedDays ? ` (${r.reconstructedDays} reconstructed)` : ""}
              {r.entries === 0 ? " · no entries" : ""}
            </div>
          </div>
          <div>
            <div className="micro">{r.fees === "venue" ? "Net of fees" : "Before fees (no rule for this venue)"}</div>
            <div className={cn("num text-[13px] font-medium", tone(Number(r.stats.total)))}>{m(r.stats.total)}</div>
            <div className="text-muted-foreground">
              win rate {pct(r.stats.winRate)} · worst fall {m(r.stats.maxDrawdown, false)}
            </div>
          </div>
          <div>
            <div className="micro">In-sample / out-of-sample</div>
            <div className="num">
              <span className={tone(Number(inSample?.stats.total ?? "0"))}>{m(inSample?.stats.total)}</span> / <span className={tone(Number(outOfSample?.stats.total ?? "0"))}>{m(outOfSample?.stats.total)}</span>
            </div>
            <div className="text-muted-foreground">
              {inSample?.stats.trades ?? 0} and {outOfSample?.stats.trades ?? 0} closed trades
            </div>
          </div>
          <div>
            <div className="micro">Losing years · trials</div>
            <div>{r.losingYears.length ? r.losingYears.map((y) => `${y.year} (${m(y.total)})`).join(", ") : r.stats.trades ? "none so far" : "—"}</div>
            <div className="text-muted-foreground">
              {r.trials} {r.trials === 1 ? "configuration" : "configurations"} looked at before these parameters
            </div>
          </div>
        </div>
      ) : null}
      {r?.noSignal ? <p className="text-2xs text-muted-foreground">{r.noSignal} recorded days had no entry signal.</p> : null}
      <p className="text-2xs text-muted-foreground" data-testid="playbook-trials-note">
        {p.trials.note}. Size for the record: {p.lots} lots. Thresholds: {p.thresholds.minTrades} closed trades, a positive net total and a positive out-of-sample half; first guesses, stated so they can be argued with.
      </p>
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="secondary" onClick={onLoad} disabled={!chainReady} title={chainReady ? "Place this structure on the chain in the Builder; the plan's rules are yours to arm" : "Chain not loaded yet"} data-testid="playbook-load">
          Load into Builder
        </Button>
        {onBacktest ? (
          <Button size="sm" variant="ghost" onClick={onBacktest} title="Open the Backtest tab with this playbook's template, rules, size, a one-year range and the in-sample / out-of-sample split filled in" data-testid="playbook-backtest">
            Open in Backtest
          </Button>
        ) : (
          <span className="self-center text-2xs text-muted-foreground" data-testid="playbook-no-backtest">
            Not in the Backtest tab's catalogue; its record above is the backtest.
          </span>
        )}
      </div>
    </div>
  );
}
