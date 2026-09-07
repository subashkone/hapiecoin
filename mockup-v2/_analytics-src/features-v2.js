// Updates features/50-analytics.json + features/60-terminal.json for v2: rewords changed v1 entries, appends new entries (new:true). Idempotent.
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'features');
const load = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const save = (f, a) => fs.writeFileSync(path.join(dir, f), JSON.stringify(a, null, 1));
const patch = (arr, match, upd) => { const x = arr.find((e) => e.feature.startsWith(match)); if (!x) { console.warn('no match', match); return; } Object.assign(x, upd); };
const N = (route, screen, feature, how, evidence) => ({ route, screen, feature, how, status: 'working', new: true, evidence: evidence || 'v2 upgrade' });
// ---------------- 50-analytics ----------------
let a = load('50-analytics.json');
if (!a.some((x) => x.new)) {
  patch(a, 'Analytics header: CG·Analytics mark', { feature: "Shared header: HapieCoin mark + 'Market Analytics' title", how: "CG.chrome['analytics-tabs'] renders the v2 shared header (same header as /terminal): logo, 'Market Analytics' title, '← Analyse' link, Live pill, coin search, Ctrl K palette button, theme toggle" });
  patch(a, 'Independent dark/light theme toggle', { feature: 'Theme toggle (sun/moon) in the shared header', how: 'Button calls CG.theme.toggle(); the analytics app now follows the page theme (html.dark). The private cg2-theme toggle and localStorage key were removed; both light and dark are token-based' });
  patch(a, 'Section tabs: Markets Hub, Futures', { feature: 'Section switcher spanning both apps: Hub · Futures · Markets · Derivatives · Options · ETF · Liquidations · Whales · Sentiment · Terminal ▾', how: 'One tab bar under the header; the active tab gets an animated amber underline (section-tab-indicator); /analytics/coin/* highlights Markets; Terminal ▾ opens a grouped dropdown of every terminal page and is active on /terminal/*' });
  patch(a, 'Reusable inline-SVG chart helper', { how: 'CG2.chart (shared with /terminal): line/area/bars/stacked/dual axis/log/regions/bands + v2 timeframe chips, toggleable legend, crosshair tooltip with all series, hover dots, last-value tags, faint horizontal grid only, 10.5px DM Mono axis labels, skeleton first paint and empty state. Colours only from tokens: price = foreground, OI/secondary = --curve, up/down = profit/loss, accent marks = --primary' });
  patch(a, 'DataTable: sortable headers, sticky header', { how: 'CG2.table (shared with /terminal): sticky header inside a scroll container, sortable columns, right-aligned DM Mono numbers, heat cells for %, plus v2 toolbar: per-table search (auto when > 15 rows), row count, Columns ▾ visibility menu, CSV copy, watchlist star column, compare checkbox column; 36px rows (28px when CG.state.density === "compact")' });
  const S = '/analytics/*', SS = 'Market Analytics shell';
  a = a.concat([
    N(S, SS, 'ONE unified skin on the shell tokens (both apps)', 'The private cg2 palette (teal accent, Inter/JetBrains fonts, cg2-* variables) was deleted; every colour comes from --background/--card/--border/--foreground/--muted-foreground/--profit/--loss/--primary/--curve and fonts from --font-body/--font-mono; dark and light both polished (tested)'),
    N(S, SS, 'Terminal ▾ dropdown in the section switcher', 'Lists every terminal page grouped (Markets / Derivatives / ETF / On-chain / Indicators) via CG.menu; the current page is highlighted in amber'),
    N(S, SS, 'Coin search → coin page (context aware)', 'Header search opens /analytics/coin/SYM (in the terminal app the same header opens /terminal/coin/SYM); top-8 matches by symbol/name, ↑↓/Enter/Esc, starred coins show a star, hint row explains the keys'),
    N(S, SS, 'Ctrl K palette button', 'Header kbd button opens the command palette (CG.palette.open()); falls back to dispatching Ctrl+K and a hint toast if no palette is present'),
    N(S, SS, 'Palette commands registered', 'CG2.registerPalette registers every analytics + terminal page ("Market Analytics · Hub", "Terminal · Funding Rates"…), "Compare coins…" (opens /analytics/markets?compare=1) and "Add to watchlist → BTC/ETH/SOL/BNB/XRP/DOGE/ADA/AVAX/LINK/PEPE" with CG.palette.register (guarded, also exposed via CG.commandProviders)'),
    N(S, SS, 'Chart timeframe chips 1D · 7D · 30D · 90D · 1Y', 'CG2.tfChart/tfSeries: the mock series is sliced when it covers the range, otherwise regenerated with a seeded random walk (CG.rng) anchored on the current value and scaled by sqrt(step); daily/8h sources keep their native step (180D for cycle charts); the choice is remembered per chart'),
    N(S, SS, 'Toggleable chart legend', 'Click a legend item to hide/show that series (strikethrough when off); axis rescales; hiding everything shows an inline empty state'),
    N(S, SS, 'Crosshair tooltip with all series values', 'Dashed crosshair + hover dots on every line series; the tooltip lists every visible series with its own formatter (plus extra rows like Ratio/Total/Net)'),
    N(S, SS, 'Last-value tag at the right edge', 'Each line/area series ends with a dot and a coloured value pill on the right edge (collision-nudged; right padding grows to fit)'),
    N(S, SS, 'Faint horizontal grid + 10.5px mono axis labels', 'Grid lines only on the y axis in --border; all axis labels DM Mono 10.5px muted'),
    N(S, SS, 'Chart loading skeleton and empty state', 'First paint shows a shimmer skeleton for one frame (also gives the chart its measured width); series with no data render a "No data" empty state'),
    N(S, SS, 'Per-table search', 'Tables with more than 15 rows (or search:true) get a search box that filters by symbol/name while keeping focus and caret'),
    N(S, SS, 'Columns ▾ visibility menu on screeners', 'Checkbox menu (stays open while toggling) + "Show all columns"; used on the hub, markets screener, RSI screener, ETF funds, terminal dashboard/spot/liquidations'),
    N(S, SS, 'CSV copy button', 'Copies the visible (filtered + sorted) rows and visible columns as CSV to the clipboard (execCommand fallback) and toasts the row count'),
    N(S, SS, 'Compact density', "Rows drop from 36px to 28px when CG.state.density === 'compact' (reacts to CG.emit('density'))"),
    N(S, SS, 'Watchlist star on coin rows', 'Star column on every coin table toggles CG.state.watchlist (persisted with CG.saveState); toasts; strips and filters update through the "watchlist" event'),
    N(S, SS, 'Compact arc gauges with the amber needle', 'CG2.gauge: 180° track with semantic segments (loss/warning/muted/profit) and an amber --primary needle + hub; inline variant inside tiles (Alt season, Fear & Greed, Whale Index), large variant with a scale on Futures/Sentiment'),
    N('/analytics/coinglass', 'Markets Hub', 'Watchlist strip', 'Cards for each starred coin (price, 24h heat, 7D sparkline coloured by 7d change, remove star); click opens the coin; empty state links to the screener; "Manage in Markets →"'),
    N('/analytics/coinglass', 'Markets Hub', 'Inline gauges in the Altcoin Season and Fear & Greed tiles', 'Compact arc gauge with amber needle beside the value'),
    N('/analytics/coinglass', 'Markets Hub', 'Main table: star · search · Columns ▾ · CSV', 'Derivatives/Spot/Memes/L1L2 tabs share the upgraded table; sticky header inside a 640px scroll area'),
    N('/analytics/overview', 'Futures overview', 'Timeframe chips on BTC Price & OI and Long/Short charts', '1D slices the hourly mock; 7D–1Y regenerate anchored series'),
    N('/analytics/overview', 'Futures overview', 'Compact Fear & Greed gauge', 'Large arc gauge with amber needle, label and scale, plus yesterday/7d/30d values and a 30-day sparkline'),
    N('/analytics/markets', 'Futures Markets Screener', 'Compare mode (up to 3 coins)', 'Cmp checkbox column; picking 1–3 coins shows a Compare panel above the table: normalised price lines (base 100, timeframe chips 1D–1Y, base-100 reference line) and a side-by-side stats table (Price, 24h/7d %, cap, volume, OI, OI 24h %, funding, L/S, liq, RSI) with the best value highlighted; ✕ removes a coin, Clear empties; a 4th coin is refused with a toast; state in CG.state.compare is shared with /terminal/spot; ?compare=1 opens the panel with a hint'),
    N('/analytics/markets', 'Futures Markets Screener', 'Watchlist filter chip', '★ Watchlist chip limits the screener to starred coins (empty state when none); stars in rows toggle the list'),
    N('/analytics/markets', 'Futures Markets Screener', 'Hidden columns 7d %, Funding, Liq 24h', 'Available through Columns ▾; CSV export respects visible columns'),
    N('/analytics/derivatives', 'Derivatives', 'Timeframe chips on all five charts', 'Close price / OI / L/S / Basis: 1D–1Y; Funding: 7D–1Y at the native 8h step'),
    N('/analytics/options', 'Options', 'Max pain as the amber accent line', 'Call/put OI bars in profit/loss tints, Max Pain dashed in --primary with per-expiry labels; CSV on the exchange table'),
    N('/analytics/etf', 'ETF', 'Timeframe chips on Net Flows and Cumulative Net Flow', 'Net flows 7D/30D/90D/1Y (daily bins, generated flows for ranges beyond the mock), cumulative 30D/90D/1Y; funds table has Columns ▾ + CSV'),
    N('/analytics/liquidations', 'Liquidations', 'Top-coins table search + CSV', 'Filter box inside the table toolbar replaces the old panel input; window chips 1h/4h/12h/24h retained'),
    N('/analytics/whales', 'Whales', 'Whale Index gauge tile + timeframe chips', 'New tile with a compact arc gauge (Quiet/Active/Frenzy); the Whale Index chart gets 1D–1Y chips; positions/reserves tables get CSV'),
    N('/analytics/sentiment', 'Sentiment', 'Timeframe chips on F&G (7D–1Y), AHR999/Puell (30D/90D/180D) and Coinbase Premium (1D/7D/30D)', 'Cycle charts keep 180D as the default; Pi Cycle/Rainbow/2Y MA stay 180D'),
    N('/analytics/sentiment', 'Sentiment', 'RSI screener: star · search · Columns ▾ · CSV', 'Upgraded shared table'),
    N('/analytics/coin/:symbol', 'Coin analytics', 'Watch and Compare chips in the coin header', '★ Watch toggles the watchlist; Compare adds the coin to CG.state.compare and opens /analytics/markets?compare=1'),
    N('/analytics/coin/:symbol', 'Coin analytics', 'Timeframe chips on Price & OI, L/S, Liquidations and Funding', 'Per-coin seeded series; exchange tables get CSV')
  ]);
  save('50-analytics.json', a);
}
// ---------------- 60-terminal ----------------
let t = load('60-terminal.json');
if (!t.some((x) => x.new)) {
  patch(t, 'Terminal shell: sticky header', { how: "Shared v2 header (CG.chrome['terminal-header'] → CG2.header, identical to /analytics, Terminal ▾ tab active) + restyled 222px sticky sidebar (CG.chrome['terminal-sidebar']) + content (max-width 1600px) + footer; everything scoped under .terminal.cg-scope.cgx and built only on the shell tokens" });
  patch(t, 'Header logo "Market Analytics"', { feature: "Header title 'Market Analytics' + HapieCoin mark", how: 'Shared header: logo links to #/analyse, the title reads Market Analytics; the terminal keeps its own left sidebar' });
  patch(t, 'Header coin search', { feature: 'Header coin search "Search coin…"', how: 'Shared header search; in the terminal Enter/click opens /terminal/coin/SYM (hint row says "open in terminal")' });
  patch(t, 'Header "Live" indicator', { how: 'Live pill (green dot) in the shared header, hidden on small screens' });
  patch(t, 'Header "Markets Hub" button', { how: 'Replaced by the Hub tab of the shared section switcher (and the sidebar "Markets Hub ↗" item)' });
  patch(t, 'Header "App" button', { feature: 'Header "← Analyse" link', how: 'Shared header link back to the options app (#/analyse)' });
  patch(t, 'Terminal theme toggle', { feature: 'Theme toggle (sun/moon icon)', how: 'Calls CG.theme.toggle(); the terminal now follows the page theme (html.dark) — the private terminal theme and cg2-theme localStorage key were removed' });
  patch(t, 'Active nav highlight', { how: 'Active sidebar item gets an amber (--primary) 2px left rule, foreground text and a muted background; section labels use the .micro style' });
  patch(t, 'Shared SVG chart helper', { how: 'MA.chart now adapts its spec to CG2.chart, the single chart helper shared with /analytics (timeframe chips, toggleable legend, crosshair tooltip, last-value tags, faint grid, skeleton)' });
  patch(t, 'Sortable tables (all terminal tables)', { how: 'MA.table adapts to CG2.table: sticky headers, sortable, mono right-aligned numbers, heat cells, search, Columns ▾, CSV, star, compare checkbox' });
  const T = '/terminal', TS = 'Market Analytics terminal';
  t = t.concat([
    N(T, TS, 'Unified skin with /analytics', 'Private ma-* palette deleted; tiles/panels/chips/tables/charts share the .cgx classes and shell tokens; light and dark tested'),
    N(T, TS, 'Shared section switcher with Terminal ▾', 'The terminal shows the same Hub … Sentiment tabs as /analytics; Terminal ▾ is active (amber underline) and drops down the grouped terminal pages'),
    N(T, TS, 'Sidebar restyle', 'Section labels .micro, 30px items, amber left rule on the active item, "Markets Hub ↗" external marker; mobile drawer retained'),
    N(T, TS, 'Follows page theme + density', "A.applyTheme/A.applyDensity run on every show; rows compact at 28px when CG.state.density === 'compact'"),
    N(T, 'Dashboard', 'Watchlist strip on the dashboard', 'Same strip as the hub (cards → /terminal/coin/SYM, remove star, empty state, "Manage in Spot Markets →")'),
    N(T, 'Dashboard', 'Timeframe chips on Aggregated OI and Long/Short charts', '1D–1Y'),
    N(T, 'Dashboard', 'Markets table: star · search · Columns ▾ (Funding hidden) · CSV', 'Sticky header inside a 560px scroll area'),
    N('/terminal/spot', 'Spot Markets', 'Compare mode (Cmp checkboxes → panel)', 'Same compare panel as /analytics/markets (normalised chart with timeframes + stats table), sharing CG.state.compare so a selection made in either app shows in both; ?compare=1 opens it'),
    N('/terminal/spot', 'Spot Markets', 'Watchlist filter chip + star column', '★ Watchlist chip shows only starred coins; count updates'),
    N('/terminal/spot', 'Spot Markets', 'Hidden columns 7d %, Funding, L/S via Columns ▾ · CSV', 'Search box moved into the table toolbar'),
    N('/terminal/sectors/:slug', 'Sector', 'Star column + CSV on sector tables', 'Shared table'),
    N('/terminal/etf', 'Bitcoin Spot ETFs', 'Timeframe chips on Net Inflow History', '7D/30D/90D/1Y; CSV on the ETF list'),
    N('/terminal/coin/:symbol', 'Coin detail', 'Watch + Compare chips in the coin header', 'Watch toggles the watchlist; Compare adds the coin and opens /terminal/spot?compare=1'),
    N('/terminal/coin/:symbol', 'Coin detail', 'Timeframe chips on Price & OI, L/S, Liquidations, Funding', 'Per-coin seeded series; exchange tables get CSV'),
    N('/terminal/exchanges/:exchange', 'Exchange overview', 'Star column + CSV', 'Shared table'),
    N('/terminal/derivatives/open-interest', 'Open Interest', 'Timeframe chips + CSV', 'OI area in --curve, BTC price line in foreground on the right axis'),
    N('/terminal/derivatives/funding', 'Funding Rates', 'Timeframe chips (7D–1Y at 8h) + CSV', 'Shared chart'),
    N('/terminal/derivatives/long-short', 'Long / Short', 'Timeframe chips on the three-line chart + CSV', 'Global = foreground, Top accounts = --curve, Top positions = muted dashed'),
    N('/terminal/derivatives/liquidations', 'Liquidations', 'Timeframe chips + table search/Columns/star', 'Shared chart + table'),
    N('/terminal/onchain/exchange-balance', 'Exchange Balance', 'Timeframe chips 30D/90D/1Y + heat cells for % + CSV', 'Shared chart + table'),
    N('/terminal/indicators/fear-greed', 'Fear & Greed Index', 'Compact arc gauge with amber needle', 'Replaces the v1 segmented gauge; semantic segments, scale labels'),
    N('/terminal/indicators/fear-greed', 'Fear & Greed Index', 'Timeframe chips on the history chart', '7D/30D/90D/1Y'),
    N('/terminal/indicators/cycle', 'BTC Cycle Indicators', 'Timeframe chips 30D/90D/180D on AHR999, Puell and Pi Cycle', 'Shared chart')
  ]);
  save('60-terminal.json', t);
}
console.log('analytics', a.length, 'new', a.filter((x) => x.new).length, '| terminal', t.length, 'new', t.filter((x) => x.new).length);
