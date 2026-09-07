# Options chain panel · design pass (Phase 2, item 1) · 2026-09-07

Covers GAPS #1, #2; spec HC-WS-015..023, HC-WS-027, HC-WS-107/108. Tokens and patterns from `mockup-v2/parts-src/analyse` (`.an-chain*`), ADR-003, ADR-006.

## 1. Job
Show, for one expiry, every listed strike with live call and put prices side by side so a trader can pick legs. First question answered in 2 s: **where is the market (spot / ATM) and what do the options around it cost?** → amber ATM band centred on load, spot value on it.

## 2. Layout (desktop 1440, left pane ≈ 55 % = ~790 px)
```
┌ expiry strip (chips, ‹ ›) ───────────────────────────────────────────────┐  fixed
├ tools: [±6|±12|all] [10Δ 16Δ 25Δ]  … [● Live] [⚙ columns] ──────────────┤  fixed
├──────────── CALLS · ITM shaded ────────┬────────┬──────── PUTS · Δ per contract ─┤ sticky h1
│  Δ  │  OI  │ Bid/IV │ Mark/IV │ Ask/IV │ Strike │ Ask/IV │ Mark/IV │ Bid/IV │ OI │ Δ │ sticky h2
├─────┴──────┴────────┴─────────┴────────┼────────┼────────┴─────────┴────────┴────┴───┤
│ ◄── calls scroller (scrolls x) ──────► │ 80 000 │ ◄──── puts scroller (mirrored x) ──►│
│                                         │ ATM ·  │                                     │  one shared
│  rows virtualised, ONE vertical scroll  │ spot   │  same rows, same virtualiser        │  y scroll
│                                         │ 80 250 │                                     │
├ footer: Σ Call OI · Σ Put OI · PCR · Max pain · n of 41 strikes ─────────┴─────────────┤  fixed
```
Regions: **strike column fixed** (92 px, sticky in x on both edges of the two side scrollers); **calls** and **puts** are two horizontally scrollable regions inside one vertically scrolling viewport; a scroll on one side sets the other's `scrollLeft` to the mirrored value (calls scroll right ⇔ puts scroll left) so the same column stays visible on both sides. Header rows sit inside the same scrollers (sticky top) so they move with the columns.
Narrow (390): the panel becomes a segmented view **Calls | Strike | Puts → “Calls” / “Puts” toggle** (mock's `data-mobile-view`): one side at a time, strike column pinned at the inner edge, same shared vertical scroll; the tools row collapses to the range control and the Live dot.

## 3. Hierarchy
Primary (amber, one element): the ATM band (row tint + strike in amber + "ATM · spot 80 012" micro tag). Secondary: strike column (foreground, medium weight), Mark/IV. Tertiary: Δ, OI bars, Bid/Ask, IV sub-line, header labels, footer. Green/red only: leg pills (B/S), hover [B]/[S] buttons, 24h change column when enabled, flash tint (up/down) on price change. ITM cells: 4 % foreground tint, never colour.

## 4. States
Loading: header + 12 skeleton rows at the ATM position (no spinner in the table); expiry chips disabled. Empty (expiry known, no rows): "No listed strikes for 25 Sep yet" with the venue name, no fake rows. Error (gateway `err` frame / no gateway): banner under the tools row with retry; last snapshot stays visible dimmed. Stale (socket lost or seq gap): FEED STALE pill in the header, rows keep last values at 60 % ink, "as of 12:04:31" under the footer; refresh resubscribes. Paper vs live: badge lives in the app header, not the chain. Light theme: same tokens; ATM tint `primary/.09` reads on both.

## 5. Numbers
Strike: mono, 0 dp for BTC/ETH, 2 dp XAUT (from instrument tick). Bid/Mark/Ask: 1 dp USD per contract (mark basis; header line says "USD per contract"; INR toggle re-formats via conversion rate, strikes stay USD); IV 1 dp % under the price. Δ 2 dp signed, puts negative. OI: compact (1.2k) + inward bar scaled to the expiry's max OI. Γ 6 dp, Θ 1 dp/day, ν 1 dp/pt when enabled. Right-aligned on calls, left-aligned on puts (mirror), tabular numerals everywhere. Missing quote: "—" never 0.

## 6. Interaction
Focus order: expiry strip → range control → chain (roving row focus) → footer. Keys inside the chain (no clash with v2 list ?, B, S, D, E, Shift+E, J, K, T, Ctrl+K, Esc): J/K or ↑/↓ move the highlighted strike; B/S add a call leg, Shift+B / Shift+S a put (Phase 2 item 3 wires them to the builder; item 1 only moves focus and emits the intent); E / Shift+E next / previous expiry; Home/End first/last strike; A recentres on ATM (new, documented in the help dialog). Mouse: row hover reveals [B] [S] on both sides (item 3). Wheel/trackpad horizontal on either side mirrors the other; Shift+wheel scrolls x. Palette entries: "Chain: recentre on ATM", "Chain: show all strikes", "Chain: column settings".

## 7. Traceability
HC-WS-015 sticky two-row header · HC-WS-016 range control + auto-scroll to ATM · HC-WS-017 strike cell + ATM band · HC-WS-018 price/IV cells with mirror alignment · HC-WS-019 OI bars · HC-WS-020 ITM tint · HC-WS-022 flash · HC-WS-107/108 (kept) · GAPS #1, #2. Playwright: `HC-WS-015 chain header stays pinned while scrolling`, `HC-WS-016 chain opens centred on ATM and range control filters`, `GAPS-2 calls and puts share vertical scroll and mirror horizontal scroll`, `HC-WS-017 ATM band visual (dark/light)`.

## 8. Real-data check
5 rows (XAUT daily): no scroll; band still centred; footer says "5 of 5 strikes". 500 rows: virtualised (36 px rows, ~14 rendered per 520 px), ±12 default hides the tail; "all" shows 500 with the same scroller. 6-digit BTC price (112 345.5) fits 92 px strike column at 12.5 px mono; price cells `minmax(64px,1fr)` hold "12345.5" and "48.2 %". 3-digit XAUT (4 398.79): strike column shows 2 dp. No positions: no pills, no stripes. Long strategy names never render in the chain (right pane). **Failure point:** below 720 px pane width the 11 columns need > 100 % width; fix = the two side scrollers (this design) rather than shrinking columns below 64 px; below 560 px switch to the single-side view.

## 9. Generic-pattern check
No card grid, no tiles; one accent (ATM); one primary control per row (B/S appear only on hover); header labels carry basis ("Δ per contract", "USD per contract"); OI bars carry information (relative size), no decorative icons; the gear is the only icon and opens column settings.

## 10. Confusion check
1. "Which side is calls?" → sticky h1 band names CALLS left / PUTS right and mirror alignment (calls right-aligned toward the strike, puts left-aligned) keeps the eye on the strike. 2. "Is this price per contract or per coin?" → header line "USD per contract · lot 0.001 BTC" and the currency toggle re-labels to INR. 3. "Is the data live?" → Live dot in the tools row + FEED LIVE/STALE in the header; stale rows dim and show "as of" time, so old numbers never look current.

---

# Item 2 · column set and Column Settings dialog · design pass · 2026-09-07

Covers HC-WS-010..014, HC-WS-021, HC-WS-073 (palette toggle). Mock reference: `mockup-v2/parts-src/analyse/30-core.js.html` (COLS, colState, renderCs), styles `.an-cs-*`.

## 1. Job
Let a trader choose which figures sit next to each strike and in what order, without ever losing the strike column. First question in 2 s: **which of these numbers do I want next to the strike?** → the dialog lists them by group with a switch each and a live "n of 13 columns visible" counter.

## 2. Layout
Chain (desktop 1440): unchanged from item 1; the visible column list is `order.filter(visible)`, laid out **from the strike outward** on the puts side and mirrored on the calls side, so the first column in the order always touches the strike on both sides. Track width = Σ column widths (fixed px per column) and the mirrored scroll from item 1 engages when it exceeds the side viewport. Column widths: Ask/Mark/Bid 68, OI 68, Δ 56, Γ 72, Θ 60, ν 60, Vol 64, Bid qty / Ask qty 64, 24h 60, Last 64.
```
┌ Column Settings ─────────────────────────────── 5 of 13 columns visible ┐
│ [Show / Hide] [Reorder]            Essentials · Show all · Hide all · Reset│
│ MARKET DATA                                                              │
│  Ask (Price/IV)              [●  ]     Bid Qty                   [  ○]    │
│  Mark (Price/IV)             [●  ]     Ask Qty                   [  ○]    │
│  …                                                                        │
│ GREEKS   Delta [●] Gamma [○] Theta [○] Vega [○]                            │
│ ACTIVITY 24h Chg [○] Last [○]                                             │
│ OHLC     Open · High · Low  — arrives with candle data (Phase 5)  (muted) │
│                                                     [Done]                │
└──────────────────────────────────────────────────────────────────────────┘
Reorder tab: numbered list, ⋮⋮ grip, label, "hidden" badge when off, ▲ ▼ buttons; drag to reorder.
```
Narrow (390): the dialog is full-height sheet, one column of rows, tabs stay on top; the chain's single-side view shows the same ordered columns.

## 3. Hierarchy
Primary: none in the dialog (a settings surface; "Done" is a plain outline button, the switches carry the meaning). In the chain the ATM band stays the only amber. Secondary: group titles (micro), counter. Tertiary: hints. Green/red: only the 24h Chg cell (signed) and the existing flash tint; no colour on switches beyond the design-system switch.

## 4. States
Loading: none (state is local + persisted). Empty (Hide all): each side shows one cell "no columns" in muted text; strike column stays; counter reads "0 of 13". Error: none possible. Stale chain: unchanged from item 1. Light/dark: dialog uses the shared Dialog tokens. Persisted layout from an older version: unknown ids dropped, missing ids appended, so the list is always complete.

## 5. Numbers
Γ 6 dp; Θ 1 dp per day (negative for long); ν 1 dp per point of IV; Volume and quantities compact ("1.2K") in contracts; 24h Chg signed % 2 dp, green/red; Last 1 dp USD per contract. All right-aligned on calls, left-aligned on puts (mirror). Missing → "—". Header labels: Γ, Θ/d, ν, Vol, Bid qty, Ask qty, 24h, Last; hover title spells the unit.

## 6. Interaction
Gear button in the chain tools (right, next to Live) opens the dialog; Esc closes. Focus order: tabs → quick buttons → rows (each row is a labelled switch, Space toggles) → Done. Reorder tab: ▲/▼ buttons move (keyboard-safe); drag with pointer as a convenience. Every change applies to the chain immediately (no Save). Palette: "Chain: column settings" opens the dialog; "Chain: toggle Greeks columns" (HC-WS-073) shows/hides Γ Θ ν together. Shortcut: none new (G is unused in the v2 list but stays reserved; the palette entry suffices).

## 7. Traceability
HC-WS-010 gear → dialog · HC-WS-011 grouped switches + counter · HC-WS-012 quick buttons · HC-WS-013 reorder tab · HC-WS-014 persistence · HC-WS-021 optional columns · HC-WS-073 Greeks toggle. Playwright: `HC-WS-010 gear opens Column Settings and toggles apply to the chain`, `HC-WS-013 reorder moves a column next to the strike on both sides`, `HC-WS-014 column layout survives a reload`. Deviation to record in GAPS: Open / High / Low are not in the gateway quote today (the option ticker adapter maps no candle fields), so the OHLC group is shown muted with the note above.

## 8. Real-data check
5 rows: unchanged. 500 rows with 13 columns: 13 × ~64 px ≈ 830 px per side → mirrored scroll carries it; virtualiser unaffected (cells per row 26). 6-digit BTC price fits the 68 px price cells at 12 px mono ("112,345.5" is 9 chars ≈ 60 px); 3-digit XAUT fine. Long strategy names: not in this surface. No positions: no change. Failure point: with all 13 columns and the 560 px single-side view, the track (≈830 px) is wider than the viewport, so the detached scrollbar and wheel must work in single-side mode too (they do: same hook).

## 9. Generic-pattern check
No cards; one list per group; quick buttons are text buttons in one row, none primary; the only icon is the gear (opens settings) and the ⋮⋮ grip (drag handle). Each column answers a trader's question, and the counter tells them what they turned off.

## 10. Confusion check
1. "Which side does the order apply to?" → the Reorder hint says "from the strike outward, mirrored on the calls side", and the list is numbered 1 = nearest the strike. 2. "Did I lose the strike column?" → it is not in the list at all; Hide all still shows strikes with a "no columns" cell. 3. "Is Theta per day or per year?" → header "Θ/d" and the hover title; the design rule that every number carries a unit.
