// Generates docs/guide/*.md from spec/traceability.json plus hand-written overviews, walkthroughs and captures.
// Run: node spec/gen-guide.js (from anywhere). Every spec screen must be mapped to a page, or the script fails.
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..") + "/";
const t = JSON.parse(fs.readFileSync(root + "spec/traceability.json", "utf8"));
const rows = Array.isArray(t) ? t : t.rows || Object.values(t).find(Array.isArray);
// captures live with the tests (already committed there); the guide links to them instead of copying 165 files
const SHOTS = root + "apps/web/e2e/__screenshots__/";
const have = new Set([...fs.readdirSync(SHOTS).filter((f) => f.endsWith(".png")), ...fs.readdirSync(SHOTS + "guide").map((f) => "guide/" + f)]);
const REL = "../../apps/web/e2e/__screenshots__/";

const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
const shot = (file, caption) => {
  const key = have.has(file) ? file : have.has("guide/" + file) ? "guide/" + file : null;
  if (!key) return `> Capture \`${file}\` is not in this build's set; see the Playwright report for the live run.\n`;
  return `![${caption}](${REL}${key})\n*${caption}*\n`;
};

const pages = [
  {
    file: "01-public-site.md",
    title: "Public site and sign-in",
    screens: ["Landing page", "Sign in / Sign up", "Delta Exchange sign-in", "SSO return", "Privacy Policy", "Terms of Service", "Disclaimer", "Payoff chart preview", "Not found", "Auth · Two-factor code", "Auth · Sign in", "Public trader page", "Public trader page · share"],
    overview: `The public site is what a stranger sees before an account exists: the landing page with live BTC / ETH / XAUT tiles, the sign-in and sign-up forms, the legal pages, a free payoff-chart preview that needs no account, and every trader's optional public page at \`/t/<handle>\` with their verified P&L.

Sign-up is email plus password with a one-time code by email. Sign-in also accepts Google (when configured), a passkey, and, for accounts that turned it on, an authenticator code as a second factor. Referral codes are read from the sign-up link.`,
    tryIt: [
      "Open `/`. The three price tiles go live within a few seconds (the gateway feed). Scroll: the nav links move you between sections without changing the route.",
      "Click **Get Started**, then **Sign Up**. Enter an email and a password; on the local stack the code is printed in the API log as `[mail] to=<email> otp=<code>`.",
      "Sign out and sign in again with the password. If you turned two-factor on (Settings → Security), the code step appears after the password.",
      "Open `/payoff-preview` without signing in: pick a preset, drag the target price, toggle the layers.",
      "Turn on your public page (Settings → Public page), then open `/t/<your handle>` in a private window and try the share buttons.",
    ],
    shots: [["home-dark.png", "Landing page, dark"], ["home-light.png", "Landing page, light"], ["auth-login-dark.png", "Sign in"], ["auth-signup-dark.png", "Sign up"], ["auth-two-factor-code.png", "The authenticator code step after the password"], ["auth-delta.png", "Sign in with Delta Exchange (SSO return)"], ["public-payoff-preview-dark.png", "Payoff chart preview, no account needed"], ["public-trader-page.png", "A trader's public page with verified P&L and share bar"], ["public-privacy.png", "Privacy policy"], ["public-terms.png", "Terms of service"], ["public-disclaimer.png", "Disclaimer"]],
  },
  {
    file: "02-workspace-and-settings.md",
    title: "Workspace chrome, settings and dialogs",
    screens: ["Shared chrome · App header (analyse)", "Shared chrome · App header (default)", "Shared chrome · Settings menu", "Shared chrome · Profile dialog", "Shared chrome · API Settings dialog", "Shared chrome · Currency Settings dialog", "Shared chrome · Lot Size Settings dialog", "Shared chrome · P&L Settings dialog", "Shared chrome · Exchange Management dialog", "Shared chrome · Plan banner", "Shared chrome · Upgrade Required dialog", "Shared chrome · Banner flyers", "Shared chrome · HapieCoin Assistant", "Shared chrome · Product tour", "Shared chrome · Command palette", "Shared chrome · Keyboard shortcuts", "Shared chrome · Portfolio bar", "Shared chrome · Density", "Shared chrome · Settings menu · Public page dialog", "Shared chrome · Settings menu · Security", "Settings · API Settings / Mindful trading / Lot Size", "Settings · Security · Passkeys", "Settings · Mindful trading", "Venues · venue switch", "Venues · spot per venue"],
    overview: `Everything around the workspace: the header (asset pills, futures price with 24 h change, feed status, exchange chip, currency toggle, alerts bell, theme, settings and account menus), the portfolio bar at the bottom, and the settings dialogs behind the gear.

Settings cover the profile, exchange API keys (several labelled keys per exchange, one per Delta sub-account), the display currency and conversion rate, lot sizes, the P&L basis (mark or bid/ask), the Mindful trading pause, security (two-factor with an authenticator app, backup codes, passkeys), exchanges (admin), and the public page. The command palette (Ctrl K), the keyboard shortcuts sheet (?), the product tour and the HapieCoin Assistant are reachable from the same menu. Exchange keys are stored encrypted on the server and never shown again after saving.`,
    tryIt: [
      "On `/analyse` press **Ctrl K**: search for any tab, dialog or page and jump to it. Press **?** for the shortcuts sheet.",
      "Gear → **Profile**: change the name and avatar. Gear → **Currency**: switch INR / USD and watch every figure in the workspace follow.",
      "Gear → **API Settings**: add a Delta API key with a label (read-only keys are refused for live trading; the whitelist IP is shown). Add a second labelled key to see accounts.",
      "Gear → **Security**: turn two-factor on with an authenticator app, save the backup codes, then add a passkey and sign in with it.",
      "Gear → **Mindful trading**: set a daily-loss threshold and pause length; the pause shows before a live order when you are down on the day.",
      "Gear → **Take a tour** for the guided overlay; click the chat bubble bottom-right for the assistant and try “Explain this strategy”.",
    ],
    shots: [["analyse-dark.png", "The analyse header and workspace"], ["settings-profile.png", "Profile"], ["settings-api-keys.png", "API keys and accounts"], ["settings-currency.png", "Currency"], ["settings-lot-size.png", "Lot sizes"], ["settings-pnl-basis.png", "P&L basis"], ["settings-mindful.png", "Mindful trading"], ["settings-security.png", "Security: two-factor and passkeys"], ["settings-exchanges.png", "Exchange management (admin)"], ["settings-public-page.png", "Public page"], ["command-palette.png", "Command palette"], ["analyse-shortcuts-dark.png", "Keyboard shortcuts"], ["analyse-tour-welcome-dark.png", "Product tour, welcome"], ["analyse-tour-dark.png", "Product tour, anchored step"], ["analyse-assistant-dark.png", "HapieCoin Assistant"], ["analyse-flyer-dark.png", "Banner flyer"]],
  },
  {
    file: "03-chain-and-analysis.md",
    title: "Options chain and the analysis tabs",
    screens: ["Analyse workspace", "Options chain", "Column Settings", "Analysis pane", "Payoff Diagram", "Payoff · Analytics strip", "Greeks", "Ladder", "Payoff", "Scenarios", "Vol", "Structure", "Share", "Analyse · Screener tab", "Analyse · Replay (API)", "Analyse · Replay tab", "Analyse · Chain", "Analyse · Backtest (engine + API)", "Analyse · Backtest tab", "API · market history", "Pricing · calendar and carry"],
    overview: `The workspace is two panes: the chain on the left (with the Builder, Paper, Live, Journal and Screener tabs) and the analysis pane on the right (Payoff, Greeks, Ladder, Scenarios, Vol, Structure, Alerts, Backtest, Replay).

The chain lists every strike the exchange lists for the chosen expiry, calls and puts around a fixed centre strike column, live from the gateway feed, with the ATM row and spot marked. Hovering a row (tapping on a phone) shows B / S / lots controls; keys B, S, Shift+B, Shift+S add legs. Columns are configurable. The analysis pane prices whatever is in the Builder with Black-76: the payoff at expiry and at a target date, greeks, a price ladder, a price × date scenario matrix, IV rank and realised vs implied vol, term structure and skew. The Screener ranks every listed option on the live chain; Backtest runs a template over our own recorded end-of-day chains; Replay scrubs a recorded expiry by day or 5-minute pass.`,
    tryIt: [
      "Pick BTC, an expiry, and a strike range (±6 / ±12 / ATM / delta filters). Hover the ATM call row and click **B**; hover the ATM put row and click **S**.",
      "Open the gear in the chain toolbar: hide a column, reorder, then **Done**.",
      "Analysis pane: **Payoff** (toggle layers, drag the target date), **Greeks**, **Ladder**, **Scenarios** (try Smooth), **Vol**, **Structure**.",
      "Left pane: **Screener** ranks options by IV rank, premium per day and skew across every expiry.",
      "Analysis pane: **Backtest** runs the chosen template over the recorded days; **Replay** scrubs a past expiry's chain by day, then by 5-minute pass.",
      "Click **Share** on the strip: copy the link, open it in a private window.",
    ],
    shots: [["analyse-dark.png", "Chain with payoff, dark"], ["analyse-light.png", "Chain with payoff, light"], ["analyse-legs-dark.png", "Two legs on the chain with the row controls"], ["analyse-columns-dark.png", "Column settings"], ["analyse-greeks-dark.png", "Greeks"], ["analyse-ladder.png", "Ladder"], ["analyse-scenarios-dark.png", "Scenarios"], ["analyse-scenarios-smooth-dark.png", "Scenarios, smooth heat map"], ["analyse-vol-dark.png", "Vol: IV rank and realised vs implied"], ["analyse-structure-dark.png", "Structure: term structure and skew"], ["analyse-screener-dark.png", "Options screener"], ["analyse-backtest.png", "Backtest"], ["analyse-replay.png", "Replay"], ["analyse-share-dark.png", "Share a strategy"]],
  },
  {
    file: "04-builder-templates-wizard.md",
    title: "Strategy Builder, templates and the wizard",
    screens: ["Analyse · Strategy panel (Builder)", "Analyse · Select Option from Chain (modal)", "Analyse · Add Futures Contract (dialog)", "Analyse · Save dialog", "Analyse · Strategy panel (Templates)", "Analyse · Strategy panel (Wizard)", "Analyse · Builder"],
    overview: `The Builder holds up to ten legs per asset, added from the chain, from the Select-from-Chain picker, from a template, or from the wizard. Each leg shows side, kind, strike, expiry, lots and price; the ticket prices the whole position (net premium, max profit and loss, breakevens, margin estimate) and the analysis pane follows it live.

Templates are a catalogue of 48 named strategies, including ones with a perpetual future leg, each with a textbook shape proven by tests. The wizard takes a view (up, down, sideways, volatile), a move and a date, and ranks defined-risk strategies for it. Drafts are saved on the server, so a strategy survives a reload and follows you across devices.`,
    tryIt: [
      "Chain → add two legs. Open **Builder**: change lots, flip a side, remove a leg; watch the ticket and payoff update.",
      "**Select from chain** in the Builder: pick several legs in the picker, **Add N legs**.",
      "**Templates**: pick Iron Condor; the legs fill from the live chain around ATM. Try one with a future leg.",
      "**Wizard**: choose a view, a move and a date; open one of the ranked cards into the Builder.",
      "**Save** with a name; reload the page; the draft is still there.",
    ],
    shots: [["analyse-builder-dark.png", "Builder with two legs and the ticket"], ["builder-select-from-chain.png", "Select from chain"], ["analyse-templates-dark.png", "Templates"], ["analyse-wizard-dark.png", "Strategy wizard"]],
  },
  {
    file: "05-paper-and-live-trading.md",
    title: "Paper trading, live trading, rules and accounts",
    screens: ["Analyse · Select Trading Mode (dialog)", "Analyse · Trade Preview (dialog)", "Analyse · Paper Trades panel", "Analyse · Strategy Details (modal)", "Analyse · Square Off Position (dialog)", "Analyse · Partial Exit (dialog)", "Analyse · Stop Paper Trading (dialog)", "Analyse · Live Trades panel", "Analyse · Confirm Adjustment Order (dialog)", "Analyse · Trade All → Live", "Analyse · trading integration", "Analyse · Paper / Live tabs", "Analyse · Live tab", "Trading · Enter Strategy Name", "Trading · Paper / Live tabs", "Trading · Trade Preview", "Trading · Trade Preview / Adjustment Review", "Trading · Live tab", "Trading · Paper and Live tabs", "Trading · server", "Trading · cards · Details · trade flow", "Trading · Paper and Live tabs · Closed", "Trading · trade dialog · cards · Details", "Trading · Live tab · net positions", "Trading · live entry", "Trading · Trade Preview · Trade All · Adjust confirm · Retry", "Trading · Live tab · resting order", "Trading · Trade Preview · Trade All", "Trading · Trade All → Live"],
    overview: `A strategy is traded from the Builder in one flow: choose Paper or Live, review the preview (legs, prices, capital block, overlap with other open strategies, the exchange's own check for live), optionally add a Protect rule, and place. Paper trades fill at mark and track P&L from the live feed. Live trades go to Delta Exchange through the stored API key: the preview shows the venue check and wallet, the typed word **LIVE** is required, and a Mindful pause applies when you are down on the day.

Cards on the Paper and Live tabs show P&L, greeks, days to expiry, lifecycle chips, order chips (filled, resting, cancelled) and actions: Details, Adjust, Square off, Partial exit, Set alert, Rules, Go live, Re-enter. Rules (strategy stop / target in money or %, leg stop, spot level, time) run on the server against the feed and exit for you. Expiry settlement closes legs at settlement with a reason. Positions are reconciled against the exchange with a drift check. Several labelled keys per exchange map to accounts; each strategy belongs to one.`,
    tryIt: [
      "Builder → **Paper trade** → Continue → Trade now → confirm the name → skip or set a Protect rule. The card appears on **Paper** with live P&L.",
      "Card → **Details**: legs, orders, P&L history. Card → **Square off** or **Partial exit**.",
      "Card → **Rules**: a strategy stop at −$50 and a target at +$100; watch the badges.",
      "Card → **Go live** (needs a Delta key in Settings): the preview shows the venue check and the wallet; type LIVE; place. On the **Live** tab the order chips show the fill.",
      "Paper tab → **Trade All → Live** previews the batch as one: every strategy's check and the wallet against the total.",
      "A resting limit entry shows a **Resting** chip: cancel it or re-price it from the card.",
    ],
    shots: [["analyse-trade-mode-dark.png", "Select trading mode"], ["analyse-paper-dark.png", "Paper trades"], ["analyse-details-dark.png", "Strategy details"], ["analyse-live-preview-dark.png", "Live preview with the exchange check"], ["analyse-live-dark.png", "Live trades with order chips"]],
  },
  {
    file: "06-adjustment-workbench.md",
    title: "Adjustment workbench",
    screens: ["Analyse · Adjustment workbench", "Trading · cards · Details · workbench", "Trading · Adjustment workbench · Review"],
    overview: `Adjust an open strategy without leaving the card: the workbench shows the position and its ticket, a live chain to add or close legs, and the analysis pane after the change, with before → after tiles (net premium, max loss, margin, open legs) and a change box that describes the change in words. Plans can be saved and compared against the position before it. Review shows the orders the change needs; for live strategies the venue check, the mark band, the order type and a hold-to-place confirmation.`,
    tryIt: [
      "Paper card → **Adjust**. Reduce a leg's lots, sell a call above ATM on the workbench chain; read the change box and the before → after tiles.",
      "**Review** → **Confirm**: the paper orders apply. Try **Exit** with an unsaved change: it asks first.",
      "Live card → **Adjust** → Review: the venue check, band and order type appear; hold to place.",
    ],
    shots: [["analyse-workbench-dark.png", "Workbench with a change"], ["analyse-adjust-confirm-dark.png", "Paper confirm"], ["analyse-adjust-live-dark.png", "Live confirm with venue check"]],
  },
  {
    file: "07-journal-and-verified-pnl.md",
    title: "Journal, verified P&L and the public page",
    screens: ["Analyse · Journal panel", "Trading · Closed chip · Journal", "Trading · cards · Details · Journal", "Trading · Journal"],
    overview: `The Journal lists every closed trade with its stats (win rate, average win / loss, profit factor), an equity curve, tags and notes, the close reason (expired, squared off, stopped, outside the app) and a CSV export. The verified block reads your actual fills from the exchange per key, computes realised P&L net of fees, and states whether it agrees with the Journal. That verified figure is what the public page shows.`,
    tryIt: [
      "Square off a paper or live strategy → open the **Journal** from Details. Tag it, add a note, export CSV.",
      "With a Delta key: **Refresh** in the verified block reads your fills and shows the agreement line.",
    ],
    shots: [["analyse-journal-dark.png", "Journal with a closed trade"], ["journal-verified-pnl.png", "Verified P&L from exchange fills"]],
  },
  {
    file: "08-alerts.md",
    title: "Alerts",
    screens: ["Shared chrome · Alerts center"],
    overview: `Alerts fire on price, ATM IV / IV rank, or a strategy's P&L, delivered by push (in the app), email and Telegram. Rules are evaluated on the server after every IV snapshot and in the browser while the workspace is open; a triggered alert turns the bell red. Telegram is linked from the alerts center with the bot.`,
    tryIt: ["Bell → **New alert**: BTC price above the current spot + 1 %; save; watch the bell. Card → **Set alert** pre-fills a P&L alert.", "Link Telegram from the alerts center and trigger an alert."],
    shots: [["analyse-alerts-dark.png", "Alerts center"], ["analyse-alerts-form-dark.png", "New alert from a card"]],
  },
  {
    file: "09-subscription-and-referrals.md",
    title: "Subscription, billing and referrals",
    screens: ["My Subscription", "My Referrals"],
    overview: `Plans (free, Starter, Pro and more from the admin's catalogue) with monthly and yearly intervals, coupons, Razorpay checkout, invoices with GST, payment history, and entitlements that gate features with an Upgrade dialog. Referrals: a personal link and code, commissions per referred subscription, earnings by month, share via WhatsApp / X / email.`,
    tryIt: ["`/subscription`: pick a plan, apply coupon `basic20` (on the mock), pay with the test checkout, open the invoice.", "`/referrals`: copy your link, share, and watch the table as referred users subscribe."],
    shots: [["account-subscribe-dark.png", "Subscribe with a coupon"], ["account-invoice-dark.png", "Invoice"], ["account-referrals-dark.png", "My referrals"], ["account-referrals-share-dark.png", "Share dialog"]],
  },
  {
    file: "10-admin.md",
    title: "Admin console",
    screens: ["Admin (index)", "Subscription Plans", "Menu Pricing Master", "Coupon Code Master", "User Subscriptions", "Banner Master", "Promotional Emails", "User Management"],
    overview: `For admins only: plans and pricing, coupons, user subscriptions with commissions (mark paid, bulk pay), banners with schedule and preview, promotional email campaigns with templates and history, and user management (search, plan, 2FA column, invite, drawer with subscription and referrals).`,
    tryIt: ["Sign in as the seeded admin (`pnpm --filter @hapiecoin/api db:seed` creates one) and open `/admin`.", "Plans → add a plan; Coupons → create and toggle one; Banners → new banner with a schedule; Emails → compose to selected users, then History."],
    shots: [["admin-index.png", "Admin home"], ["admin-plans.png", "Subscription plans"], ["admin-pricing.png", "Pricing master"], ["admin-coupons-dark.png", "Coupons"], ["admin-subscriptions.png", "User subscriptions"], ["admin-commissions-dark.png", "Commissions"], ["admin-commissions-mark-dark.png", "Mark a commission paid"], ["admin-banners-dark.png", "Banners"], ["admin-banner-dialog-dark.png", "Banner dialog"], ["admin-emails-dark.png", "Promotional emails"], ["admin-emails-history-dark.png", "Campaign history"], ["admin-users-dark.png", "User management"], ["admin-user-drawer-dark.png", "User drawer"]],
  },
  {
    file: "11-market-analytics.md",
    title: "Market Analytics",
    screens: ["Market Analytics (index)", "Markets (legacy path)", "Market Analytics shell", "Markets Hub", "Futures overview", "Futures Markets Screener", "Derivatives", "Options", "ETF", "Liquidations", "Whales", "Sentiment", "Coin analytics"],
    overview: `Market-wide pages fed by the ingest worker from public venue data (Bybit, Deribit, Delta, Hyperliquid, CoinGecko): the hub with open interest, funding and liquidation tiles, the markets screener with compare, derivatives (basis, long / short), options (expiries, max pain), liquidations feed and heat map, whales (Hyperliquid positions), sentiment (RSI, rainbow, fear and greed), and per-coin analytics. Pages marked "coming soon" wait on paid data feeds (see the backlog).`,
    tryIt: ["`/analytics/hub`, then Markets with `?compare=BTC,ETH`, Derivatives, Options, Liquidations, Whales, Sentiment, Coin BTC."],
    shots: [["analytics-hub-dark.png", "Hub"], ["analytics-overview-dark.png", "Overview"], ["analytics-markets-dark.png", "Markets screener with compare"], ["analytics-derivatives-dark.png", "Derivatives"], ["analytics-options-dark.png", "Options"], ["analytics-liquidations-dark.png", "Liquidations"], ["analytics-whales-dark.png", "Whales"], ["analytics-sentiment-dark.png", "Sentiment"], ["analytics-coin-dark.png", "Coin analytics"], ["analytics-etf-dark.png", "ETF (coming soon)"]],
  },
  {
    file: "12-terminal.md",
    title: "Market Analytics terminal",
    screens: ["Market Analytics terminal", "Dashboard", "Spot Markets", "Sector", "Bitcoin Spot ETFs", "Coin detail", "Exchange overview", "Open Interest", "Funding Rates", "Long / Short", "Exchange Balance", "Token Unlock Schedule", "Fear & Greed Index", "BTC Cycle Indicators"],
    overview: `A sidebar-driven terminal over the same snapshots: dashboard with a watchlist, spot markets with compare, sectors, per-exchange pages, open interest, funding, long / short readings, fear and greed, cycle indicators and coin detail. ETFs, exchange balances and token unlocks are marked coming soon (paid data).`,
    tryIt: ["`/terminal`: star two coins for the watch strip; then Spot, Sectors, Exchanges → binance, Derivatives → funding / long-short / open interest, Indicators → fear-greed / cycle, Coin BTC."],
    shots: [["terminal-dashboard-dark.png", "Dashboard"], ["terminal-spot-dark.png", "Spot markets"], ["terminal-sectors.png", "Sectors"], ["terminal-exchange-dark.png", "Exchange page"], ["terminal-open-interest.png", "Open interest"], ["terminal-funding-dark.png", "Funding"], ["terminal-long-short-dark.png", "Long / short"], ["terminal-liquidations.png", "Liquidations"], ["terminal-fear-greed-dark.png", "Fear and greed"], ["terminal-cycle-dark.png", "Cycle indicators"], ["terminal-coin.png", "Coin detail"], ["terminal-etf.png", "ETFs (coming soon)"], ["terminal-exchange-balance.png", "Exchange balance (coming soon)"], ["terminal-unlocks.png", "Token unlocks (coming soon)"]],
  },
  {
    file: "13-phone-and-home-screen.md",
    title: "Phone and the home-screen app",
    screens: ["Shared chrome · phone", "Analyse · Chain · phone", "Analyse · cards, panels and dialogs · phone", "Shared chrome · home-screen app", "Shared chrome · offline"],
    overview: `On a phone the header compacts, the two panes stack behind a Chain & Builder / Analysis switch, the tab strips scroll, the chain pans by touch and a tapped row shows finger-sized controls, and cards and tables scroll inside their own frames. HapieCoin installs to the home screen: Chrome and Android get the native prompt from the settings menu, an iPhone gets the two Share-sheet steps. A service worker serves a branded offline page when the connection drops and never caches prices, positions, orders or sessions.`,
    tryIt: ["On the desktop, Chrome DevTools → device toolbar → Pixel 7: stack, scroll the strips, tap a chain row, tap B.", "Settings → **Install app** (or the one-time hint). DevTools → Application → Service Workers → Offline → reload: the offline page; untick and **Try again**."],
    shots: [["analyse-phone-dark.png", "Pixel 7, dark"], ["analyse-phone-light.png", "Pixel 7, light"], ["analyse-iphone-dark.png", "iPhone 14"], ["install-dialog-iphone.png", "Install dialog on an iPhone"], ["offline-page.png", "Offline page"]],
  },
  {
    file: "14-platform-and-operations.md",
    title: "Platform and operations",
    screens: ["API · hardening", "API · replicas", "Gateway · replicas", "Venues · port", "Venues · port (web)", "Venues · column", "Venues · Deribit (data-only)", "Venues · API per venue", "Shared chrome · Error screen · browser error report", "Ops · API /metrics and the error sink"],
    overview: `Not screens but guarantees: request body limits and per-route rate limits on the order routes, one API replica running the background jobs and one gateway feeding, the venue port that lets a second exchange be added without touching the apps (Deribit is wired data-only), error tracking through a Sentry-protocol sink with browser errors relayed through the API, and Prometheus-style metrics on the API and the gateway behind a token.`,
    tryIt: ["`GET /healthz` on the API and the gateway; `GET /metrics` with the bearer token; trigger a browser error (the error screen offers a report).", "Switch venue in the header to Deribit (data-only) and back."],
    shots: [],
  },
];

