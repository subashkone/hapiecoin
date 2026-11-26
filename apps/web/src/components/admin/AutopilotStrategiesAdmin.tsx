"use client";
// Admin · Autopilot strategies (HC-TR-277; ADR-141, ADR-142): every saved strategy with its stage, how it enters, its
// backtest figures and who can use it, and the steps the API would accept for it: edit, copy, publish to paper, retire,
// delete. A second tab lists the built-in strategies, read-only, each with "Copy as my own" (HC-TR-280): the built-in
// one is never changed. Paper only.
import { AUTOPILOT_PLAYBOOKS, type Playbook, playbookBacktest, playbookCadence } from "@hapiecoin/pricing";
import { SAVED_STAGES, SAVED_STAGE_LABELS, type SavedStage, type SavedStrategy } from "@hapiecoin/schema";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, cn, toast } from "@hapiecoin/ui";
import { type KeyboardEvent, useMemo, useState } from "react";
import { AdminHeader } from "./AdminShell";
import { AutopilotStrategyDialog } from "./AutopilotStrategyDialog";
import { useDeleteSavedStrategy, useSavedStrategies, useSavedStrategyStep } from "@/lib/api/autopilot-saved";
import { useAdminPlans } from "@/lib/api/billing";
import { fmtDate } from "@/lib/format";
import { exitTags } from "@/lib/strategy/autopilot-words";
import { type SavedForm, savedFormFromBuiltIn } from "@/lib/strategy/saved-form";

