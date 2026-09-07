// One-off: patches features/20-analyse.json for v2 (run from clone-v2: node parts-src/analyse-v1/feat-update.js)
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', '..', 'features', '20-analyse.json');
const a = JSON.parse(fs.readFileSync(file, 'utf8'));
if (a.some((x) => x.new)) { console.log('already patched'); process.exit(0); }
const R = '/analyse';
const patch = (i, o) => Object.assign(a[i], o);
// ---- wording fixes for entries whose behaviour changed in v2 ----
patch(0, { feature: 'Two-pane workspace (chain left ≈55%, analysis right ≈45%) below the app header, above the fixed portfolio bar; each pane scrolls internally', how: 'Flex shell sized to 100vh minus the measured header + plan banner height and a reserved 44px bottom strip for the chrome portfolio bar (measured: fixed bar → padding, in-flow bar → subtracted); ResizeObservers keep it in sync' });
patch(1, { feature: 'Resizable divider between the panes (drag 35–70%, double-click resets to 55%)', how: 'Width persisted in CG.state.analyseSplit; chart re-renders to the new width' });
patch(3, { feature: "Shared chrome placeholders: app header (variant 'analyse'), plan banner and portfolio bar", how: '<div data-cg="app-header" data-variant="analyse">, <div data-cg="plan-banner"> and <div data-cg="portfolio-bar"> are rendered by the chrome part; the workspace measures them' });
patch(4, { feature: 'Left tab bar: Chain · Builder · Paper · Live · Journal with small mono count pills', how: 'data-lptab chain|strategy|paper|live|journal (same data-tour ids as v1); pills show active legs / paper / live / closed strategy counts and hide at 0; the trading module mounts its .lp-panel[data-tab] panels into #analyse-left-panels' });
patch(5, { feature: 'Deep links #/analyse?tab=strategy&panel=scenarios (panel = payoff | scenarios | greeks | vol | structure | ladder; the v1 values analytics → payoff and pnl → ladder still resolve)', how: 'query.tab / query.panel are read in show(); the last tab is persisted in CG.state.analyseTab / analyseRightTab' });
patch(6, { feature: "Expiry strip with two-line chips '25 Sep / 21d' (07 Sep … 26 Mar); an amber dot marks expiries that hold legs of the current strategy", how: 'Chips rendered from CG.EXPIRIES; click sets CG.analyse.expiry + CG.state.expiry, re-renders the chain, emits analyse:expiry and toasts' });
patch(7, { feature: 'Expiry strip scroll arrows ‹ › (only shown when the strip overflows)', how: 'Overflow measured after render / resize; arrows scroll the strip by 220px' });
patch(8, { feature: 'LIVE pill in the chain toolbar (Live → Connecting → Static and back)', how: 'Toggles CG.analyse.mode; in static mode ticks stop updating the chain' });
patch(9, { feature: 'Gear button in the chain toolbar → Column Settings dialog', how: 'Opens the v1 Column Settings dialog (show / hide, reorder, quick buttons)' });
patch(10, { feature: 'Show / Hide tab with grouped switches: Market Data (Ask (Price/IV), Mark (Price/IV), Bid (Price/IV), OI, Volume, Bid Qty, Ask Qty), Greeks (Delta, Gamma, Theta, Vega), Activity (24hr Chg, Last), OHLC (Open, High, Low)' });
patch(11, { how: 'Essentials = Ask · Mark · Bid · OI · Δ (the v2 default); Show All / Hide all / Reset; each change re-renders the chain and toasts' });
patch(13, { how: 'Saved as CG.state.chainCols {v:2, order, visible} (v1 layouts are migrated to the v2 default)' });
patch(14, { feature: "Sticky two-row header: 'CALLS · ITM shaded · strikes ±12' | '25 Sep · 19d' | 'Δ per contract · PUTS', then the column labels Δ · OI · Bid/IV · Mark/IV · Ask/IV | Strike | Ask/IV · Mark/IV · Bid/IV · OI · Δ", how: 'Column order is defined once from the strike outward (price triplet inboard, OI and Δ outboard) and mirrored on the calls side' });
patch(15, { feature: '41 strikes around ATM from CG.chain(asset, expiry) with a strike-range control (±6 / ±12 / all), auto-scrolled to ATM', how: 'Range persisted in CG.state.chainRange (default ±12); the footer reports "n of 41 strikes"' });
patch(16, { feature: "Strike cell: mono price; the ATM row is a single amber band with an 'ATM' micro tag; leg pills ('C B 10', 'P S 10') sit under the strike", how: 'tr.atm background hsl(--primary/.09) with amber strike text; the sub-line is rebuilt on every legs change' });
patch(17, { feature: 'Price cells (Bid / Mark / Ask) show the price at 1dp with the IV at 1dp underneath; calls right-aligned, puts left-aligned; neutral ink (colour is reserved for buy/sell and P&L)', how: 'cellInner() renders <span class="px"> + <span class="iv">; INR mode converts premiums at CG.state.conversionRate (0dp)' });
patch(18, { feature: 'OI column drawn as a thin inward bar anchored at the outer edge (calls grow towards the strike from the left, puts from the right)', how: '2px bar width proportional to max OI of the chain; value shown as an integer' });
patch(19, { feature: 'ITM tint: call cells below spot and put cells above spot get a 4% foreground tint', how: 'td.itm{background:hsl(var(--foreground)/.04)}; hover replaces it with the raised surface tone' });
patch(20, { feature: 'Optional columns: Γ (6dp), Θ (1dp), ν (1dp), Volume, Bid Qty, Ask Qty, 24hr Chg (signed, coloured), Last, Open, High, Low; Δ (2dp) is shown by default', how: 'Toggled in Column Settings; the Greeks chip in the toolbar adds/removes Γ Θ ν in one click' });
patch(22, { feature: 'Row hover reveals a floating control on both sides: [B] [S] [− 10 +] lot stepper [ⓘ]', how: '.an-ctl inside the inboard cell; − / + step through the lot presets, clicking the number opens a preset menu, ⓘ opens option details; also shown on the keyboard-highlighted row' });
patch(24, { feature: 'Lot stepper presets (1 · 2 · 5 · 10 · 25 · 50 · 100 · 250 · 500 · 1000), default 10, "× lot size" shown as the stepper tooltip and in the option details dialog', how: 'CG.state.chainLots persisted; all steppers update together' });
patch(25, { feature: 'ⓘ icon (or Enter on the highlighted row) → option details dialog titled with the Delta-style symbol (e.g. C-BTC-79500-250926)' });
patch(26, { feature: "Existing strategy legs are marked in the chain: 'C B 10' / 'P S 10' pills under the strike, the mark cell outlined green/red, a green/red stripe on the row's left edge, filled B / S buttons and an amber dot on the expiry chip", how: 'renderPills() runs on analyse:legs-changed and after every chain render' });
patch(27, { feature: 'Keyboard: j / k or ↑ / ↓ move the highlighted strike (amber outline), B / S add a call leg, Shift+B / Shift+S a put, E / Shift+E cycle the expiry, Enter opens details, Esc clears', how: 'Registered through CG.shortcuts.register(key, description, handler) when the chrome registry exists (so they appear in the ? help) with a document-level fallback; ignored while typing or when a dialog is open; hovering a row moves the highlight' });
patch(28, { feature: "Chain footer: Σ Call OI · Σ Put OI · PCR · Max pain · Skew 25Δ · Fwd · 'n of 41 strikes · hover a row for B / S'", how: 'Skew 25Δ = IV(25Δ put) − IV(25Δ call) in vol points; Fwd from ATM put-call parity (K + C − P); max pain = strike minimising total option value' });
patch(30, { feature: 'Currency toggle (USD / INR) re-formats premiums, P&L, tiles, greeks and axes; strikes stay in USD (contract terms)' });
patch(31, { feature: 'Right tab bar: Payoff · Scenarios · Greeks · Vol · Structure · Ladder with the strategy summary ("Bull Call Spread · 25 Sep · 20 lots"), Share and collapse buttons (data-tour="payoff-panel")', how: 'The v1 Analytics tab was merged into the Payoff tab as the Analytics strip; the v1 P&L Table became the Ladder tab' });
patch(32, { feature: "Six summary tiles: Max profit ('at ≥ 80,512' / 'unlimited upside') · Max loss ('at ≤ 79,319') · Net debit / credit with the per-BTC line ('465.8 / BTC · 10 lots') · Breakeven(s) with % from spot · POP ('lognormal · IV 42.4%') · R:R ('1 : 1.15')", how: 'Hairline-separated tiles, no cards; extremes located from the expiry payoff, per-unit premium = net premium / (lot size × gcd of lots)' });
patch(33, { feature: "Empty state 'No strategy yet · Hover a chain row and press B / S, or load a template from the Builder' with a ghost chart and the spot marker" });
patch(34, { feature: 'Legend toggles: At expiry (ink line) · On <target date> (blue curve); layer chips OI · ±SD · BE · IV −5% · IV +5%', how: 'Clicking a legend item or chip flips the layer (persisted in CG.state.chartLayers)' });
patch(36, { feature: 'Layers popover: At-expiry P&L line · Target-date P&L curve · Profit / loss fill · Open interest bars · ±1σ expected-move band · Breakeven markers · IV −5% curve · IV +5% curve' });
patch(37, { feature: 'Expected-move band: ±1σ shaded band on the chart with dashed edges labelled "+1σ 85.1k" / "−1σ 73.9k" (replaces the v1 -2SD…+2SD header row)', how: 'σ = spot × ATM IV × √(days/365) for the target date or expiry' });
patch(38, { feature: 'SVG payoff chart in the direction-a style: ink at-expiry line, blue target-date curve, green/red fills, faint grid, $ axis, max profit / max loss tags at the plateaus, amber spot marker', how: 'Rendered from CG.analyze(points 201) over the zoomed price range; re-renders on ticks, legs, sliders, layers, theme and resize' });
patch(40, { feature: "Spot marker: amber dashed hairline with the 'SPOT 79,521' tag at the top of the chart (the only accent colour on the chart)" });
patch(41, { feature: 'Faint open-interest bars per strike (call + put combined) along the bottom of the chart with a tooltip per bar' });
patch(42, { feature: '±1σ band with dashed edges (see the expected-move band entry)', how: 'Layer "sd"; the ±2σ guides of v1 were dropped in favour of the labelled ±1σ band' });
patch(43, { feature: "Target-price marker: dashed blue line, dot on the target-date curve and a '+$1.7 @ 81,921' label; clicking the chart sets the target price", how: 'AN.targetPrice; emits analyse:target' });
patch(44, { feature: "Hover crosshair with tooltip '16 Sep @ 82,879 +4.2% · +$2.28 · exp +$5.33'" });
patch(45, { feature: "Spot-zone readout ('Spot now ✓ profit zone / ✗ loss zone') in the Analytics strip (replaces the v1 chart footer)", how: 'P&L at spot at expiry from CG.analyze' });
patch(46, { feature: "Target price slider: '− 81,900 +3.0% +' value, amber SPOT tick on the track, fill, knob and five price ticks", how: 'Hidden native range over a custom track; steps move by 1/5 of the strike step; range follows the zoom' });
patch(47, { feature: "Target date slider: 'Today · 06 Sep · 19d left' / 'Wed 16 Sep · 9d left', ‹ › day steps, ticks Today · mid dates · Expiry", how: 'AN.targetDays 0…max DTE of the legs; legend and tooltips show the chosen date' });
patch(48, { feature: 'Automatic re-rendering on price ticks, leg changes, asset / expiry / currency / lot-size changes, density, theme and pane resize' });
[49, 50, 51, 52, 53, 54, 55, 56, 57].forEach((i) => patch(i, { screen: 'Payoff · Analytics strip' }));
patch(49, { feature: "Max profit with ROI → 'Max ROI 6% on margin' in the Analytics strip under the tiles (merged from the v1 Analytics tab)", how: 'ROI = max profit / margin; ∞ when unlimited' });
patch(50, { feature: "Max loss as % of capital → 'Margin $94 · risk 5%' in the Analytics strip" });
patch(51, { feature: "Expected required margin → 'Margin $94.38' in the Analytics strip and 'Margin est.' in the greeks strip" });
patch(52, { feature: "Breakeven points → Breakeven tile ('79,966 · +0.6% from spot', or two values) plus 'Spot now ✓/✗ zone' in the strip" });
patch(53, { feature: "R/R with grade → 'R:R 1.15 balanced' (✓ favorable ≥2 / balanced ≥1 / high risk / unlimited exposure) in the strip and the R : R tile" });
patch(54, { feature: "Probability of profit with grade → 'POP 47.7% moderate' (✓ high ≥60 / moderate ≥40 / low) in the strip and the POP tile" });
patch(55, { feature: "Win if price → 'Win if > 79,966' / '77,660 – 81,341' / '< a or > b' / 'any price' in the strip" });
patch(56, { feature: "Net premium → 'Net debit $4.66 · 465.8 / BTC' tile (credit / debit label switches)" });
patch(57, { feature: "Max ROI → 'Max ROI 6% on margin' in the strip" });
patch(58, { feature: 'Greeks tab tiles: Total Delta (directional exposure) · Total Gamma (Δ change per $1) · Total Theta ($/day) · Total Vega ($ per 1% IV), hairline-separated' });
patch(59, { feature: "Leg-wise Greeks table: BUY/SELL · strike C/P · expiry, Lots, IV, Δ, Γ, Θ/day, ν and a 'Portfolio total' row" });
patch(61, { screen: 'Ladder', feature: 'Ladder tab: P&L by underlying price with columns Price · Change from spot · At expiry · On <target date> · Status (profit / loss / breakeven / spot pills)', how: 'Rows every step from −20% to +20% around spot; the spot row is highlighted amber and breakeven rows are inserted (dashed); sticky header; auto-scrolls to spot' });
patch(62, { feature: 'Shared workspace state CG.analyse {legs, name, strategyId, asset, expiry, targetDays, targetPrice, mode, stats, setExpiry(), setRightTab(), findDelta()} and events analyse:addLeg / analyse:legs-changed / analyse:tab / analyse:set-tab / analyse:right-tab / analyse:expiry / analyse:target / analyse:stats' });
// ---- new v2 features ----
const N = (screen, feature, how, evidence) => ({ route: R, screen, feature, how: how || '', status: 'working', evidence: evidence || 'v2 · direction-a "Obsidian Desk" mockup + research UX rules', new: true });
const add = [
  N('Analyse workspace', 'Tab count pills: Builder = active legs, Paper / Live = strategy counts, Journal = closed strategies', 'renderCounts() on analyse:legs-changed / analyse:strategies-changed; pills hide at 0'),
  N('Analyse workspace', 'Pane collapse buttons ‹ › give either pane the full width; a ⋮ handle restores both', 'CG.state.analyseCollapse = left | right | ""; the chart re-renders to the new width'),
  N('Analyse workspace', 'Density: comfortable rows (36px) / compact rows (28px) for the chain and the ladder', "root[data-density] follows CG.state.density and CG.on('density')"),
  N('Analyse workspace', "Tab-bar micro info: 'Lot 0.001 BTC · Basis mark' (left) and 'Bull Call Spread · 25 Sep · 20 lots' (right)", 'Rebuilt on legs / lot-size / basis changes'),
  N('Analyse workspace', "Header stats feed: CG.emit('analyse:stats', {atmIv, ivRank, ivPercentile, expectedMove, expiry, spot, pcr, maxPain, skew25}) on show, expiry, asset and every tick; also stored in CG.analyse.stats", 'Consumed by the chrome header (ATM IV · IV rank · expected move)'),
  N('Analyse workspace', 'Command palette commands: Switch expiry → <date> (one per expiry), Load template → <name> (skipped when the trading module registers its own), Toggle chain Greeks, Find strike by delta…, Share strategy link, Analyse → <tab>', 'CG.palette.register({id,label,group:"Analyse",keywords,run}) guarded; commands navigate to /analyse first when needed'),
  N('Analyse workspace', 'Keyboard shortcuts listed in the ? help: J / K, ↑ / ↓, B / S, Shift+B / Shift+S, E / Shift+E, Enter', 'CG.shortcuts.register(key, description, handler, {group:"Analyse workspace"}) with a document fallback when the registry is absent'),
  N('Options chain', 'Mirrored column order: Δ · OI · Bid/IV · Mark/IV · Ask/IV | Strike | Ask/IV · Mark/IV · Bid/IV · OI · Δ (price triplet inboard, Δ and OI outboard) with Δ visible by default at 2dp', 'DEFAULT_ORDER / ESSENTIALS in the column model; column settings still reorder from the strike outward'),
  N('Options chain', 'Strike range control ±6 / ±12 / all in the chain toolbar', 'CG.state.chainRange; the header hint and footer count follow'),
  N('Options chain', 'Greeks expand toggle adds Γ Θ ν columns next to Δ on both sides', 'setGreeksCols() edits the column state (persisted) and re-renders; chip state mirrors the columns'),
  N('Options chain', 'Find strike by Δ chips (10Δ · 16Δ · 25Δ · 50Δ): scrolls to the call and put strikes nearest that delta, pulses both rows, highlights the call strike and toasts the pair', 'nearestDelta() over the full chain; widens the strike range when the hits fall outside it; the palette command opens a dialog with a custom Δ input'),
  N('Options chain', "Spot hairline between the two strikes bracketing spot with a 'SPOT 79,521' tag; ATM row as a single amber band", 'A zero-height spot row is inserted after the last strike ≤ spot and moves on ticks; the neighbouring strike cells get extra padding so the tag never covers a label'),
  N('Options chain', 'Row height 36px (28px compact), IV 1dp under 1dp prices, Δ 2dp, OI integers with thousands separators', 'Fixed precision per column'),
  N('Options chain', "Two-line expiry chips '25 Sep / 21d' with an amber dot on expiries that hold legs; scroll arrows appear only on overflow"),
  N('Options chain', 'Keyboard highlight row (amber outline) also shows the B / S controls; hovering another row moves the highlight', 'tr.hl styling; hover sync keeps mouse and keyboard in step'),
  N('Options chain', 'Header group row hints: "ITM shaded · strikes ±12" and "Δ per contract"'),
  N('Options chain', 'Footer additions: Skew 25Δ (IV put − IV call at 25Δ) and Fwd (from ATM put-call parity)'),
  N('Payoff', 'Analytics strip under the tiles (merged Analytics tab): POP with grade · R:R with grade · Max ROI · Margin with risk % · Win if · Spot now zone', 'Wraps to a second line on narrow panes'),
  N('Payoff', 'Chart restyled to the reference: ink expiry line, blue target curve, green/red fills, amber SPOT tag + dashed hairline, ±1σ dashed edges with labels, faint OI bars, BE labels, max profit / max loss tags'),
  N('Payoff', 'IV −5% and IV +5% layers: dashed blue target-date curves computed with CG.analyze(legs, asset, {ivShift:±0.05})', 'Chips + layers popover; persisted in CG.state.chartLayers'),
  N('Payoff', "Target marker '+$1.7 @ 81,921' on the curve; clicking the chart sets the target price", 'setTargetPrice(price, true)'),
  N('Payoff', 'Sliders restyled: custom track with fill, knob, amber SPOT tick with label, five price ticks; date ticks Today · mid dates · Expiry'),
  N('Payoff', "Net greeks strip under the sliders: Net Δ · Net Γ · Net Θ / day · Net ν / 1% IV · Margin est. · 'USD per strategy · 20 lots · mark basis'"),
  N('Payoff', "Tooltip format '16 Sep @ 82,879 +4.2% · +$2.28 · exp +$5.33'"),
  N('Scenarios', 'Price × date P&L matrix: rows −10% … +10% in 2% steps (or ±20% in 4% steps), columns today · +25% · +50% · +75% · expiry−1d · expiry, cells shaded by magnitude with mono values', 'Each cell = CG.analyze(…, {targetDays, spot, min:S, max:S}).pnlTarget; rows carry a SPOT label'),
  N('Scenarios', 'Mode toggle P&L | Δ | Θ re-computes the grid as position delta or theta per day at each price × date', 'positionGreeksAt(legs, S, daysElapsed, ivShift) re-prices every leg with Black-76'),
  N('Scenarios', 'IV shift slider −20% … +20% re-computes the grid through CG.analyze(…, {ivShift})', 'Debounced; persisted in CG.state.scnIv'),
  N('Scenarios', 'Target cell (nearest to the slider target price and date) is outlined; its row / column headers are emphasised; clicking a cell sets the target price and date', 'Round-trips through setTargetPrice / setTargetDays'),
  N('Scenarios', 'Smooth toggle renders the same grid as a bilinearly interpolated canvas heat field with column separators, dashed zero (breakeven) contour, amber spot line and the target outline', 'ImageData interpolation between cell centres; colours read from the theme tokens so both themes work'),
  N('Scenarios', "Hover tooltip on cells and on the canvas ('81,129 · 16 Sep · +1.1'; canvas values are interpolated)"),
  N('Vol', "Smile · <expiry>: mark IV across the 41 strikes with the strategy's strikes as amber dots, spot hairline, ATM IV and 25Δ skew readout", 'From CG.chain(asset, expiry); re-renders on expiry changes'),
  N('Vol', 'Term structure: ATM IV per expiry across CG.EXPIRIES as bars (active expiry amber, click a bar to switch expiry) with contango / backwardation note'),
  N('Vol', 'IV rank (1y): rank, percentile, current, 1y low / high on a gauge with an interpretation line', 'Generated 365-day ATM IV history (mean-reverting log process seeded per asset, pinned to the current ATM IV)'),
  N('Vol', 'Realised vs implied: 30-day realised vol (from a generated price series) vs the ATM IV history over 365 days, with the IV − RV spread'),
  N('Structure', 'Max pain: amber marker + label over call / put OI bars per strike (±12 around ATM) with spot hairline and strategy-strike ticks', 'Max pain = strike minimising Σ call OI × max(K − Ki, 0) + put OI × max(Ki − K, 0)'),
  N('Structure', 'Put / call ratio for open interest and 24h volume with call/put share bars and a positioning note'),
  N('Structure', 'Gamma exposure (GEX) profile: Σ γ × OI × lot × spot² × 1% per strike (calls +, puts −) as signed bars with a zero line, net GEX and the gamma-flip strike'),
  N('Greeks', 'Position Δ and Θ across the price axis: two small charts (re-pricing every leg at 49 prices ±20% around spot on the target date) with strike dots and the spot hairline'),
  N('Greeks', 'Greeks tab restyled: hairline tiles, mono table (Θ and ν in currency), compact explanations'),
  N('Ladder', 'Step selector (250 / 500 / 1000 for BTC; ½× / 1× / 2× the strike step for other assets)', 'CG.state.ladderStep'),
  N('Ladder', "'At expiry' and 'On <target date>' P&L columns, 'Change from spot', status pills; spot row highlighted amber; breakeven rows inserted; sticky header; auto-scroll to spot"),
  N('Share', 'Share button in the pane header copies a link (origin + path + #/s/<base64url {a, l:[[type,side,strike,expiry,lots,price]…], n}>) and opens a dialog with the link, Copy button, legs and max profit / loss / POP', 'navigator.clipboard with an execCommand fallback; toasts "Link copied"'),
  N('Share', '/s/:code route (no auth): decodes the link, loads the legs into CG.analyse, toasts "Strategy loaded from link" and navigates to /analyse; logged-out visitors get a preview card (legs, max profit / loss, POP) with "Open in Analyse" and "Sign in"; invalid codes show an error card', 'Registered as <section data-route="/s/:code" data-title="Shared strategy">'),
];
add.forEach((x) => { if (!x.route) x.route = R; });
const out = a.concat(add);
fs.writeFileSync(file, JSON.stringify(out, null, 1));
console.log('entries:', out.length, 'new:', add.length);
