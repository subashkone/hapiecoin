# How HapieCoin can use AI, and where it makes money (14 September 2026, inventory refreshed 27 September)

Status: research for the user's decision; nothing here is scheduled (feature freeze, ADR-090). Written at a high level for someone deciding what to fund, with the engineering detail kept to what changes the decision.

## 1. Where AI stands today: an honest inventory

There is **no machine learning and no language model anywhere in the product**. No AI dependency exists in any package (checked every `package.json`). Everything that feels "smart" is deterministic maths or rules, which is a strength for a trading product, not a gap to apologise for:

| Feature | What it really is | Where |
|---|---|---|
| HapieCoin Assistant (the chat bubble) | A keyword-matched help bot with 16 hand-written answers about the platform, plus one templated "Explain this strategy" that reads the live analysis. It cannot answer a question it was not written for. | `apps/web/src/lib/assistant.ts`, ADR-036 |
| Strategy Wizard | Rule-based: a view, a move and a date; every defined-risk template is placed on the live chain and valued at expiry; ranked by payoff if the thesis comes true. | `apps/web/src/lib/strategy/wizard.ts`, ADR-072 |
| Options screener | Every listed option ranked by IV rank, premium per day and skew, computed from the chain the browser already holds. | ADR-076 |
| Alerts | Three rule kinds set by the trader: price, IV (ATM IV or IV rank), strategy P&L. Evaluated on the server every IV snapshot and in the browser. | ADR-052, ADR-057 |
| Stop / target rules | Five rule kinds run by the server every 2 s from public tickers: strategy stop, target, leg stop, spot level, time. | ADR-059, A4 |
| Backtest | A template replayed over our own recorded end-of-day chains, marked and settled by day. | ADR-077 |
| Mindful pause | A countdown before a live order on a day the trader is already down, decided on the server. | ADR-074, ADR-084 |
| Verified P&L | Realised P&L computed from the exchange's fills, net of fees. | ADR-073 |
| Repair ideas and the delta hedge (added after this note was first written) | Rule-based suggestions for a position the trader already holds, shown in the adjustment workbench: ranked repairs, and a hedge with the perpetual. They react to an open trade; they do not scan the market. | ADR-094, ADR-095 |

**Does the app suggest a strategy when an opportunity appears?** Only half-way. The screener ranks what is rich or cheap *right now* when the trader opens it, and the wizard answers *once the trader has a view*. Nothing watches the market for the trader and says "this is a premium-selling window, here is the trade". Alerts fire only on conditions the trader typed in. That gap, an **opportunity radar that comes to the trader**, is the single most valuable thing to build, and most of it needs no language model at all.

## 2. The asset nobody else in this niche has: our own recorded data

AI features are only as good as the data under them. HapieCoin already records, per venue and underlying:

- every option chain at the settlement hour, per strike (`chain_eod`, ADR-077), growing one day per day;
- IV snapshots every 5 minutes and per-instrument marks (`iv_snapshots`, `instrument_marks`, ADR-056);
- the trader's own strategies, orders, adjustments, closes with reasons, journal tags and notes, and exchange fills (ADR-059, ADR-073);
- market analytics snapshots: open interest, funding, long / short, taker volume, liquidations, options, RSI, premium, fear and greed, whales (ADR-038);
- the live feed through the gateway.

The competitor research (docs/research/competitors-sensibull-opstra.md) shows Sensibull's moat is brokers and scale, Opstra's is depth for experts. Neither builds on a per-user record of what the trader actually did and what it earned. That record is where personalised AI pays off, and the data compounds from the day of launch.

## 3. Eight ways to use AI, ranked by profit per unit of effort

The first three need no language model. They are statistics on data we already hold, delivered through channels we already have (alerts, Telegram, the bell, the cards).

