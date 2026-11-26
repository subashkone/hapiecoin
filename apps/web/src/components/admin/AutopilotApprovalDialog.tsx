"use client";
// Admin · approval of a saved Autopilot strategy for live (HC-TR-294; ADR-145): the paper record of one version against
// the checks the owner kept, the trades and skip lines the approver has to read, Approve for live and Withdraw.
// An approval is a record on a strategy that stays on paper: nothing here places, enables or switches an order, and a
// trader sees none of it. The figures are paper ones, of one account, after estimated fees, and say so beside them.
import { CLOSE_REASON_LABELS, type SavedApproval, type SavedApprovalCheck, type SavedApprovalView, type SavedPaperRecord, type SavedStrategy } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, cn, toast } from "@hapiecoin/ui";
import { useState } from "react";
import { SECOND_FACTOR_MISSING_MESSAGE, SecondFactorField, secondFactorMissing } from "@/components/dialogs/SecondFactorField";
import { useSavedApproval, useSavedApprovalStep } from "@/lib/api/autopilot-saved";
import { useMe } from "@/lib/api/queries";
import { isSecondFactorError } from "@/lib/api/second-factor";
import { fmtDate, fmtDateTime } from "@/lib/format";

/** A decimal string of USD with its sign: "+$60.90", "−$8.50", "$0.00". The cents are the server's; nothing is recomputed here. */
export function signedUsdText(v: string): string {
  const negative = v.startsWith("-");
  const [whole = "0", cents = "00"] = (negative ? v.slice(1) : v).split(".");
  const zero = Number(v) === 0;
  return `${zero ? "" : negative ? "−" : "+"}$${Number(whole).toLocaleString("en-US")}.${cents.padEnd(2, "0")}`;
}
const tone = (v: string): string | undefined => (Number(v) > 0 ? "text-profit" : Number(v) < 0 ? "text-loss" : undefined);
const reasonOf = (reason: string): string => (CLOSE_REASON_LABELS as Record<string, string>)[reason] ?? reason;
const MARK: Record<"pass" | "fail" | "open", { sign: string; word: string }> = { pass: { sign: "✓", word: "passes" }, fail: { sign: "✗", word: "does not pass" }, open: { sign: "○", word: "open" } };
export const checkState = (c: SavedApprovalCheck): "pass" | "fail" | "open" => (c.pass ? "pass" : c.blocking ? "fail" : "open");
/** The blocking checks that do not pass. */
export const failingOf = (checks: readonly SavedApprovalCheck[]): SavedApprovalCheck[] => checks.filter((c) => c.blocking && !c.pass);

