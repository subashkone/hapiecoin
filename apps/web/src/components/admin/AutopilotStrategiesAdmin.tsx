"use client";
// Admin · Autopilot strategies (HC-TR-277; ADR-141, ADR-142): every saved strategy with its stage, how it enters, its
// backtest figures and who can use it, and the steps the API would accept for it: edit, copy, publish to paper, retire,
// delete. The 85 built-in strategies are not listed here and cannot be changed. Paper only.
import { SAVED_STAGES, SAVED_STAGE_LABELS, type SavedStage, type SavedStrategy } from "@hapiecoin/schema";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, cn, toast } from "@hapiecoin/ui";
import { useMemo, useState } from "react";
import { AdminHeader } from "./AdminShell";
import { AutopilotStrategyDialog } from "./AutopilotStrategyDialog";
import { useDeleteSavedStrategy, useSavedStrategies, useSavedStrategyStep } from "@/lib/api/autopilot-saved";
import { useAdminPlans } from "@/lib/api/billing";
import { fmtDate } from "@/lib/format";

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
const signed = (n: number): string => `${n > 0 ? "+" : n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

export function AutopilotStrategiesAdmin() {
  const list = useSavedStrategies();
  const plans = useAdminPlans();
  const step = useSavedStrategyStep();
  const remove = useDeleteSavedStrategy();
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<"all" | SavedStage>("all");
  const [editing, setEditing] = useState<SavedStrategy | null | "new">(null);
  const [asking, setAsking] = useState<{ step: Step; strategy: SavedStrategy } | null>(null);
  const all = useMemo(() => list.data ?? [], [list.data]);
  const rows = all.filter((s) => (!q || `${s.name} ${s.summary}`.toLowerCase().includes(q.toLowerCase())) && (stage === "all" || s.stage === stage));
  const filtered = q !== "" || stage !== "all";
  const clear = () => { setQ(""); setStage("all"); };
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
      <div className="sticky top-0 z-10 -mx-1 mb-2 flex flex-wrap items-center gap-2 bg-background px-1 py-2" data-testid="saved-filters">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search strategies" className="h-7 w-[200px] rounded border border-input bg-background px-2 text-xs" aria-label="Search strategies" data-testid="saved-search" />
        <select value={stage} onChange={(e) => setStage(e.target.value as typeof stage)} className="h-7 rounded border border-input bg-background px-2 text-xs" aria-label="Stage" data-testid="saved-stage-filter">
          <option value="all">All stages</option>
          {SAVED_STAGES.map((k) => <option key={k} value={k}>{SAVED_STAGE_LABELS[k]}</option>)}
        </select>
        {filtered ? <Button size="sm" variant="ghost" onClick={clear} data-testid="saved-clear">Clear</Button> : null}
        <span className="flex-1" />
        <span className="micro">{rows.length} of {all.length}</span>
      </div>
      {list.isLoading ? (
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
      {editing ? <AutopilotStrategyDialog key={editing === "new" ? "new" : editing.id} strategy={editing === "new" ? null : editing} onOpenChange={(o) => { if (!o) setEditing(null); }} /> : null}
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
