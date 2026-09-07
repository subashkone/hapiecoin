# HapieCoin v2 mock (improved UX build)

Fork of ../mockup-clone with the "Obsidian Desk" design system and new features (command palette Ctrl-K, alerts center, portfolio bar, Scenarios/Vol/Structure tabs, strike finder, share links /s/:code, journal, ticket block, ranked templates, compare mode, watchlists, admin bulk actions, invoice preview).

- Open `hapiecoin-v2.local.html` in a browser. Dark by default; press T for light, D for density, Ctrl-K for the palette, ? for shortcuts.
- Rebuild: `node assemble.js` (some parts are generated from source folders: chrome-src/build-chrome.js, public-src/build-public.js, parts-src/analyse (concatenate), src-trd/build.sh, adm-src/merge-v2.js, _analytics-src/build.js).
- QA: `node qa.js dark|light` (Playwright required). Inventory: `node inventory.js`.
- The original clone is untouched in ../mockup-clone.
