# CoinGreeks mock clone (build output)

- `coingreeks-clone.local.html` — open this file directly in a browser (double-click). Hash routes: `#/`, `#/auth`, `#/analyse`, `#/subscription`, `#/referrals`, `#/admin/users`, `#/analytics/coinglass`, `#/terminal`, `#/features` (feature inventory).
- `coingreeks-clone.html` — the same page without the html/head/body wrapper (the version published as a Claude artifact).
- `feature-inventory.html` — standalone document listing every feature per screen.
- Rebuild: `node assemble.js` (concatenates `shell-head.html` + `core.js` + `parts/*.html` + `features/*.json`). QA sweep: `node qa.js light|dark` (needs Playwright in `../pw`). Inventory doc: `node inventory.js`.
- `parts/` — one file per area (00 chrome, 10 public, 20 analyse, 21 trading, 30 account, 40 admin, 50 analytics, 60 terminal). `features/` — inventory JSON per area.
- `routes-report2.md`, `chunks-report.md`, `anchors-trim.md` — strings extracted from the real production bundle, used as the source of truth for labels and flows.
- `shots/` — screenshots taken during the build and QA.
