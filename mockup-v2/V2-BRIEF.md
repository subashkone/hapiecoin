# HapieCoin v2 · brief for the improved-UX build

We already have a faithful mock clone of hapiecoin.com (folder `<root>\clone`, published separately; DO NOT touch it). `<root>\clone-v2` is a fork of it. Your job: turn your area of the fork into the IMPROVED product ("HapieCoin v2") — same information architecture, same mock data, every existing feature still working — but with the new design system, better UX, and the new features listed for your area. The v2 output is published at a separate URL so the client can compare it side by side with the clone.

Root: `C:\Users\localPC\AppData\Local\Temp\claude\e--Subash-Projects-HapieCoin\d3615c97-79cc-4291-b058-71a5f85d2a88\scratchpad`
Read first: `<root>\clone\CLONE-BRIEF.md` (the part contract, runtime API, testing method — all still valid; paths now under `clone-v2`), then `<root>\clone-v2\shell-head.html` (the NEW tokens and component classes), `<root>\clone-v2\core.js`, and your existing part in `<root>\clone-v2\parts\`. Reference design: `<root>\direction-a.html` (the "Obsidian Desk" workspace mockup; view `<root>\direction-a-dark.png` and `<root>\direction-a-light.png` with the Read tool) and the research summary below.

## Design system (already in shell-head.html; use the variables, never hard-code colours)
- Dark-first (`html.dark` is applied by default; light variant must remain equally polished — test both).
- Ground/panel/raised separated by TONE, hairline 1px borders, radius 4–7px, no drop shadows on cards (only on popovers/dialogs).
- Fonts: Schibsted Grotesk for UI (`--font-body`/`--font-display`), DM Mono for every number/label-in-caps (`--font-mono`, `.mono`, `.micro`, `.eyebrow`). Tabular figures everywhere.
- ONE brand accent = amber `--primary`/`--spot` used only for: spot/ATM markers, active tab underline, the primary action button. Never for decoration.
- Semantic colours are separate: `--profit`/`--buy` green, `--loss`/`--sell` red, `--curve` blue for the target-date curve, `--warning`.
- Micro-labels: uppercase DM Mono 10.5px letter-spaced (`.micro`). Dense rows: 36px comfortable, 28px when `CG.state.density === 'compact'`.
- Remove any leftover "blue SaaS" styling from v1 in your part: hard-coded hsl(215 50% 55%)-style blues, rounded-lg cards with shadows, gradient heroes, emoji used as icons (replace with small inline SVG), Space Grotesk/IBM Plex font-family declarations (delete them so the tokens apply).
- Avoid the generic AI look: no purple-blue gradients, no centered-everything, no card-with-shadow grid for everything. Information design first: summary above detail, state encoded in shape (pills, stripes), charts with faint grids and emphasised endpoints.

## Research-backed UX rules (apply where relevant)
1. Calls | Strike | Puts mirrored outward: price triplet inboard, Δ and OI outboard; IV under each price; OI as inward bars; ATM as one amber rule/band; ITM as a 3–5% tint; hover reveals B/S with a lot stepper; leg rows show B10/S10 pills.
2. Chain and payoff stay side by side; summary tiles always visible.
3. Two converging payoff curves, filled zones, breakevens, expected-move band, spot marker; the date×price P&L matrix is the most valued paid feature — make it first-class.
4. Margin and IV rank shown next to POP; currency shown both per-BTC and in USD/INR where relevant.
5. Colour has fixed meaning; numbers right-aligned, fixed precision per column (Δ 2dp, IV 1dp).
6. Keyboard: Ctrl-K palette, j/k, B/S, E; every list has search + empty state; every destructive action confirms; every action toasts.

## Part contract reminders
- Same file names (`parts/NN-area.html`) and same `CG.register` keys as v1; the router, modal, toast, chrome placeholder mechanism are unchanged. `CG.state.v2 === true` in this build. `CG.state.density` ('comfortable'|'compact') is emitted as `CG.emit('density', value)` by the chrome part; react to it if you have dense tables.
- Update `features/NN-area.json`: keep all existing entries (fix wording if behaviour changed) and ADD entries for every new feature with `"new": true` and `"status": "working"`.
- Build & test: `cd <root>\clone-v2 && node assemble.js` → `hapiecoin-v2.local.html`; Playwright from `<root>\pw` as before (file URL `.../clone-v2/hapiecoin-v2.local.html#/route`). Screenshot to `<root>\clone-v2\shots\v2-<area>-*.png`, view, fix. Zero console errors in BOTH themes (`CG.theme.set('light')`).
- Final message: part path, features path, routes, list of NEW features you added, screenshots, honest gaps.