// coverage check
const mapped = new Set(pages.flatMap((p) => p.screens));
const all = [...new Set(rows.map((r) => r.screen))];
const unmapped = all.filter((s) => !mapped.has(s));
if (unmapped.length) throw new Error("unmapped screens: " + unmapped.join(" | "));
const dup = pages.flatMap((p) => p.screens).filter((s, i, a) => a.indexOf(s) !== i);
if (dup.length) throw new Error("screen mapped twice: " + dup.join(" | "));

const outDir = root + "docs/guide/";
fs.mkdirSync(outDir, { recursive: true });
let index = "";
for (const [i, p] of pages.entries()) {
  const prows = rows.filter((r) => p.screens.includes(r.screen));
  const working = prows.filter((r) => r.status !== "static").length;
  const stat = prows.length - working;
  let md = `# ${p.title}\n\n`;
  md += `Part of the [HapieCoin feature guide](README.md). ${prows.length} traced features on ${p.screens.length} screens; ${working} built and tested, ${stat} still mock-only (listed in the backlog).\n\n`;
  md += `## What it does\n\n${p.overview}\n\n`;
  md += `## Try it\n\n${p.tryIt.map((s, k) => `${k + 1}. ${s}`).join("\n")}\n\n`;
  if (p.shots.length) {
    md += `## Screens\n\n${p.shots.map(([f, c]) => shot(f, c)).join("\n")}\n`;
  }
  md += `## Every feature, in detail\n\nEach row is one traced feature from the build spec: the id, what it is, how it behaves (the acceptance rule the tests check), and how it is tested. Status "mock-only" means the screen exists but the data feed behind it is not connected yet.\n\n`;
  for (const screen of p.screens) {
    const srows = prows.filter((r) => r.screen === screen);
    if (!srows.length) continue;
    const route = srows[0].route ? ` · \`${srows[0].route}\`` : "";
    md += `### ${screen}${route}\n\n| ID | Feature | How it behaves | Status | Tested by |\n|---|---|---|---|---|\n`;
    for (const r of srows) {
      md += `| ${r.id} | ${esc(r.feature)} | ${esc(r.acceptance)} | ${r.status === "static" ? "mock-only" : "built"} | ${esc(r.test)} |\n`;
    }
    md += "\n";
  }
  fs.writeFileSync(outDir + p.file, md);
  index += `${i + 1}. [${p.title}](${p.file}) — ${prows.length} features, ${working} built\n`;
}
console.log("pages written:", pages.length, "rows:", rows.length, "images available:", have.size);
