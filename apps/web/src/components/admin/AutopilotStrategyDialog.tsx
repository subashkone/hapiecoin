"use client";
// Admin · the editor of a saved Autopilot strategy (HC-TR-278; ADR-141, ADR-142): basics, when to enter, what to
// trade, when to exit, the backtest figures entered by hand, and who can use it. India time on screen; the conversion
// to the engine's UTC hours and days is in lib/strategy/saved-form. Paper only: there is no live control here.
import { SAVED_STAGE_LABELS, type SavedStrategy, type SavedStrategyPatch, UNDERLYINGS, savedEntryText } from "@hapiecoin/schema";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, cn, toast } from "@hapiecoin/ui";
import { type ReactNode, useState } from "react";
import { useAdminUsersList } from "@/lib/api/admin";
import { useCreateSavedStrategy, useUpdateSavedStrategy } from "@/lib/api/autopilot-saved";
import { useAdminPlans } from "@/lib/api/billing";
import { FROM_HOURS, LEG_PRESETS, type LegForm, type SavedForm, WEEKDAYS, emptySavedForm, istClock, sameDefinition, savedBacktestOf, savedDefinitionOf, savedFormOf } from "@/lib/strategy/saved-form";

const input = "h-8 w-full rounded border border-input bg-background px-2 text-xs";
const numInput = `num ${input}`;

function Section({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-2 border-t border-border pt-3 first:border-t-0 first:pt-0" aria-label={title}>
      <h3 className="text-sm font-medium"><span className="micro mr-2">{n}</span>{title}</h3>
      {hint ? <p className="text-muted-foreground">{hint}</p> : null}
      {children}
    </section>
  );
}
function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <label className={cn("block min-w-0", className)}><span className="micro">{label}</span>{children}</label>;
}
const Check = ({ label, checked, onChange, testId }: { label: string; checked: boolean; onChange: (on: boolean) => void; testId: string }) => (
  <label className="flex items-center gap-2"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} /> {label}</label>
);

function NamedUsers({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState("");
  // the people met in any search so far, so a chosen user keeps their name when the search moves on
  const [known, setKnown] = useState<Record<string, string>>({});
  const users = useAdminUsersList({ q, status: "all", plan: "all", sort: "name", dir: "asc", page: 1 });
  const rows = users.data?.items ?? [];
  const fresh = rows.filter((u) => known[u.id] === undefined);
  if (fresh.length > 0) setKnown({ ...known, ...Object.fromEntries(fresh.map((u) => [u.id, `${u.name} · ${u.email}`])) });
  return (
    <div className="rounded border border-border p-2" data-testid="saved-users">
      <ul className="mb-1 flex flex-wrap gap-1" aria-label="Named users">
        {selected.map((id) => (
          <li key={id} className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5" data-testid="saved-user-chip">
            <span className="max-w-[220px] truncate">{known[id] ?? id}</span>
            <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => onChange(selected.filter((x) => x !== id))} aria-label={`Remove ${known[id] ?? id}`} data-testid="saved-user-remove">×</button>
          </li>
        ))}
        {selected.length === 0 ? <li className="micro">Nobody named yet</li> : null}
      </ul>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search users by name or email" className={input} aria-label="Search users" data-testid="saved-users-search" />
      <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto">
        {rows.map((u) => (
          <li key={u.id}><label className="flex items-center gap-2"><input type="checkbox" checked={selected.includes(u.id)} onChange={(e) => onChange(e.target.checked ? [...selected, u.id] : selected.filter((x) => x !== u.id))} data-testid="saved-user" data-email={u.email} /> <span className="truncate">{u.name} · {u.email}</span></label></li>
        ))}
        {rows.length === 0 ? <li className="micro">No users match</li> : null}
      </ul>
      <p className="micro mt-1">{selected.length} named</p>
    </div>
  );
}

