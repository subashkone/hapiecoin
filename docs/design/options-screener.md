# Options screener — design pass (roadmap item 11, ADR-076, HC-WS-110..112)

1. **Job.** Rank every listed option of the workspace asset, across all its expiries, by what a trader is hunting for: the richest premium per day, the highest or lowest IV against its own ATM, the widest skew, the cheapest break-even, and hand the pick to the Builder in one click. First question answered in 2 s: *"Which strike and expiry pays most per day for the delta I am willing to hold?"* (the top row of the default sort).

2. **Layout (1440, a sixth left-pane tab `Screener` after Journal; the pane's full height).**
```
┌ Chain | Builder | Paper | Live | Journal | Screener ────── Lot 0.001 BTC · basis mark ┐
│ View [Strikes] [Expiries]     Side [Both] [Calls] [Puts]   |Δ| [Any] [≤0.10] [0.10–0.30] [0.30–0.50] [>0.50] │
│ Expiries [25 Sep] [02 Oct] [30 Oct] [26 Dec] …   Min OI [ 0 ]                                    │
│ 812 options on 8 expiries · marks · IV rank 62 (front) · spot 79,521 · updated live               │  ← basis line
├───────────────────────────────────────────────────────────────────────────────────────────────┤
│ Expiry   Strike   Side  Mark     IV     IV−ATM  |Δ|   Prem/day  Yield/day  BE %    OI     Act. │  ← sortable header
│ 25 Sep   81,000   C     412.5   58.2%  +1.4    0.32  31.73     0.040 %    +2.38   1.2M  B S ⌕ │
│ 02 Oct   78,000   P     690.0   61.0%  +3.1    0.29  34.50     0.043 %    −2.78   0.9M  B S ⌕ │
│ …  (top 100 of 812; the rest by tightening a filter)                                            │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
Expiries view: Expiry · Days · ATM IV · 25Δ skew · Expected move (± USD, %) · Call OI · Put OI · PCR · ⌕
```
The filter block is fixed; the table scrolls inside the pane (`DataTable maxH`), header sticky. **Narrow (390):** chip rows wrap; the table keeps the essentials by the column menu default (Expiry, Strike, Side, Prem/day, |Δ|, Act.) and scrolls horizontally inside its own container.

3. **Hierarchy.** Primary: none amber (no single action on a list); the row's Buy / Sell are the chain's own small buy/sell buttons (green/red by side, as in the chain row controls). Secondary: the sort column's figures (tabular, right-aligned), the sort arrow. Tertiary: the filter chips, basis line, the OI. Green/red only on the Buy / Sell buttons (side) and on the break-even sign (a P&L-like figure: none; BE % stays neutral). IV−ATM is neutral text; positive means richer than ATM.

4. **States.** *No expiries yet*: EmptyState "Waiting for the listed expiries". *Chains loading*: the table shows the expiries that have arrived and the basis line says "3 of 8 expiries priced…"; `data-state=pending` until at least one chain is in. *No spot*: rows still list (no IV−ATM, no yield, no BE %); basis says "No spot yet". *No row after filters*: the table's own empty line "No option fits these filters" with the count. *Feed disconnected*: basis line "Feed disconnected · figures from the last tick" (the chain panel's rule). *Data-only venue (Deribit)*: the screener works (chains only); Buy / Sell still add Builder legs (paper is allowed on a data-only venue, ADR-069). *Light theme*: tokens only.

5. **Numbers.** Mark in USD per unit (`fmtPrice`), IV as `fmtIv` (58.2 %), IV−ATM in vol points with sign (1 dp), |Δ| 2 dp, Premium/day = mark ÷ days to settlement (USD per unit per day, 2 dp; days floored at one hour so the figure stays finite: a row under one day reads "expires today" in Days), Yield/day = premium/day ÷ spot × 100 (% per day, 3 dp), BE % = (strike ± mark) ÷ spot − 1 signed 2 dp (+ for a call's break-even above spot, − for a put's below), OI via `fmtOi`; Expiries view: days as an integer, ATM IV `fmtIv`, 25Δ skew "x.x pts", expected move "±$1,234 (1.6 %)", OI totals `fmtOi`, PCR 2 dp. Sort keys are the raw numbers; nulls sort last (the DataTable's rule). Every column header carries a title with its unit and basis.

6. **Interaction.** Focus order: view chips → side → delta band → expiry chips → min OI → table header (sort on click / Enter) → rows' Buy, Sell, Chain buttons. Buy / Sell add one leg at the chain lots (the chain row rule: mark as price, mark IV; the leg limit toasts as the chain does). "⌕ Chain" sets the workspace expiry to the row's and opens the Chain tab. Palette: `Options screener` (Navigate to /analyse?tab=screener); deep link `?tab=screener`. No new shortcut (S is Sell).

7. **Traceability.** HC-WS-110 the Screener tab: strikes table across all listed expiries with the filters and the sortable figures; HC-WS-111 the Expiries view (ATM IV, 25Δ skew, expected move, OI, PCR, term shape); HC-WS-112 row actions (Buy / Sell to the Builder, Chain), the palette command and the deep link. Functional: `screener.test.ts` (pure), `screener.test.tsx` (panel), `workspace.test.tsx` (tab), `shell.test.tsx` (palette), e2e `analyse.spec.ts` "HC-WS-110..112". Visual: `analyse-screener-{dark,light}.png` in `visual.spec.ts`.

8. **Real-data check.** 5 strikes: a handful of rows, filters mostly empty, honest counts. 500 strikes × 12 expiries × 2 sides = 12,000 candidate rows: the fold is O(n) per tick batched by `useChains` (one re-render per burst), the table shows the top 100, sorting runs over the filtered set; if it ever lags, the fold moves behind `useDeferredValue`. 6-digit BTC (`1,02,345.5`) and 3-digit XAUT (`3,425.5`): `num` tabular cells, Strike column 84 px min. Long expiries list (12 chips): wraps to a second row. No positions: irrelevant. Topic budget: the gateway allows 50 topics per connection; 12 expiries plus spot and the chain panel's own topic stay far below; the Vol tab already subscribes the same set. Failure breakpoint: eleven columns need ~1000 px; below that the table scrolls horizontally inside the pane, and the column menu hides the tertiary ones by default under 560 px.

9. **Generic-pattern check.** One table, one set of filters, no tiles, no icons but the chain's own ⌕. The Expiries view exists because skew and expected move are per-expiry facts that make no sense on a strike row. Buy / Sell are the only buttons per row because that is what a trader does with a pick.

10. **Confusion check.** (a) "Premium per day is what I earn" → the header title says "mark ÷ days to settlement, per unit; you earn it only if you sell and it expires worthless", and Yield/day is labelled "% of spot per day". (b) "IV−ATM is IV rank" → the column is named IV−ATM with the unit "vol pts vs this expiry's ATM"; the underlying's IV rank sits in the basis line labelled "(front expiry, 1 y)". (c) "BE % is P&L" → the header reads "Break-even vs spot at expiry" and the figure is neutral, never green or red.
