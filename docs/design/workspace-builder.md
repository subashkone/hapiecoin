# Workspace · Builder, templates and the analysis pane · design pass · 2026-09-08

Covers the remaining Phase 2 rows: Builder and templates (HC-TR-001..049 subset for Phase 2, HC-TR-090..092), the right pane (HC-WS-033..062 Phase 2 rows), workspace chrome (HC-WS-001..009, 030, 031). Mock reference: `mockup-v2/src-trd/*` (Builder, templates, dialogs), `mockup-v2/parts-src/analyse/40-payoff.js.html` and `50-panels.js.html` (payoff, Greeks, ladder). Tokens: ADR-003; legs: ADR-022.

## 1. Job
Turn the legs added from the chain into a named strategy and show what it does: payoff, break-evens, Greeks, and P&L by price and date. First question in 2 s: **is this strategy a debit or a credit, and where does it make money?** → the Net premium tile and the payoff chart with break-even markers are the first two things in the right pane.

## 2. Layout (desktop 1440)
```
┌ Chain · Builder 3 · Paper · Live · Journal ─────────┐┃┌ Payoff · Greeks · Ladder   (Scenarios · Vol · Structure = Phase 5) ┐
│ [Builder] [Templates]           3 legs · 07 Sep     │┃│ ┌Max profit┐┌Max loss┐┌Net premium┐┌Breakeven┐┌POP┐┌R:R┐        │
│ BUILDER  [Untitled strategy____]  live│custom  ⧉basket│┃│ POP 47.7% moderate · R:R 1.15 balanced · Max ROI · Margin · Win if│
│ Side  Instrument          Lots   IV    Price   Δ   Θ ✕│┃│ [At expiry][On 16 Sep]  layers OI ±SD BE      zoom − 100% +     │
│ BUY   79,400 C · 0d ATM  [−10+] 27.0  807.5 +0.53 −1.2 ✕│┃│  ┌──────── payoff (canvas) ────────┐                              │
│ SELL  79,200 P · 0d ATM  [−10+] 41.4  918.4 +0.47 +0.9 ✕│┃│  │ spot ┊  BE 81,454 ┊ target ● …   │                              │
│ [Select from chain] [+ Future]                      │┃│  └──────────────────────────────────┘                              │
│ Net debit $4.66 · 465.8 / BTC · Margin est. $94    │┃│ Target price ── 81,900 +3.0% ──●──   Target date ‹ Today · 19d › │
│ [Save draft] [Save & trade]                         │┃│ Net Δ · Net Γ · Net Θ/day · Net ν · Margin est.                     │
└─────────────────────────────────────────────────────┘┃└──────────────────────────────────────────────────────────────────┘
```
Left pane keeps the chain tab; Builder is the second tab with a mono count pill. The divider (┃) drags 35–70 %, double-click resets 55 %. Below 1000 px the panes stack behind a `Chain | Analysis` segmented toggle. Right pane tabs: Payoff, Greeks, Ladder live now; Scenarios, Vol, Structure show the Phase 5 placeholder.
Templates sub-tab: category chips All · Bullish · Bearish · Neutral · Others, an expiry select, 28 cards (name, category, one-line description, small payoff sketch) and a "My templates" section (Drafts | Archived, search, cards with Load / Archive / Delete).

## 3. Hierarchy
Primary (amber): the spot hairline and tag on the chart (the only amber). Secondary: tiles' big values, the strategy name. Tertiary: sub-lines, ticks, layer chips. Green/red: P&L values, side badges, profit / loss fills on the chart, POP and R:R grades.

## 4. States
No legs: Builder shows "No legs added · Start building your strategy by adding option or futures legs" with two actions (Select from chain, Browse templates); the right pane shows the ghost chart with the spot marker and "No strategy yet · Hover a chain row and press B / S, or load a template". Missing quotes for a leg (expired or unlisted): the leg row shows "no quote", the analysis uses the stored price and IV. Stale feed: values keep the last quote, the chain footer already says "as of". Undefined risk: Max profit / loss read "Unlimited", R:R "1 : ∞" / "∞ : 1", Margin est. "—" until the Phase 3 exchange estimate. Light / dark: canvas colours read from the CSS tokens at draw time.

## 5. Numbers
Money: USD per position by default, 2 dp with sign for P&L (+$1,234.50 / −$94.38); INR when the currency setting is INR, converted at the stored rate and formatted "₹1,03,045" style (en-IN grouping), never re-stored. Net premium tile also shows "per BTC" = premium ÷ (lots × lot size), 1 dp. Strikes stay USD (contract terms). Greeks: Δ 4 dp signed, Γ 4 dp (exponent below 1e-3), Θ/day and ν per 1 % IV as money. POP 1 dp %, R:R 2 dp, ROI 0 dp %, expected move ±1σ as price. Prices per contract in the legs table 1 dp. Quantities: integer lots × lot size shown as "10 × 0.001 BTC".

## 6. Interaction
Builder: side badge click toggles BUY ↔ SELL; lots stepper (−/+, typed number, min 1); Basket switch applies lot changes to every leg; price mode Live (marks follow the feed) / Custom (editable price inputs); New, Clear (toast "Cleared"), name input (Enter saves), Save draft (name dialog when unnamed), Save & trade (name dialog then the Phase 3 trading-mode dialog placeholder). Templates: click loads legs at the chosen expiry with the ATM index ± k rows from the venue list (never a strike step, ADR-006), switches to Builder, toasts. Payoff: click the chart or drag the price slider to set the target price; date slider ‹ › steps days; legend toggles the two curves; layer chips OI, ±σ, BE; zoom 50–300 %. Keyboard: sliders are native range inputs (arrows work). Palette: "Builder: new strategy", "Builder: clear legs", "Load template → <name>" for the 28 templates. No new shortcuts.

