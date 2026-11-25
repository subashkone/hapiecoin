# Autopilot strategy builder: design for approval (25 November 2026)

Status: a proposal with mock screens. Nothing is built. The owner asked for it on 25 Nov 2026 and set the order: research and mocks first, approval, then build. The current Autopilot and its 85 built-in strategies are not touched by anything here.

Mock screens: https://claude.ai/artifact/Ni223PVQjgjhD7AK4LeVdQ (four boards: the admin's list, the builder form, test and approve, the customer's switch).

Research this rests on:
- [autopilot-live-compliance.md](../research/autopilot-live-compliance.md): the rules for automated trading for customers in India. Research, not legal advice.
- [delta-margin-verification.md](../research/delta-margin-verification.md): the margin estimate against Delta's documents and public product list.
- The code map below, read on 25 Nov 2026 (main 1800e92).

## 1. What the owner asked for

1. The strategies in Autopilot are configurations; an admin must be able to create, save, edit and delete them, with every setting the current ones have, including the time to enter.
2. Only admins create strategies. Customers are given them and can switch them on.
3. Paper and live. A strategy goes live only after it has been approved from its paper run.

## 2. What exists today (verified in the code)

- Every strategy is a fixed entry in `packages/pricing/src/playbooks.ts` (`Playbook` at lines 26-54, `PlaybookClock` at 56-115). No table stores one. 85 are offered to Autopilot: 6 trend, 43 daily, 21 weekly, 15 monthly.
- The engine (`apps/api/src/autopilot.ts`, `runAutopilot` at line 307) runs after every market snapshot, loops the fixed list, and writes a paper strategy with its exit rules. Its logic is driven by the fields, not by strategy names, so a saved configuration with the same fields would run on the same engine.
- The web screen imports the fixed list in the browser (`AutopilotPage.tsx:8`); the settings route refuses an id that is not in the list (`autopilot.ts:545`).
- The backtest figures shown for the daily, weekly and monthly strategies are a table typed in by hand (`playbooks.ts:851-931`) from research scripts outside the app (`docs/research/scripts/autopilot-study`). The app's own backtest (`runBacktest`) only knows a target, a stop and a time stop on daily prices. **It cannot test a leg stop, a trail, steps, a lock or a buy-back.**
- Paper only is enforced in several places: the engine never calls the order code; `apps/api/src/routes/live.ts:178` and `:344` refuse to take an Autopilot trade live.
- The live order path assumes a person: the typed LIVE word, the Mindful pause and the check of the prices the person saw at the preview (`live-exec.ts`).
- There is no way today to give one strategy to one named user or to one plan.

## 3. The design

### 3.1 A strategy moves through five stages

Draft → Backtested → On paper → Approved for live → Live. Plus Retired.

- **Draft**: saved, not tested. Only its author sees it.
- **Backtested**: the backtest has been run on the recorded prices with fees and fill costs, and the admin has seen the result. Only then can it be published.
- **On paper**: published to an audience. Autopilot opens paper trades for whoever switched it on. Its paper record builds.
- **Approved for live**: an admin has approved it against a checklist (3.4). Customers who can use it may now switch it to live, each with their own limits.
- **Live**: per customer, not per strategy. A strategy is live for a customer who has signed its mandate.
- **Retired**: no new entries; open trades keep their exits; the record stays. Delete is offered only for a strategy that never traded.

### 3.2 Saved beside the built-in ones, never instead of them

- A new table holds the saved strategies: the definition (the same fields the built-in ones have), the stage, the version, the audience, the backtest result, who made it and when.
- One loader gives the engine "the built-in list plus the active saved ones". The built-in list, its ids and its trades are unchanged.
- The built-in strategies appear in the admin screen in their own read-only tab. To change one, the admin duplicates it into a saved strategy.

### 3.3 Versions

Changing any entry, strike or exit setting of a strategy that has traded saves a new version with an empty record. The old version stays in history with its record, and its open trades keep the exits they were opened with. An approval for live does not carry over to a new version. Reason: otherwise a record earned by one set of rules would be shown for another.

