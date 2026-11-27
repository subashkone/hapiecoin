"use client";
// HC-TR-308 (ADR-147, ADR-148, ADR-149): the mandate a trader holds for a strategy, under that strategy's row: what
// state it is in, said in full, its limits, and the three steps. Pause and End ask for no code (stopping is never held
// up); Resume asks for the authenticator code. A paused mandate shows its reason whole, never cut.
import type { Mandate } from "@hapiecoin/schema";
import { Badge, Button, cn, toast } from "@hapiecoin/ui";
import { useState } from "react";
import { SECOND_FACTOR_LEN, SecondFactorField } from "@/components/dialogs/SecondFactorField";
import { TradingEnvTag } from "@/components/trading/TradingEnvTag";
import { type MandateStep, useMandateStep } from "@/lib/api/autopilot-mandate";
import { isSecondFactorError } from "@/lib/api/second-factor";
import { fmtDate } from "@/lib/format";

export type MandateView = "live" | "waiting" | "off" | "paused" | "not-standing" | "ended";
/**
 * How a mandate reads. "live" only when a live entry can actually be taken: the server enters live trades at all AND
 * the trader has this strategy switched on (Autopilot enters nothing, live or paper, for a strategy that is off). An
 * active, standing mandate is otherwise "waiting" (the server's switch is off) or "off" (the strategy's own switch).
 */
export function mandateView(m: Pick<Mandate, "state" | "standing">, liveAvailable: boolean, on: boolean): MandateView {
  if (m.state === "ended") return "ended";
  if (m.state === "paused") return "paused";
  if (!m.standing) return "not-standing";
  if (!liveAvailable) return "waiting";
  return on ? "live" : "off";
}
const LABEL: Record<MandateView, string> = { live: "LIVE · active", waiting: "Mandate signed · live is off", off: "Mandate signed · strategy is off", paused: "PAUSED", "not-standing": "NOT STANDING", ended: "ENDED" };
const NOT_STANDING = "No new live entries: the strategy is no longer approved for live, or is no longer yours to use.";
/** What the state means, in a sentence that claims nothing about paper unless the strategy is switched on. */
function wordsOf(view: MandateView, on: boolean): string | null {
  if (view === "waiting") return `Live Autopilot is switched off on this server.${on ? " This strategy trades on paper meanwhile." : " This strategy is switched off too: nothing is entered for it."}`;
  if (view === "off") return "This strategy is switched off on Autopilot: nothing is entered for it, live or paper. Switch it on to let this mandate work.";
  if (view === "not-standing") return NOT_STANDING;
  return null;
}
/** A pause the server made for an entry that did not complete: the trader has something to do at the exchange. */
export const isIncompletePause = (m: Pick<Mandate, "state" | "pauseReason">): boolean => m.state === "paused" && (m.pauseReason ?? "").startsWith("Live entry incomplete");

