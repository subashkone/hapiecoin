"use client";
// Daily P&L points for paper and live strategies (HC-TR-076, GAPS #38, ADR-029): while the workspace is open, the
// browser that already prices every strategy at the feed's marks upserts today's total to `POST /strategies/{id}/pnl`
// shortly after mount and then every five minutes, only when the value moved. A server-side writer that does not
// need an open browser stays on the Phase 5 snapshotter list.
import type { Strategy } from "@hapiecoin/schema";
import { useEffect, useRef } from "react";
import { useRecordPnl } from "@/lib/api/strategies";
import { toDecimal } from "@hapiecoin/schema";
import type { PaperBook } from "./usePaper";

export const PNL_WRITE_FIRST_MS = 20_000;
export const PNL_WRITE_EVERY_MS = 5 * 60_000;

export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function usePnlWriter(strategies: readonly Strategy[] | undefined, book: PaperBook, enabled = true): void {
  const record = useRecordPnl();
  const last = useRef(new Map<string, string>());
  const mutate = record.mutate;
  const list = strategies;
  useEffect(() => {
    if (!enabled || !list) return;
    const write = () => {
      const day = todayIso();
      for (const s of list) {
        if (s.status !== "paper" && s.status !== "live") continue;
        const open = s.legs.filter((l) => l.status === "open");
        // no quote yet for an open leg: the total would be wrong, wait for the next pass
        if (open.some((l) => book.priceOf(s, l) === null)) continue;
        const pnl = toDecimal(book.pnlOf(s).total, 2);
        const key = `${s.id}:${day}`;
        if (last.current.get(key) === pnl) continue;
        last.current.set(key, pnl);
        mutate({ id: s.id, body: { day, pnl } });
      }
    };
    const first = setTimeout(write, PNL_WRITE_FIRST_MS);
    const every = setInterval(write, PNL_WRITE_EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [enabled, list, book, mutate]);
}