### 3.4 Approval for live (proposed rules; the owner decides the numbers)

Checked by HapieCoin:
1. Backtest net is positive after fees and fill costs.
2. At least 30 days on paper.
3. At least 20 closed paper trades.
4. Paper net is positive after fees.
5. Every trade's loss is limited (bought options cover the sold ones), or every sold option has a stop.
6. The margin estimate for this structure has been checked against what the exchange held on a test trade.

Confirmed by the admin:
7. The admin has read its trades and its skipped entries.

Approval is recorded with the admin's name and the time and can be withdrawn at once: new live entries stop, open trades keep their exits.

### 3.5 What a customer signs before live (the mandate)

Per strategy and per version: the exchange account, lots per trade, the most capital it may use, a loss limit for the day and for the week, the number of trades open at once, four statements ticked, the typed LIVE word and the authenticator code. It replaces the per-trade LIVE word, which an unattended trade cannot have.

### 3.6 Who can use a strategy

Decided 25 Nov 2026: a strategy is given to **plans**. A user can switch a strategy on when the plan they hold is one of the strategy's plans. Two more audiences stay for the time before a strategy is ready for a plan: admins only (while it is being tested) and named users (the owner's "a couple of selected users" for live).

Plans already exist as rows an admin creates (`packages/schema/src/billing.ts`, `PlanInput`: name, limits per month, menu items). A plan has no list of strategies today; that link is new. How an admin gives a user a plan without a payment has to be confirmed in the code when step 1 is planned.

## 4. What the research found

### 4.1 Rules for automated trading in India (not legal advice)

- Delta Exchange India supports API trading and promotes third-party platforms, but its Terms (clause 7.2) say an individual account is for the account holder only. **No written permission for a platform that places orders on a customer's key was found.** Delta's written confirmation is needed.
- A trading key on Delta must have whitelisted IP addresses: live trading needs deployed servers on fixed IPs that each customer enters on their key.
- SEBI's retail algo rules are addressed to stock exchanges and brokers and do not appear to reach crypto derivatives on Delta. This is an inference, not a ruling.
- HapieCoin probably does not have to register with FIU-IND because it holds nobody's assets, but the wording of the 2023 notification is wide and a lawyer must confirm.
- Whether a paid service that trades a preset strategy on customers' accounts counts as investment advice or portfolio management is unsettled. One fixed strategy for everyone, chosen and capped by the customer, is the safer shape.
- Advertising: the fixed risk disclaimer is mandatory in ads, profits must not be promised, and returns for periods under twelve months must not be shown as returns. A 30-day paper record cannot be advertised as a return figure.
- Tax: Delta says its futures and options carry no 1 % TDS and no flat 30 % tax. That is the exchange's position; no government clarification was found. HapieCoin should not tell customers what their tax is.

**Nothing found forbids live Autopilot outright. Three things block it until done: Delta's written confirmation, a lawyer's opinion, and the signed mandate with hard limits.**

### 4.2 The margin figure

- GAPS #109 asked the wrong question. The unit (percent) is right. **The defect is that the code multiplies the scaling factor by the number of contracts; Delta's documents and product list say it applies per USD of position above a threshold** (`max_leverage_notional`, 200,000 USD for a BTC option in production), which the code never reads.
- At the owner's sizes the difference is small (the code overstates by at most 1.4 % below the threshold). Above the threshold the code understates: about 26 % low at 5,000 lots and 59 % low at 10,000 lots.
- A larger unknown: in isolated margin the trader's chosen leverage sets the margin, and the code assumes the highest leverage and never reads the setting. At 10x leverage Delta could hold twenty times the code's figure.
- Relief for a sold option covered by a bought one exists only in portfolio margin, an account mode the trader selects. The code's "no relief" is right for isolated margin.
- The testnet's margin parameters differ from production's, so a testnet trade proves the shape of the formula, not production's numbers.
- None of this is confirmed against a real position. The check is four steps the owner does on testnet; the predicted figures are in the research note.

