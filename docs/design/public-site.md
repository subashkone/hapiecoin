# Public site · design notes (Phase 4 item 5)

## 5b · Payoff chart preview (`/payoff-preview`)
Traceability: HC-PB-042..051, HC-PB-059 (palette entry), HC-PB-063, HC-PB-064. ADR-037.

### 1. Job
Show a visitor, without an account, exactly the chart they will get in the workspace: within two seconds they must see *where this strategy makes money* (green fill, breakevens) and that the blue line is "before expiry".

### 2. Layout
```
1440 ─────────────────────────────────────────────────────────────────────────
│ Payoff chart preview  [Iron Condor][Long Call][Short Strangle][Wide chain]   Spot · amber · Target date · blue · OI · faint bars │
│ ┌ legend: On Expiry · On Target Date · Profit · Loss · Call OI · Put OI     [+] 100% [−] [Layers] ┐ ┌ BTC TARGET  +0.5% ┐ │
│ │ −2SD $80.0k │ −1SD $89.4k │ Current $100k (expected move…) │ +1SD │ +2SD │ │ [−] ───●─── [+]    │ │
│ │  Profit / Loss                        canvas chart                Open Interest │ │ $82.0k $100,500 $118k │ │
│ │                                Underlying Price                                 │ └───────────────────┘ │
│ │ @ $100k (+0.0%) · 15D: +$… · Expiry: +$1.2k · [Profit: $1.2k]        hover… │ ┌ TODAY   (expiry) ┐ │
│ └─────────────────────────────────────────────────────────────────────────────┘ │ [‹] ───●─── [›]  │ │
│                                                                                  │ Today  Fri, 18 Sep 02:30 PM  Expiry (09 Oct) │ │
```
At 390 px the grid stacks: chart card first (360 px tall), the two slider cards below; the legend wraps to two rows; the header note drops under the presets.

### 3. Hierarchy
Primary: the chart. The selected preset is the only filled button. Amber is reserved for the spot line and its pill; blue for the target-date curve and target marker. Green/red only in fills, the summary P&L and the % chip.

### 4. States
Fixed data, so no loading or error state: the page renders synchronously. Layer off → legend item struck through and the popover switch off. Day 0 → target curve hidden ("Today"), SD bands to expiry. Target at spot → no target marker (HC-PB-064). Light and dark from the same tokens as the workspace chart.

### 5. Numbers
Prices as `$100k` / `$78.5k` (`fmtK`), signed P&L as `+$1.2k` / `-$350` (`fmtSigned`), percent from spot to one decimal, one contract = 1 BTC so P&L is in USD per BTC of exposure. Day label `Fri, 18 Sep 02:30 PM` from page-load time.

### 6. Interaction
Presets reset zoom, target and day. Zoom ×1.25 per click between 50 % and 400 %; the label resets; the target is clamped into the new axis. Legend items and the Layers popover toggle the same six layers; the popover closes on an outside mousedown. Target slider step $100 with ±$500 buttons; day slider 0..30 with ‹ › buttons. Hover over the plot draws the crosshair on the canvas and prints the readout at the end of the summary row. Palette: "Payoff chart preview" is available signed out. Footer Quick Links carries the route.

### 7. Traceability and tests
Unit: `lib/payoff-preview.test.ts` (presets, zoom, SD, OI, pricing, formatters), `landing/payoff-preview.test.tsx` (presets, zoom/clamp, legend/popover, sliders/summary). E2E: public.spec "HC-PB-042..051 payoff chart preview". Visual: `public-payoff-preview-*`.

### 8. Real-data check
Four presets only; the wide-chain preset (spot 78k, OI 69k–87k) proves the axis and OI bars survive a narrow leg on a wide chain. Short strangle shows both tails unbounded (max loss "unlimited" is never printed on this page; the fills show it). Long call at max zoom-out (50 %) still shows the breakeven inside the axis.

### 9. Generic-pattern check
No feature tiles; one chart, two control cards; every control changes the picture. The note under the sliders says what the data is (sample legs, fixed spot) and where the real thing lives.

### 10. Confusion check
- "Is this live?" The header note and the footnote say fixed spot and sample legs; there is no feed badge to imply otherwise.
- "Which line is which?" Legend swatches match the chart tokens; the target curve disappears at day 0 rather than overlapping the expiry line.
- "Why did my target jump?" Zooming clamps the target into the visible axis and the $ label updates at the same time.

## 5c · Evidence audit of the Phase 1 public pages (09 Sep 2026)
Scope: every `10-public.json` row without a build tag, plus the plan-banner rows HC-SH-051/052 and the Support menu section HC-SH-025 (tagged in 5a).
Method: each row was matched to an existing unit or e2e test; rows with no test got `landing-sections.test.tsx`, which renders the full landing page and asserts every section against `content/landing.ts` (hero buttons, stats strip, comparison table, feature tabs, capabilities incl. the two wide cells, analytics teaser link, full feature list, what's new badges, CTA, section anchors with the sticky offset, exchange tiles).
Result: 34 rows tagged "verified in the web app" with the test name; 7 v2-brief extras recorded as not built in GAPS #54 (count-up stats, tab auto-rotate, live terminal top bar / scenario matrix / portfolio bar, liquidation cells and sparkline, tile IV). All reference-parity rows HC-PB-001..022 are built.
