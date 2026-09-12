# Strategy Wizard — design pass (roadmap item 8, ADR-072, HC-TR-176..178)

1. **Job.** Turn a plain thesis ("BTC up 3 % by the 25th") into three defined-risk strategies priced at the live chain, ranked by return on risk at that thesis, one click from the Builder. First question answered in 2 s: *"If I'm right, what do I make, and what can I lose?"* (the P&L-at-target and max-loss figures on the top card).

2. **Layout (1440, Builder pane, third sub-tab `Wizard` after Builder | Templates).**
```
┌ Builder | Templates | Wizard ─────────────────── Lot 0.001 BTC · basis mark ┐
│ View   [Bullish] [Bearish] [Neutral] [Volatile]                            │  ← toggle chips, one on
│ Target  [ +3.0 ] %  = 81,907 USD      by [ 25 Sep 26 ▾ ] (13 d)            │  ← % and price are one field pair
│ Priced at the live chain, 10 lots × 0.001 BTC, marks · updated 2 s ago     │  ← basis line, muted
├────────────────────────────────────────────────────────────────────────────┤
│ 1  ▁▂▅▇  Bull Call Spread            best return on risk                   │  ← rank, sketch, name, one tag
│    Buy 79,400 C · Sell 82,000 C · 25 Sep 26                                 │
│    If right on 25 Sep   +184.20 USD    POP 41 %   Max loss −93.10 USD       │  ← green/red only on P&L
│    Max profit +166.90 USD · R:R 1 : 1.8                       [ Use this ]  │  ← amber primary, only on card 1
│ 2  …  Call Backspread                highest POP           … [ Use this ]  │  ← outline buttons on 2 and 3
│ 3  …  Long Call Butterfly            smallest max loss     … [ Use this ]  │
└────────────────────────────────────────────────────────────────────────────┘
```
Region above the rule is fixed; the three cards scroll with the pane. **Narrow (390):** chips wrap to two rows, the target pair stacks (% on one line, price and date on the next), cards go full-width with the sketch above the name and the button full-width at the card's foot. Nothing hides; the basis line stays.

3. **Hierarchy.** Primary (amber): the `Use this` button on card 1 only; cards 2 and 3 use the outline button. Secondary: P&L at target (the biggest number on each card, green or red by sign), the rank numeral. Tertiary: POP, max loss, max profit, R:R, legs line, basis line. Green/red appear only on P&L at target, max profit, max loss. The chosen view chip uses the foreground fill (as the asset chips do), not amber.

4. **States.** *Chain loading*: inputs enabled, three skeleton cards with the basis line reading "Waiting for the chain…". *No spot*: cards replaced by one EmptyState "No spot yet for BTC on Delta Exchange India"; inputs disabled. *No fit*: EmptyState "No defined-risk template fits a Bullish view at +3 % by 25 Sep" with a link to Templates and a hint to widen the move or the date. *Pricing*: cards keep their last figures dimmed with a "repricing…" caption; new figures replace them in one frame. *Stale (WS disconnected)*: the basis line turns to "Feed disconnected · figures from HH:MM:SS" (same copy as the chain panel); buttons stay enabled (loading legs is a local act). *Paper vs live*: none, the wizard never trades; the Builder's own ticket shows the mode. *Light theme*: tokens only; the sketch strokes use `--fg-muted`.

5. **Numbers.** P&L at target, max loss, max profit: `fmtMoney` in the account currency (USD or INR from settings), signed, two decimals, basis "per N lots × lot size" stated once in the basis line, `Unlimited` never appears (defined risk only; max profit may read `Unlimited` for a backspread and is shown as the word). POP as a whole percent. R:R as `1 : x.x`. Target price at the venue's tick (`fmtPrice`), move as a signed percent with one decimal. Days to the date as an integer with `d`. All figures right-aligned in a tabular-numeral grid; the legs line is text.

6. **Interaction.** Focus order: view chips → move % → target price → date select → card 1 button → card 2 → card 3. Arrow keys move between chips; Enter on a card button loads. Palette: `Strategy wizard` (Actions) opens Builder → Wizard; `Load template → …` stays. Shortcut: `W` (Analyse workspace: open the Wizard tab; free in the registry: used keys are J K B S E A P T D ? Ctrl K Esc and arrows). Loading a card writes the legs, the name, `builderTab = builder`, and sets the payoff target to the thesis (price and days) so the chart opens on it.

7. **Traceability.** HC-TR-176 Wizard sub-tab and inputs (view, move/price, date); HC-TR-177 ranked defined-risk cards priced at the target; HC-TR-178 Use this loads the Builder and sets the payoff target; palette and `W`. Visual tests: `analyse-wizard-dark.png`, `analyse-wizard-light.png` (visual.spec), functional in `analyse.spec.ts` "HC-TR-176..178 strategy wizard".

8. **Real-data check.** Five strikes: the ATM-relative templates fall off the ladder and drop out silently (materialise refuses `out-of-range`), so the list may be shorter than three: the panel then shows what fits and says "2 of 3 fit this ladder". 500 strikes: unaffected (rows are read by index around ATM). 6-digit BTC price (`1,02,345` in INR display or `102,345.5` USD): the target price field is 12 ch wide, tabular. 3-digit XAUT (`3,425.5`): the same field, no reflow. Long names ("Broken-Wing Put Butterfly"): the name truncates with an ellipsis at 28 ch, the full name in the title attribute. No positions: irrelevant, the wizard reads the chain only. Failure breakpoint: below 1180 px the card's figure row (four figures) overflows; fix: the figures wrap to two rows of two at `max-[1180px]`, which the narrow layout already does.

9. **Generic-pattern check.** Three cards are ranked and unequal: card 1 carries the amber button and the largest figure; 2 and 3 are visibly secondary. No icon decorates; the sketch is the payoff shape the Templates panel already uses (it tells the trader the strategy's silhouette). One primary action per screen. The tag on each card is earned by an argmax over the three, never repeated, so no two cards claim the same virtue.

10. **Confusion check.** (a) "P&L at target" could be read as guaranteed: the label says *If right on 25 Sep* and the POP sits beside it, and the basis line says "priced at the live chain". (b) The % move could be read as the option's return: the field shows the derived underlying price next to it (`+3.0 % = 81,907 USD`) and the date, so it is the underlying's move. (c) "Max loss" could be read as margin: the caption reads *Max loss (the most you can lose)* and the ticket in the Builder still shows margin separately; nothing here says margin.
