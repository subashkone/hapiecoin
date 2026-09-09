# Assistant and product tour · design note (Phase 4 item 5a)

Traceability: HC-SH-057..063 (assistant), HC-SH-064..076 (tour), HC-SH-110..112 (explainer, canned answers, palette step). ADR-036.

## 1. Job
The assistant answers "how do I…" without leaving the screen; the tour turns a first session into a completed paper trade. Within two seconds a new trader must see *where to click next* (tour) or *the answer to the question they typed* (assistant).

## 2. Layout
```
1440 ─────────────────────────────────────────────────────────────────────────
│ header  [asset-select]                                 [Ctrl K] [gear ⚙]     │
│ ┌ workspace tabs: Chain* | Builder | Paper* | Live | Journal ──────────────┐ │
│ │        chain / builder                       │ payoff-panel*            │ │
│ │                                              │                          │ │
│ └──────────────────────────────────────────────┴──────────────────────────┘ │
│ portfolio bar ────────────────────────────────────────────── (💬)*  bottom 56 │
```
Tour: full-viewport SVG mask (66 % dark) with a rounded cut-out around the anchor (6 px pad), a 2 px accent ring, and a 320 px popover placed below the anchor, else above, else beside; centred when a step has no anchor (welcome). Assistant: 40 px round launcher, fixed bottom-right (16 px; 56 px up on /analyse to clear the portfolio bar), draggable anywhere; a 340 px panel opens above it (header, scrolling transcript ≤ 320 px, input row, "Need a human?" footer). At 390 px both shrink to `calc(100vw − 16px)`; the popover keeps 8 px margins and the tour's paper steps scroll the card into view first.

## 3. Hierarchy
Primary: the tour's Next/Start/Done button (only amber element while the tour is open); the assistant's Send. Secondary: Previous, ✕, chips. The cut-out itself is the emphasis; nothing else glows. Green/red never appear in either surface (P&L stays in the panels beneath).

## 4. States
- Tour: centred (no anchor), anchored, waiting-for-you (steps 4, 7, 8, 9, 10 advance on app events but Next still works), complete (toast "Tour complete" with the replay hint), dismissed (Escape / ✕, no toast). Leaving /analyse ends it. Runs once per browser (`hapiecoin.tour`), replay from Settings → Take a tour or the palette.
- Assistant: closed, open-greeting (chips), typing (33 ms slices, Send disabled), answered, visitor mode (signed out: header says "Limited visitor mode", every answer ends with the sign-in note). Route change or sign-out clears the transcript.
- Light and dark from the popover tokens; no theme-specific colours.

## 5. Numbers
The explainer prints money in the trader's display currency via `fmtMoney` (signed for P&L and Greeks), strikes grouped via `fmtStrike`, breakevens with "% from spot" (one decimal), POP rounded to whole percent, Delta to three decimals. Unlimited profit/loss prints the word, never ∞.

## 6. Interaction
Tour: → / Next, ← / Previous, Esc closes (captured before any dialog's own Escape), popover keeps pointer events while a Radix dialog has the page inert. Tab switches follow the step (`tab`). Anchors: `data-tour` = asset-select, options-chain, strategy-legs/add-leg-button, payoff-panel, paper-trade-button, trade-modal/trade-confirm-button, save-dialog, trade-preview, paper-tab, paper-pnl, paper-stop, settings-menu, chat-launcher, command-palette. Events: `hc-tour:leg-added` (store addLeg), `trade-mode-open`, `save-dialog-open`, `trade-preview-open`, `paper-started` (TradeFlow). HapieCoin asks for a name only after Trade now on an unnamed strategy, so step 9 (Review and start) jumps one on `save-dialog-open` and two on `paper-started`.
Assistant: click or Enter/Space on the launcher toggles; a pointer move over 5 px is a drag (position saved to `hapiecoin.assistant-pos`); Enter sends; Esc closes. Palette: "Take a tour" (act:tour, navigates to /analyse first), "Ask the HapieCoin Assistant" (act:assistant). Settings menu: "Take a tour" under Preferences.

## 7. Traceability and tests
Unit: `lib/tour.test.ts`, `lib/assistant.test.ts`, `shell/Tour.test.tsx`, `shell/Assistant.test.tsx`. E2E: analyse.spec "HC-SH-064..076 product tour" (a real paper trade driven by the tour, once-only, menu and palette replay), "HC-SH-057..063 / HC-SH-110 assistant", public.spec "HC-SH-057 / HC-SH-063 visitor mode". Visual: `analyse-tour-welcome-*`, `analyse-tour-*`, `analyse-assistant-*`.

## 8. Real-data check
Explainer with 10 legs prints ten bullet lines then the summary; the transcript scrolls. A 6-digit BTC strike ("120,000") and a 3-digit XAUT strike ("2,650") both fit the bullet. Long strategy names wrap in the first line. No legs: guidance, not an error. Anchors missing (e.g. paper-stop before any trade): the popover centres and the ring hides rather than pointing at nothing; the alt anchor covers the empty Builder (add-leg-button).

## 9. Generic-pattern check
No feature tiles, one primary per surface, chips are questions traders actually ask, the launcher icon is the only icon and it means "chat".

## 10. Confusion check
- "Is this financial advice?" Header and every explainer end with "not financial advice"; answers describe the platform only.
- "Did the tour place a real order?" Step 7 says "no real orders"; step 8 explains Live needs a connected key and places real orders, so the trader keeps Paper.
- "Why did the tour skip a step?" The name dialog only appears for unnamed strategies; a named one jumps straight to the running-trade step, whose copy describes what is on screen.
