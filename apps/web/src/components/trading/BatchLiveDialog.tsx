"use client";
// Trade All → Live (HC-TR-089, ADR-010): an explicit batch selector over the open paper strategies, one
// exchange, one confirm; the API places one strategy at a time and stops at the first failure. Previewed as one batch
// first (HC-TR-191, ADR-087): every strategy's own check and the wallet against the premiums together.
import type { Broker, BrokerCredentialPublic, Strategy } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, cn, toast } from "@hapiecoin/ui";
import { useEffect, useMemo, useState } from "react";
import { newIdempotencyKey, useBatchPreview, useLiveBatch } from "@/lib/api/live";
import { handleUpgradeRequired } from "@/lib/api/upgrade";
import { fmtMoney, type MoneyFormat } from "@/lib/money";
import { accountsOf } from "@/lib/accounts";
import { useUiStore } from "@/lib/store";
import { openLegs } from "@/lib/strategy/paper";
import type { MindfulPauseInfo } from "@/lib/strategy/mindful";
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
  const pauseLeft = useMindfulCountdown(open ? mindful : null, key);
  // ADR-087: the ticked strategies previewed as one batch; the button waits for it and stays off while it refuses
  const ids = useMemo(() => [...sel].sort(), [sel]);
  const preview = useBatchPreview(open && connected && brokerId && ids.length ? { ids, brokerId, ...(accountId ? { accountId } : {}) } : null);
  const batchOk = preview.data?.ok === true && !preview.isFetching && !preview.isError; // a failed re-check never rides on a stale ok
  const itemOf = (id: string) => preview.data?.items.find((i) => i.id === id);
  /** A cash figure from the exchange in the display currency when it is USD, else as the exchange states it. */
  const cash = (v: string | null, asset: string | null) => (v === null ? "—" : asset === null || asset === "USD" ? fmtMoney(Number(v), money) : `${v} ${asset}`);
  const canGo = sel.size > 0 && connected && Boolean(brokerId) && isLiveConfirm(word) && batchOk;
  useEffect(() => {
    if (open) {
      setSel(new Set(strategies.filter((s) => openLegs(s).length > 0).map((s) => s.id)));
      setBrokerId(brokers[0]?.id ?? "");
      setKey(newIdempotencyKey());
      setWord("");
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
          if (!handleUpgradeRequired(e)) toast.error("Batch refused", { description: e.message });
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
            const item = sel.has(s.id) ? itemOf(s.id) : undefined;
            return (
              <div key={s.id} className={cn("mb-1 rounded border border-border px-2 py-1 text-xs", open.length === 0 && "opacity-50")} data-testid="batch-row">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={sel.has(s.id)} disabled={open.length === 0} onChange={(e) => setSel((x) => { const n = new Set(x); if (e.target.checked) n.add(s.id); else n.delete(s.id); return n; })} aria-label={s.name} data-testid="batch-check" />
                  <span className="font-medium">{s.name}</span>
                  <span className="micro rounded border border-border px-1">{s.asset}</span>
                  <span className="micro">{open.length} open {open.length === 1 ? "leg" : "legs"}</span>
                  <span className={cn("num ml-auto", totalOf(s) >= 0 ? "text-profit" : "text-loss")}>{fmtMoney(totalOf(s), money, { signed: true })}</span>
                </label>
                {sel.has(s.id) ? (
                  <div className={cn("mt-0.5 text-2xs", item ? (item.ok ? "text-muted-foreground" : "text-loss") : "text-muted-foreground")} data-testid="batch-row-check" data-ok={item ? String(item.ok) : "pending"}>
                    {item ? (item.ok ? `Exchange check passed · notional ${fmtMoney(Number(item.notional), money)} · ${Number(item.debit) >= 0 ? "pays" : "receives"} ${fmtMoney(Math.abs(Number(item.debit)), money)}` : item.reasons[0]) : preview.isError ? "Exchange check failed to run" : "Checking on the exchange…"}
                  </div>
                ) : null}
              </div>
            );
          })}
          {preview.isError && ids.length > 0 ? (
            <div className="mt-2 rounded border border-loss/60 p-2 text-2xs" role="status" data-testid="batch-preview" data-ok="error">
              <span className="text-loss">The exchange check could not run: {preview.error instanceof Error ? preview.error.message : "request failed"}</span>
              <Button variant="outline" size="sm" className="ml-2" onClick={() => void preview.refetch()} data-testid="batch-preview-retry">
                Check again
              </Button>
            </div>
          ) : preview.data && ids.length > 0 ? (
            <div className={cn("mt-2 rounded border p-2 text-2xs", preview.data.ok ? "border-border" : "border-loss/60", preview.isFetching && "opacity-70")} role="status" data-testid="batch-preview" data-ok={String(preview.data.ok)} data-fetching={String(preview.isFetching)}>
              <div className="flex flex-wrap gap-x-3">
                <span>Batch on the exchange: <b className="num">{fmtMoney(Number(preview.data.notional), money)}</b> notional</span>
                <span>Premium {Number(preview.data.debit) >= 0 ? "paid" : "received"} together: <b className="num">{fmtMoney(Math.abs(Number(preview.data.debit)), money)}</b></span>
                <span>Available: <b className="num">{cash(preview.data.available, preview.data.availableAsset)}</b></span>
                <span>Margin in use: <b className="num">{cash(preview.data.marginUsed, preview.data.availableAsset)}</b></span>
              </div>
              {preview.data.reasons.map((r, i) => (
                <div key={`${i}-${r}`} className="mt-1 text-loss" data-testid="batch-preview-reason">
                  {r}
                </div>
              ))}
              {!preview.data.ok && preview.data.reasons.length === 0 ? <div className="mt-1 text-loss">Untick the refused strategy or fix it; the batch places nothing until every check passes.</div> : null}
            </div>
          ) : null}
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
          {mindful ? <MindfulPause info={mindful} money={money} left={pauseLeft} atRisk={preview.data ? { text: `${fmtMoney(Math.abs(Number(preview.data.debit)), money)} premium ${Number(preview.data.debit) >= 0 ? "paid" : "received"} across the batch · each strategy's own worst case on its card`, loss: Number(preview.data.debit) > 0 } : { text: "each strategy's own worst case · see its card", loss: false }} marginText={preview.data ? cash(preview.data.marginUsed, preview.data.availableAsset) : "—"} /> : null}
          <div className="mt-3 rounded border border-loss/40 p-2 text-2xs" data-testid="batch-warning">
            <b className="text-loss">Real Money Trading</b>
            <div>The batch is previewed as one against the exchange (contracts, marks, limits, and the wallet against the premiums together): nothing is placed until every check passes; then the strategies go in order, and a refusal at the venue stops the batch and names the strategy.</div>
            {!connected ? <div className="mt-1 text-warning">Connect your exchange in Settings → API Settings first.</div> : null}
          </div>
          <TypedConfirm value={word} onChange={setWord} onSubmit={() => canGo && pauseLeft === 0 && go()} disabled={batch.isPending} focusKey={open && pauseLeft === 0} verb="place" />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {mindful && pauseLeft > 0 ? (
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
