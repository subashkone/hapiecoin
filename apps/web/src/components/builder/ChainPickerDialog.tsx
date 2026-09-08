"use client";
// Select Option from Chain (HC-TR-015, 027, 028, 031..034): a compact live chain with B / S multi-select per
// side, a selected list with lots, and "Add N legs" into the Builder within the remaining slots.
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, cn, toast } from "@hapiecoin/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { discoverExpiries, nearestExpiry } from "@/lib/chain/expiries";
import { sliceAroundAtm } from "@/lib/chain/range";
import { publicEnv } from "@/lib/env";
import { daysToExpiry, fmtExpiry, fmtIv, fmtOi, fmtPrice, fmtStrike } from "@/lib/format";
import { useChain, useSpot } from "@/lib/gateway/hooks";
import { atmIndex } from "@/lib/gateway/reducer";
import { useUiStore } from "@/lib/store";
import { ExpiryStrip } from "@/components/chain/ExpiryStrip";
import { type LegKind, type LegSide, MAX_ACTIVE_LEGS } from "@/lib/strategy/legs";

interface Pick {
  key: string;
  kind: LegKind;
  side: LegSide;
  strike: string;
  expiry: string;
  price: string;
  iv: number | undefined;
  lots: number;
}

export function ChainPickerDialog({ open, onOpenChange, remaining }: { open: boolean; onOpenChange: (open: boolean) => void; remaining: number }) {
  const asset = useUiStore((s) => s.asset);
  const workspaceExpiry = useUiStore((s) => s.expiry[s.asset] ?? null);
  const chainLots = useUiStore((s) => s.chainLots);
  const addLeg = useUiStore((s) => s.addLeg);
  const env = publicEnv();
  const expiries = useQuery({
    queryKey: ["expiries", asset],
    queryFn: () => discoverExpiries(asset, { gatewayWsUrl: env.NEXT_PUBLIC_GATEWAY_URL, defaultsCsv: env.NEXT_PUBLIC_DEFAULT_EXPIRIES }),
    staleTime: 5 * 60_000,
    enabled: open,
  });
  const list = expiries.data?.expiries ?? [];
  const [expiry, setExpiry] = useState<string | null>(null);
  useEffect(() => {
    if (open) setExpiry(workspaceExpiry && list.includes(workspaceExpiry) ? workspaceExpiry : nearestExpiry(list));
  }, [open, workspaceExpiry, list]);
  const chain = useChain(asset, open ? expiry : null);
  const spot = useSpot(asset);
  const rows = chain?.rows ?? [];
  const atm = useMemo(() => atmIndex(rows, spot?.price), [rows, spot?.price]);
  const shown = useMemo(() => sliceAroundAtm(rows, atm, 12), [rows, atm]);
  const [picks, setPicks] = useState<Pick[]>([]);
  useEffect(() => {
    if (!open) setPicks([]);
  }, [open]);

  const toggle = (kind: LegKind, side: LegSide, row: (typeof rows)[number]) => {
    if (!expiry) return;
    const q = kind === "call" ? row.call : row.put;
    if (!q) return;
    const key = `${expiry}:${row.strike}:${kind}:${side}`;
    setPicks((ps) => {
      const without = ps.filter((p) => !(p.strike === row.strike && p.kind === kind && p.expiry === expiry));
      const existed = ps.some((p) => p.key === key);
      if (existed) return without;
      if (without.length >= remaining) {
        toast.error("Limit reached", { description: `${remaining} more ${remaining === 1 ? "leg" : "legs"} can be added` });
        return ps;
      }
      return [...without, { key, kind, side, strike: row.strike, expiry, price: q.mark, iv: q.markIv, lots: chainLots }];
    });
  };
  const add = () => {
    let added = 0;
    for (const p of picks) {
      const r = addLeg({ asset, kind: p.kind, side: p.side, strike: p.strike, expiry: p.expiry, lots: p.lots, price: p.price, iv: p.iv });
      if (r.ok) added += 1;
      else {
        toast.error("Limit reached", { description: `Maximum ${MAX_ACTIVE_LEGS} active legs per strategy` });
        break;
      }
    }
    if (added) toast(`${added} ${added === 1 ? "leg" : "legs"} added`);
    onOpenChange(false);
  };
  const pickOf = (strike: string, kind: LegKind) => picks.find((p) => p.strike === strike && p.kind === kind && p.expiry === expiry);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[820px]" data-testid="chain-picker">
        <DialogHeader>
          <DialogTitle>Select Option from Chain</DialogTitle>
          <DialogDescription>
            {asset} • Spot {fmtPrice(spot?.price)} · <span className="micro rounded border border-border px-1">Maximum {remaining} more {remaining === 1 ? "leg" : "legs"}</span>
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ExpiryStrip className="pb-1" testId="picker-strip">
            {list.map((e) => (
              <button
                key={e}
                type="button"
                role="tab"
                aria-selected={e === expiry}
                onClick={() => setExpiry(e)}
                className={cn("shrink-0 rounded px-2 py-1 text-xs", e === expiry ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
                data-testid="picker-expiry"
                data-expiry={e}
              >
                {fmtExpiry(e)} <span className="font-mono text-3xs">{daysToExpiry(e)}d</span>
              </button>
            ))}
          </ExpiryStrip>
          <div className="mt-2 max-h-[46vh] overflow-auto rounded border border-border">
            <table className="w-full text-xs" data-testid="picker-table" data-rows={shown.rows.length}>
              <thead className="sticky top-0 bg-surface-1">
                <tr className="micro">
                  <th className="py-1 pl-2 text-left">Calls</th>
                  <th className="py-1 text-right">Mark/IV</th>
                  <th className="py-1 text-right">OI</th>
                  <th className="py-1 text-center">Strike</th>
                  <th className="py-1 text-left">OI</th>
                  <th className="py-1 text-left">Mark/IV</th>
                  <th className="py-1 pr-2 text-right">Puts</th>
                </tr>
              </thead>
              <tbody>
                {shown.rows.map((r, i) => {
                  const isAtm = i === shown.atm;
                  const bs = (kind: LegKind) => (
                    <span className="inline-flex gap-1">
                      {(["buy", "sell"] as const).map((side) => {
                        const on = pickOf(r.strike, kind)?.side === side;
                        const q = kind === "call" ? r.call : r.put;
                        return (
                          <button
                            key={side}
                            type="button"
                            disabled={!q}
                            aria-pressed={on}
                            onClick={() => toggle(kind, side, r)}
                            className={cn("grid h-[18px] w-5 place-items-center rounded-[2px] border text-[10.5px] font-bold disabled:opacity-40", side === "buy" ? "border-buy text-buy" : "border-sell text-sell", on && (side === "buy" ? "bg-buy text-white" : "bg-sell text-white"))}
                            aria-label={`${side === "buy" ? "Buy" : "Sell"} ${kind} ${fmtStrike(r.strike)}`}
                            data-testid={`picker-${side}-${kind}`}
                            data-strike={r.strike}
                          >
                            {side === "buy" ? "B" : "S"}
                          </button>
                        );
                      })}
                    </span>
                  );
                  return (
                    <tr key={r.strike} className={cn("border-t border-border", isAtm && "atm-band")} data-testid="picker-row" data-strike={r.strike}>
                      <td className="py-1 pl-2">{bs("call")}</td>
                      <td className="num py-1 text-right">
                        {fmtPrice(r.call?.mark)} <span className="text-3xs text-muted-foreground">{fmtIv(r.call?.markIv)}</span>
                      </td>
                      <td className="num py-1 text-right">{fmtOi(r.call?.oi)}</td>
                      <td className={cn("num py-1 text-center font-medium", isAtm && "text-spot")}>{fmtStrike(r.strike)}</td>
                      <td className="num py-1 text-left">{fmtOi(r.put?.oi)}</td>
                      <td className="num py-1 text-left">
                        {fmtPrice(r.put?.mark)} <span className="text-3xs text-muted-foreground">{fmtIv(r.put?.markIv)}</span>
                      </td>
                      <td className="py-1 pr-2 text-right">{bs("put")}</td>
                    </tr>
                  );
                })}
                {shown.rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-muted-foreground">
                      {expiry ? "Waiting for the chain…" : "No expiry"}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {picks.length ? (
            <div className="mt-2 flex flex-col gap-1" data-testid="picker-selected">
              {picks.map((p) => (
                <div key={p.key} className="flex items-center gap-2 rounded border border-border px-2 py-1 text-xs">
                  <span className={cn("font-mono text-3xs font-bold uppercase", p.side === "buy" ? "text-buy" : "text-sell")}>{p.side}</span>
                  <span className="font-mono text-3xs uppercase text-muted-foreground">{p.kind}</span>
                  <span className="num font-medium">{fmtStrike(p.strike)}</span>
                  <span className="text-muted-foreground">{fmtExpiry(p.expiry)}</span>
                  <span className="num ml-auto">{fmtPrice(p.price, 1)}</span>
                  <label className="flex items-center gap-1 text-muted-foreground">
                    Qty
                    <input type="number" min={1} step={1} value={p.lots} onChange={(e) => setPicks((ps) => ps.map((x) => (x.key === p.key ? { ...x, lots: Math.max(1, Math.round(Number(e.target.value) || 1)) } : x)))} className="w-14 rounded border border-input bg-transparent px-1 text-right" aria-label="Lots" data-testid="picker-qty" />
                    <span className="micro">lots</span>
                  </label>
                  <button type="button" onClick={() => setPicks((ps) => ps.filter((x) => x.key !== p.key))} aria-label="Remove" className="text-muted-foreground hover:text-loss">
                    ✕
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => setPicks([])} className="self-end text-xs text-muted-foreground hover:text-foreground" data-testid="picker-clear">
                Clear
              </button>
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter className="items-center">
          <span className="mr-auto text-2xs text-muted-foreground">B selects a buy leg, S a sell leg; click again to deselect.</span>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={add} disabled={picks.length === 0} data-testid="picker-add">
            Add {picks.length || ""} {picks.length === 1 ? "Leg" : "Legs"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