### 3.1 Opportunity radar (no LLM) · highest value, lowest risk
A server job scores the market every IV snapshot against a small set of named, explainable setups, and pushes a card plus an alert when one appears:
- **Premium-selling window**: IV rank above 70 with realised vol below implied (we compute both), a flat or inverted term structure (Structure tab already has it), and no expiry inside 24 h → the wizard's "sideways" candidates, ranked by premium per day and probability of profit.
- **Cheap convexity**: IV rank below 20 with rising realised vol → defined-risk directional candidates.
- **Skew extremes**: 25-delta put skew beyond its own 1-year percentile → risk reversal and collar candidates.
- **Funding extremes**: OI-weighted funding beyond ±0.05 % with a crowded long / short ratio (analytics snapshots) → covered call or protective put on the perpetual leg the catalogue already supports.
- **Event windows**: the trader's own settlement calendar and the expiry ladder → "do not open new theta before Friday settlement" nudges.

The complete plans these signals open, with entry, management and exit rules on templates already in the catalogue, are in [strategy-playbooks.md](strategy-playbooks.md). Each signal is a rule with a threshold we can backtest on our own chain history before it ever reaches a trader, so the product can say "this setup made money on N of the last M days it appeared" and mean it. Delivery: a Radar tab beside the Screener, the bell, Telegram. Every card opens straight into the Builder with the legs filled.

*Why it makes money*: it is the feature a free user upgrades for, it drives trades (the broker-pays conversation with Delta, roadmap 14, values exactly this), and it is defensible because it runs on our recorded history.

### 3.2 Expected-value scoring of templates (no LLM)
The backtest already replays a template over our end-of-day chains. Turn it around: for the current IV regime (IV rank bucket, days to expiry, skew bucket), show each template's historical realised P&L, win rate and worst day from our own record, right on the template card and in the wizard's ranking. Grows more credible every week; the research (item 9) already promised this direction.

### 3.3 Natural-language alerts and rules (small LLM use)
"Tell me when BTC IV rank drops below 20 and funding turns negative" becomes an alert rule; "close half if I am up 5 % by Thursday" becomes a rule. The model only translates text into the alert and rule schemas we already have, the user confirms the parsed rule, and the existing engines run it. Cheap, contained, no numbers computed by the model. Turns the hardest part of alerts (the form) into a sentence.

### 3.4 Journal coach (LLM over the trader's own record) · highest retention value
Weekly and on demand: the model reads the trader's closed trades, tags, notes, close reasons, fills, the day P&L series and the Mindful pause events, and writes a short, specific review: "Four of your five losses this month were puts sold on Thursdays into settlement; your winners were spreads held to expiry; your average loser is 2.3× your average winner." Every number comes from our engine (the model is given the computed stats, it does not compute them). Delivered in the Journal and by email. This is the feature that makes a trader feel the product knows them, and it is what a paid tier is for.

### 3.5 Strategy advisor with tools (LLM + our own engines)
A conversation: "I think BTC drifts up to 85k by the 25th, I can lose 200 dollars". The model calls our tools: the wizard (ranked candidates), the pricer (payoff, greeks, breakevens, margin), the backtest (how the candidate did), the screener (which strikes are rich), the trader's positions (overlap, exposure). It then explains the top choices in plain language with the trade-offs, and hands the chosen one to the Builder. Rules that keep it honest and safe:
- the model never computes a price, a greek or a P&L; it only reads what our engine returned, so every figure on screen is the same one the Builder shows;
- it is decision support, not advice: no "buy this", always "here is what the numbers say and what could go wrong", with the existing disclaimer;
- it never places an order; the trade flow, the typed LIVE word and the Mindful pause stay exactly as they are.

### 3.6 Assistant upgrade: retrieval over the guide (LLM)
Replace the 16 keyword answers with a model that answers from `docs/guide` (the 14 area pages we just wrote are the perfect corpus), the spec rows and the ADRs. It cuts support load, helps onboarding, and the same corpus is the advisor's knowledge of the product. The cheapest model does this well.

### 3.7 Volatility regime model (statistics, later ML)
A GARCH-type or regime model on our IV and realised-vol history to improve the Scenarios tab's expected move and the radar's thresholds. Useful, not urgent, and never a price forecast: the product should never claim to predict direction.

### 3.8 Risk guardian (no LLM)
Server-side anomaly checks on things we already track: drift between the exchange and the strategies, margin proximity, a fill far from mark, a rule that fired late. Push, do not wait for Reconcile. Low glamour, high trust.

**Not recommended**: a "predict the price" model, auto-trading bots, or copy-trading of AI signals. They invite regulatory trouble, they lose, and the first bad week ends the product's reputation.

