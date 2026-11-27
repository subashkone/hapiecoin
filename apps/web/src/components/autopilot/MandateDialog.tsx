"use client";
// HC-TR-307 (ADR-147, ADR-149): the mandate a trader signs before Autopilot may trade one saved strategy live for them.
// One exchange account, the lots per trade, the most capital, a loss limit for the day and the week, the trades open at
// once, four statements in the server's own words, the typed LIVE word and the authenticator code. Signing places no
// order: the dialog says so beside its button, and shows no result, margin or profit figure.
import { MANDATE_STATEMENT_KEYS, MANDATE_STATEMENTS, type MandateStatementKey, type SavedCard } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, toast } from "@hapiecoin/ui";
import { type ReactNode, useState } from "react";
import { SECOND_FACTOR_LEN, SecondFactorField } from "@/components/dialogs/SecondFactorField";
import { TradingEnvTag } from "@/components/trading/TradingEnvTag";
import { useSignMandate } from "@/lib/api/autopilot-mandate";
import { useBrokers, useCredential, useMe } from "@/lib/api/queries";
import { isSecondFactorError } from "@/lib/api/second-factor";

/** A whole number as typed: digits only, no sign, no separator, no leading zero. */
const whole = (v: string): number | null => (/^[1-9]\d{0,8}$/.test(v.trim()) ? Number(v.trim()) : null);
/** The most a limit may be (the schema's own cap). */
const MAX_USD = 10_000_000;

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium">{label}</span>
      {children}
      {hint ? <span className="text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

/** What stops the form from being sent, in the order a reader fills it in; null when it can be signed. */
export function mandateBlock(v: { accountId: string; lots: number | null; maxLots: number; maxOpen: number | null; coins: number; capital: number | null; day: number | null; week: number | null; ticked: number; word: string; code: string }): string | null {
  if (v.accountId === "") return "Choose the exchange account it trades through.";
  if (v.lots === null) return "Enter the lots per trade, a whole number.";
  if (v.lots > v.maxLots) return `At most ${v.maxLots} lots per trade: the size this strategy runs at.`;
  if (v.maxOpen === null || v.maxOpen > v.coins) return `Trades open at once: 1${v.coins > 1 ? ` to ${v.coins}` : ""} (one per coin).`;
  if (v.capital === null) return "Enter the most capital it may use, in whole US dollars.";
  if (v.capital > MAX_USD) return `The most capital is at most ${MAX_USD.toLocaleString("en-US")} USD.`;
  if (v.day === null || v.week === null) return "Enter both loss limits, in whole US dollars.";
  if (v.day > v.capital) return "The loss limit for the day is within the capital it may use.";
  if (v.week < v.day) return "The loss limit for the week is at least the limit for the day.";
  if (v.week > v.capital) return "The loss limit for the week is within the capital it may use.";
  if (v.ticked < MANDATE_STATEMENT_KEYS.length) return "Tick each of the four statements.";
  if (v.word.trim().toUpperCase() !== "LIVE") return "Type LIVE to sign.";
  if (v.code.length !== SECOND_FACTOR_LEN) return "Enter the 6-digit code from your authenticator app.";
  return null;
}

export function MandateDialog({ strategy, onOpenChange }: { strategy: SavedCard; onOpenChange: (open: boolean) => void }) {
  const me = useMe();
  const accounts = useCredential();
  const brokers = useBrokers();
  const sign = useSignMandate();
  // only the accounts on the exchange this strategy trades on: another exchange's account would be refused at signing
  const venueOf = (brokerId: string) => brokers.data?.find((b) => b.id === brokerId)?.venue;
  const items = (accounts.data?.items ?? []).filter((a) => (strategy.definition.venues as readonly (string | undefined)[]).includes(venueOf(a.brokerId)));
  const [accountId, setAccountId] = useState("");
  const [lots, setLots] = useState("");
  const [maxOpen, setMaxOpen] = useState("1");
  const [capital, setCapital] = useState("");
  const [day, setDay] = useState("");
  const [week, setWeek] = useState("");
  const [ticked, setTicked] = useState<Record<MandateStatementKey, boolean>>({ realOrders: false, ownAccount: false, canLose: false, estimate: false });
  const [word, setWord] = useState("");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const account = accountId !== "" ? accountId : items.length === 1 ? items[0]!.id : "";
  const coins = strategy.definition.assets.length;
  const values = { accountId: account, lots: whole(lots), maxLots: strategy.definition.lots, maxOpen: whole(maxOpen), coins, capital: whole(capital), day: whole(day), week: whole(week), ticked: MANDATE_STATEMENT_KEYS.filter((k) => ticked[k]).length, word, code };
  const blocked = mandateBlock(values);
  const loading = me.isLoading || accounts.isLoading || brokers.isLoading;
  // a mandate is never signed without the authenticator, nor without an account of the trader's own
  const noApp = !loading && me.data?.twoFactorEnabled !== true;
  const noAccount = !loading && items.length === 0;

  const submit = () => {
    if (blocked !== null) return;
    setRefusal(null);
    setCodeError(null);
    sign.mutate(
      { body: { strategyId: strategy.id, accountId: account, lots: values.lots!, maxCapitalUsd: values.capital!, dayLossLimitUsd: values.day!, weekLossLimitUsd: values.week!, maxOpen: values.maxOpen!, statements: { realOrders: ticked.realOrders as true, ownAccount: ticked.ownAccount as true, canLose: ticked.canLose as true, estimate: ticked.estimate as true }, confirm: word.trim() }, code },
      {
        onSuccess: () => {
          toast.success("Mandate signed", { description: "No order was placed. Autopilot enters when this strategy's conditions are met." });
          onOpenChange(false);
        },
        onError: (e) => {
          // a code is good for one try: it is never kept after a refusal
          setCode("");
          if (isSecondFactorError(e)) setCodeError(e.message);
          else setRefusal(e instanceof Error ? e.message : "The mandate was not signed");
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !sign.isPending && onOpenChange(o)}>
      <DialogContent className="max-w-[640px]" data-testid="mandate-dialog">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">Trade live · {strategy.name} <span className="font-mono text-xs text-muted-foreground">v{strategy.version}</span> <TradingEnvTag /></DialogTitle>
          <DialogDescription>A mandate lets Autopilot place real orders for this strategy on your exchange account, inside the limits you set here. You can pause or end it at any time.</DialogDescription>
        </DialogHeader>
        <DialogBody className="max-h-[65vh] overflow-y-auto">
          {loading ? (
            <p className="text-sm text-muted-foreground" data-testid="mandate-loading">Reading your account…</p>
          ) : noApp ? (
            <p className="text-sm" data-testid="mandate-no-authenticator">Switch the authenticator on for your account before signing a mandate: Settings → Security. A mandate stands in for your confirmation of every later order, so it is never signed without one.</p>
          ) : noAccount ? (
            <p className="text-sm" data-testid="mandate-no-account">Connect an account on the exchange this strategy trades on first: Settings → API Settings. A mandate names the one account it trades through.</p>
          ) : (
            <div className="flex flex-col gap-4">
              <Row label="Exchange account">
                <select className="h-8 rounded border border-border bg-background px-2 text-sm" value={account} onChange={(e) => setAccountId(e.target.value)} data-testid="mandate-account">
                  {items.length > 1 ? <option value="">Choose an account</option> : null}
                  {items.map((a) => (
                    <option key={a.id} value={a.id}>{a.label} · {a.apiKeyMasked}</option>
                  ))}
                </select>
              </Row>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Row label="Lots per trade" hint={`A whole number, at most ${strategy.definition.lots}`}>
                  <Input inputMode="numeric" value={lots} onChange={(e) => setLots(e.target.value)} data-testid="mandate-lots" />
                </Row>
                <Row label="Trades open at once" hint={coins > 1 ? `1 to ${coins}: one per coin` : "1: it trades one coin"}>
                  <Input inputMode="numeric" value={maxOpen} onChange={(e) => setMaxOpen(e.target.value)} data-testid="mandate-open" />
                </Row>
                <Row label="Most capital it may use · USD" hint="Whole US dollars, digits only, against the estimated margin of its open trades">
                  <Input inputMode="numeric" value={capital} onChange={(e) => setCapital(e.target.value)} data-testid="mandate-capital" />
                </Row>
                <div className="grid grid-cols-2 gap-3">
                  <Row label="Loss limit, day · USD">
                    <Input inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value)} data-testid="mandate-day" />
                  </Row>
                  <Row label="Loss limit, week · USD">
                    <Input inputMode="numeric" value={week} onChange={(e) => setWeek(e.target.value)} data-testid="mandate-week" />
                  </Row>
                </div>
              </div>
              <p className="text-xs text-muted-foreground" data-testid="mandate-limits-basis">The loss limits count closed trades only: the day from 00:00 UTC, the week from Monday 00:00 UTC. A limit stops new entries; it does not close a trade that is open.</p>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-xs font-medium">Read and tick each statement</legend>
                {MANDATE_STATEMENT_KEYS.map((k) => (
                  <label key={k} className="flex items-start gap-2 text-xs">
                    <input type="checkbox" className="mt-0.5" checked={ticked[k]} onChange={(e) => setTicked({ ...ticked, [k]: e.target.checked })} data-testid="mandate-statement" data-key={k} />
                    <span>{MANDATE_STATEMENTS[k]}</span>
                  </label>
                ))}
              </fieldset>
              <Row label="Type LIVE to sign">
                <Input value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" data-testid="mandate-word" />
              </Row>
              <SecondFactorField value={code} onChange={(v) => { setCode(v); setCodeError(null); }} error={codeError} what="this mandate" />
            </div>
          )}
          {refusal ? <p className="mt-3 text-sm text-loss" role="alert" data-testid="mandate-refusal">{refusal}</p> : null}
        </DialogBody>
        <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <p className="mr-auto text-xs text-muted-foreground" data-testid="mandate-nothing-placed">{!loading && !noApp && !noAccount && blocked ? blocked : "Signing places no order. Autopilot enters when this strategy's conditions are met."}</p>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sign.isPending} data-testid="mandate-cancel">Cancel</Button>
          {!loading && !noApp && !noAccount ? <Button onClick={submit} disabled={blocked !== null || sign.isPending} data-testid="mandate-sign">{sign.isPending ? "Signing…" : "Sign mandate"}</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
