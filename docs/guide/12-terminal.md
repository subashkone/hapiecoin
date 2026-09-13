# Market Analytics terminal

Part of the [HapieCoin feature guide](README.md). 167 traced features on 14 screens; 132 built and tested, 35 still mock-only (listed in the backlog).

## What it does

A sidebar-driven terminal over the same snapshots: dashboard with a watchlist, spot markets with compare, sectors, per-exchange pages, open interest, funding, long / short readings, fear and greed, cycle indicators and coin detail. ETFs, exchange balances and token unlocks are marked coming soon (paid data).

## Try it

1. `/terminal`: star two coins for the watch strip; then Spot, Sectors, Exchanges → binance, Derivatives → funding / long-short / open interest, Indicators → fear-greed / cycle, Coin BTC.

## Screens

![Dashboard](../../apps/web/e2e/__screenshots__/terminal-dashboard-dark.png)
*Dashboard*

![Spot markets](../../apps/web/e2e/__screenshots__/terminal-spot-dark.png)
*Spot markets*

![Sectors](../../apps/web/e2e/__screenshots__/guide/terminal-sectors.png)
*Sectors*

![Exchange page](../../apps/web/e2e/__screenshots__/terminal-exchange-dark.png)
*Exchange page*

![Open interest](../../apps/web/e2e/__screenshots__/guide/terminal-open-interest.png)
*Open interest*

![Funding](../../apps/web/e2e/__screenshots__/terminal-funding-dark.png)
*Funding*

![Long / short](../../apps/web/e2e/__screenshots__/terminal-long-short-dark.png)
*Long / short*

![Liquidations](../../apps/web/e2e/__screenshots__/guide/terminal-liquidations.png)
*Liquidations*

![Fear and greed](../../apps/web/e2e/__screenshots__/terminal-fear-greed-dark.png)
*Fear and greed*

![Cycle indicators](../../apps/web/e2e/__screenshots__/terminal-cycle-dark.png)
*Cycle indicators*

![Coin detail](../../apps/web/e2e/__screenshots__/guide/terminal-coin.png)
*Coin detail*

![ETFs (coming soon)](../../apps/web/e2e/__screenshots__/guide/terminal-etf.png)
*ETFs (coming soon)*

![Exchange balance (coming soon)](../../apps/web/e2e/__screenshots__/guide/terminal-exchange-balance.png)
*Exchange balance (coming soon)*

![Token unlocks (coming soon)](../../apps/web/e2e/__screenshots__/guide/terminal-unlocks.png)
*Token unlocks (coming soon)*

## Every feature, in detail

Each row is one traced feature from the build spec: the id, what it is, how it behaves (the acceptance rule the tests check), and how it is tested. Status "mock-only" means the screen exists but the data feed behind it is not connected yet.

### Market Analytics terminal · `/terminal`