## 5. What has to be built, in order

1. **Saved strategies on paper** (the builder itself): the table, the admin routes and screens (boards 1 and 2), the loader, the audience, versions, retire. The customer screen merges saved strategies into the list. No live. This is the bulk of what the owner described.
2. **The backtest inside the app**: the research backtest (leg stops, trails, steps, lock, buy-back, fees, fill costs, intraday prices) rebuilt in the app so "run the backtest" is a button. **This is the largest piece.** Until it exists, a saved strategy's backtest would have to be run by the research thread and entered by hand, which is how the built-in ones work today.
3. **Approval** (board 3): the checklist, the paper record per version, approve and withdraw.
4. **Live** (board 4): the mandate, per-strategy limits, the order path for an unattended entry, the kill switches, the margin fix, order and fill tracking fit for a server. Behind the three conditions in 4.1 and its own decision record.

Steps 1 to 3 change nothing about paper only. Step 4 does, and needs deployment first (fixed IPs).

## 6. The owner's decisions (25 November 2026)

1. **Approval numbers**: kept as in 3.4. At least 30 days on paper, at least 20 closed paper trades, backtest net and paper net both positive.
2. **Who approves for live**: the owner at first; later any user with admin rights. So approval is its own permission that starts with one named admin and can be widened, not simply "is an admin".
3. **Backtest**: start with backtests run by the research thread and entered by hand. The backtest inside the app (step 2 of section 5) comes after the builder is in use.
4. **A strategy whose loss is not capped never goes live**, even with a stop on every sold option. It can run on paper. The statement "Its loss is not capped by bought options" in the customer mock and the warning path in the approve mock are dropped when the screens are built.
5. **Live rollout**: the owner's account and a couple of users the owner selects, before anyone else.
6. **Delta and a lawyer**: not contacted now. The owner's reason: the exchange key already exists, HapieCoin is not public, and only people the owner knows will use it, for a few days. Both questions in 4.1 stay open and come back before live is offered to anyone outside that group or the product is made public.

Also decided with these answers:
- **Strategies are given to plans.** The admin assigns a strategy to one or more plans, and every user holds a plan. Plans are not shown or sold to users for now (ADR-140): the admin gives each user one of the plans that exist. Prices and benefits are discussed later; a first proposal is in section 8.

What decision 6 does not change: no live order is placed by Autopilot until step 4 of section 5 is built with its own decision record, and the margin check in 4.2 is done. The selected users each trade their own exchange account on their own key; Delta's clause 7.2 is a risk to their accounts as well as the owner's, and they should be told so before they sign the mandate.

## 7. What is not in this design

A new kind of rule (for example a futures hedge), sizing by account balance, more than one exchange, a marketplace of strategies written by customers, and showing results in advertising.

## 8. Plans and what each could include (a proposal, nothing decided)

The owner asked for anything in mind to be written down; prices and benefits are to be discussed later. This is a starting point for that talk, not a decision, and no price is proposed here.

- **Group strategies by risk, and tie the groups to plans.** This is the owner's earlier idea (risk-profile bundles). Three groups would be enough to start: loss limited by bought options; sold options with a stop on each; faster or larger structures. A lower plan gets the first group, a higher plan adds the next.
- **Paper for every plan, live for the higher ones.** Paper places no order and builds the record a customer needs before trusting a strategy. Live carries the support load and the risk, so it belongs to a paid plan, and only for strategies approved for live.
- **Limit by count, not by profit.** A plan can cap how many strategies run at once and how many live trades a month (a `live_trading` limit key already exists in `billing.ts`). Charging a share of profit would move HapieCoin towards portfolio management (4.1) and is better avoided until a lawyer has answered.
- **A plan never promises a return.** The plan page lists what a customer can use, never what a strategy earned; the advertising rule in 4.1 forbids figures for periods under twelve months.
- **What must be decided before plans go on sale**: the plan names and how many, which strategy group each includes, whether live is in every paid plan or only the top one, the limits per plan, and the prices.