export function AutopilotApprovalDialog({ strategy, onOpenChange }: { strategy: SavedStrategy; onOpenChange: (open: boolean) => void }) {
  const view = useSavedApproval(strategy.id);
  const step = useSavedApprovalStep(strategy.id);
  const me = useMe();
  const needsCode = me.data?.twoFactorEnabled === true;
  const [read, setRead] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const v = view.data;
  const approval = v?.approval ?? null;
  const failing = v ? failingOf(v.checks) : [];
  // why Approve cannot be pressed, in the order a reader can do something about it
  const onPaper = strategy.stage === "paper";
  const blocked = !v ? null : !v.mayApprove ? "Approving a strategy for live is not among your permissions." : !onPaper ? "Only a strategy on paper can be approved." : failing.length > 0 ? `${failing.length} ${failing.length === 1 ? "check does" : "checks do"} not pass.` : !v.approvable ? "It cannot be approved as it stands." : !read ? "Tick the box once you have read its trades and its skip lines." : null;
  // the code is asked for only when the step it confirms can be taken
  const codeAsked = needsCode && v?.mayApprove === true && (approval ? withdrawing : blocked === null || failing.length === 0);
  const keep = () => {
    setWithdrawing(false);
    setCode("");
    setCodeError(null);
    setRefusal(null);
  };
  const send = (what: "approve" | "withdraw") => {
    setRefusal(null);
    setCodeError(null);
    if (secondFactorMissing(needsCode, code)) return setCodeError(SECOND_FACTOR_MISSING_MESSAGE);
    step.mutate(
      { step: what, read, ...(needsCode ? { code } : {}) },
      {
        onSuccess: (s) => {
          toast.success(what === "approve" ? "Approved for live" : "Approval withdrawn", { description: `${s.name} · still on paper` });
          setRead(false);
          setCode("");
          setWithdrawing(false);
        },
        onError: (e) => {
          if (isSecondFactorError(e)) setCodeError(e.message);
          else setRefusal(e.message);
          // a refusal for want of a code on an account whose authenticator was switched on elsewhere: the field appears
          if (isSecondFactorError(e) && !needsCode) void me.refetch();
        },
      },
    );
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[880px]" data-testid="saved-approval-dialog" data-state={view.isLoading ? "loading" : view.isError ? "error" : approval ? "approved" : "open"}>
        <DialogHeader>
          <DialogTitle><span className="truncate" title={strategy.name}>Approval for live · {strategy.name}</span> <span className="micro">v{strategy.version}</span> <span className="ml-1 rounded border border-border px-1.5 py-0.5 font-mono text-3xs text-muted-foreground" data-testid="saved-approval-stage">{onPaper ? "PAPER" : strategy.stage === "retired" ? "RETIRED" : "NOT ON PAPER"}</span></DialogTitle>
          <DialogDescription>Approving records that this version may go live once live trading exists. It places nothing and switches nothing: Autopilot stays paper only.</DialogDescription>
        </DialogHeader>
        <DialogBody className="max-h-[70vh] space-y-3 overflow-y-auto text-xs">
          {view.isLoading ? <div className="h-24 animate-pulse rounded bg-muted" /> : null}
          {view.isError ? <p className="text-loss" role="alert" data-testid="saved-approval-load-error">Couldn&apos;t load its paper record: {view.error.message} <Button size="sm" variant="outline" onClick={() => void view.refetch()}>Retry</Button></p> : null}
          {v ? (
            <>
              {approval ? <Approved approval={approval} failing={failing} /> : null}
              <section aria-label="Checks" data-testid="saved-approval-checks">
                <h3 className="mb-1 flex items-baseline justify-between text-sm font-medium"><span>Checks</span><span className="micro" data-testid="saved-approval-tally">{v.checks.filter((c) => c.blocking && c.pass).length} of {v.checks.filter((c) => c.blocking).length} pass</span></h3>
                <ul className="divide-y divide-border rounded border border-border">
                  {v.checks.map((c) => {
                    const s = checkState(c);
                    return (
                      <li key={c.key} className="grid gap-x-3 gap-y-0.5 p-2 sm:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]" data-testid="saved-approval-check" data-key={c.key} data-state={s}>
                        <span className={cn(s === "fail" && "font-medium")}><span aria-hidden className="num mr-1.5 inline-block w-3">{MARK[s].sign}</span>{c.label} <span className="micro">{MARK[s].word}</span></span>
                        <span className="text-muted-foreground">{c.detail}</span>
                      </li>
                    );
                  })}
                </ul>
              </section>
              <Record v={v} />
              {v.mayApprove && !approval && onPaper ? (
                <label className="flex items-start gap-2 rounded border border-border p-2">
                  <input type="checkbox" className="mt-0.5" checked={read} onChange={(e) => setRead(e.target.checked)} data-testid="saved-approval-read" />
                  <span>I have read its trades and its skip lines.</span>
                </label>
              ) : null}
              {codeAsked ? <SecondFactorField value={code} onChange={(x) => { setCode(x); setCodeError(null); }} error={codeError} what={approval ? "withdrawing this approval" : "this approval"} name="approval-second-factor" /> : null}
              {!needsCode && codeError ? <p className="text-loss" role="alert" data-testid="saved-approval-code-error">{codeError}</p> : null}
              {refusal ? <p className="rounded border border-border p-2 text-loss" role="alert" data-testid="saved-approval-refusal">{refusal}</p> : null}
              {withdrawing ? <p className="rounded border border-border p-2" data-testid="saved-approval-withdraw-ask">Withdraw this approval? The strategy stays on paper and its open paper trades keep their exits. It can be approved again.</p> : null}
              {!approval && blocked ? <p className="text-muted-foreground" data-testid="saved-approval-blocked">{blocked}</p> : null}
              {approval && !v.mayApprove ? <p className="text-muted-foreground" data-testid="saved-approval-blocked">Withdrawing an approval is not among your permissions.</p> : null}
            </>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => (withdrawing ? keep() : onOpenChange(false))} data-testid="saved-approval-close">{withdrawing ? "Keep it" : "Close"}</Button>
          {v && !approval ? <Button loading={step.isPending} disabled={blocked !== null} onClick={() => send("approve")} data-testid="saved-approval-approve">Approve for live</Button> : null}
          {v && approval && v.mayApprove ? <Button variant="destructive" loading={step.isPending} onClick={() => (withdrawing ? send("withdraw") : setWithdrawing(true))} data-testid="saved-approval-withdraw">{withdrawing ? "Yes, withdraw" : "Withdraw approval"}</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Who approved it, when, and on what; and beside it what the checks say today. */
function Approved({ approval, failing }: { approval: SavedApproval; failing: SavedApprovalCheck[] }) {
  const r = approval.record;
  const b = approval.backtest;
  return (
    <section className="space-y-1 rounded border border-foreground/40 p-2" aria-label="Approval" data-testid="saved-approval-given">
      <div className="text-sm font-medium">Approved for live by {approval.byName} on {fmtDateTime(approval.at)}</div>
      <div className="text-muted-foreground">Given on a paper record of {signedUsdText(r.netUsd)} after estimated fees on {r.closed} closed paper {r.closed === 1 ? "trade" : "trades"} of one account, {r.days} days after its first, and a backtest of {b.mean.toFixed(2)} USD a {b.per} ({b.run ? "computed in the app" : "entered by hand"}).</div>
      <div data-testid="saved-approval-today" data-passes={failing.length === 0}>{failing.length === 0 ? "Today it still passes the checks that block. The margin check is still open." : `Today it no longer passes: ${failing.map((c) => c.label.toLowerCase()).join("; ")}. The approval stands until someone withdraws it.`}</div>
      <div className="micro">It still trades on paper only.</div>
    </section>
  );
}

const periodOf = (r: SavedPaperRecord): string => (r.firstEntryAt && r.lastEntryAt ? `first paper trade ${fmtDate(r.firstEntryAt)}, latest ${fmtDate(r.lastEntryAt)}` : "no paper trade yet");
/** An amount of USD without a sign, as the server sent it, with thousands separated. */
const usdText = (v: string): string => signedUsdText(v).replace(/^[+−]/, "");

/** The paper record with what it rests on, then the trades and the skip lines the approver reads. */
function Record({ v }: { v: SavedApprovalView }) {
  const r = v.record;
  const skips = Object.entries(v.skips);
  return (
    <section className="space-y-2 rounded border border-border p-2" aria-label="Paper record" data-testid="saved-approval-record">
      <div className="micro" data-testid="saved-approval-basis">Paper record · {r.accounts === 0 ? "no account has traded it yet" : r.accounts === 1 ? `the one account that traded it · ${periodOf(r)}` : `one account of the ${r.accounts} that traded it · ${periodOf(r)}`}</div>
      {r.closed + r.open === 0 ? (
        <div data-testid="saved-approval-no-trades">No paper trade yet{r.since ? `; published ${fmtDate(r.since)}` : ""}.</div>
      ) : (
        <>
          <div className="num flex flex-wrap gap-x-5 gap-y-1 text-sm" data-testid="saved-approval-figures">
            {r.closed === 0 ? <span>No trade closed yet</span> : <><span className={tone(r.netUsd)}>{signedUsdText(r.netUsd)} after est. fees</span><span>{r.wins} of {r.closed} won</span></>}
            {r.worstNetUsd !== null ? <span>worst <span className={tone(r.worstNetUsd)}>{signedUsdText(r.worstNetUsd)}</span></span> : null}
            <span>{r.open} open</span>
          </div>
          {r.closed > 0 ? <div className="num text-muted-foreground" data-testid="saved-approval-totals">Before fees {signedUsdText(r.grossUsd)} · estimated fees {usdText(r.feesUsd)} (USD, at that account&apos;s size)</div> : null}
        </>
      )}
      <div className="text-muted-foreground" data-testid="saved-approval-limits">Paper fills are at the mark price and the fees are the estimate made at entry. {r.accounts > 1 ? "The figures are one account\u2019s, the one that took the most entries. " : ""}The log keeps {r.logDays} days.</div>
      {v.trades.length > 0 ? (
        <details open data-testid="saved-approval-trades">
          <summary className="cursor-pointer">Closed trades ({r.closed}){r.closed > v.trades.length ? `, the latest ${v.trades.length} shown` : ""}</summary>
          <div className="mt-1 max-h-[280px] overflow-auto rounded border border-border" tabIndex={0} role="region" aria-label="Closed paper trades">
            <table className="w-full min-w-[640px] text-xs">
              <thead className="sticky top-0 bg-background"><tr className="micro text-left"><th className="py-1 pl-2 pr-2">Entered</th><th className="py-1 pr-2">Expiry</th><th className="py-1 pr-2">Strikes</th><th className="py-1 pr-2">Ended</th><th className="py-1 pr-2">How</th><th className="py-1 pr-2 text-right">After est. fees</th></tr></thead>
              <tbody>
                {v.trades.map((t) => (
                  <tr key={`${t.asset}-${t.expiry ?? ""}-${t.openedAt}`} className="border-t border-border align-top" data-testid="saved-approval-trade">
                    <td className="num whitespace-nowrap py-1 pl-2 pr-2">{fmtDateTime(t.openedAt)}</td>
                    <td className="num whitespace-nowrap py-1 pr-2">{t.asset}{t.expiry ? ` ${fmtDate(t.expiry)}` : ""}</td>
                    <td className="num py-1 pr-2">{t.strikes.map((k) => Number(k).toLocaleString("en-US")).join(" · ")}</td>
                    <td className="num whitespace-nowrap py-1 pr-2">{fmtDateTime(t.closedAt)}</td>
                    <td className="py-1 pr-2">{reasonOf(t.reason)}</td>
                    <td className={cn("num whitespace-nowrap py-1 pr-2 text-right", tone(t.netUsd))}>{signedUsdText(t.netUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
      {skips.length > 0 ? (
        <details open data-testid="saved-approval-skips">
          <summary className="cursor-pointer">Skip lines {r.accounts === 0 ? "in every account\u2019s log" : "in that account\u2019s log"} ({r.skipLines}), by reason</summary>
          <ul className="list-disc pl-4 text-muted-foreground">{skips.map(([why, n]) => <li key={why}>{why}: {n}</li>)}</ul>
          <div className="micro mt-1">A line is written when the reason changes, not once for every entry skipped.</div>
        </details>
      ) : null}
    </section>
  );
}
