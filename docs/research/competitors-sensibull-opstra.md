# Competitor notes: Sensibull and Opstra (11 Sep 2026)

Status: research for the user's review. Facts come from the sources at the end; anything marked "not verified" was not
found in a primary source in this session. Both products serve **NSE index and stock options** with Indian brokers;
HapieCoin serves **crypto options on Delta Exchange India**. The audience, the data and the broker model differ, so
the value here is in product ideas and the business model, not feature-for-feature parity.

## 1. Sensibull (sensibull.com)
- **Scale**: ~200k monthly active users (2023-24), "2 million users" claimed; SEBI-registered research analyst; iOS and
  Android apps. Founded 2018; Zerodha holds a stake and **pays for it: free for every Zerodha customer**. Other
  brokers: Angel One, Upstox, ICICI Direct, Dhan, IIFL, 5paisa.
- **Pricing (non-Zerodha)**: Free plan (basic chain, Verified P&L, daily analysis, education, events, positions,
  FII/DII, expiry trades). Pro ₹1,300/month list, ₹800/month for one month, ₹640 for six, ₹392/month on a year.
- **Product**: strategy builder (25+ templates), Strategy Wizard (view + target + date → suggested strategies), Easy
  Options (pick a direction, get a defined-loss strategy), positions page with **named position groups, group P&L
  and exit-all**, basket orders, draft portfolios (paper), watchlist, advanced chain, OI and multi-strike OI charts,
  straddle/strangle charts, options screener, technical signals, IV chart, FII/DII data, live options charts,
  events calendar, free video education (English and Hindi), **Mindful Trading** (a pause before impulsive orders),
  **Verified P&L** (P&L read from the broker backend, published to X, one broker account per Sensibull account, free
  to view), **Conditional Exits** (June 2025: only *index price* conditions, executed by Zerodha's alert-triggers-
  order, Zerodha only; users keep asking for strategy P&L stop/target).
- **Praise**: real-time data, beginner-friendly, strategy builder projections, broker integration.
- **Complaints**: mobile charts cut off and slow, cluttered on phones, "bit expensive" for occasional traders, some
  reports of inaccurate strategy analytics and delayed charts, positions stop loss only per leg.

## 2. Opstra (opstra.definedge.com)
- **Model**: owned by Definedge Securities, a broker. **Full access needs a Definedge demat account**; brokerage
  ₹18 per derivatives trade; PRO subscription money converts to wallet points spent on brokerage. One-month PRO trial
  for new accounts. Users are not disclosed. Aggregate review rating ~2.5/5.
- **Free**: strategy builder (limited to two trades on the free tier per one review), paper portfolio with payoff,
  option chain with IV/OI/volume, EOD and intraday IV charts, futures dashboard, OI tracking, predefined strategies,
  order placement and positions (through Definedge).
- **PRO**: **options backtesting on EOD data**, **options simulator** (intraday, 5-minute steps, replay a past
  session), volatility skew and 3D surface, multi-OI charts, historical total OI, intraday charts, strategy charts,
  scanners ("options algorithm", "options activity").
- **Praise**: skew, IV charts, volatility surface, depth for advanced traders.
- **Complaints**: needs expertise, stocks and ETFs only, app freezes and login issues, mandatory demat account puts
  people off.

## 3. What HapieCoin already matches
Strategy builder with templates, live Greeks and payoff, paper and live trading with batch orders, positions
(strategies) with names and P&L, adjustments workbench (neither competitor has a combined before → after workbench),
alerts with Telegram (Sensibull has none server-side), IV history with rank and realised vol, analytics terminal,
journal, plans, referrals, education hooks, dark/light, keyboard-first.

## 4. What to take (ranked by value to a Delta India options trader)
1. **Strategy stop loss and target executed by HapieCoin** (docs/design/trade-lifecycle.md §2.3 A). Sensibull
   users have asked for this for years and it still only has index-price triggers on one broker. On Delta, where
   the API places orders directly, HapieCoin can do it properly. This is the single clearest differentiator.
2. **Verified P&L**: P&L read from Delta fills, a public page per trader, shareable to X and Telegram, one Delta
   account per HapieCoin account. It removes fake screenshots, and it is a growth loop: every share is an advert
   that only HapieCoin users can produce. Crypto Twitter and Telegram groups are where Delta traders live.
