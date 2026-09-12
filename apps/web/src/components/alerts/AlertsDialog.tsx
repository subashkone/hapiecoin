"use client";
// Alerts center (Phase 5 item 2, ADR-052; HC-SH-079, 094, 097..100; docs/design/alerts.md): the counts line, the
// New alert form (Type · Asset or Strategy · Condition · Value · Channels), the rows with the condition, the
// current reading, channel chips, the state badge, the arm switch and delete, and the empty state.
import { ALERT_KIND_LABELS, ALERT_KIND_UNITS, ALERT_OP_LABELS, type Alert, type AlertChannel, type AlertKind, type AlertOp, type Underlying, alertCounts, DECIMAL_STRING_RE } from "@hapiecoin/schema";
import { Activity, Badge, Bell, Button, Checkbox, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, Percent, Switch, TrendingUp, cn, toast } from "@hapiecoin/ui";
import { useEffect, useMemo, useState } from "react";
import { useAlerts, useCreateAlert, useDeleteAlert, usePatchAlert } from "@/lib/api/alerts";
import { useLinkTelegram, useTelegramStatus, useTestTelegram, useUnlinkTelegram } from "@/lib/api/telegram";
import { useStrategies } from "@/lib/api/strategies";
import { conditionText, currentValue, nowText } from "@/lib/alerts/engine";
import { useReadings } from "@/lib/alerts/readings";
import { ASSET_META, type AlertPrefill, useUiStore } from "@/lib/store";
import { useVenueId } from "@/lib/useVenue";
import type { DialogProps } from "@/components/dialogs/SettingsDialogs";

const KINDS: AlertKind[] = ["price", "iv", "pnl"];
const OPS: AlertOp[] = [">=", "<="];
const selectCls = "h-8 w-full rounded border border-input bg-background px-2 text-xs";

function KindIcon({ kind }: { kind: AlertKind }) {
  const cls = "size-3.5";
  return <span className="flex size-7 shrink-0 items-center justify-center rounded border border-border text-muted-foreground" aria-hidden="true">{kind === "price" ? <TrendingUp className={cls} /> : kind === "iv" ? <Activity className={cls} /> : <Percent className={cls} />}</span>;
}

function stateVariant(state: Alert["state"]): "profit" | "warning" | "outline" {
  return state === "armed" ? "profit" : state === "triggered" ? "warning" : "outline";
}

