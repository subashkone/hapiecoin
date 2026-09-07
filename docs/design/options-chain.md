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
