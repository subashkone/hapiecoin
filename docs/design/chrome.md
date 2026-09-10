# Shared chrome extras (Phase 5 item 3, ADR-053)

Traceability: HC-SH-077, 078, 083 (header stats and trimming), HC-SH-086..089, 092, 093 (palette), HC-SH-101..104 (shortcuts), HC-SH-105..108 (portfolio bar), HC-WS-004, 068, 070. Reference captures: `mockup-v2/shots/v2-chrome-header-w*.png`, `v2-chrome-portfolio-bar*.png`, `v2-chrome-shortcuts-dialog*.png`, `v2-chrome-palette-*.png`.

## 1. Job
Put the three numbers a trader glances at (price, ATM IV, expected move) in the header, the state of the book (open strategies, net greeks, margin, day P&L, alerts) in a 32 px bar under the workspace, and make every action reachable from the keyboard and the palette.

## 2. Header stats (`components/header/HeaderStats.tsx`)
`ATM IV 42.4% · IV rank —` and `Exp. move · 25 Sep ± 7,693 1σ` for the chain's shown expiry (`store.expiry[asset]`, else the nearest listed), from the same chain topic the workspace subscribes to (`atmIvOf`, `expectedMove(spot, iv, dte)`). IV rank stays a dash until the IV history exists (GAPS #62). Trimming (HC-SH-083): venue and the "Command" label hide below 1500 px, expected move below 1330 px, ATM IV below 1180 px, sub-labels below 1000 px. Test ids `header-atm-iv`, `header-exp-move` (`data-state` pending / ready), `header-venue`.

## 3. Portfolio bar (`components/chrome/PortfolioBar.tsx`, mounted in the analyse layout)
```
PORTFOLIO 5 open strategies · 2 live │ NET Δ +0.00 │ NET Θ/DAY +$0.18 │ NET ν −$0.30 │ MARGIN USED $158 / $1,158 ▬▬ │ DAY P&L −$15.45 │ ALERTS 2 armed 1 fired │ … │ BASIS mark │ CCY USD
```
Sticky at the bottom (`sticky bottom-0`, the workspace reserves 82 px). Figures from `usePortfolio(strategies, book, "active")` (paper + live priced in the worker, `data-portfolio` pending / ready / empty), the paper book for day P&L (`dayPnl`), the exchange wallet for the margin denominator when connected, `useAlerts` for the counts, settings for basis and currency. Clicks: Portfolio → Paper tab · Margin → API settings · Alerts → Alerts center · Basis → P&L settings · CCY → Currency settings. Test ids `portfolio-bar`, `bar-portfolio`, `bar-net-delta`, `bar-net-theta`, `bar-net-vega`, `bar-margin`, `bar-day-pnl`, `bar-alerts` (`data-triggered`), `bar-basis`, `bar-ccy`.

## 4. Shortcuts (`lib/shortcuts.ts`, `components/shell/ShortcutsDispatcher.tsx`, `components/dialogs/ShortcutsDialog.tsx`)
Registry: `DEFAULT_SHORTCUTS` (Global: Ctrl K · ? · T · D · Esc; Analyse workspace: J / K, ↑ / ↓, B / S, Shift+B / Shift+S, E / Shift+E, Enter, A, P) plus `registerShortcut(key, description, handler, { group, always })` → unregister. The dispatcher (mounted in the header while signed in) ignores typing targets and open dialogs unless `always`; "?" opens the help (dialog kind `shortcuts`, also Settings → Keyboard shortcuts and the palette), T toggles the theme, D the density. The chain keeps handling its own keys; the help lists them. Test ids `shortcuts-dialog`, `shortcuts-group` (`data-group`), `shortcut-row`.

## 5. Palette (`lib/palette.ts`, `components/shell/CommandPalette.tsx`)
Groups Recent · Navigate · Actions · Settings, custom groups appended (`registerCommand` → unregister, `when` hides a command). Fuzzy match: substring first (word-start bonus), then subsequence; matched characters underlined (`highlight`). Recents: the last five commands run (`hapiecoin.palette.recent`). Settings commands open the six settings dialogs; "Display currency → INR / USD" writes the setting. Tab / Shift+Tab move like ↓ / ↑. Empty state "No commands match “…”" with hints (`palette-empty`). New actions: Toggle density (D), Keyboard shortcuts (?). Settings menu gains Keyboard shortcuts (?), Command palette (Ctrl K) and Market Analytics.