/** The New alert form (HC-SH-098). Saving arms the alert at once; the engine evaluates it on the next reading. */
export function AlertForm({ prefill, onDone }: { prefill: AlertPrefill; onDone: () => void }) {
  const { data: strategies } = useStrategies();
  const active = useMemo(() => (strategies ?? []).filter((s) => s.status === "paper" || s.status === "live"), [strategies]);
  const workspaceAsset = useUiStore((s) => s.asset);
  const readings = useReadings();
  const create = useCreateAlert();
  const venue = useVenueId();
  const { data: telegram } = useTelegramStatus();
  const telegramReady = telegram?.linked === true;
  const [kind, setKind] = useState<AlertKind>(prefill.kind ?? "price");
  const [asset, setAsset] = useState<Underlying>(prefill.asset ?? workspaceAsset);
  const [strategyId, setStrategyId] = useState(prefill.strategyId ?? "");
  const [op, setOp] = useState<AlertOp>(prefill.op ?? ">=");
  const [value, setValue] = useState(prefill.value ?? "");
  const [channels, setChannels] = useState<AlertChannel[]>(prefill.channels ?? ["push"]);
  // a P&L alert follows its strategy's asset
  const strategy = active.find((s) => s.id === strategyId);
  const effectiveAsset = kind === "pnl" && strategy ? strategy.asset : asset;
  const now = currentValue({ kind, asset: effectiveAsset, strategyId: kind === "pnl" ? strategyId || null : null }, readings);
  const toggle = (ch: AlertChannel, on: boolean) => setChannels((prev) => (on ? [...new Set([...prev, ch])] : prev.filter((c) => c !== ch)));
  const save = () => {
    const v = value.trim();
    if (!DECIMAL_STRING_RE.test(v)) return toast.error("Enter a value", { description: `A number in ${ALERT_KIND_UNITS[kind]}` });
    if (kind !== "pnl" && Number(v) <= 0) return toast.error("Enter a value", { description: `${ALERT_KIND_LABELS[kind]} must be greater than 0` });
    if (kind === "pnl" && !strategy) return toast.error("Pick a strategy", { description: "A P&L alert watches one of your paper or live strategies" });
    if (channels.length === 0) return toast.error("Pick a channel", { description: "Push or email, or both" });
    if (channels.includes("push") && typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission().catch(() => undefined);
    create.mutate(
      { kind, asset: effectiveAsset, venue: kind === "pnl" && strategy ? strategy.venue : venue, ...(kind === "pnl" ? { strategyId } : {}), op, value: v, channels },
      {
        onSuccess: (a) => {
          toast.success("Alert saved", { description: `${conditionText(a)} · armed` });
          onDone();
        },
        onError: (e) => toast.error("Could not save the alert", { description: e.message }),
      },
    );
  };
  return (
    <form
      className="flex flex-col gap-3 rounded border border-border bg-muted/30 p-3"
      data-testid="alert-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-2xs text-muted-foreground">
          Type
          <select className={selectCls} value={kind} onChange={(e) => setKind(e.target.value as AlertKind)} data-testid="alert-kind">
            {KINDS.map((k) => (
              <option key={k} value={k}>{ALERT_KIND_LABELS[k]}</option>
            ))}
          </select>
        </label>
        {kind === "pnl" ? (
          <label className="flex flex-col gap-1 text-2xs text-muted-foreground">
            Strategy
            <select className={selectCls} value={strategyId} onChange={(e) => setStrategyId(e.target.value)} data-testid="alert-strategy">
              <option value="">{active.length ? "Select a strategy…" : "No paper or live strategies yet"}</option>
              {active.map((s) => (
                <option key={s.id} value={s.id}>{`${s.name} · ${s.asset} · ${s.status.toUpperCase()}`}</option>
              ))}
            </select>
          </label>
        ) : (
          <label className="flex flex-col gap-1 text-2xs text-muted-foreground">
            Asset
            <select className={selectCls} value={asset} onChange={(e) => setAsset(e.target.value as Underlying)} data-testid="alert-asset">
              {(Object.keys(ASSET_META) as Underlying[]).map((a) => (
                <option key={a} value={a}>{`${ASSET_META[a].name} (${a})`}</option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-2xs text-muted-foreground">
          Condition
          <select className={selectCls} value={op} onChange={(e) => setOp(e.target.value as AlertOp)} data-testid="alert-op">
            {OPS.map((o) => (
              <option key={o} value={o}>{ALERT_OP_LABELS[o]}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <label className="flex flex-col gap-1 text-2xs text-muted-foreground">
          <span>
            Value · {ALERT_KIND_UNITS[kind]}
            <span className="ml-2 font-mono" data-testid="alert-form-now">{nowText({ kind }, now).replace(/^[^·]+· /, "")}</span>
          </span>
          <input type="number" step="any" inputMode="decimal" className={cn(selectCls, "num")} value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === "price" ? "e.g. 82000" : kind === "iv" ? "e.g. 30" : "e.g. 20 or -15"} autoFocus data-testid="alert-value" />
        </label>
        <fieldset className="flex flex-col gap-1 text-2xs text-muted-foreground">
          <legend className="mb-1">Channels</legend>
          <div className="flex h-8 items-center gap-4">
            <label className="flex items-center gap-1.5 text-xs text-foreground"><Checkbox checked={channels.includes("push")} onCheckedChange={(v) => toggle("push", v === true)} aria-label="Push" data-testid="alert-ch-push" /> push</label>
            <label className="flex items-center gap-1.5 text-xs text-foreground"><Checkbox checked={channels.includes("email")} onCheckedChange={(v) => toggle("email", v === true)} aria-label="Email" data-testid="alert-ch-email" /> email</label>
            <label className={cn("flex items-center gap-1.5 text-xs", telegramReady ? "text-foreground" : "text-muted-foreground")} title={telegramReady ? "Delivered to your linked Telegram chat" : telegram?.configured === false ? "Telegram delivery is not configured on this server" : "Connect Telegram below to enable this channel"}>
              <Checkbox checked={channels.includes("telegram")} disabled={!telegramReady} onCheckedChange={(v) => toggle("telegram", v === true)} aria-label="Telegram" data-testid="alert-ch-telegram" /> telegram{telegramReady ? null : <span className="micro">{telegram?.configured === false ? "off" : "connect"}</span>}
            </label>
          </div>
        </fieldset>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onDone} data-testid="alert-cancel">Cancel</Button>
        <Button type="submit" size="sm" loading={create.isPending} data-testid="alert-save">Save alert</Button>
      </div>
    </form>
  );
}

/** Telegram delivery (ADR-057): link the chat through the bot's /start deep link, test it, unlink it. */
export function TelegramConnect() {
  const { data: s, isLoading } = useTelegramStatus();
  const link = useLinkTelegram();
  const unlink = useUnlinkTelegram();
  const test = useTestTelegram();
  if (isLoading || !s) return <div className="text-2xs text-muted-foreground" data-testid="telegram-status" data-state="loading">Telegram · checking…</div>;
  if (!s.configured) return <div className="text-2xs text-muted-foreground" data-testid="telegram-status" data-state="off">Telegram · not configured on this server (set TELEGRAM_BOT_TOKEN)</div>;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-border px-3 py-2 text-2xs" data-testid="telegram-status" data-state={s.linked ? "linked" : s.pending ? "pending" : "unlinked"}>
      <span className="micro">Telegram</span>
      {s.linked ? (
        <>
          <span className="text-profit">connected{s.linkedAt ? ` · ${new Date(s.linkedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}` : ""}</span>
          <span className="text-muted-foreground">· alerts on the telegram channel reach your chat even with HapieCoin closed</span>
          <Button size="sm" variant="outline" className="ml-auto" loading={test.isPending} onClick={() => test.mutate(undefined, { onSuccess: () => toast.success("Test message sent", { description: "Check your Telegram chat" }), onError: (e) => toast.error("Telegram did not accept it", { description: e.message }) })} data-testid="telegram-test">Send test</Button>
          <Button size="sm" variant="ghost" className="text-loss" loading={unlink.isPending} onClick={() => unlink.mutate(undefined, { onSuccess: () => toast("Telegram disconnected") })} data-testid="telegram-unlink">Disconnect</Button>
        </>
      ) : s.pending ? (
        <>
          <span className="text-muted-foreground">open the link and press Start · waiting…</span>
          <a href={s.pending.link} target="_blank" rel="noopener noreferrer" className="font-mono text-primary underline underline-offset-2" data-testid="telegram-link">{s.pending.link}</a>
          <span className="font-mono" data-testid="telegram-code">code {s.pending.code}</span>
          <Button size="sm" variant="ghost" className="ml-auto" loading={link.isPending} onClick={() => link.mutate()} data-testid="telegram-relink">New code</Button>
        </>
      ) : (
        <>
          <span className="text-muted-foreground">not connected · get alerts in Telegram when HapieCoin is closed</span>
          <Button size="sm" variant="outline" className="ml-auto" loading={link.isPending} onClick={() => link.mutate(undefined, { onError: (e) => toast.error("Could not start the link", { description: e.message }) })} data-testid="telegram-connect">Connect Telegram</Button>
        </>
      )}
    </div>
  );
}

function AlertRow({ a }: { a: Alert }) {
  const readings = useReadings();
  const patch = usePatchAlert();
  const del = useDeleteAlert();
  const [confirm, setConfirm] = useState(false);
  const current = currentValue(a, readings);
  const fired = a.triggeredAt ? new Date(a.triggeredAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : null;
  return (
    <div className={cn("flex flex-wrap items-center gap-3 rounded border px-3 py-2", a.state === "triggered" ? "border-warning" : "border-border")} data-testid="alert-row" data-state={a.state} data-kind={a.kind}>
      <KindIcon kind={a.kind} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[13px] font-medium" data-testid="alert-condition">{conditionText(a)}</div>
        <div className="text-2xs text-muted-foreground" data-testid="alert-now">
          {nowText(a, current)}
          {fired ? <span className="text-warning"> · fired {fired}</span> : null}
        </div>
      </div>
      <span className="flex gap-1">
        {a.channels.map((c) => (
          <span key={c} className="micro rounded border border-border px-1 uppercase" data-testid="alert-channel">{c}</span>
        ))}
      </span>
      <Badge variant={stateVariant(a.state)} className="font-mono" data-testid="alert-state">{a.state}</Badge>
      <Switch checked={a.state === "armed"} disabled={patch.isPending} aria-label={a.state === "armed" ? "Pause the alert" : "Arm the alert"} onCheckedChange={(on) => patch.mutate({ id: a.id, body: { state: on ? "armed" : "paused" } }, { onError: (e) => toast.error("Could not update", { description: e.message }) })} data-testid="alert-arm" />
      {confirm ? (
        <span className="flex gap-1">
          <Button size="sm" variant="destructive" loading={del.isPending} onClick={() => del.mutate(a.id, { onSuccess: () => toast("Alert deleted", { description: conditionText(a) }), onError: (e) => toast.error("Could not delete", { description: e.message }) })} data-testid="alert-delete-confirm">Delete</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Keep</Button>
        </span>
      ) : (
        <Button size="sm" variant="ghost" iconOnly className="text-muted-foreground hover:text-loss" title="Delete the alert" aria-label="Delete the alert" onClick={() => setConfirm(true)} data-testid="alert-delete">✕</Button>
      )}
    </div>
  );
}

export function AlertsDialog({ open, onOpenChange }: DialogProps) {
  const prefill = useUiStore((s) => s.alertPrefill);
  const { data, isLoading, isError } = useAlerts(open);
  const [form, setForm] = useState<AlertPrefill | null>(null);
  // a "Set alert" button opens straight on the form (HC-SH-100); reopening from the bell shows the list
  useEffect(() => {
    if (open) setForm(prefill);
  }, [open, prefill]);
  const items = data ?? [];
  const counts = alertCounts(items);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[860px]" data-testid="alerts-dialog" data-count={items.length}>
        <DialogHeader>
          <DialogTitle>Alerts</DialogTitle>
          <DialogDescription>Price, ATM IV and strategy P&amp;L alerts · in-app push, email or Telegram · checked every tick while open and every five minutes by the server</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="font-mono text-2xs text-muted-foreground" data-testid="alerts-counts">
              {counts.total} {counts.total === 1 ? "alert" : "alerts"} · {counts.armed} armed · {counts.triggered} triggered{counts.paused ? ` · ${counts.paused} paused` : ""}
            </span>
            <Button size="sm" className="ml-auto" disabled={form !== null} onClick={() => setForm({})} data-testid="alerts-new">New alert</Button>
          </div>
          {form ? <AlertForm prefill={form} onDone={() => setForm(null)} /> : null}
          {isLoading ? (
            <p className="py-6 text-center text-xs text-muted-foreground">Loading alerts…</p>
          ) : isError ? (
            <p className="py-6 text-center text-xs text-loss" role="alert">Could not load your alerts.</p>
          ) : items.length === 0 ? (
            <EmptyState icon={<Bell className="size-5" />} title="No alerts yet" description="Get told when the futures price, the ATM IV or a strategy's P&L crosses a level." action={form ? undefined : <Button size="sm" variant="outline" onClick={() => setForm({})} data-testid="alerts-empty-new">New alert</Button>} data-testid="alerts-empty" />
          ) : (
            <div className="flex flex-col gap-1.5" data-testid="alerts-list">
              {items.map((a) => (
                <AlertRow key={a.id} a={a} />
              ))}
            </div>
          )}
          <TelegramConnect />
          <p className="text-2xs text-muted-foreground">Evaluated on every price tick while HapieCoin is open, and by the server on every five-minute snapshot when it is not · price vs futures, ATM IV vs the nearest expiry chain, P&amp;L vs your paper and live strategies.</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
