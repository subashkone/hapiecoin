# Mindful Trading pause — design pass (roadmap item 10, ADR-074, HC-TR-182..183)

1. **Job.** When a trader who is down on the day is about to place a live order, put the day's loss, this order's worst case and its margin in front of them and hold the button for N seconds, so the next order is a decision and not a reflex. First question answered in 2 s: *"How much am I down today, and how much more could this one lose?"* (the two red figures at the top of the block).

2. **Layout (1440, inside the live Trade Preview dialog, between the exchange check and the red preview note; the same block sits above the batch warning in Trade All → Live).**
```
┌ Exchange check · ready to place ─────────────────────────────────────────────┐
│ …                                                                            │
├ Mindful pause · you are down today ──────────────────────────────────────────┤
│ Today's live P&L   −$183.40    This order could lose   −$93.10   Margin  $410 │  ← three figures, tabular
│ 2 live strategies · closed today included · since 05:30 IST (00:00 UTC)      │  ← basis line, muted
│ Take 30 seconds. Nothing is blocked: the button returns when the pause ends. │
│ Turn the pause off or change it in Settings → Mindful trading.               │  ← link, muted
├──────────────────────────────────────────────────────────────────────────────┤
│ You are about to trade this strategy. Orders will be placed on Delta …       │  ← existing red note
└──────────────────────────────────────────────────────────────────────────────┘
                                   [ Cancel ]  [ Pause · 27 s ]  → after 0: [ Place live orders → ]
```
The dialog body scrolls as today; the footer is fixed. The countdown replaces the destructive button in place (same width, outline, disabled, `font-mono` seconds), so nothing moves when it turns back into the real button. **Narrow (390):** the three figures stack to one per line (label left, figure right), the basis line wraps, the footer buttons go full width, countdown first.

**Settings dialog "Mindful trading" (size sm, the PnlDialog shape):** a Switch "Pause before a live order when I am down on the day" · Threshold: `[ 0 ] USD` with the hint "0 = any loss; the pause starts once today's live P&L is below −threshold" · Pause: `[ 30 ] seconds (10–300)` · a one-line note "Counts live strategies only, today since 05:30 IST (00:00 UTC), closed trades included. Paper trades, adjustments and exits are never paused." · Save. Turning it off shows one sentence under the switch: "The pause is there for the day you most want to skip it." (no confirm dialog; the sentence is the friction).

3. **Hierarchy.** Primary: none new (the dialog's destructive Place button stays the only action, and during the pause there is no enabled primary at all: that is the point). Secondary: the two loss figures (red) and the countdown. Tertiary: margin, basis line, the settings link. Red only on today's P&L and the worst-case figure; the block border is `border-warning/60` (the preview-capital block's own "over 50 %" colour), never amber (amber is spot/ATM/primary).

4. **States.** *Not down / off / paper / threshold not crossed*: the block does not render (no empty variant). *Down, pause running*: block + countdown button. *Down, pause ended*: block stays (figures remain in view), button returns. *Day P&L unknown* (no live strategy priced yet, the book has no figure): no pause (never pause on a guess) and no block. *Feed disconnected*: the preview already shows its own stale marks copy; the block adds "figures from the last tick" to the basis line. *Reopen the flow*: the pause restarts (state lives in the dialog, keyed on open). *Light theme*: tokens only. No paper/live badge change: the block appears only in live mode.

5. **Numbers.** Today's live P&L: `fmtMoney(signed)` in the display currency (USD or INR), basis "live strategies · closed today included · since 05:30 IST (00:00 UTC)" (the UTC day the P&L points are keyed by, the same figure as the bar's Day P&L restricted to live). This order could lose: the preview's Capital at risk (worst loss at expiry, or "undefined risk" as the word when uncapped, never a made-up number). Margin: the exchange's margin in use from the venue check (`marginUsed`) when present, else "—". Threshold shown when non-zero: "pause below −$50". Seconds as an integer with "s". Figures right-aligned, `num` tabular.

6. **Interaction.** Focus order unchanged: the dialog's fields, then Cancel, then the countdown button (disabled, so it is skipped by Tab; screen readers hear the seconds through `aria-live="polite"`), then the real button when it returns (a disabled button cannot hold focus, so nothing is moved). Esc cancels as today. Palette: `Settings: Mindful trading` (Settings group, keywords mindful, pause, cooldown, tilt). Settings menu entry "Mindful trading" after "P&L settings". The bar's Day P&L tile becomes a button opening the same dialog (title "Today's P&L · click for Mindful trading"). No new shortcut.

7. **Traceability.** HC-TR-182 the pause block and countdown in the live preview and the live batch (down on the day, threshold, seconds, never on paper / adjustments / exits); HC-TR-183 the Mindful trading preference (dialog, menu, palette, bar tile, persisted in settings). Functional: `trading-live.test.tsx` HC-TR-182 (the block, the countdown, the button returning, off / paper / unpriced never pause, the batch latched through a tick), `dialogs.test.tsx` HC-TR-183, e2e `settings.spec.ts` HC-TR-183. Visual snapshots of the block are not taken (the live e2e would need a seeded losing day; GAPS #90).

8. **Real-data check.** 5 or 500 chain rows: irrelevant, the block reads the book. 6-digit BTC figures (`−$1,02,345.60` in INR): the figure cells are `minmax(0, auto)` with `num`, so three 12-character figures fit at 1440 and stack at 390. 3-digit XAUT: same cells. Long strategy names: none shown (the count "2 live strategies" replaces names). No live positions: no figure, no pause. Failure breakpoint: three inline figures overflow below about 560 px dialog width; fix: the grid goes `grid-cols-1` under `sm`, which the layout above already does.

9. **Generic-pattern check.** No card grid, no icon: three figures in one row because they are the three numbers the research names (day P&L, max loss, margin), one countdown that is the disabled shape of the real button (no second competing button), one settings link because the trader must be able to find the off switch without hunting. Nothing decorative.

10. **Confusion check.** (a) "The server blocked my order" → the block says "Nothing is blocked: the button returns when the pause ends" and the countdown is the button itself. (b) "Which day, which P&L?" → the basis line names live strategies only, closed trades included, and the day boundary in IST and UTC, matching the bar's Day P&L tile. (c) "Is the worst case the margin?" → two labelled figures side by side, "This order could lose" and "Margin", with the margin taken from the exchange check and "—" when the exchange has not said.

**Update (ADR-084, 13 Sep 2026).** The server now computes the same day figure from its recorded marks and carries it in the live preview; when known it decides, and a live entry is delayed (409 MINDFUL_PAUSE) until the pause shown at preview time has elapsed. The block names whose figure it shows ("the server's figure" / this tab's book). The workbench's Review shows the block for an add. §4's "unknown → no pause" holds on both sides.
