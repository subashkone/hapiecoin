"use client";
// Trade All → Live (HC-TR-089, ADR-010): an explicit batch selector over the open paper strategies, one
// exchange, one confirm; the API places one strategy at a time and stops at the first failure.
import type { Broker, BrokerCredentialPublic, Strategy } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, cn, toast } from "@hapiecoin/ui";
import { useEffect, useState } from "react";
import { newIdempotencyKey, useLiveBatch, useLiveDay } from "@/lib/api/live";
import { handleUpgradeRequired } from "@/lib/api/upgrade";
import { fmtMoney, type MoneyFormat } from "@/lib/money";
import { accountsOf } from "@/lib/accounts";
import { useUiStore } from "@/lib/store";
import { openLegs } from "@/lib/strategy/paper";
import { type MindfulPauseInfo, refusedMindful, serverMindful } from "@/lib/strategy/mindful";
import { MindfulCountdownButton, MindfulPause, useMindfulCountdown } from "./MindfulPause";
import { TypedConfirm, isLiveConfirm } from "./TypedConfirm";

export function BatchLiveDialog({ open, onOpenChange, strategies, brokers, accounts, connected, money, totalOf, mindful = null }: { open: boolean; onOpenChange: (o: boolean) => void; strategies: Strategy[]; brokers: Broker[]; accounts: BrokerCredentialPublic[]; connected: boolean; money: MoneyFormat; totalOf: (s: Strategy) => number; /** Mindful pause (HC-TR-182): the trader is down on the day on live strategies. */ mindful?: MindfulPauseInfo | null | undefined }) {
  const batch = useLiveBatch();
  const setWorkspaceTab = useUiStore((s) => s.setWorkspaceTab);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [brokerId, setBrokerId] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [word, setWord] = useState(""); // HC-TR-186
  const storedAccount = useUiStore((s) => s.accountId);
  const setAccount = useUiStore((s) => s.setAccount);
  const mine = accountsOf(accounts, brokerId);
  // ADR-084: the server's figure decides when it is known (and its read starts the server's pause clock); the tab's fold otherwise
  const day = useLiveDay(open);
  const fromServer = serverMindful(day.data);
  // a refusal the preview did not foresee (the day moved after it) shows the block and restarts the countdown
  const [refused, setRefused] = useState<{ info: MindfulPauseInfo; run: number } | null>(null);
  const info = refused?.info ?? (fromServer === undefined ? mindful : fromServer);
  const pauseLeft = useMindfulCountdown(open ? info : null, refused ? `${key}:${refused.run}` : key);
  // nothing goes until the server's figure has been asked for: its read is what starts the server's pause clock
  const canGo = sel.size > 0 && connected && Boolean(brokerId) && isLiveConfirm(word) && !day.isPending;
  useEffect(() => {
    if (open) {
      setSel(new Set(strategies.filter((s) => openLegs(s).length > 0).map((s) => s.id)));
      setBrokerId(brokers[0]?.id ?? "");
      setKey(newIdempotencyKey());
      setWord("");
      setRefused(null);
    }
  }, [open, strategies, brokers]);
  useEffect(() => {
    // ADR-068: the account chosen last, else the exchange's first key; a strategy that already names one keeps its own
    if (open && brokerId) setAccountId(mine.find((m) => m.id === storedAccount)?.id ?? mine[0]?.id ?? null);
  }, [open, brokerId, accounts.length]);
  const go = () =>
    batch.mutate(
      { confirm: word, ids: [...sel], brokerId, ...(accountId ? { accountId } : {}), idempotencyKey: key },
      {
        onSuccess: (r) => {
          onOpenChange(false);
          if (r.placed.length) setWorkspaceTab("live");
          if (r.failed) toast.error("Batch stopped", { description: `${strategies.find((s) => s.id === r.failed?.id)?.name ?? r.failed.id}: ${r.failed.error}` });
          else toast.success("Live Orders Placed", { description: `${r.placed.length} ${r.placed.length === 1 ? "strategy" : "strategies"} moved to live` });
        },
        onError: (e) => {
          const pause = refusedMindful(e);
          if (pause) setRefused((r) => ({ info: pause, run: (r?.run ?? 0) + 1 }));
          else if (!handleUpgradeRequired(e)) toast.error("Batch refused", { description: e.message });
        },
      },
    );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]" data-testid="batch-live">
        <DialogHeader>
          <DialogTitle>Trade All → Live</DialogTitle>
          <DialogDescription>Place every ticked paper strategy as real orders on the exchange, one strategy at a time</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {strategies.length === 0 ? <p className="text-xs text-muted-foreground">No paper strategies to convert.</p> : null}
          {strategies.map((s) => {
            const open = openLegs(s);
            return (
              <label key={s.id} className={cn("mb-1 flex items-center gap-2 rounded border border-border px-2 py-1 text-xs", open.length === 0 && "opacity-50")} data-testid="batch-row">
                <input type="checkbox" checked={sel.has(s.id)} disabled={open.length === 0} onChange={(e) => setSel((x) => { const n = new Set(x); if (e.target.checked) n.add(s.id); else n.delete(s.id); return n; })} aria-label={s.name} data-testid="batch-check" />
                <span className="font-medium">{s.name}</span>
                <span className="micro rounded border border-border px-1">{s.asset}</span>
                <span className="micro">{open.length} open {open.length === 1 ? "leg" : "legs"}</span>
                <span className={cn("num ml-auto", totalOf(s) >= 0 ? "text-profit" : "text-loss")}>{fmtMoney(totalOf(s), money, { signed: true })}</span>
              </label>
            );
          })}
          <div className="mt-3">
            <div className="micro mb-1">Exchange</div>
            <select className="h-8 w-full rounded border border-input bg-background px-2 text-xs" value={brokerId} onChange={(e) => setBrokerId(e.target.value)} aria-label="Exchange" data-testid="batch-broker">
              {brokers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} · Fee {b.feePct}% · GST {b.gstPct}%
                </option>
              ))}
            </select>
            {mine.length > 1 ? (
              <div className="mt-2">
                <div className="micro mb-1">Account</div>
                <select className="h-8 w-full rounded border border-input bg-background px-2 text-xs" value={accountId ?? ""} onChange={(e) => { setAccountId(e.target.value || null); setAccount(e.target.value || null); }} aria-label="Account" data-testid="batch-account">
                  {mine.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} · {m.apiKeyMasked}
                    </option>
                  ))}
                </select>
                <div className="mt-1 text-2xs text-muted-foreground">For strategies that do not name an account yet; one started on another account keeps its own.</div>
              </div>
            ) : null}
          </div>
          {info ? <MindfulPause info={info} money={money} left={pauseLeft} atRisk={{ text: "each strategy's own worst case · see its card", loss: false }} marginText="—" /> : null}
          <div className="mt-3 rounded border border-loss/40 p-2 text-2xs" data-testid="batch-warning">
            <b className="text-loss">Real Money Trading</b>
            <div>Each strategy is previewed against the exchange (contracts, marks, wallet, limits) and placed in order; the batch stops at the first refusal and tells you which strategy.</div>
            {!connected ? <div className="mt-1 text-warning">Connect your exchange in Settings → API Settings first.</div> : null}
          </div>
          <TypedConfirm value={word} onChange={setWord} onSubmit={() => canGo && pauseLeft === 0 && go()} disabled={batch.isPending} focusKey={open && pauseLeft === 0} verb="place" />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {info && pauseLeft > 0 ? (
            <MindfulCountdownButton left={pauseLeft} />
          ) : (
            <Button variant="destructive" disabled={!canGo} loading={batch.isPending} onClick={go} data-testid="batch-go">
              Trade {sel.size} {sel.size === 1 ? "strategy" : "strategies"} live →
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