type Step = "publish" | "retire" | "delete";
const STEP_TEXT: Record<Step, { title: string; what: (s: SavedStrategy) => string; button: string; done: string }> = {
  publish: { title: "Publish to paper?", what: (s) => `Autopilot will open paper trades from "${s.name}" for everyone who may use it and switches it on. No real order is placed. Any other version of it on paper is retired, and the traders who had that one switched on get this one.`, button: "Publish to paper", done: "On paper" },
  retire: { title: "Retire this strategy?", what: (s) => `"${s.name}" stops entering new trades. Its open trades keep their exits and its record stays. A retired strategy cannot be changed; copy it to start again.`, button: "Retire", done: "Retired" },
  delete: { title: "Delete this strategy?", what: (s) => `This permanently removes "${s.name}". It has never traded, so no record is lost. This cannot be undone.`, button: "Delete", done: "Deleted" },
};
/** The steps the API would accept for a strategy as it stands. */
export const stepsOf = (s: SavedStrategy): { edit: boolean; publish: boolean; retire: boolean; remove: boolean } => ({
  edit: s.stage !== "retired",
  publish: s.stage === "draft" || s.stage === "backtested",
  retire: s.stage === "paper",
  remove: s.stage !== "paper" && !s.traded,
});
const FAMILY: Record<ReturnType<typeof playbookCadence>, string> = { trend: "Trend", daily: "Daily", weekly: "Weekly", monthly: "Monthly" };
/** The built-in strategies with what "Copy as my own" would open for each, or why it cannot be copied. Worked out once: the list never changes. */
const BUILT_IN = AUTOPILOT_PLAYBOOKS.map((p) => ({ p, copy: savedFormFromBuiltIn(p) }));
const signed = (n: number): string => `${n > 0 ? "+" : n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

export function AutopilotStrategiesAdmin() {
  const list = useSavedStrategies();
  const plans = useAdminPlans();
  const step = useSavedStrategyStep();
  const remove = useDeleteSavedStrategy();
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<"all" | SavedStage>("all");
  const [editing, setEditing] = useState<SavedStrategy | null | "new">(null);
  const [view, setView] = useState<"mine" | "builtin">("mine");
  const [copying, setCopying] = useState<{ id: string; from: string; form: SavedForm; notes: string[] } | null>(null);
  const [asking, setAsking] = useState<{ step: Step; strategy: SavedStrategy } | null>(null);
  const all = useMemo(() => list.data ?? [], [list.data]);
  const rows = all.filter((s) => (!q || `${s.name} ${s.summary}`.toLowerCase().includes(q.toLowerCase())) && (stage === "all" || s.stage === stage));
  const filtered = q !== "" || stage !== "all";
  const builtIn = BUILT_IN.filter(({ p }) => !q || `${p.name} ${p.summary}`.toLowerCase().includes(q.toLowerCase()));
  const clear = () => { setQ(""); setStage("all"); };
  // each tab starts unfiltered: a search or a stage chosen on one must not hide rows on the other
  const show = (next: "mine" | "builtin") => { if (next !== view) { clear(); setView(next); } };
  // a strategy that was just saved is shown: on the admin's own list, with nothing filtered away
  const saved = () => { clear(); setView("mine"); };
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = view === "mine" ? "builtin" : "mine";
    show(next);
    document.getElementById(`saved-tab-${next}`)?.focus();
  };
  const planName = (id: string) => plans.data?.find((p) => p.id === id)?.name ?? id;
  const who = (s: SavedStrategy): string => (s.audience === "admins" ? "Admins only" : s.audience === "users" ? `${s.userIds.length} named ${s.userIds.length === 1 ? "user" : "users"}` : s.planIds.length === 0 ? "No plan chosen" : plans.data ? s.planIds.map(planName).join(", ") : "…");
  const failed = (e: Error) => toast.error("Not done", { description: e.message });
  const copy = (s: SavedStrategy) => step.mutate({ id: s.id, step: "duplicate" }, { onSuccess: (made) => toast.success("Duplicated as a draft", { description: made.name }), onError: failed });
  const confirm = () => {
    if (!asking) return;
    const { step: what, strategy } = asking;
    const done = () => { toast.success(STEP_TEXT[what].done, { description: strategy.name }); setAsking(null); };
    const refused = (e: Error) => { failed(e); setAsking(null); };
    if (what === "delete") remove.mutate(strategy.id, { onSuccess: done, onError: refused });
    else step.mutate({ id: strategy.id, step: what }, { onSuccess: done, onError: refused });
  };
  return (
    <div data-testid="admin-saved" data-count={all.length} data-state={list.isLoading ? "loading" : list.isError ? "error" : "ready"}>
      <AdminHeader
        title="Autopilot strategies"
        subtitle="Strategies you build for Autopilot, beside the built-in ones. A strategy trades on paper once it has backtest figures and you publish it."
        action={<span className="flex items-center gap-2"><span className="rounded border border-border px-1.5 py-0.5 font-mono text-3xs text-muted-foreground" data-testid="saved-paper-only">PAPER ONLY</span><Button size="sm" onClick={() => setEditing("new")} data-testid="saved-new">+ New strategy</Button></span>}
      />
      <div className="mb-1 flex gap-1 border-b border-border" role="tablist" aria-label="Which strategies">
        {([["mine", list.data ? `Yours (${all.length})` : "Yours"], ["builtin", `Built-in (${BUILT_IN.length})`]] as const).map(([key, label]) => (
          <button key={key} type="button" role="tab" id={`saved-tab-${key}`} aria-selected={view === key} aria-controls="saved-panel" tabIndex={view === key ? 0 : -1} onKeyDown={onTabKey} onClick={() => show(key)} className={cn("-mb-px border-b-2 px-3 py-1.5 text-xs", view === key ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")} data-testid="saved-view" data-value={key}>{label}</button>
        ))}
      </div>
      <div className="sticky top-0 z-10 -mx-1 mb-2 flex flex-wrap items-center gap-2 bg-background px-1 py-2" data-testid="saved-filters">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search strategies" className="h-7 w-[200px] rounded border border-input bg-background px-2 text-xs" aria-label="Search strategies" data-testid="saved-search" />
        <select hidden={view === "builtin"} value={stage} onChange={(e) => setStage(e.target.value as typeof stage)} className="h-7 rounded border border-input bg-background px-2 text-xs" aria-label="Stage" data-testid="saved-stage-filter">
          <option value="all">All stages</option>
          {SAVED_STAGES.map((k) => <option key={k} value={k}>{SAVED_STAGE_LABELS[k]}</option>)}
        </select>
        {(view === "builtin" ? q !== "" : filtered) ? <Button size="sm" variant="ghost" onClick={clear} data-testid="saved-clear">Clear</Button> : null}
        <span className="flex-1" />
        <span className="micro" data-testid="saved-count">{view === "builtin" ? `${builtIn.length} of ${BUILT_IN.length}` : `${rows.length} of ${all.length}`}</span>
      </div>
      <div role="tabpanel" id="saved-panel" aria-labelledby={`saved-tab-${view}`}>
      {view === "builtin" ? (
        <BuiltInTable rows={builtIn} onCopy={(p, form, notes) => setCopying({ id: p.id, from: p.name, form, notes })} />
      ) : list.isLoading ? (
        <div className="h-24 animate-pulse rounded bg-muted" />
      ) : list.isError ? (
        <EmptyState title="Couldn't load the strategies" description={list.error.message} className="py-10" action={<Button size="sm" onClick={() => void list.refetch()}>Retry</Button>} data-testid="saved-load-error" />
      ) : all.length === 0 ? (
        <EmptyState title="No saved strategies yet" description="The built-in Autopilot strategies are unchanged. Build your own here; it starts as a draft and cannot trade until you publish it." className="py-10" action={<Button size="sm" onClick={() => setEditing("new")}>+ New strategy</Button>} data-testid="saved-empty" />
      ) : rows.length === 0 ? (
        <EmptyState title="No strategies match" description="Try another search or stage" className="py-10" action={<Button size="sm" variant="outline" onClick={clear}>Clear filters</Button>} data-testid="saved-empty-filtered" />
      ) : (
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full min-w-[900px] text-xs" data-testid="saved-table">
            <thead><tr className="micro text-left"><th className="py-1 pl-2 pr-2">Strategy</th><th className="py-1 pr-2">Stage</th><th className="py-1 pr-2">Enters</th><th className="py-1 pr-2 text-right">Backtest</th><th className="py-1 pr-2">Who</th><th className="py-1 pr-2 text-right">Actions</th></tr></thead>
            <tbody>
              {rows.map((s) => {
                const can = stepsOf(s);
                return (
                  <tr key={s.id} className={cn("border-t border-border align-top", s.stage === "retired" && "opacity-70")} data-testid="saved-row" data-name={s.name} data-stage={s.stage} data-version={s.version}>
                    <td className="max-w-[280px] py-1.5 pl-2 pr-2">
                      <div className="flex items-baseline gap-1 font-medium"><span className="truncate" title={s.name}>{s.name}</span><span className="micro shrink-0" data-testid="saved-version">· v{s.version}</span></div>
                      <div className="micro truncate" title={s.summary}>{s.summary}</div>
                      <div className="micro">{s.lossCapped ? "Loss limited by bought options" : "Loss not limited"}{s.traded ? " · has traded" : ""}</div>
                    </td>
                    <td className="py-1.5 pr-2"><span className={cn("rounded border px-1.5 py-0.5 font-mono text-3xs", s.stage === "paper" ? "border-foreground/50 text-foreground" : "border-border text-muted-foreground")} data-testid="saved-stage">{SAVED_STAGE_LABELS[s.stage]}</span></td>
                    <td className="max-w-[260px] py-1.5 pr-2"><div>{s.entryText}</div><div className="micro num">{s.definition.assets.join(", ")} · {s.definition.lots} lots</div></td>
                    <td className="num whitespace-nowrap py-1.5 pr-2 text-right" data-testid="saved-backtest">
                      {s.backtest ? (
                        <>
                          <div className={s.backtest.mean > 0 ? "text-profit" : s.backtest.mean < 0 ? "text-loss" : undefined}>{signed(s.backtest.mean)} a {s.backtest.per}</div>
                          <div className="micro">{s.backtest.positivePct} % won · worst {signed(s.backtest.worst)} · {s.backtest.samples} trades</div>
                          <div className="micro" title={s.backtest.basis}>entered by hand{s.backtestAt ? ` · ${fmtDate(s.backtestAt)}` : ""}</div>
                        </>
                      ) : <span className="text-muted-foreground">No figures yet</span>}
                    </td>
                    <td className="max-w-[180px] py-1.5 pr-2" data-testid="saved-who">{who(s)}</td>
                    <td className="py-1.5 pr-2 text-right whitespace-nowrap">
                      {can.edit ? <Button size="sm" variant="ghost" onClick={() => setEditing(s)} aria-label={`Edit ${s.name}`} data-testid="saved-edit">Edit</Button> : null}
                      <Button size="sm" variant="ghost" onClick={() => copy(s)} aria-label={`Copy ${s.name}`} data-testid="saved-copy">Copy</Button>
                      {can.publish ? <Button size="sm" variant="outline" onClick={() => setAsking({ step: "publish", strategy: s })} aria-label={`Publish ${s.name}`} data-testid="saved-publish">Publish</Button> : null}
                      {can.retire ? <Button size="sm" variant="outline" onClick={() => setAsking({ step: "retire", strategy: s })} aria-label={`Retire ${s.name}`} data-testid="saved-retire">Retire</Button> : null}
                      {can.remove ? <Button size="sm" variant="ghost" onClick={() => setAsking({ step: "delete", strategy: s })} aria-label={`Delete ${s.name}`} data-testid="saved-delete">Delete</Button> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </div>
      {copying ? <AutopilotStrategyDialog key={`copy-${copying.id}`} strategy={null} copy={copying} onSaved={saved} onOpenChange={(o) => { if (!o) setCopying(null); }} /> : null}
      {editing ? <AutopilotStrategyDialog key={editing === "new" ? "new" : editing.id} strategy={editing === "new" ? null : editing} onSaved={saved} onOpenChange={(o) => { if (!o) setEditing(null); }} /> : null}
      <Dialog open={asking !== null} onOpenChange={(o) => { if (!o) setAsking(null); }}>
        <DialogContent className="sm:max-w-[440px]" data-testid="saved-confirm">
          <DialogHeader>
            <DialogTitle>{asking ? STEP_TEXT[asking.step].title : ""}</DialogTitle>
            <DialogDescription>{asking ? STEP_TEXT[asking.step].what(asking.strategy) : ""}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsking(null)}>Cancel</Button>
            <Button variant={asking?.step === "publish" ? "primary" : "destructive"} loading={step.isPending || remove.isPending} onClick={confirm} data-testid="saved-confirm-yes">{asking ? STEP_TEXT[asking.step].button : ""}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The built-in strategies, read-only: what each does and its backtest figures, with a copy into a draft of the admin's own (HC-TR-280). */
function BuiltInTable({ rows, onCopy }: { rows: typeof BUILT_IN; onCopy: (p: Playbook, form: SavedForm, notes: string[]) => void }) {
  if (rows.length === 0) return <EmptyState title="No built-in strategy matches" description="Try another search" className="py-10" data-testid="builtin-empty" />;
  return (
    <>
      <p className="mb-2 text-xs text-muted-foreground" data-testid="builtin-note">These are the strategies that ship with HapieCoin. They cannot be edited or removed here. "Copy as my own" opens the editor with a strategy's settings as a new draft and leaves the built-in one as it is.</p>
      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full min-w-[900px] text-xs" data-testid="builtin-table">
          <thead><tr className="micro text-left"><th className="py-1 pl-2 pr-2">Strategy</th><th className="py-1 pr-2">Family</th><th className="py-1 pr-2">Enters</th><th className="py-1 pr-2">How it gets out</th><th className="py-1 pr-2 text-right">Backtest</th><th className="py-1 pr-2 text-right">Actions</th></tr></thead>
          <tbody>
            {rows.map(({ p, copy }) => {
              const back = playbookBacktest(p.id);
              return (
                <tr key={p.id} className="border-t border-border align-top" data-testid="builtin-row" data-playbook={p.id} data-copyable={copy.ok}>
                  <td className="max-w-[280px] py-1.5 pl-2 pr-2"><div className="truncate font-medium" title={p.name}>{p.name}</div><div className="micro truncate" title={p.summary}>{p.summary}</div><div className="micro num">{p.assets.join(", ")} · {p.lots} lots</div></td>
                  <td className="py-1.5 pr-2"><span className="rounded border border-border px-1.5 py-0.5 font-mono text-3xs text-muted-foreground">{FAMILY[playbookCadence(p)]}</span></td>
                  <td className="max-w-[240px] py-1.5 pr-2">{p.clock ? p.clock.describe : "when its market condition is met"}</td>
                  <td className="max-w-[220px] py-1.5 pr-2"><ul className="flex flex-wrap gap-1">{exitTags(p).map((t) => <li key={t} className="whitespace-nowrap rounded border border-border px-1.5 py-px">{t}</li>)}</ul></td>
                  <td className="num whitespace-nowrap py-1.5 pr-2 text-right" data-testid="builtin-backtest">
                    {back ? (
                      <>
                        <div className={back.mean > 0 ? "text-profit" : back.mean < 0 ? "text-loss" : undefined}>{signed(back.mean)} a {back.per}</div>
                        <div className="micro">{back.positivePct} % won · worst {signed(back.worst)}</div>
                        <div className="micro">{back.basis ?? `${back.samples} ${back.per}s tested`}</div>
                      </>
                    ) : <span className="text-muted-foreground">Recorded per coin, on the Autopilot page</span>}
                  </td>
                  <td className={cn("max-w-[220px] py-1.5 pr-2", copy.ok ? "text-right" : "text-left")}>
                    {copy.ok ? <Button size="sm" variant="outline" onClick={() => onCopy(p, copy.form, copy.notes)} aria-label={`Copy ${p.name} as my own`} data-testid="builtin-copy">Copy as my own</Button> : <span className="text-muted-foreground" data-testid="builtin-no-copy">Cannot be copied yet. {copy.why}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