export function AutopilotStrategyDialog({ strategy: opened, onOpenChange }: { strategy: SavedStrategy | null; onOpenChange: (o: boolean) => void }) {
  // a new strategy is saved as a draft first and then given its figures and audience: once the draft exists, a second
  // press of Save changes that draft and never makes another
  const [made, setMade] = useState<SavedStrategy | null>(null);
  const strategy = opened ?? made;
  const [form, setForm] = useState<SavedForm>(opened ? savedFormOf(opened) : emptySavedForm());
  const [error, setError] = useState<string | null>(null);
  const create = useCreateSavedStrategy();
  const update = useUpdateSavedStrategy();
  const plans = useAdminPlans();
  const busy = create.isPending || update.isPending;
  const set = <K extends keyof SavedForm>(key: K, value: SavedForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setLeg = (i: number, patch: Partial<LegForm>) => setForm((f) => ({ ...f, legs: f.legs.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const toggle = <T,>(list: T[], item: T, on: boolean): T[] => (on ? [...list, item] : list.filter((x) => x !== item));

  // "changed" is judged against the settings as this form writes them, taken once when it opens: a stored row in
  // another shape (its days unsorted, say) must not make a change of name look like new settings
  const [openedAs] = useState(() => {
    if (!opened) return null;
    const asForm = savedDefinitionOf(savedFormOf(opened));
    return asForm.ok ? asForm.value : opened.definition;
  });
  const base = opened ? openedAs : (made?.definition ?? null);
  const parsed = savedDefinitionOf(form);
  const resettled = strategy !== null && base !== null && parsed.ok && !sameDefinition(parsed.value, base);
  const fail = (message: string) => {
    setError(message);
    toast.error("Not saved", { description: message });
  };
  const close = (o: boolean) => {
    // between the two requests of a new strategy the editor stays: closing it then would lose what the second says
    if (!o && busy) return;
    onOpenChange(o);
  };
  const differs = (a: unknown, b: unknown): boolean => JSON.stringify(a) !== JSON.stringify(b);
  const submit = () => {
    if (!form.name.trim()) return fail("Give the strategy a name.");
    if (!form.summary.trim()) return fail("Describe the strategy in a sentence.");
    if (!parsed.ok) return fail(parsed.error);
    const figures = savedBacktestOf(form);
    if (!figures.ok) return fail(figures.error);
    if (form.audience === "users" && form.userIds.length === 0) return fail("Name at least one user, or choose another audience.");
    if (form.audience === "plans" && form.planIds.length === 0) return fail("Choose at least one plan, or choose another audience.");
    if (strategy?.stage === "paper" && !resettled && figures.value === null) return fail("It is on paper: its backtest figures cannot be removed. Retire it first.");
    setError(null);
    const definition = parsed.value;
    const name = form.name.trim();
    const summary = form.summary.trim();
    const done = (s: SavedStrategy, was: SavedStrategy | null) => {
      toast.success(was && s.id !== was.id ? `Saved as version ${s.version}` : "Saved", { description: `${s.name} · ${SAVED_STAGE_LABELS[s.stage]}` });
      onOpenChange(false);
    };
    /** Send what differs from `from`, and nothing else: another admin's change to a field this one did not touch stays. */
    const change = (from: SavedStrategy, settings: boolean, onError: (e: Error) => void) => {
      const body: SavedStrategyPatch = {
        ...(name !== from.name ? { name } : {}),
        ...(summary !== from.summary ? { summary } : {}),
        ...(form.audience !== from.audience ? { audience: form.audience } : {}),
        ...(differs(form.userIds, from.userIds) ? { userIds: form.userIds } : {}),
        ...(differs(form.planIds, from.planIds) ? { planIds: form.planIds } : {}),
        ...(settings ? { definition } : {}),
        // figures typed for the old settings are not sent with new ones: the server clears them
        ...(differs(figures.value, from.backtest) ? { backtest: figures.value } : {}),
      };
      if (Object.keys(body).length === 0) return done(from, from);
      update.mutate({ id: from.id, body }, { onSuccess: (s) => done(s, from), onError });
    };
    if (strategy) return change(strategy, resettled, (e) => fail(e.message));
    create.mutate({ name, summary, definition }, { onSuccess: (draft) => { setMade(draft); change(draft, false, (e) => fail(`Saved as a draft, but its figures and audience were not: ${e.message}`)); }, onError: (e) => fail(e.message) });
  };

  return (
    <Dialog open onOpenChange={close}>
      <DialogContent className="sm:max-w-[880px]" data-testid="saved-dialog">
        <DialogHeader>
          <DialogTitle>{opened ? `Edit strategy · version ${opened.version}` : "New strategy"}</DialogTitle>
          <DialogDescription>Paper only. A strategy trades on paper once it has backtest figures and you publish it.</DialogDescription>
        </DialogHeader>
        <DialogBody className="max-h-[70vh] space-y-4 overflow-y-auto text-xs">
          <Section n={1} title="Basics">
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Name *"><input value={form.name} maxLength={60} onChange={(e) => set("name", e.target.value)} className={input} placeholder="e.g. BTC evening strangle, 2 % away" data-testid="saved-name" /></Field>
              <Field label="Lots per trade *"><input value={form.lots} inputMode="numeric" onChange={(e) => set("lots", e.target.value)} className={numInput} data-testid="saved-lots" /></Field>
            </div>
            <Field label="In one sentence, what it does *"><textarea value={form.summary} maxLength={300} rows={2} onChange={(e) => set("summary", e.target.value)} className="w-full rounded border border-input bg-background px-2 py-1 text-xs" data-testid="saved-summary" /></Field>
            <div className="flex flex-wrap items-center gap-3" role="group" aria-label="Coins">
              <span className="micro">Coins *</span>
              {UNDERLYINGS.map((a) => <Check key={a} label={a} checked={form.assets.includes(a)} onChange={(on) => set("assets", toggle(form.assets, a, on))} testId={`saved-asset-${a}`} />)}
            </div>
          </Section>

          <Section n={2} title="When to enter" hint="Times and days are India time (IST). Autopilot enters on its first pass inside the window.">
            <div className="grid gap-2 sm:grid-cols-4">
              <Field label="How often">
                <select value={form.cadence} onChange={(e) => set("cadence", e.target.value as SavedForm["cadence"])} className={input} data-testid="saved-cadence">
                  <option value="daily">Daily, the next expiry</option>
                  <option value="weekly">Weekly, one day</option>
                  <option value="monthly">Monthly, the month-end expiry</option>
                </select>
              </Field>
              <Field label="From (IST)">
                <select value={form.fromHourUtc} disabled={form.anyTime} onChange={(e) => set("fromHourUtc", Number(e.target.value))} className={numInput} data-testid="saved-from">
                  {FROM_HOURS.map((h) => <option key={h} value={h}>{istClock(h)}</option>)}
                </select>
              </Field>
              <Field label="To (IST)">
                <select value={form.toHourUtc} disabled={form.anyTime} onChange={(e) => set("toHourUtc", Number(e.target.value))} className={numInput} data-testid="saved-to">
                  {FROM_HOURS.map((h) => <option key={h + 1} value={h + 1}>{istClock(h + 1)}{h + 1 === 24 ? " the next morning" : ""}</option>)}
                </select>
              </Field>
              <div className="flex items-end pb-1"><Check label="Any time of day" checked={form.anyTime} onChange={(on) => set("anyTime", on)} testId="saved-anytime" /></div>
            </div>
            {form.cadence === "weekly" ? (
              <Field label={form.anyTime ? "Day (from 5:30 AM IST to 5:30 the next morning)" : "Day (IST)"} className="sm:w-1/2">
                <select value={form.weekday} onChange={(e) => set("weekday", Number(e.target.value))} className={input} data-testid="saved-weekday">
                  {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              </Field>
            ) : null}
            {form.cadence === "daily" ? (
              <div className="flex flex-wrap items-center gap-3" role="group" aria-label="Days">
                <span className="micro">{form.anyTime ? "Days (each from 5:30 AM IST to 5:30 the next morning)" : "Days (IST)"}, none ticked: every day</span>
                {WEEKDAYS.map((d, i) => <Check key={d} label={d.slice(0, 3)} checked={form.weekdays.includes(i)} onChange={(on) => set("weekdays", toggle(form.weekdays, i, on))} testId={`saved-day-${i}`} />)}
              </div>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-4">
              <Field label="Nearest expiry (days out)"><input value={form.minDte} inputMode="decimal" onChange={(e) => set("minDte", e.target.value)} className={numInput} data-testid="saved-min-dte" /></Field>
              <Field label="Furthest expiry (days out)"><input value={form.maxDte} inputMode="decimal" onChange={(e) => set("maxDte", e.target.value)} className={numInput} data-testid="saved-max-dte" /></Field>
              <div className="flex items-end pb-1 sm:col-span-2"><Check label="One entry per expiry (not again after it closes)" checked={form.oncePerExpiry} onChange={(on) => set("oncePerExpiry", on)} testId="saved-once" /></div>
            </div>
            <div className="space-y-2 rounded border border-border p-2">
              <p className="text-muted-foreground">Market conditions (optional), judged on the daily prices with the latest snapshot as today</p>
              <div className="flex flex-wrap items-center gap-2">
                <Check label="Only when the price is" checked={form.smaOn} onChange={(on) => set("smaOn", on)} testId="saved-sma" />
                <select value={form.smaSide} disabled={!form.smaOn} onChange={(e) => set("smaSide", e.target.value as SavedForm["smaSide"])} className="h-8 rounded border border-input bg-background px-2 text-xs" aria-label="Above or below" data-testid="saved-sma-side"><option value="above">above</option><option value="below">below</option></select>
                <span>its average of the last</span>
                <input value={form.smaDays} disabled={!form.smaOn} inputMode="numeric" onChange={(e) => set("smaDays", e.target.value)} className="num h-8 w-16 rounded border border-input bg-background px-2 text-xs" aria-label="Days of the average" data-testid="saved-sma-days" />
                <span>days</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Check label="Only when the volatility rank is from" checked={form.ivOn} onChange={(on) => set("ivOn", on)} testId="saved-iv" />
                <input value={form.ivMin} disabled={!form.ivOn} inputMode="numeric" placeholder="min" onChange={(e) => set("ivMin", e.target.value)} className="num h-8 w-16 rounded border border-input bg-background px-2 text-xs" aria-label="Lowest rank" data-testid="saved-iv-min" />
                <span>to</span>
                <input value={form.ivMax} disabled={!form.ivOn} inputMode="numeric" placeholder="max" onChange={(e) => set("ivMax", e.target.value)} className="num h-8 w-16 rounded border border-input bg-background px-2 text-xs" aria-label="Highest rank" data-testid="saved-iv-max" />
                <span>(0 to 100) over the last</span>
                <input value={form.ivLookback} disabled={!form.ivOn} inputMode="numeric" onChange={(e) => set("ivLookback", e.target.value)} className="num h-8 w-16 rounded border border-input bg-background px-2 text-xs" aria-label="Days of the rank" data-testid="saved-iv-days" />
                <span>days</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Check label="Sell one side only after a move of more than" checked={form.moveOn} onChange={(on) => set("moveOn", on)} testId="saved-move" />
                <input value={form.movePct} disabled={!form.moveOn} inputMode="decimal" onChange={(e) => set("movePct", e.target.value)} className="num h-8 w-16 rounded border border-input bg-background px-2 text-xs" aria-label="Move in per cent" data-testid="saved-move-pct" />
                <span>% over the last</span>
                <input value={form.moveHours} disabled={!form.moveOn} inputMode="numeric" onChange={(e) => set("moveHours", e.target.value)} className="num h-8 w-16 rounded border border-input bg-background px-2 text-xs" aria-label="Hours of the move" data-testid="saved-move-hours" />
                <span>hours (up: the put; down: the call)</span>
              </div>
            </div>
          </Section>

          <Section n={3} title="What to trade" hint="Every leg is out of the money: a call above the spot, a put below it. A strategy sells at least one option; bought options further out limit the loss.">
            <div className="flex flex-wrap items-center gap-2">
              <span className="micro">Start from</span>
              {(Object.keys(LEG_PRESETS) as (keyof typeof LEG_PRESETS)[]).map((k) => <Button key={k} size="sm" variant="outline" onClick={() => set("legs", LEG_PRESETS[k].legs())} data-testid={`saved-preset-${k}`}>{LEG_PRESETS[k].label}</Button>)}
            </div>
            <ul className="space-y-1" data-testid="saved-legs">
              {form.legs.map((l, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2" data-testid="saved-leg">
                  <select value={l.side} onChange={(e) => setLeg(i, { side: e.target.value as LegForm["side"] })} className={cn("h-8 rounded border border-input bg-background px-2 text-xs", l.side === "buy" ? "text-profit" : "text-loss")} aria-label={`Leg ${i + 1} side`} data-testid="saved-leg-side"><option value="sell">Sell</option><option value="buy">Buy</option></select>
                  <select value={l.kind} onChange={(e) => setLeg(i, { kind: e.target.value as LegForm["kind"] })} className="h-8 rounded border border-input bg-background px-2 text-xs" aria-label={`Leg ${i + 1} kind`} data-testid="saved-leg-kind"><option value="put">Put</option><option value="call">Call</option></select>
                  <input value={l.value} inputMode="decimal" onChange={(e) => setLeg(i, { value: e.target.value })} className="num h-8 w-20 rounded border border-input bg-background px-2 text-xs" aria-label={`Leg ${i + 1} value`} data-testid="saved-leg-value" />
                  <select value={l.by} onChange={(e) => setLeg(i, { by: e.target.value as LegForm["by"] })} className="h-8 rounded border border-input bg-background px-2 text-xs" aria-label={`Leg ${i + 1} strike by`} data-testid="saved-leg-by">
                    <option value="pct">% of the spot away</option>
                    <option value="strikes">listed strikes out</option>
                    <option value="premium">priced nearest this premium (USD)</option>
                  </select>
                  <Button size="sm" variant="ghost" disabled={form.legs.length === 1} onClick={() => set("legs", form.legs.filter((_, j) => j !== i))} aria-label={`Remove leg ${i + 1}`} data-testid="saved-leg-remove">Remove</Button>
                </li>
              ))}
            </ul>
            <Button size="sm" variant="outline" disabled={form.legs.length >= 6} onClick={() => set("legs", [...form.legs, { kind: "call", side: "buy", by: "pct", value: "4" }])} data-testid="saved-leg-add">+ Add a leg</Button>
          </Section>

          <Section n={4} title="When to exit" hint="Leave a field empty and that exit is not used. With none, the trade is held to settlement.">
            <div className="grid items-end gap-2 sm:grid-cols-3">
              <Field label="Stop on each sold option (× its sold price)"><input value={form.legStop} inputMode="decimal" placeholder="e.g. 2" onChange={(e) => set("legStop", e.target.value)} className={numInput} data-testid="saved-leg-stop" /></Field>
              <Field label="After a stop, trail the rest (give back %)"><input value={form.trailRestPct} inputMode="decimal" placeholder="e.g. 50" onChange={(e) => set("trailRestPct", e.target.value)} className={numInput} data-testid="saved-trail-rest" /></Field>
              <Field label="Close everything at this time (IST)">
                <select value={form.exitHourUtc} onChange={(e) => set("exitHourUtc", e.target.value)} className={numInput} data-testid="saved-exit-hour">
                  <option value="">Not used</option>
                  {FROM_HOURS.map((h) => <option key={h} value={String(h)}>{istClock(h)}</option>)}
                </select>
              </Field>
              <Field label="Take profit at (% of the premium)"><input value={form.takeProfitPct} inputMode="decimal" placeholder="e.g. 50" onChange={(e) => set("takeProfitPct", e.target.value)} className={numInput} data-testid="saved-take" /></Field>
              <Field label="…and trail from there (give back %)"><input value={form.takeTrailPct} inputMode="decimal" placeholder="empty: close there" onChange={(e) => set("takeTrailPct", e.target.value)} className={numInput} data-testid="saved-take-trail" /></Field>
              <Field label="Take profit in steps (% levels, commas)"><input value={form.ladder} placeholder="e.g. 25, 50, 75" onChange={(e) => set("ladder", e.target.value)} className={numInput} data-testid="saved-ladder" /></Field>
              <Field label="Profit lock: arm at (% of the premium)"><input value={form.lockAtPct} inputMode="decimal" placeholder="e.g. 50" onChange={(e) => set("lockAtPct", e.target.value)} className={numInput} data-testid="saved-lock-at" /></Field>
              <Field label="…and close if it falls back to (%)"><input value={form.lockFloorPct} inputMode="decimal" placeholder="e.g. 20" onChange={(e) => set("lockFloorPct", e.target.value)} className={numInput} data-testid="saved-lock-floor" /></Field>
              <div className="flex items-end gap-2">
                <Field label="Buy a sold option back" className="flex-1">
                  <select value={form.buyBackBy} onChange={(e) => set("buyBackBy", e.target.value as SavedForm["buyBackBy"])} className={input} data-testid="saved-buyback-by">
                    <option value="none">Not used</option>
                    <option value="price">when its price falls to (USD)</option>
                    <option value="share">at this % of its sold price</option>
                  </select>
                </Field>
                <input value={form.buyBackValue} disabled={form.buyBackBy === "none"} inputMode="decimal" placeholder={form.buyBackBy === "none" ? "" : form.buyBackBy === "share" ? "e.g. 20" : "e.g. 5"} onChange={(e) => set("buyBackValue", e.target.value)} className="num h-8 w-20 rounded border border-input bg-background px-2 text-xs" aria-label="Buy-back level" data-testid="saved-buyback-value" />
              </div>
            </div>
          </Section>

          <Section n={5} title="Backtest figures" hint="Entered by hand from the research backtest of these same settings, in USD at this strategy's size. A strategy cannot be published without them, and they are cleared when the settings change.">
            <div className="grid gap-2 sm:grid-cols-5">
              <Field label="Average result (USD)"><input value={form.btMean} inputMode="decimal" onChange={(e) => set("btMean", e.target.value)} className={numInput} data-testid="saved-bt-mean" /></Field>
              <Field label="Per">
                <select value={form.btPer} onChange={(e) => set("btPer", e.target.value as SavedForm["btPer"])} className={input} data-testid="saved-bt-per"><option value="day">day</option><option value="week">week</option><option value="trade">trade</option></select>
              </Field>
              <Field label="Winning trades (%)"><input value={form.btPositivePct} inputMode="decimal" onChange={(e) => set("btPositivePct", e.target.value)} className={numInput} data-testid="saved-bt-positive" /></Field>
              <Field label="Worst trade (USD)"><input value={form.btWorst} inputMode="decimal" onChange={(e) => set("btWorst", e.target.value)} className={numInput} data-testid="saved-bt-worst" /></Field>
              <Field label="Trades tested"><input value={form.btSamples} inputMode="numeric" onChange={(e) => set("btSamples", e.target.value)} className={numInput} data-testid="saved-bt-samples" /></Field>
            </div>
            <Field label="Where the figures come from (script, period, costs counted)"><input value={form.btBasis} maxLength={300} onChange={(e) => set("btBasis", e.target.value)} className={input} placeholder="e.g. autopilot-study, 8 Aug to 21 Nov 2026, the exchange's real fees" data-testid="saved-bt-basis" /></Field>
          </Section>

          <Section n={6} title="Who can use it" hint="Admins can always use a published strategy. Everyone else needs to be named, or to hold one of its plans.">
            <div className="flex flex-wrap gap-4" role="radiogroup" aria-label="Audience">
              {([["admins", "Admins only"], ["users", "Named users"], ["plans", "Plans"]] as const).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2"><input type="radio" name="saved-audience" checked={form.audience === value} onChange={() => set("audience", value)} data-testid={`saved-audience-${value}`} /> {label}</label>
              ))}
            </div>
            {form.audience === "users" ? <NamedUsers selected={form.userIds} onChange={(ids) => set("userIds", ids)} /> : null}
            {form.audience === "plans" ? (
              <div className="flex flex-wrap gap-3 rounded border border-border p-2" data-testid="saved-plans">
                {(plans.data ?? []).map((p) => <Check key={p.id} label={p.name} checked={form.planIds.includes(p.id)} onChange={(on) => set("planIds", toggle(form.planIds, p.id, on))} testId={`saved-plan-${p.id}`} />)}
                {plans.data?.length === 0 ? <span className="micro">No plans exist yet</span> : null}
              </div>
            ) : null}
          </Section>

          <p className="rounded border border-border p-2" data-testid="saved-reads">
            <span className="micro mr-2">Reads as</span>
            {parsed.ok ? `Enters ${savedEntryText(parsed.value)}.` : <span className="text-muted-foreground">{parsed.error}</span>}
          </p>
          {resettled && strategy.traded ? <p className="rounded border border-border p-2" data-testid="saved-version-note">This version has traded. Saving new settings creates version {strategy.version + 1} as a draft; version {strategy.version} keeps its record and its open trades keep their exits.</p> : null}
          {resettled && !strategy.traded && strategy.stage === "paper" ? <p className="rounded border border-border p-2" data-testid="saved-off-paper-note">The settings changed: this strategy comes off paper and stops entering until you publish it again. Its backtest figures are cleared unless you enter the new ones above.</p> : null}
          {resettled && !strategy.traded && strategy.stage !== "paper" && strategy.backtest ? <p className="rounded border border-border p-2" data-testid="saved-cleared-note">The settings changed: unless you enter new figures above, the old backtest figures are cleared and the strategy goes back to a draft.</p> : null}
          {error ? <p className="text-loss" role="alert" data-testid="saved-error">{error}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)} data-testid="saved-cancel">Cancel</Button>
          <Button loading={busy} onClick={submit} data-testid="saved-save">{opened ? "Save changes" : "Save draft"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
