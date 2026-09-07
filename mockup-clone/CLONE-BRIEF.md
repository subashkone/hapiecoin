# CoinGreeks clone · build brief for screen agents

We are building a faithful, fully navigable, mock-data clone of https://coingreeks.com (a crypto options strategy platform for Delta Exchange India users). The whole app is ONE HTML page with hash routing. You build a group of screens as an HTML "part" that the assembler concatenates into the page.

Goal: pixel-faithful in spirit to the ORIGINAL (light theme by default, blue primary, shadcn-style cards and tables, IBM Plex Sans body, Space Grotesk headings, JetBrains Mono numbers). Every link/button/tab/dialog on the original must exist and DO something (open a dialog, switch a tab, mutate mock data, show a toast). No lorem, no "coming soon" unless the original says so.

## Paths
- Scratchpad root: `C:\Users\localPC\AppData\Local\Temp\claude\e--Subash-Projects-CoinGreeks\d3615c97-79cc-4291-b058-71a5f85d2a88\scratchpad`
- Clone folder: `<root>\clone`
  - `shell-head.html` — the page head: fonts + base CSS (tokens, utilities, components). READ IT to know the available classes (.btn .btn-primary .btn-outline .btn-ghost .btn-sm .card .card-header .card-title .card-content .input .select .textarea .label .field .badge .badge-* .tabs .tab .tabs-line .table .table-compact .switch .stat .alert .empty .menu .kbd .mono .text-muted .text-profit .text-loss .grid .grid-2/3/4 .flex .gap-* .p-* etc.).
  - `core.js` — runtime: `CG.mock` (all shared mock data), `CG.fmt` (number/money/date formatting), `CG.pricing` (Black-76), `CG.chain(asset, expiry)` (full options chain rows), `CG.quote(asset, expiry, strike, 'CALL'|'PUT')`, `CG.analyze(legs, asset, {targetDays, ivShift})` (payoff points, maxProfit/maxLoss, breakevens, POP, greeks, margin), `CG.TEMPLATES` (28 templates) + `CG.templateLegs(tpl, asset, expiry)`, `CG.state` (currency, lotSizes, pnlBasis, asset, expiry, exchangeConnected…), `CG.register(route, {init(root, params, query), show(root, params, query), hide(root)})`, `CG.navigate(path)`, `CG.modal.open(elOrHtml, {title, description, size:'sm'|'lg'|'xl', onClose})` → handle with `.close()`, `CG.modal.confirm({title, description, confirmText, variant:'destructive'})` → Promise<boolean>, `CG.toast({title, description, variant:'destructive'|'success'})`, `CG.menu(anchorEl, innerHtml)` (dropdown; use `.menu-item`, `.menu-label`, `.menu-sep`), `CG.theme.toggle()/get()`, `CG.auth.login()/logout()/isAdmin()`, `CG.on(event, fn)/CG.emit` (events: 'tick' every 2.5s with live prices, 'theme', 'auth', 'route', plus any you define), `CG.h(html)` → element, `CG.esc(str)`, `CG.$`, `CG.$$`, `CG.delegate(root, event, selector, fn)`, `CG.NOW` (mock clock: 06 Sep 2026 14:30), `CG.ASSETS`, `CG.EXPIRIES`. READ core.js fully before building.
  - `parts/` — put your output here as `NN-<area>.html` (the NN prefix is given in your task). Parts are concatenated in NN order inside `<div id="cg-app">` AFTER core.js has run.
  - `features/` — put your feature inventory JSON here as `<area>.json`.
  - `assemble.js` — run `node assemble.js` from the clone folder to build `coingreeks-clone.html`. Then screenshot it with Playwright (see below) to verify your screens.