## 4. What it costs to run (language-model features only)

Anthropic first-party prices at the time of writing: Claude Opus 5 $5 per million input tokens and $25 per million output; Claude Sonnet 5 $2 / $10; Claude Haiku 4.5 $1 / $5. Prompt caching cuts repeated prefix input to about a tenth; the Batch API halves the price of anything that can run overnight.

Estimate per active paying user per month, assuming the advisor on Opus 5 (correctness matters), the help bot on Haiku 4.5, the weekly coach on Opus 5 through the Batch API, and the system prompts and tool definitions cached:

| Feature | Volume assumed | Cost per user per month |
|---|---|---|
| Advisor conversations | 30 turns, ~8k tokens in (6k cached), 1.5k out | about $1.5 |
| Journal coach | 4 reviews, 20k in, 2k out, batch priced | about $0.3 |
| Help bot | 50 questions, 3k in, 0.5k out | about $0.3 |
| Natural-language alerts | 20 parses | under $0.1 |
| **Total** | | **about $2.2, roughly ₹190** |

Against the competitor price anchor of ₹392–800 per month for the paid tier, the AI cost fits inside a Pro price, or justifies an AI tier at ₹999+ with fair-use caps. A user who never opens the advisor costs nothing. The radar, EV scoring and risk guardian cost only compute we already run.

## 5. How it makes HapieCoin profitable

1. **Conversion**: the radar and the wizard's EV scores are visible to free users but the trades they propose open only on Pro. Today Pro sells charts; with this it sells opportunities.
2. **Retention**: the journal coach is the reason to keep paying after the novelty wears off; it gets better the longer the trader stays.
3. **Volume**: every radar card and advisor answer ends in the Builder with the legs filled. More placed strategies is what a broker-pays or affiliate deal with Delta Exchange India pays for (roadmap 14). The verified P&L public page then markets the results for us.
4. **Support cost**: the guide-backed assistant answers the questions support answers today.
5. **A moat that compounds**: our chain history, our signals' track record, and the trader's own record are things a competitor cannot buy.

## 6. Risks and the rules that contain them

- **Regulation**: crypto derivatives on Delta India sit outside SEBI's research-analyst regime as far as I know, but I have not verified this and advertising rules for virtual digital assets do apply; get counsel before any feature says "you should". Design rule: decision support with the numbers, never a recommendation to trade, the disclaimer everywhere, and the model never places an order.
- **Hallucination**: the model must never produce a number. Every figure comes from `packages/pricing` and the API; the model narrates. Enforced by giving it tools that return computed results and by tests that diff the advisor's quoted figures against the engine's.
- **Cost drift**: caps per user per month, caching, batch for anything overnight, usage metered per account and shown in the admin console.
- **Trust**: every radar signal ships with its own backtested record; a signal that stops working is retired by the numbers, not by opinion.
- **Data**: the personal coach reads only the trader's own data, and the public page shows only what the trader turned on.

## 7. A phased proposal (after launch, on your go)

| Phase | What ships | Effort | Needs |
|---|---|---|---|
| AI-1 Radar | Opportunity radar with five backtested setups, Radar tab, alerts and Telegram delivery, EV scores on template cards | 3–4 weeks | 30+ recorded days of chains (accumulating now) |
| AI-2 Language | Natural-language alerts and rules; the assistant on the guide corpus | 2 weeks | an Anthropic API key in the secret store |
| AI-3 Coach | Weekly journal coach, in the Journal and by email | 2 weeks | AI-2 plumbing, the mailer |
| AI-4 Advisor | Conversational advisor with the wizard, pricer, backtest, screener and positions as tools | 3–4 weeks | AI-2, legal review of the copy |
| AI-5 Models | Vol regime model into Scenarios and the radar thresholds; risk guardian | 3 weeks | 90+ days of history |

AI-1 is the one to fund first: it creates the reason to upgrade, needs no language model, no legal review and no new spend, and it produces the track record the later phases quote.

## 8. What I would measure

Free-to-Pro conversion, radar cards opened and traded, trades per active user, 30-day retention of coach readers versus non-readers, language-model cost per active user, support questions per user, and the signals' live hit rate against their backtest.