3. **Easy Options / Strategy Wizard** ("I think BTC goes up 3% by Friday" → three defined-risk strategies ranked):
   HapieCoin has the templates, the pricing engine, the fix-ranking (ADR-044 extra 3) and the assistant; the wizard
   is a thin layer over them. This is the beginner funnel both competitors use.
4. **Positions page with expiry filters and exit-all** (docs/design/trade-lifecycle.md §2.4): Sensibull's positions
   page is the reason traders open it every day. Ours needs the lifecycle chips, expiry sort and reasons.
5. **Backtesting and session replay** (Opstra's paid moat): HapieCoin now stores IV snapshots and option marks every
   five minutes (ADR-056). A "replay this expiry's chain" and an EOD strategy backtest on our own snapshots is
   reachable, and nothing like it exists for Delta India options.
6. **Mindful Trading**: a pause with the strategy's max loss, margin and the day's realised P&L before placing a
   live order when the trader is down on the day. Cheap; fits the "no confusion" bar.
7. **Options screener** on the chain data we already hold (highest IV rank, richest premium per day, widest skew).
8. **Mobile**: both competitors are criticised for phones. HapieCoin's narrow layouts exist but are untested by
   real traders on phones; a phone pass before launch is cheaper than the reviews afterwards.

## 5. Business model lessons
- **Broker pays**: Sensibull's growth came from Zerodha paying for every customer. The equivalent here is a Delta
  Exchange India partnership: Delta gains order flow from strategy traders; HapieCoin gets either a per-user fee or
  affiliate revenue on brokerage. Worth a direct conversation with Delta India; HapieCoin already has the referral
  and commission machinery (ADR-031) that a broker deal would reuse.
- **Free tier that is genuinely useful** (chain, positions, education, verified P&L) with the analysis behind the
  paywall (builder, screener, IV, alerts, backtests). HapieCoin's plans (ADR-030) can be tuned to this split.
- **Price anchor**: Sensibull effectively sells at ₹392–800 per month. Delta India's audience is smaller than NSE's;
  a lower Pro price with a yearly discount and a broker-paid path is the realistic shape.
- **Do not copy Opstra's mandatory-broker-account gate**: it is the most complained-about thing about it.
- **Education as acquisition**: both run free courses; Sensibull in Hindi and English. Crypto options education for
  Indian traders is thin; a short course tied to paper trading in HapieCoin is a low-cost funnel.
- **Verified P&L as marketing**: the only feature that markets itself.

## 6. Sub-accounts on Delta Exchange India (for trade-lifecycle §2.3 C)
Verified: Delta Exchange India offers sub-accounts; "each sub-account has its own margin balance, open orders, and
positions"; funds move between the main account and sub-accounts; withdrawals only from the main account; 2FA
required. **Not verified**: whether an API key can be scoped to a sub-account (the API guide does not say). The
user can confirm in the account's API key page whether a sub-account can be selected when creating a key.

## Sources
- https://sensibull.com/ · https://sensibull.freshdesk.com/support/solutions/articles/43000586718-what-are-the-charges-of-sensibull-
- https://www.strike.money/reviews/sensibull · https://equitiesindia.com/tools-directory/sensibull-review
- https://blog.sensibull.com/2023/07/24/sensibull-is-free-for-all-zerodha-users/
- https://blog.sensibull.com/2025/06/06/introducing-conditional-exits/
- https://blog.sensibull.com/2022/09/02/trade-better-with-sensibull-positions-page/
- https://blog.sensibull.com/2022/12/06/verified-pl-by-sensibull/ · https://sensibull.freshdesk.com/support/solutions/articles/43000696013-what-is-verified-by-sensibull-
- https://www.strike.money/reviews/definedge-opstra · https://www.definedgesecurities.com/faqs/opstra/
- https://knowyourbrokerage.in/tools/opstra · https://algotest.in/blog/opstra-strategy-builder-vs-algotest/
- https://www.delta.exchange/support/solutions/articles/80001177857-what-is-a-sub-account-
- https://www.delta.exchange/support/solutions/articles/80001174969-kickstarting-your-trading-journey-with-delta-india-apis
- https://www.laevitas.ch/ · https://about.greeks.live/ (crypto-native analytics vendors, for pricing context)