- Reference material (READ the ones for your screens):
  - `<root>\routes-report2.md` — per-route list of every UI string found in the production bundle (labels, headings, placeholders, toasts, dialog titles). Your screens must contain these strings where they belong.
  - `<root>\anchors-trim.md` — strings around specific dialogs/panels (settings dialogs, strategy legs panel, trade preview, strategy details, tour steps, column settings, chart layers, analytics panel, templates modal…).
  - `<root>\chunks-report.md` — strings of the lazy-loaded Market Analytics sections (/analytics/*: coinglass home, liquidations, derivatives, options, etf, whales, sentiment, markets).
  - Screenshots of the real product: `<root>\feature-payoff-diagram-Bd1wZ0T5.png` (the /analyse workspace: header, left tabs, expiry strip, chain, right tabs, payoff), `<root>\feature-options-chain-DoeAi24A.png` (older chain + payoff), `<root>\feature-strategy-builder-BkglL8Tp.png` ("Select Option from Chain" modal), `<root>\feature-paper-trading-B95JFCKD.png` (Strategy Details modal), `<root>\pub_.png` (landing page, full), `<root>\pw\analyse-1.png` (auth page), `<root>\pw\pub_payoff-preview.png` (new payoff chart component with layers, SD bands, OI bars, target sliders). Use the Read tool on PNGs to view them.

## Part file contract (STRICT)
```html
<!-- one or more screens -->
<section class="screen" data-route="/subscription" data-title="My Subscription" data-auth="user">
  <div data-cg="app-header"></div>        <!-- shared logged-in header (rendered by the chrome part); omit on public pages -->
  ... your markup ...
  <div data-cg="footer"></div>            <!-- shared footer, optional -->
</section>
<style>
  /* scope EVERYTHING to your screens, e.g. */
  [data-route="/subscription"] .plan-card{...}
</style>
<script>
  CG.register('/subscription', {
    init(root, params, query){ /* runs once, build DOM, bind events */ },
    show(root, params, query){ /* runs every time the route is shown; re-render lists from CG.mock */ }
  });
</script>
```
Rules:
- `data-route` patterns: exact paths or `:param` segments (e.g. `/terminal/coin/:symbol`). `data-auth="user"` redirects logged-out users to /auth; `data-auth="admin"` requires admin. `data-redirect="/x"` makes a screen redirect.
- Sub-panels of another agent's screen register as `CG.register('/analyse:yourkey', {...})` — handlers whose key starts with the route + ':' are also called when that route shows.
- Links: use `href="#/path"` (the router intercepts) or `data-nav="/path"` on any element.
- Dialogs: build them as hidden elements inside your section (`hidden` attribute) and open with `CG.modal.open(el, {title,…})`; the element is moved into the overlay and put back on close. Or pass an HTML string.
- Never add `<link>`/`<script src>`/images from the network; inline SVG icons only (simple paths), no emoji as icons except where the original uses emoji (e.g. "🟢 Live", "📄 Paper").
- Charts: inline SVG generated in JS (line/area/bar), or `<canvas>`. Keep them theme-aware by using `hsl(var(--profit))`, `hsl(var(--border))`, `currentColor`, etc.
- Mock data: use `CG.mock.*` for shared entities (user, plans, coupons, users, strategies, coins, exchanges, etfs, fearGreed, liqHistory, lsHistory, oiHistory, fundingHistory, priceHistory(sym,n), whaleAlerts…). You may ADD your own data to `CG.mock` (e.g. `CG.mock.sentimentExtra = …`) but do not rename existing fields. Mutations (create/edit/delete) should update `CG.mock` in memory so other screens see the change.
- Theme: the page has a light default and a `.dark` class on `<html>`; use only the CSS variables from shell-head.html so both themes work. Test both.
- Every interactive element must do something: at minimum `CG.toast(...)`. Prefer real behaviour: filter lists, paginate, open the right dialog, add/remove items, validation messages that match the original strings (e.g. "Plan name is required", "Code is required").
- Keep the visual style of the ORIGINAL (see screenshots): white cards on a very light grey ground, 1px borders, 8-10px radii, blue primary buttons, small uppercase muted labels, green/red for buy/sell and profit/loss, mono for numbers.
- Do not use `id` attributes that could collide: prefix ids with your area (e.g. `sub-plan-list`). Scope CSS under your `[data-route]`.
- The assembled page must have zero console errors. After building, run this check from `<root>\pw`:
  ```js
  // save as check-<area>.js and run: node check-<area>.js
  const { chromium } = require('playwright');
  (async () => { const b = await chromium.launch({ channel: 'chrome', headless: true }); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
    const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto('file:///C:/Users/localPC/AppData/Local/Temp/claude/e--Subash-Projects-CoinGreeks/d3615c97-79cc-4291-b058-71a5f85d2a88/scratchpad/clone/coingreeks-clone.html#/YOUR/ROUTE');
    await p.waitForTimeout(1500); await p.screenshot({ path: '../clone/shots/<area>-<name>.png', fullPage: true });
    console.log('errors:', errs); await b.close(); })();
  ```
  Look at your screenshots with the Read tool and fix layout problems. Test dark mode too (`await p.evaluate(() => CG.theme.set('dark'))`). Note: the assembler output includes ALL parts present at build time; other agents' parts may be missing or in progress — ignore their screens, but your part must not break if theirs are absent (guard `CG.chrome[...]` overrides, never assume another agent's DOM exists).

## Feature inventory JSON (`features/<area>.json`)
An array; one entry per feature/control/behaviour (be exhaustive — this is the client's record of "each and every feature"):
```json
[{"route":"/subscription","screen":"My Subscription","feature":"Billing interval toggle (Monthly / Quarterly / Yearly)","how":"Toggles prices and feature limits on every plan card","status":"working","evidence":"bundle strings: Monthly, quarterly, Semi-Annually, yearly"}]
```
`status` is one of `working` (interactive in the mockup), `static` (rendered from mock data, not interactive), `inferred` (behaviour reconstructed from bundle strings, not directly observed).

## Final message from you
Report: the part file path, features json path, the list of routes you registered, screenshots taken, remaining known gaps (be honest), and any `CG.chrome` overrides or `CG.mock` additions you made.