| ID | Feature | How it behaves | Status | Tested by |
|---|---|---|---|---|
| HC-MT-001 | Terminal shell: sticky header + 232px sticky sidebar + content (max-width 1600px) + footer note | Shared v2 header (CG.chrome['terminal-header'] → CG2.header, identical to /analytics, Terminal ▾ tab active) + restyled 222px sticky sidebar (CG.chrome['terminal-sidebar']) + content (max-width 1600px) + footer; everything scoped under .terminal.cg-scope.cgx and built only on the shell tokens | built | unit (pricing) · e2e (Playwright) |
| HC-MT-002 | Header title 'Market Analytics' + HapieCoin mark | Shared header: logo links to #/analyse, the title reads Market Analytics; the terminal keeps its own left sidebar | built | e2e (Playwright) · api contract |
| HC-MT-003 | Header coin search "Search coin…" | Shared header search; in the terminal Enter/click opens /terminal/coin/SYM (hint row says "open in terminal") | built | e2e (Playwright) |
| HC-MT-004 | Search dropdown item click | Navigates to /terminal/coin/SYM and clears the input | built | e2e (Playwright) |
| HC-MT-005 | Search keyboard: ArrowUp/ArrowDown highlight, Enter opens highlighted coin, Escape closes | Enter with no match shows destructive toast "No coin matches “…”" | built | unit (pricing) · e2e (Playwright) |
| HC-MT-006 | Search empty state | Dropdown shows "No coin matches “xyz”" when nothing matches | built | e2e (Playwright) |
| HC-MT-007 | Header "Live" indicator | Live pill (green dot) in the shared header, hidden on small screens | mock-only | unit (pricing) · visual (screenshot diff) · security |
| HC-MT-008 | Header "Markets Hub" button | Replaced by the Hub tab of the shared section switcher (and the sidebar "Markets Hub ↗" item) | built | e2e (Playwright) |
| HC-MT-009 | Header "← Analyse" link | Shared header link back to the options app (#/analyse) | built | e2e (Playwright) |
| HC-MT-010 | Theme toggle (sun/moon icon) | Calls CG.theme.toggle(); the terminal now follows the page theme (html.dark) — the private terminal theme and cg2-theme localStorage key were removed | built | unit (pricing) · e2e (Playwright) |
| HC-MT-011 | Sidebar section labels: Markets, Derivatives, ETF, On-chain, Indicators | Grouped navigation with small inline-SVG icons | mock-only | unit (pricing) · visual (screenshot diff) |
| HC-MT-012 | Sidebar nav item "Dashboard" | Navigates to /terminal | built | e2e (Playwright) |
| HC-MT-013 | Sidebar nav item "Markets Hub" | Navigates to /analytics/coinglass (external to the terminal) | built | e2e (Playwright) |
| HC-MT-014 | Sidebar nav item "Spot Markets" | Navigates to /terminal/spot | built | e2e (Playwright) |
| HC-MT-015 | Sidebar nav item "Layer-1" | Navigates to /terminal/sectors/layer-1 | built | e2e (Playwright) |
| HC-MT-016 | Sidebar nav item "Layer-2" | Navigates to /terminal/sectors/layer-2 | built | e2e (Playwright) |
| HC-MT-017 | Sidebar nav item "DeFi" | Navigates to /terminal/sectors/defi | built | e2e (Playwright) |
| HC-MT-018 | Sidebar nav item "Memes" | Navigates to /terminal/sectors/memes | built | e2e (Playwright) |
| HC-MT-019 | Sidebar nav item "Exchanges" | Navigates to /terminal/exchanges/Binance | built | e2e (Playwright) |
| HC-MT-020 | Sidebar nav item "Open Interest" | Navigates to /terminal/derivatives/open-interest | built | unit (pricing) · e2e (Playwright) |
| HC-MT-021 | Sidebar nav item "Funding Rates" | Navigates to /terminal/derivatives/funding | built | unit (pricing) · e2e (Playwright) |
| HC-MT-022 | Sidebar nav item "Long / Short" | Navigates to /terminal/derivatives/long-short | built | unit (pricing) · e2e (Playwright) |
| HC-MT-023 | Sidebar nav item "Liquidations" | Navigates to /terminal/derivatives/liquidations | built | unit (pricing) · e2e (Playwright) |
| HC-MT-024 | Sidebar nav item "ETF Flows" | Navigates to /terminal/etf | built | e2e (Playwright) |
| HC-MT-025 | Sidebar nav item "Exchange Balance" | Navigates to /terminal/onchain/exchange-balance | built | e2e (Playwright) |
| HC-MT-026 | Sidebar nav item "Token Unlocks" | Navigates to /terminal/onchain/unlocks | built | e2e (Playwright) |
| HC-MT-027 | Sidebar nav item "Fear & Greed" | Navigates to /terminal/indicators/fear-greed | built | e2e (Playwright) |
| HC-MT-028 | Sidebar nav item "BTC Cycle" | Navigates to /terminal/indicators/cycle | built | e2e (Playwright) |
| HC-MT-029 | Active nav highlight | Active sidebar item gets an amber (--primary) 2px left rule, foreground text and a muted background; section labels use the .micro style | built | unit (pricing) · e2e (Playwright) |
| HC-MT-030 | Sidebar collapses to a top drawer under 900px | "Navigation" toggle button shows the current section name and expands/collapses the nav; closes on route change | built | e2e (Playwright) |
| HC-MT-031 | Footer note "Market data · auto-refreshing · intervals vary per dataset" | Rendered by CG.chrome["terminal-footer"] on every terminal screen | mock-only | visual (screenshot diff) |
| HC-MT-032 | Shared SVG chart helper (line / area / bars / stacked bars / dual axis / reference lines) | MA.chart now adapts its spec to CG2.chart, the single chart helper shared with /analytics (timeframe chips, toggleable legend, crosshair tooltip, last-value tags, faint grid, skeleton) | built | e2e (Playwright) |
| HC-MT-033 | Chart hover crosshair + tooltip | Mouse over any chart shows a dashed crosshair, dots on line series and a tooltip with the time label and every series value | built | e2e (Playwright) |
| HC-MT-034 | Chart legends | Multi-series charts show a colour legend above the plot | mock-only | visual (screenshot diff) |
| HC-MT-035 | Sortable tables (all terminal tables) | MA.table adapts to CG2.table: sticky headers, sortable, mono right-aligned numbers, heat cells, search, Columns ▾, CSV, star, compare checkbox | built | e2e (Playwright) |
| HC-MT-036 | Table rows link to detail pages | Coin rows → /terminal/coin/SYM, exchange rows → /terminal/exchanges/NAME (data-nav) | built | e2e (Playwright) |
| HC-MT-037 | Number formatting: .ma-mono numbers, .ma-up/.ma-down colours | Prices with 2/4/8 decimals by magnitude, compact USD ($1.23B), signed % in green/red, funding to 4 decimals | mock-only | visual (screenshot diff) |
| HC-MT-038 | Access control | All terminal screens are data-auth="user"; logged-out users are redirected to /auth | built | e2e (Playwright) |
| HC-MT-039 | Extra coins added to CG.mock.coins at init | MNT, METIS, ZK, COMP, DYDX, SUSHI, 1INCH, MEME, POPCAT, BRETT added with plausible numbers so every sector symbol resolves (50 coins total) | mock-only | unit (pricing) · visual (screenshot diff) |
| HC-MT-152 | Unified skin with /analytics | Private ma-* palette deleted; tiles/panels/chips/tables/charts share the .cgx classes and shell tokens; light and dark tested | built | unit (pricing) · e2e (Playwright) |
| HC-MT-153 | Shared section switcher with Terminal ▾ | The terminal shows the same Hub … Sentiment tabs as /analytics; Terminal ▾ is active (amber underline) and drops down the grouped terminal pages | built | unit (pricing) · e2e (Playwright) |
| HC-MT-154 | Sidebar restyle | Section labels .micro, 30px items, amber left rule on the active item, "Markets Hub ↗" external marker; mobile drawer retained | built | unit (pricing) · e2e (Playwright) |
| HC-MT-155 | Follows page theme + density | A.applyTheme/A.applyDensity run on every show; rows compact at 28px when CG.state.density === 'compact' | built | e2e (Playwright) |

### Dashboard · `/terminal`

| ID | Feature | How it behaves | Status | Tested by |
|---|---|---|---|---|
| HC-MT-040 | Page title "Dashboard · Derivatives market overview" | Header with "Updated 14:30" (mock clock) | built | unit (pricing) · e2e (Playwright) |
| HC-MT-041 | Stat tile "Fear & Greed" | value + label Extreme Fear / Fear / Neutral / Greed / Extreme Greed from CG.mock.fearGreedNow | built | e2e (Playwright) |
| HC-MT-042 | Stat tile "Total Open Interest · All tracked coins" | sum of openInterest over CG.mock.coins | built | e2e (Playwright) |
| HC-MT-043 | Stat tile "24h Volume · Aggregated futures" | sum of volume24h over CG.mock.coins | built | e2e (Playwright) |
| HC-MT-044 | Stat tile "BTC Dominance · OI share" | BTC openInterest / total OI | built | e2e (Playwright) |
| HC-MT-045 | Stat tile "BTC ETF Net Inflow (USD) · Net Flow" | last CG.mock.etfFlows flow, green/red by sign | mock-only | visual (screenshot diff) |
| HC-MT-046 | Stat tile "Long / Short Ratio · L/S" | last CG.mock.lsHistory global ratio | built | e2e (Playwright) |
| HC-MT-047 | Chart "Aggregated Open Interest" (area) | CG.mock.oiHistory (96h) as an accent area chart with hover tooltip | built | e2e (Playwright) |
| HC-MT-048 | Chart "Long / Short Ratio" (line) | CG.mock.lsHistory global ratio as a yellow line with L/S = 1 reference line | built | e2e (Playwright) |
| HC-MT-049 | Table "Top Gainers (24h)" — Coin, Price, 24h % | Top 6 coins by chg24 desc; sortable; rows open the coin page | built | e2e (Playwright) |
| HC-MT-050 | Table "Top Losers (24h)" — Coin, Price, 24h % | Bottom 6 coins by chg24; sortable; rows open the coin page | built | e2e (Playwright) |
| HC-MT-051 | Main table "Markets" — Coin, Price, 24h %, Open Interest, 24h Vol | All 50 coins sorted by Open Interest desc by default; every column sortable; row click → /terminal/coin/SYM | built | e2e (Playwright) |
| HC-MT-156 | Watchlist strip on the dashboard | Same strip as the hub (cards → /terminal/coin/SYM, remove star, empty state, "Manage in Spot Markets →") | built | e2e (Playwright) |
| HC-MT-157 | Timeframe chips on Aggregated OI and Long/Short charts | 1D–1Y | built | e2e (Playwright) |
| HC-MT-158 | Markets table: star · search · Columns ▾ (Funding hidden) · CSV | Sticky header inside a 560px scroll area | built | e2e (Playwright) |

### Spot Markets · `/terminal/spot`

| ID | Feature | How it behaves | Status | Tested by |
|---|---|---|---|---|
| HC-MT-052 | Page title "Spot Markets · Sortable list of all tracked markets" | Header with filter input and live "N markets" counter | built | unit (pricing) · e2e (Playwright) · security |
| HC-MT-053 | Search filter input "Filter by symbol or name…" | Filters the table as you type (symbol or name substring); counter updates; empty state "No markets match “…”" | built | e2e (Playwright) |
| HC-MT-054 | Column "Coin" (sortable) | from CG.mock.coins; click header to sort asc/desc | built | e2e (Playwright) |
| HC-MT-055 | Column "Price" (sortable) | from CG.mock.coins; click header to sort asc/desc | built | e2e (Playwright) |
| HC-MT-056 | Column "24h %" (sortable) | from CG.mock.coins; click header to sort asc/desc | built | e2e (Playwright) |
| HC-MT-057 | Column "Market Cap" (sortable) | from CG.mock.coins; click header to sort asc/desc | built | e2e (Playwright) |
| HC-MT-058 | Column "24h Volume" (sortable) | from CG.mock.coins; click header to sort asc/desc | built | e2e (Playwright) |
| HC-MT-059 | Column "Open Interest" (sortable) | from CG.mock.coins; click header to sort asc/desc | built | e2e (Playwright) |
| HC-MT-060 | Column "OI Share" (sortable) | coin OI / total OI in % | built | e2e (Playwright) |
| HC-MT-061 | Default sort | Market Cap descending | built | e2e (Playwright) |
| HC-MT-062 | Row click | Opens /terminal/coin/SYM | built | e2e (Playwright) |
| HC-MT-159 | Compare mode (Cmp checkboxes → panel) | Same compare panel as /analytics/markets (normalised chart with timeframes + stats table), sharing CG.state.compare so a selection made in either app shows in both; ?compare=1 opens it | built | e2e (Playwright) |
| HC-MT-160 | Watchlist filter chip + star column | ★ Watchlist chip shows only starred coins; count updates | built | e2e (Playwright) |
| HC-MT-161 | Hidden columns 7d %, Funding, L/S via Columns ▾ · CSV | Search box moved into the table toolbar | built | e2e (Playwright) |

### Sector · `/terminal/sectors/:slug`

| ID | Feature | How it behaves | Status | Tested by |
|---|---|---|---|---|
| HC-MT-063 | Page title "<Name> Sector · N symbols" | Layer-1 (13), Layer-2 (8), DeFi (11), Memes (9) symbol lists filtered to coins present in CG.mock.coins | built | e2e (Playwright) |
| HC-MT-064 | Sector switcher chips (Layer-1 / Layer-2 / DeFi / Memes) | Chips in the page header navigate between sectors; active chip highlighted | built | unit (pricing) · e2e (Playwright) |
| HC-MT-065 | Sector table (same columns as Spot Markets) | Coin, Price, 24h %, Market Cap, 24h Volume, Open Interest, OI Share; sortable; rows open the coin page | built | e2e (Playwright) |
| HC-MT-066 | Unknown slug state "Unknown sector: xyz" | Title and empty panel "Unknown sector: xyz" with hint to pick a known sector | built | e2e (Playwright) |
| HC-MT-067 | Redirect /terminal/sectors → /terminal/sectors/layer-1 | data-redirect screen | built | e2e (Playwright) |
| HC-MT-162 | Star column + CSV on sector tables | Shared table | built | e2e (Playwright) |

### Bitcoin Spot ETFs · `/terminal/etf`

| ID | Feature | How it behaves | Status | Tested by |
|---|---|---|---|---|
| HC-MT-068 | Page title "Bitcoin Spot ETFs · Issuer flows, AUM and holdings" | Behaves as in the v2 mock. | mock-only | visual (screenshot diff) |
| HC-MT-069 | Stat tile "Total AUM" | sum of aum over CG.mock.etfs (bitcoin) | mock-only | visual (screenshot diff) |
| HC-MT-070 | Stat tile "Total BTC Held" | sum of btcHeld with USD equivalent | mock-only | unit (pricing) · visual (screenshot diff) |
| HC-MT-071 | Stat tile "ETF Count" | number of spot funds tracked | mock-only | visual (screenshot diff) |
| HC-MT-072 | Stat tile "Net Flow (1d)" | sum of flow1d, green/red by sign | mock-only | visual (screenshot diff) |
| HC-MT-073 | Chart "Net Inflow History · Net Flow USD" (bars) | CG.mock.etfFlows daily flows; positive bars accent, negative bars red; hover tooltip | mock-only | unit (pricing) · visual (screenshot diff) |
| HC-MT-074 | ETF List column "Ticker" (sortable) | from CG.mock.etfs | mock-only | visual (screenshot diff) |
| HC-MT-075 | ETF List column "Issuer" (sortable) | issuer with fund name underneath (ma-dim) | mock-only | visual (screenshot diff) |
| HC-MT-076 | ETF List column "AUM" (sortable) | from CG.mock.etfs | mock-only | visual (screenshot diff) |
| HC-MT-077 | ETF List column "BTC Held" (sortable) | from CG.mock.etfs | mock-only | visual (screenshot diff) |
| HC-MT-078 | ETF List column "Net Flow (1d)" (sortable) | signed compact USD in green/red | mock-only | visual (screenshot diff) |
| HC-MT-079 | ETF List column "Change %" (sortable) | from CG.mock.etfs | mock-only | visual (screenshot diff) |
| HC-MT-163 | Timeframe chips on Net Inflow History | 7D/30D/90D/1Y; CSV on the ETF list | mock-only | visual (screenshot diff) |

### Coin detail · `/terminal/coin/:symbol`

| ID | Feature | How it behaves | Status | Tested by |
|---|---|---|---|---|
| HC-MT-080 | "← Back" button | Returns to /terminal | built | e2e (Playwright) |
| HC-MT-081 | Coin header: icon, symbol, name, rank chip, sector chip, price, 24h % | Sector chip links to the sector page; BTC/ETH/XAUT price updates live on the 2.5s CG tick with a green/red flash | mock-only | unit (pricing) · visual (screenshot diff) · security |
| HC-MT-082 | Stat tile "Price" | with 24h % underneath | built | e2e (Playwright) |
| HC-MT-083 | Stat tile "Open Interest" | with OI change 24h % underneath | built | e2e (Playwright) |
| HC-MT-084 | Stat tile "24h Volume" | futures volume across exchanges | built | e2e (Playwright) |
| HC-MT-085 | Stat tile "Funding (avg)" | average of per-exchange funding | built | e2e (Playwright) |
| HC-MT-086 | Chart "Price & Open Interest" (dual axis) | Price (left axis, accent) and OI USD (right axis, yellow) over 96h from CG.mock.priceHistory + scaled oiHistory | built | e2e (Playwright) |
| HC-MT-087 | Chart "Long / Short Ratio · L/S" | lsHistory scaled to the coin lsRatio | built | e2e (Playwright) |
| HC-MT-088 | Chart "Liquidations · Long Liq / Short Liq" (stacked bars) | CG.mock.liqHistory scaled by the coin liq24h; long red, short green | built | e2e (Playwright) |
| HC-MT-089 | Chart "OI-Weighted Funding · Funding %" (bars) | fundingHistory shifted to the coin funding; sign-coloured bars | built | e2e (Playwright) |
| HC-MT-090 | Chart "Taker Buy / Sell Volume" (grouped bars) | Buy (green) vs Sell (red) hourly derived from priceHistory volume | built | unit (pricing) · e2e (Playwright) |
| HC-MT-091 | "Markets by Exchange" column "Exchange" (sortable) | per-exchange split of the coin OI/volume/funding; row click opens the exchange page | built | e2e (Playwright) |
| HC-MT-092 | "Markets by Exchange" column "Open Interest" (sortable) | per-exchange split of the coin OI/volume/funding; row click opens the exchange page | built | e2e (Playwright) |
| HC-MT-093 | "Markets by Exchange" column "24h Vol" (sortable) | per-exchange split of the coin OI/volume/funding; row click opens the exchange page | built | e2e (Playwright) |
| HC-MT-094 | "Markets by Exchange" column "OI Share" (sortable) | share bar + % | built | e2e (Playwright) |
| HC-MT-095 | "Markets by Exchange" column "Funding" (sortable) | per-exchange split of the coin OI/volume/funding; row click opens the exchange page | built | e2e (Playwright) |
| HC-MT-096 | "Funding by Exchange" column "Exchange" (sortable) | current / predicted 8h funding and annualised rate per exchange; row click opens the exchange page | built | e2e (Playwright) |
| HC-MT-097 | "Funding by Exchange" column "Funding" (sortable) | current / predicted 8h funding and annualised rate per exchange; row click opens the exchange page | built | e2e (Playwright) |
| HC-MT-098 | "Funding by Exchange" column "Predicted" (sortable) | current / predicted 8h funding and annualised rate per exchange; row click opens the exchange page | built | e2e (Playwright) |
| HC-MT-099 | "Funding by Exchange" column "Annualised" (sortable) | current / predicted 8h funding and annualised rate per exchange; row click opens the exchange page | built | e2e (Playwright) |
| HC-MT-100 | "Liquidation Heatmap (long vs short)" grid | 24 hour columns × Long/Short rows; cell intensity = liquidation USD / max; hover title shows hour and value | built | e2e (Playwright) |
| HC-MT-101 | Unknown symbol state "No data" | Panel "No data · No market data for “XYZ”" with the Back button | built | e2e (Playwright) |
| HC-MT-164 | Watch + Compare chips in the coin header | Watch toggles the watchlist; Compare adds the coin and opens /terminal/spot?compare=1 | built | e2e (Playwright) |
| HC-MT-165 | Timeframe chips on Price & OI, L/S, Liquidations, Funding | Per-coin seeded series; exchange tables get CSV | built | e2e (Playwright) |

### Exchange overview · `/terminal/exchanges/:exchange`

| ID | Feature | How it behaves | Status | Tested by |
|---|---|---|---|---|
| HC-MT-102 | Page title "<Exchange> · Exchange overview" | Default Binance | built | e2e (Playwright) |
| HC-MT-103 | Exchange switcher chips | One chip per CG.mock.exchanges entry (Binance, OKX, Bybit, Bitget, Gate, HTX, CoinEx, Hyperliquid, Deribit, Kraken); active chip highlighted; click navigates | built | unit (pricing) · e2e (Playwright) |
| HC-MT-104 | Stat tile "Tracked Coins" | number of perpetual markets listed (scales with exchange OI share) | built | e2e (Playwright) |
| HC-MT-105 | Stat tile "Total OI" | exchange openInterest with share of aggregated OI | built | e2e (Playwright) |
| HC-MT-106 | Stat tile "24h Volume" | exchange volume24h | mock-only | visual (screenshot diff) |
| HC-MT-107 | Stat tile "BTC Balance" | exchange btcBalance with 24h % change | mock-only | visual (screenshot diff) |
| HC-MT-108 | "Coins on <Exchange>" column "Coin" (sortable) | per-coin split for this exchange; row click opens the coin page | built | e2e (Playwright) |
| HC-MT-109 | "Coins on <Exchange>" column "Open Interest" (sortable) | per-coin split for this exchange; row click opens the coin page | built | e2e (Playwright) |
| HC-MT-110 | "Coins on <Exchange>" column "24h Vol" (sortable) | per-coin split for this exchange; row click opens the coin page | built | e2e (Playwright) |
| HC-MT-111 | "Coins on <Exchange>" column "Funding" (sortable) | per-coin split for this exchange; row click opens the coin page | built | e2e (Playwright) |
| HC-MT-112 | Unknown exchange state | Title "Unknown exchange: xyz" + "No data" panel + switcher chips | built | e2e (Playwright) |
| HC-MT-113 | Redirect /terminal/exchanges → /terminal/exchanges/Binance | data-redirect screen | built | e2e (Playwright) |
| HC-MT-166 | Star column + CSV | Shared table | built | e2e (Playwright) |

### Open Interest · `/terminal/derivatives/open-interest`

| ID | Feature | How it behaves | Status | Tested by |
|---|---|---|---|---|
| HC-MT-114 | Page title "Open Interest" | Tiles: Aggregated OI, BTC OI (with BTC dominance), Top Exchange | built | e2e (Playwright) |
| HC-MT-115 | Chart "Aggregated Open Interest" (area + BTC price on right axis) | CG.mock.oiHistory oi (area, accent) and price (line, yellow) | built | e2e (Playwright) |
| HC-MT-116 | Table column "Exchange" (sortable) | from CG.mock.exchanges; row click opens the exchange page | built | e2e (Playwright) |
| HC-MT-117 | Table column "Open Interest" (sortable) | from CG.mock.exchanges; row click opens the exchange page | built | e2e (Playwright) |
| HC-MT-118 | Table column "Share" (sortable) | accent share bar + % | built | e2e (Playwright) |
| HC-MT-167 | Timeframe chips + CSV | OI area in --curve, BTC price line in foreground on the right axis | built | e2e (Playwright) |

### Funding Rates · `/terminal/derivatives/funding`

| ID | Feature | How it behaves | Status | Tested by |
|---|---|---|---|---|
| HC-MT-119 | Page title "Funding Rates" | Tiles: OI-Weighted Funding, Average Funding, Annualised | built | e2e (Playwright) |
| HC-MT-120 | Chart "OI-Weighted Funding · Funding %" (bars) | CG.mock.fundingHistory oiWeighted, 8h intervals, sign-coloured bars with tooltip | built | e2e (Playwright) |
| HC-MT-121 | "Per-exchange Funding" column "Exchange" (sortable) | BTC perpetual funding per venue; row click opens the exchange page | built | e2e (Playwright) |
| HC-MT-122 | "Per-exchange Funding" column "Funding" (sortable) | BTC perpetual funding per venue; row click opens the exchange page | built | e2e (Playwright) |
| HC-MT-123 | "Per-exchange Funding" column "Predicted" (sortable) | BTC perpetual funding per venue; row click opens the exchange page | built | e2e (Playwright) |
| HC-MT-124 | "Per-exchange Funding" column "Open Interest" (sortable) | BTC perpetual funding per venue; row click opens the exchange page | built | e2e (Playwright) |
| HC-MT-125 | "Per-exchange Funding" column "Annualised" (sortable) | BTC perpetual funding per venue; row click opens the exchange page | built | e2e (Playwright) |
| HC-MT-168 | Timeframe chips (7D–1Y at 8h) + CSV | Shared chart | built | e2e (Playwright) |

### Long / Short · `/terminal/derivatives/long-short`

| ID | Feature | How it behaves | Status | Tested by |
|---|---|---|---|---|
| HC-MT-126 | Page title "Long / Short" | Tiles: Global Accounts, Top Trader (Accounts), Top Trader (Positions) — green ≥ 1, red < 1 | built | e2e (Playwright) |
| HC-MT-127 | Chart: three lines Global Accounts / Top Trader (Accounts) / Top Trader (Positions) with legend and L/S axis | CG.mock.lsHistory 72h; colours accent / yellow / purple; L/S = 1 reference line; hover shows all three values | built | e2e (Playwright) |
| HC-MT-128 | Table "Hourly Readings" (Time, Global Accounts, Top Trader (Accounts), Top Trader (Positions)) | Latest 24 readings, sortable | built | e2e (Playwright) |
| HC-MT-169 | Timeframe chips on the three-line chart + CSV | Global = foreground, Top accounts = --curve, Top positions = muted dashed | built | e2e (Playwright) |

### Exchange Balance · `/terminal/onchain/exchange-balance`

| ID | Feature | How it behaves | Status | Tested by |
|---|---|---|---|---|
| HC-MT-135 | Page title "Exchange Balance · Bitcoin held on exchanges" | Tiles: Total BTC Balance, 24h / 7d / 30d change | mock-only | visual (screenshot diff) |
| HC-MT-136 | Chart "BTC Balance" (area, 90 days) | Derived 90-day series anchored to CG.mock.global.btcExchangeBalance (CG.terminal.exchBalance) | mock-only | unit (pricing) · visual (screenshot diff) |
| HC-MT-137 | Table column "Exchange" (sortable) | from CG.mock.exchanges btcBalance / btcBalanceChg*; row click opens the exchange page | mock-only | visual (screenshot diff) |
| HC-MT-138 | Table column "BTC Balance" (sortable) | from CG.mock.exchanges btcBalance / btcBalanceChg*; row click opens the exchange page | mock-only | visual (screenshot diff) |
| HC-MT-139 | Table column "24h %" (sortable) | from CG.mock.exchanges btcBalance / btcBalanceChg*; row click opens the exchange page | mock-only | visual (screenshot diff) |
| HC-MT-140 | Table column "7d %" (sortable) | from CG.mock.exchanges btcBalance / btcBalanceChg*; row click opens the exchange page | mock-only | visual (screenshot diff) |
| HC-MT-141 | Table column "30d %" (sortable) | from CG.mock.exchanges btcBalance / btcBalanceChg*; row click opens the exchange page | mock-only | visual (screenshot diff) |
| HC-MT-171 | Timeframe chips 30D/90D/1Y + heat cells for % + CSV | Shared chart + table | mock-only | visual (screenshot diff) |

### Token Unlock Schedule · `/terminal/onchain/unlocks`

| ID | Feature | How it behaves | Status | Tested by |
|---|---|---|---|---|
| HC-MT-142 | Page title "Token Unlock Schedule · Upcoming vesting events" | Behaves as in the v2 mock. | mock-only | visual (screenshot diff) |
| HC-MT-143 | Empty panel "Token unlock data unavailable" | Exact text: "This data source is not enabled on the current plan. Enable a token-unlock endpoint in the proxy to populate this view — no mock data shown." | mock-only | unit (pricing) · visual (screenshot diff) |

### Fear & Greed Index · `/terminal/indicators/fear-greed`

| ID | Feature | How it behaves | Status | Tested by |
|---|---|---|---|---|
| HC-MT-144 | Page title "Fear & Greed Index" | Behaves as in the v2 mock. | built | e2e (Playwright) |
| HC-MT-145 | Gauge with value + label | Semicircle gauge with 5 coloured bands (Extreme Fear / Fear / Neutral / Greed / Extreme Greed), marker at the current value, big value and label | built | e2e (Playwright) |
| HC-MT-146 | Chart "History · F&G" (area, 90 days) | CG.mock.fearGreed with Extreme Fear (25) and Extreme Greed (75) reference lines; tooltip shows value + label | built | e2e (Playwright) |
| HC-MT-147 | Tiles Now / Yesterday / Last Week / Last Month | Value + label at 0, 1, 7 and 30 days back | built | e2e (Playwright) |
| HC-MT-172 | Compact arc gauge with amber needle | Replaces the v1 segmented gauge; semantic segments, scale labels | built | e2e (Playwright) |
| HC-MT-173 | Timeframe chips on the history chart | 7D/30D/90D/1Y | built | e2e (Playwright) |

### BTC Cycle Indicators · `/terminal/indicators/cycle`

| ID | Feature | How it behaves | Status | Tested by |
|---|---|---|---|---|
| HC-MT-148 | Page title "BTC Cycle Indicators" | Tiles: AHR999, Puell Multiple, Pi Cycle 111DMA / 350DMA×2, Rainbow Band (from CG.mock.cycle) | built | e2e (Playwright) |
| HC-MT-149 | Panel "AHR999" (area chart) | CG.mock.cycleHistory ahr999 with Bottom 0.45 / Top 1.2 reference lines | mock-only | visual (screenshot diff) |
| HC-MT-150 | Panel "Puell Multiple" (area chart) | cycleHistory puell with Undervalued 0.5 reference line | mock-only | visual (screenshot diff) |
| HC-MT-151 | Panel "Pi Cycle" (price with 111DMA and 350DMA×2) | Three lines with legend (price accent, 111DMA yellow, 350DMA×2 purple) from cycleHistory | built | e2e (Playwright) |
| HC-MT-174 | Timeframe chips 30D/90D/180D on AHR999, Puell and Pi Cycle | Shared chart | built | e2e (Playwright) |

