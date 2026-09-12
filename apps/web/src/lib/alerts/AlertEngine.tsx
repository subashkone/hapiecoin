"use client";
import { listedVenue } from "@/lib/venue";
import type { VenueId } from "@hapiecoin/venues/core";
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
import { useExpiriesQuery } from "@/lib/chain/useExpiries";
import { useChain, useSpot } from "@/lib/gateway/hooks";
import { usePaperBook } from "@/lib/strategy/usePaper";
import { type AlertReadings, decimalOf, dueAlerts, firedText, readingKey } from "./engine";
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

/** Reads the ATM IV of the asset's nearest listed expiry on `venue` and hands it up under its reading key; renders nothing. */
function IvProbe({ venue, asset, onValue }: { venue: VenueId; asset: Underlying; onValue: (key: string, iv: number | null) => void }) {
  const expiries = useExpiriesQuery(asset, { venue }).data?.expiries ?? NO_EXPIRIES;
  const expiry = useMemo(() => nearestExpiry(expiries), [expiries]);
  const chain = useChain(asset, expiry, venue);
  const spot = useSpot(asset, listedVenue(venue, asset));
  const iv = atmIvOf(chain?.rows ?? [], spot ? Number(spot.price) : null);
  const key = readingKey(venue, asset);
  useEffect(() => onValue(key, iv), [key, iv, onValue]);
  return null;
}
const NO_EXPIRIES: string[] = [];

export function AlertEngine({ throttleMs = EVAL_THROTTLE_MS }: { throttleMs?: number }) {
  const { data: alerts } = useAlerts();
  const list = useMemo(() => alerts ?? [], [alerts]);
  const needPnl = list.some((a) => a.kind === "pnl");
  const ivProbes = useMemo(() => {
    const seen = new Map<string, { venue: VenueId; asset: Underlying }>();
    for (const a of list) if (a.kind === "iv") seen.set(readingKey(a.venue, a.asset), { venue: a.venue, asset: a.asset });
    return [...seen.entries()];
  }, [list]);
  // one spot per venue and asset (ADR-071), skipped where the venue lists no such market (HOOK_VENUES in lib/venue.ts pins the two)
  const dBtc = useSpot("BTC", listedVenue("delta_india", "BTC"));
  const dEth = useSpot("ETH", listedVenue("delta_india", "ETH"));
  const dXaut = useSpot("XAUT", listedVenue("delta_india", "XAUT"));
  const rBtc = useSpot("BTC", listedVenue("deribit", "BTC"));
  const rEth = useSpot("ETH", listedVenue("deribit", "ETH"));
  const rXaut = useSpot("XAUT", listedVenue("deribit", "XAUT"));
  const { data: strategies } = useStrategies();
  const book = usePaperBook(needPnl ? (strategies ?? NONE) : NONE);
  const [ivs, setIvs] = useState<Partial<Record<string, number | null>>>({});
  const onIv = useCallback((key: string, iv: number | null) => setIvs((prev) => (prev[key] === iv ? prev : { ...prev, [key]: iv })), []);
  const trigger = useTriggerAlert();
  const triggerRef = useRef(trigger);
  triggerRef.current = trigger;
  const firing = useRef(new Set<string>());
  const lastRun = useRef(0);

  const readings = useMemo<AlertReadings>(() => {
    const pnl: Record<string, number | null> = {};
    if (needPnl) for (const s of strategies ?? NONE) if (s.status === "paper" || s.status === "live") pnl[s.id] = book.pnlOf(s).total;
    return {
      spot: {
        [readingKey("delta_india", "BTC")]: dBtc ? Number(dBtc.price) : null,
        [readingKey("delta_india", "ETH")]: dEth ? Number(dEth.price) : null,
        [readingKey("delta_india", "XAUT")]: dXaut ? Number(dXaut.price) : null,
        [readingKey("deribit", "BTC")]: rBtc ? Number(rBtc.price) : null,
        [readingKey("deribit", "ETH")]: rEth ? Number(rEth.price) : null,
        [readingKey("deribit", "XAUT")]: rXaut ? Number(rXaut.price) : null,
      },
      atmIv: ivs,
      pnl,
    };
    // `book` is rebuilt on every quote version, so pnlOf re-reads the marks
  }, [needPnl, strategies, book, dBtc, dEth, dXaut, rBtc, rEth, rXaut, ivs]);

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
      {ivProbes.map(([key, probe]) => (
        <IvProbe key={key} venue={probe.venue} asset={probe.asset} onValue={onIv} />
      ))}
    </>
  );
}
