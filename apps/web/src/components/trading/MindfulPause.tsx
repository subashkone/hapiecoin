"use client";
// Mindful Trading pause (roadmap item 10, ADR-074; HC-TR-182): the block a live entry dialog shows when the trader is
// down on the day (today's live P&L, this order's worst case, the margin the exchange holds), and the countdown that
// stands in for the Place button until the pause ends. Nothing is blocked: the block says so, and the button is the
// countdown itself. Design: docs/design/mindful-pause.md.
import { Button } from "@hapiecoin/ui";
import { useEffect, useState } from "react";
import { fmtMoney, type MoneyFormat } from "@/lib/money";
import { DAY_BASIS, type MindfulPauseInfo } from "@/lib/strategy/mindful";

let tickMs = 1000;
/** Tests: shorten a second so a 10 s pause runs in a moment; null restores real seconds. */
export function setMindfulTickMsForTests(ms: number | null): void {
  tickMs = ms ?? 1000;
}

/** Seconds left of the pause; restarts when `resetKey` changes (a reopened flow) or the pause itself changes. */
export function useMindfulCountdown(info: MindfulPauseInfo | null | undefined, resetKey: string | number): number {
  const seconds = info?.seconds ?? 0;
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    setLeft(seconds);
    if (seconds <= 0) return;
    // the interval idles at 0 until the dialog closes or the pause restarts; the cleanup owns it (a pure updater)
    const id = setInterval(() => setLeft((n) => (n > 1 ? n - 1 : 0)), tickMs);
    return () => clearInterval(id);
  }, [seconds, resetKey]);
  return info ? left : 0;
}

export interface MindfulPauseProps {
  info: MindfulPauseInfo;
  money: MoneyFormat;
  /** Seconds left; 0 once the pause has ended (the block stays, the button returns). */
  left: number;
  /** This order's worst case as the dialog already states it; `loss` paints it red (a number), a note stays plain. */
  atRisk: { text: string; loss: boolean };
  /** Margin the exchange holds now, as the exchange check states it, or "—". */
  marginText: string;
  /** The feed is not live: the figures are from the last tick. */
  stale?: boolean | undefined;
}

export function MindfulPause({ info, money, left, atRisk, marginText, stale }: MindfulPauseProps) {
  const { day, seconds, thresholdUsd } = info;
  return (
    <div className="mt-3 rounded border border-warning/60 p-2 text-2xs" data-testid="mindful-pause" data-left={left} data-source={info.source}>
      <div className="micro mb-1">Mindful pause · you are down today</div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-3">
        <div className="flex items-baseline justify-between gap-2 sm:block">
          <dt className="micro">Today's live P&amp;L</dt>
          <dd className="num text-[13px] font-medium text-loss" data-testid="mindful-day-pnl">
            {fmtMoney(day.pnl, money, { signed: true })}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2 sm:block">
          <dt className="micro">This order could lose</dt>
          <dd className={atRisk.loss ? "num text-[13px] font-medium text-loss" : "num text-[13px] font-medium"} data-testid="mindful-at-risk">
            {atRisk.text}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2 sm:block">
          <dt className="micro">Margin in use</dt>
          <dd className="num text-[13px] font-medium" data-testid="mindful-margin">
            {marginText}
          </dd>
        </div>
      </dl>
      <p className="micro mt-1" data-testid="mindful-basis">
        {day.count} live {day.count === 1 ? "strategy" : "strategies"}
        {day.closedCount ? ` · ${day.closedCount} closed today included` : ""} · {DAY_BASIS}
        {thresholdUsd > 0 ? ` · pause below ${fmtMoney(-thresholdUsd, money, { signed: true })}` : ""}
        {info.source === "server" ? " · the server's figure" : ""}
        {stale ? " · figures from the last tick" : ""}
      </p>
      <p className="mt-1" data-testid="mindful-copy">
        {left > 0 ? `Take ${seconds} seconds. Nothing is blocked: the button returns when the pause ends.` : "The pause has ended. The order is yours to place."}
      </p>
      <p className="micro mt-1">Turn the pause off or change it in Settings → Mindful trading.</p>
    </div>
  );
}

/** The Place button's shape while the pause runs: same width, outline, disabled, the seconds read aloud politely. */
export function MindfulCountdownButton({ left }: { left: number }) {
  return (
    <Button variant="outline" disabled data-testid="mindful-countdown" data-left={left}>
      <span aria-live="polite">
        Pause · <span className="font-mono">{left} s</span>
      </span>
    </Button>
  );
}