export function MandateLine({ mandate: m, liveAvailable, on, named = false }: { mandate: Mandate; liveAvailable: boolean; /** whether the trader has this strategy switched on */ on: boolean; /** say the strategy's name: the line stands alone, not under its row */ named?: boolean }) {
  const step = useMandateStep();
  const [asking, setAsking] = useState<"end" | "resume" | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const view = mandateView(m, liveAvailable, on);
  const keep = () => {
    setAsking(null);
    setCode("");
    setCodeError(null);
    setRefusal(null);
  };
  const run = (what: MandateStep) => {
    setRefusal(null);
    setCodeError(null);
    step.mutate(
      { id: m.id, step: what, ...(what === "resume" ? { code } : {}) },
      {
        onSuccess: () => {
          toast.success(what === "pause" ? "Mandate paused" : what === "resume" ? "Mandate resumed" : "Mandate ended", { description: what === "resume" ? undefined : "No new live entries. Open trades keep their exits." });
          keep();
        },
        onError: (e) => {
          setCode("");
          if (isSecondFactorError(e)) setCodeError(e.message);
          else setRefusal(e instanceof Error ? e.message : "Nothing was changed");
        },
      },
    );
  };
  const reason = m.state === "paused" ? m.pauseReason : m.state === "ended" ? m.endReason : wordsOf(view, on);
  return (
    <div className={cn("col-span-full mt-1 flex flex-col gap-1.5 rounded border px-2.5 py-2 text-xs", view === "paused" || view === "not-standing" ? "border-warning bg-warning/5" : "border-border")} data-testid="mandate-line" data-view={view} data-mandate={m.id}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {named ? <b data-testid="mandate-strategy">{m.strategyName} · v{m.version}</b> : null}
        {/* never amber (the primary action's) and never green (profit's): live is said in words, in a plain bold chip */}
        <Badge variant={view === "live" ? "secondary" : "outline"} className={view === "live" ? "font-bold" : undefined} data-testid="mandate-state">{LABEL[view]}</Badge>
        {view !== "ended" ? <TradingEnvTag /> : null}
        <span className="num text-muted-foreground" data-testid="mandate-terms">{m.accountLabel ?? "account removed"} · {m.lots} lots a trade · {m.maxOpen} open at once · capital {m.maxCapitalUsd} USD · loss limit {m.dayLossLimitUsd} USD a day, {m.weekLossLimitUsd} USD a week</span>
        <span className="text-muted-foreground">signed {fmtDate(m.signedAt)}</span>
        {view !== "ended" ? (
          <span className="ml-auto flex items-center gap-2">
            {m.state === "active" ? <Button size="sm" variant="outline" onClick={() => run("pause")} disabled={step.isPending} data-testid="mandate-pause">Pause</Button> : null}
            {m.state === "paused" && asking !== "resume" ? <Button size="sm" variant="outline" onClick={() => { keep(); setAsking("resume"); }} disabled={step.isPending} data-testid="mandate-resume">Resume</Button> : null}
            {asking !== "end" ? <Button size="sm" variant="outline" onClick={() => { keep(); setAsking("end"); }} disabled={step.isPending} data-testid="mandate-end">End</Button> : null}
          </span>
        ) : null}
      </div>
      {reason ? <p className="whitespace-pre-wrap break-words" data-testid="mandate-reason">{reason}</p> : null}
      {m.state === "paused" && !m.standing ? <p data-testid="mandate-also">{NOT_STANDING} Resuming it would be refused.</p> : null}
      {isIncompletePause(m) ? <p data-testid="mandate-todo">What to do: check what your exchange account holds for this trade, then square the trade off on the Live tab of the desk. While that trade is open this mandate cannot be resumed.</p> : null}
      {view !== "ended" ? <p className="text-muted-foreground">Pausing or ending stops new live entries. Open trades keep their exits.</p> : null}
      {asking === "end" ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="mandate-end-ask">
          <span>End this mandate? It cannot be resumed; to trade this strategy live again you sign a new one.</span>
          <Button size="sm" variant="outline" onClick={keep} disabled={step.isPending} data-testid="mandate-keep">Keep it</Button>
          <Button size="sm" variant="destructive" onClick={() => run("end")} disabled={step.isPending} data-testid="mandate-end-yes">End mandate</Button>
        </div>
      ) : null}
      {asking === "resume" ? (
        <div className="flex flex-col gap-2" data-testid="mandate-resume-ask">
          <SecondFactorField value={code} onChange={(v) => { setCode(v); setCodeError(null); }} error={codeError} what="resuming this mandate" name={`mandate-code-${m.id}`} />
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={keep} disabled={step.isPending} data-testid="mandate-keep">Leave it paused</Button>
            <Button size="sm" onClick={() => run("resume")} disabled={code.length !== SECOND_FACTOR_LEN || step.isPending} data-testid="mandate-resume-yes">Resume</Button>
          </div>
        </div>
      ) : null}
      {refusal ? <p className="text-loss" role="alert" data-testid="mandate-step-refusal">{refusal}</p> : null}
    </div>
  );
}