## 7. Traceability
Builder: HC-TR-001, 002, 004, 005, 006, 007, 008, 009, 011, 013, 015, 016, 017, 018, 019, 020, 021, 024, 025, 026, 027, 028, 031, 032, 033, 034, 035, 036, 037, 038, 039, 040, 041, 042, 044, 045, 047, 048, 049, 090, 091. Pane: HC-WS-001, 002, 003, 005, 007, 009, 031, 033..062 (Phase 2 rows). Playwright: `HC-TR-040 template loads legs into the Builder and the payoff appears`, `HC-TR-009/011/013 builder edits legs`, `HC-TR-020/044 save draft, list, load, delete`, `HC-WS-033/039 tiles and chart for a bull call spread`, `HC-WS-047/048 target sliders move the target marker`, `HC-WS-059/060 Greeks tab`, `HC-WS-062 ladder`, visual `analyse-builder-<theme>.png`, `analyse-payoff-<theme>.png`.

## 8. Real-data check
1 leg or 8 legs: the table grows, the pane scrolls internally. 6-digit BTC: tiles use compact grouping; the chart's $ axis uses k units above 10,000. XAUT 3-digit prices with 0.001 lots: money values are small (cents); 2 dp keeps them readable. Long strategy names truncate in the tab pill and the pane summary ("Bull Call Spread · 25 Sep · 20 lots"). No positions: ghost chart. Failure point: right pane below 360 px; stacking below 1000 px handles it.

## 9. Generic-pattern check
Six tiles are the mock's proven layout, each answering one question (profit, loss, cost, where, odds, ratio); no decorative icons; one primary action per state (Select from chain in the empty state, Save draft with legs). Chart layers are opt-in chips, not a toolbar.

## 10. Confusion check
1. "Is this what I pay or receive?" → the tile is labelled Net debit or Net credit with the sign, and the strip repeats "Win if > 79,966". 2. "Per contract or per position?" → every money value in the pane is per position and the tile sub-line gives the per-unit figure; the legs table says "per contract". 3. "Which date is the blue curve?" → the legend button names the date ("On 16 Sep") and the date slider shows "9d left".

## As built (08 Sep 2026, ADR-023)
Files: `apps/web/src/components/builder/{BuilderPanel,TemplatesPanel,ChainPickerDialog,FutureDialog}.tsx`, `components/analysis/{AnalysisPane,PayoffPanel,PayoffChart,payoffDraw,GreeksPanel,LadderPanel}.ts(x)`, `components/dialogs/SaveDraftDialog.tsx`, `components/workspace/Workspace.tsx`, `lib/strategy/{templates,analysis,useStrategyAnalysis}.ts`, `lib/pricing/{client,worker,legs}.ts`, `lib/gateway/useLegQuotes.ts`, `lib/money.ts`, store additions (`strategy`, `drafts`, `workspaceTab`, `analysisTab`, `builderTab`, `targetPrice`, `targetDays`).
Deviations from the sketch above: the Builder table shows Side · Instrument · Lots · IV · Price · Δ · Θ/d · ✕ (Type / Strike / Expiry / Unit folded into the two-line Instrument cell; lots are the only unit); zoom is 1× / 2× / 4× chips; the hover readout is in the strip, not a floating tooltip; the analytics strip holds Win if · Expected move · Nearest expiry (ROI / margin rows wait for Phase 3, GAPS #34); the divider default is 55 % with double-click / Home reset; Scenarios, Vol and Structure tabs are Phase 5 placeholders. Palette: "Builder: open / load a template / new strategy", "Analysis: payoff / Greeks / ladder". Minor parity gaps: GAPS #33.
Expiries are listed until their settlement instant (12:00 UTC BTC / ETH, 16:00 UTC XAUT), so the Builder never prices an already-settled option as "0d" (`lib/chain/expiries.ts`, found in the first visual capture on the expiry day).

## Amendment · templates strip (08 Sep 2026, ADR-027)
`TemplatesStrip` sits under the Builder actions: outlook tabs Bullish / Bearish / Neutral / Others, expiry select, scroll row of sketch cards, one click loads (replaces the legs, names the strategy, stays on the Builder). Collapsible with a persisted flag; "All 28 →" opens the Templates tab, which keeps the gallery and My templates. Loading shared with the tab via `useTemplateLoader`.

## Amendment · legs table parity (08 Sep 2026, ADR-028)
Checkbox column (master + per leg, `enabled` on the leg, `activeLegs` for analysis / ticket / trade), `LegInstrument` editor per option row (CE / PE toggle, strike select from the expiry's chain, expiry select from `useExpiries`), default 100 lots. Payoff: `sigma-labels` row (−2σ … +2σ), break-even % in the tile, target date next to +Nd. Header: `WalletChip` (available balance from `live/positions` balances) and `CurrencyToggle`.

## Amendment · payoff extras (10 Sep 2026, ADR-048)
Layers gain **IV −5 % / IV +5 %** (dashed target-date curves from two worker scenario calls with `ivShift ±0.05`; persisted in `store.chartLayers`). A click on the chart sets the target price (`onSelect` on `PayoffChart`). The analytics strip adds **Max ROI** (`max-roi`) and **Margin · risk x%** (`strip-margin`); the hover readout reads `16 Sep @ 82,879 +4.2% · +$2.28 · exp +$5.33`. Five price ticks (SPOT amber) and Today / mid / Expiry date ticks sit under the native sliders (`price-ticks`, `date-ticks`). The greeks strip adds **Margin est.** and the `USD per strategy · N lots` basis (`greeks-basis`).
