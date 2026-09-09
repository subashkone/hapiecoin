"use client";
// The alert engine (Phase 5 item 2, ADR-052; HC-SH-096): mounted once in the app header while signed in. Reads
// the futures price of every asset, the ATM IV of the nearest expiry for assets with an IV alert, and the live
// P&L of strategies with a P&L alert; evaluates the armed alerts at most once a second (trailing throttle, so a
// busy feed never starves it) and posts each hit to the API, which records it and mails the email channel.
// The push channel is the in-app toast plus a browser notification when the trader has allowed them.
import type { Alert, Strategy, Underlying } from "@hapiecoin/schema";
import { toast } from "@hapiecoin/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAlerts, useTriggerAlert } from "@/lib/api/alerts";
import { useStrategies } from "@/lib/api/strategies";
import { nearestExpiry } from "@/lib/chain/expiries";
import { atmIvOf } from "@/lib/chain/structure";
import { useExpiries } from "@/lib/chain/useExpiries";
import { useChain, useSpot } from "@/lib/gateway/hooks";
import { usePaperBook } from "@/lib/strategy/usePaper";
import { type AlertReadings, decimalOf, dueAlerts, firedText } from "./engine";
import { publishReadings } from "./readings";

const NONE: Strategy[] = [];
export const EVAL_THROTTLE_MS = 1000;

/** Best-effort browser notification for the push channel; silent when unsupported or not permitted. */
export function browserNotify(title: string, body: string): void {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    new Notification(title, { body });
  } catch {
    /* a browser without the Notification API in this context */
  }
}

/** Reads the ATM IV of the asset's nearest listed expiry and hands it up; renders nothing. */
function IvProbe({ asset, onValue }: { asset: Underlying; onValue: (asset: Underlying, iv: number | null) => void }) {
  const expiries = useExpiries(asset);
  const expiry = useMemo(() => nearestExpiry(expiries), [expiries]);
  const chain = useChain(asset, expiry);
  const spot = useSpot(asset);
  const iv = atmIvOf(chain?.rows ?? [], spot ? Number(spot.price) : null);
  useEffect(() => onValue(asset, iv), [asset, iv, onValue]);
  return null;
}

export function AlertEngine({ throttleMs = EVAL_THROTTLE_MS }: { throttleMs?: number }) {
  const { data: alerts } = useAlerts();
  const list = useMemo(() => alerts ?? [], [alerts]);
  const needPnl = list.some((a) => a.kind === "pnl");
  const ivAssets = useMemo(() => [...new Set(list.filter((a) => a.kind === "iv").map((a) => a.asset))], [list]);
  const btc = useSpot("BTC");
  const eth = useSpot("ETH");
  const xaut = useSpot("XAUT");
  const { data: strategies } = useStrategies();
  const book = usePaperBook(needPnl ? (strategies ?? NONE) : NONE);
  const [ivs, setIvs] = useState<Partial<Record<Underlying, number | null>>>({});
  const onIv = useCallback((asset: Underlying, iv: number | null) => setIvs((prev) => (prev[asset] === iv ? prev : { ...prev, [asset]: iv })), []);
  const trigger = useTriggerAlert();
  const triggerRef = useRef(trigger);
  triggerRef.current = trigger;
  const firing = useRef(new Set<string>());
  const lastRun = useRef(0);

  const readings = useMemo<AlertReadings>(() => {
    const pnl: Record<string, number | null> = {};
    if (needPnl) for (const s of strategies ?? NONE) if (s.status === "paper" || s.status === "live") pnl[s.id] = book.pnlOf(s).total;
    return {
      spot: { BTC: btc ? Number(btc.price) : null, ETH: eth ? Number(eth.price) : null, XAUT: xaut ? Number(xaut.price) : null },
      atmIv: ivs,
      pnl,
    };
    // `book` is rebuilt on every quote version, so pnlOf re-reads the marks
  }, [needPnl, strategies, book, btc, eth, xaut, ivs]);

  useEffect(() => publishReadings(readings), [readings]);

  const armedKey = list
    .filter((a) => a.state === "armed")
    .map((a) => a.id)
    .join("|");
  useEffect(() => {
    if (!armedKey) return;
    const wait = Math.max(0, throttleMs - (Date.now() - lastRun.current));
    const timer = setTimeout(() => {
      lastRun.current = Date.now();
      for (const { alert, current } of dueAlerts(list, readings)) {
        if (firing.current.has(alert.id)) continue;
        firing.current.add(alert.id);
        triggerRef.current.mutate(
          { id: alert.id, body: { value: decimalOf(current) } },
          {
            onSuccess: (a: Alert) => {
              const { title, description } = firedText(a);
              toast(title, { description });
              if (a.channels.includes("push")) browserNotify(title, description);
            },
            onSettled: () => firing.current.delete(alert.id),
          },
        );
      }
    }, wait);
    return () => clearTimeout(timer);
  }, [armedKey, readings, throttleMs, list]);

  return (
    <>
      {ivAssets.map((asset) => (
        <IvProbe key={asset} asset={asset} onValue={onIv} />
      ))}
    </>
  );
}
