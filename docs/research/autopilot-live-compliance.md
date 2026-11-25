# Live Autopilot: exchange terms, regulation and tax (25 November 2026)

**This is research, not legal advice.** It was put together from public web pages read on 25 November 2026. A written opinion from an Indian lawyer who works on virtual digital assets, and a chartered accountant's view on the tax points, are needed before HapieCoin's server places a single real order for a customer. Where I could not confirm a point from a primary source it is marked **UNVERIFIED**.

Companion note: [algo-trading.md](algo-trading.md) (section 3 point 6 lists the compliance questions this note works through).

How to read the sources: "primary" means the exchange's own page, the regulator's own document or the law itself. "Secondary" means a law firm note, a press report or a reproduction of an official text. Several pages were read through an automated page reader that returns short quotes and summaries, not the full text; where a clause matters (Delta's clause 7.2 above all) the owner or the lawyer must read the clause itself. Every source below was read on 25 November 2026 unless stated.

## Short answer

- **Delta Exchange India openly supports automated trading through its API, and it promotes third-party platforms that trade on a user's key.** But its Terms of Service also say an individual account is for the account holder only and that third parties may not trade on it. I found no written permission for a platform like HapieCoin. Get Delta's confirmation in writing before going live.
- **A trading key on Delta must have whitelisted IP addresses.** HapieCoin needs a fixed server IP that each customer enters on their key. Delta's key has two permissions, Read Data and Trading; there is no withdrawal permission in the documentation I read, and a sub-account cannot withdraw directly.
- **SEBI's retail algo rules do not appear to reach this.** They are addressed to recognised stock exchanges and stock brokers. Delta's own risk statement says its contracts are not traded on a recognised stock exchange and may not be regulated by SEBI. Crypto is still "not regulated" in India outside tax and anti-money-laundering law. That also means the customer has no regulator to complain to.
- **HapieCoin probably does not have to register with FIU-IND**, because it does not exchange, transfer or hold anyone's assets; the exchange does. This is my reading of the five listed activities, not a ruling. "Transfer" and "administration ... of instruments enabling control" are wide words and an API key with trading rights is uncomfortably close to them. A lawyer must sign this off.
- **The investment-advice / portfolio-management risk is real but unsettled.** SEBI's adviser and portfolio rules are written around securities; crypto has not been classified as a security. No source I found says a crypto strategy service needs a SEBI licence, and none says it is safe. Selling one fixed strategy to everyone, with the customer choosing and capping it, is the safer shape; anything tailored to a person, or any pooling of money, is not.
- **Advertising rules bite on how results are shown.** The ASCI guidelines require a fixed disclaimer on crypto ads, forbid promising profits, and say returns for periods under 12 months shall not be shown. A 30-day paper record cannot be used as a return figure in an advertisement.
- **Tax: Delta says its futures and options carry no 1 % TDS and no flat 30 % tax; profits are taxed at the trader's slab.** That is the exchange's position, widely followed, but there is no government clarification I could find and some advisers warn it could change. HapieCoin should not tell customers what their tax is.
- **Nothing I found forbids live Autopilot outright.** Three things block it until done: Delta's written confirmation on third-party order placement, a lawyer's opinion on questions 3 and 4, and a signed customer mandate with hard limits.

## 1. Delta Exchange India: API terms, keys, third parties

**Automated trading is allowed and encouraged.**
- Delta's API page (India entity, Excelium Technologies Private Limited) says: "Yes, you can fully automate trading strategies with the Delta Exchange API", "You can create a trading bot for automated trading in your preferred language/platform" and "Using the Delta Exchange API for algo trading or other operations is free." Primary. https://www.delta.exchange/algo/delta-exchange-apis
- Delta's help article on its APIs: "You can embark on your automated trading journey with Delta India by exploring these APIs." Primary. https://www.delta.exchange/support/solutions/articles/80001174969-kickstarting-your-trading-journey-with-delta-india-apis

**Third-party platforms on a user's key: promoted in practice, not granted in the Terms.**
- The same API page names third-party algo platforms as integrations, and Delta's blog walks a user through pasting the API key and secret into one of them and subscribing to pre-built strategies in that platform's marketplace (post dated 30 January 2024). Primary. https://www.delta.exchange/blog/how-to-trade-automated-strategies-on-delta-exchange-via-tradetron
- Against that, the Terms of Service (Excelium Technologies Private Limited, services limited to residents of India):
  - Clause 7.2, as returned by the page reader: an Individual Account "is provided on the basis that you are the only authorised user of the Account"; "You must not provide your Account details (including any access credentials, such as your email address, or password)"; third parties may not trade, deposit or withdraw; the user is responsible for their actions.
  - Clause 7.3: "You are at all times responsible and liable for any use of your Account."
  - Clause 8.1: "You are only permitted to access your Account using your user account login credentials." Clause 8.5 requires notice if any other person has access to or uses the account.
  - Clause 1.1.9 defines an "Authorised Representative" as "any person that is authorised to access and use the Platform on behalf of a user"; the reader's summary ties this to Institutional Accounts.
  - Clause 22.4 refers to a "Third-Party Service Provider" and says Delta is not responsible for transactions "conducted by you or your Authorized Representative".
  - Primary. https://www.delta.exchange/terms-of-use
- **What I could not find:** the Terms do not mention API keys at all, and I found no clause, help article or programme page that says a third-party platform may (or may not) place orders with a customer's API key. The page reader found no "last updated" date on the Terms. **UNVERIFIED: whether Delta treats an API key as an "access credential" under clause 7.2, and whether a platform placing orders on the key is a "third party trading" that the clause forbids.** The practice Delta itself promotes points one way; the wording of the clause points the other. Only Delta can settle it.
- Delta's API help article also says: "Never share your API secret or include it in client-side code." Primary. Same help URL as above. This is security advice, yet it sits awkwardly with handing the secret to a platform.

**Key permissions.**
- Two permissions: "Read Data" and "Trading". Trading "includes placing new orders, cancelling orders, closing positions, changing margin & leverage". Primary. https://docs.delta.exchange/
- The part of the documentation I read (the first 100,000 of about 346,000 characters) lists no withdrawal permission and does not say whether withdrawal is possible by API. The page mentions asset transfers and wallet transaction downloads. **UNVERIFIED: that no API key can withdraw, and whether a Trading key can move funds between a sub-account and the main account.**
- Sub-accounts: "You cannot directly withdraw funds from a sub-account"; funds can move between main and sub-account "anytime"; 2FA on the main account is required to create one. Primary. https://www.delta.exchange/support/solutions/articles/80001177857-what-is-a-sub-account-
- Delta's own blog advice for connecting a third-party platform: "restrict API key permissions to trading only, never enable withdrawals", plus IP whitelisting. Primary (Delta blog URL above).

**IP whitelisting is mandatory for trading keys.**
- "To create an API key with Trading permissions, whitelisted IP(s) must be provided." and "API requests using this API key will only succeed, if made from a machine with an IP address that was whitelisted." Several IPs can be listed. Primary. https://docs.delta.exchange/
- Consequence: HapieCoin's order-placing servers need fixed outbound IP addresses, published to customers, and a plan for changing them.

**Rate limits.**
- "Default Quota is 20000 for a fixed 5 minute window", reset every 5 minutes. Weights: 3 for reads such as products, order book, tickers, open orders, positions, balances; 5 for placing, editing or deleting an order; 10 for order history and fills; 25 for batch orders. Over the quota: HTTP 429 with an `X-RATE-LIMIT-RESET` header. A separate product-level limit of "500 operations per second for each product". Higher limits by asking support. Primary. https://docs.delta.exchange/
- The help article warns of requests being "throttled or your access temporarily suspended". Primary (help URL above).
- **UNVERIFIED: whether the 20,000 quota is counted per API key, per user or per source IP.** This matters a great deal when many customers' keys are used from the same HapieCoin IP.
- The Terms (clause 4.7) let Delta impose "transaction volumes, risk limits, rate limits, account limits, and order restrictions", without notice.

**Market conduct.** Clause 12.1(13) of the Terms: the user "will not be involved or initiate any form of market manipulation, including wash trading, spoofing orders". Many customers running the same strategy at the same second could cross each other's orders; that needs a design answer.

**Broker / partner / affiliate programme.** I found a consumer referral programme and a `/broker/trading-view` page for the TradingView integration, and a search result for an affiliate agreement page (https://www.delta.exchange/affiliate-agreement, not opened). I found no published partner or broker programme with terms for platforms that place orders. **UNVERIFIED: whether one exists by private agreement** (the third-party algo platforms Delta names presumably have some arrangement).

**Delta's own automated products** (shows how Delta treats the idea):
- "Algo Marketplace" under its AlgoHub menu: lets users "automatically mirror trades from top-performing, fully automated crypto trading strategies". The user picks a strategy card, sets a capital amount, sets a trailing stop loss (marked "Recommended", 5 % to 95 %), ticks a box agreeing to "Delta Exchange's Algo Marketplace Agreement" and subscribes. Fee per trade (example 0.03 % of notional), "No upfront subscription fees". Disclaimers: "The Algo Marketplace involves substantial risk, and past performance is not indicative of future results."; "profits or capital protection cannot be guaranteed."; "You are solely responsible for your investment decisions."; "Delta Exchange does not offer financial advice or personalized trading recommendations." Two exits: after the current position closes, or close everything at market now. Primary. https://www.delta.exchange/support/solutions/articles/80001185498-copy-trading-coming-soon
- I could not find the text of the Algo Marketplace Agreement, nor who writes the strategies. **UNVERIFIED.**
- "API Copilot" (an AI helper that writes API code): its terms advise users "not to deploy any AI-generated output in production, trading environments, or regulated activities" without their own checks, and refer to users who rely on "third party service providers or integrations" doing so at their own risk. Primary. https://www.delta.exchange/support/solutions/articles/80001178769-api-copilot-terms-conditions
- "Trading Bot: Automate Bots from TradingView" appears in the site menu. Primary (API page above).

## 2. Indian regulation: SEBI, the retail algo framework, legal status

**SEBI's retail algo framework is aimed at stock brokers and stock exchanges.**
- Circular SEBI/HO/MIRSD/MIRSD-PoD/P/CIR/2025/0000013 dated 4 February 2025, "Safer participation of retail investors in Algorithmic trading". Number, date and title confirmed on SEBI's site. Primary. https://www.sebi.gov.in/legal/circulars/feb-2025/safer-participation-of-retail-investors-in-algorithmic-trading_91614.html
- A reproduction of the circular's text says it is addressed to "All Recognized Stock Exchanges" and "Stock Brokers through Recognized Stock Exchanges", issued under section 11(1) of the SEBI Act, 1992 read with the SEBI (Stock Brokers) Regulations, 1992. Brokers are principals and algo providers their agents; algo providers must be empanelled with exchanges; algo orders carry an exchange-issued identifier; API access only through a vendor- and client-specific key and a static IP whitelisted by the broker; "black box" algo providers must register as Research Analysts; original start date 1 August 2025. Secondary (reproduction). https://taxguru.in/sebi/sebi-circular-safer-participation-retail-investors-algorithmic-trading.html
- Extension circular SEBI/HO/MIRSD/MIRSD-PoD/P/CIR/2025/132 dated 30 September 2025: number and date confirmed on SEBI's site. Primary. https://www.sebi.gov.in/legal/circulars/sep-2025/extension-of-timeline-for-implementation-of-sebi-circular-dated-february-04-2025-on-safer-participation-of-retail-investors-in-algorithmic-trading-_96979.html
- Dates from press reports (secondary, from search summaries; the SEBI page I opened did not show them): start moved from 1 August to 1 October 2025; first algo registration by 31 October 2025; mock session by 3 January 2026; brokers that miss the milestones barred from onboarding new retail API algo clients from 5 January 2026; full applicability to all stock brokers from 1 April 2026. https://www.business-standard.com/markets/news/sebi-extends-retail-algo-trading-framework-rollout-to-2026-125093000956_1.html **UNVERIFIED: whether there was any further extension after April 2026.**

**Does it reach crypto derivatives on Delta?** My reading: no, because Delta is not a recognised stock exchange and HapieCoin's customers are not clients of a stock broker for these trades. Supporting evidence:
- Delta's Risk Disclosure Statement (Appendix I of its Terms) says its products "may not be regulated by SEBI or any other Governmental Authority except by Financial Intelligence Unit" and "are not listed or traded on any recognized stock exchange in India". Primary. https://www.delta.exchange/terms-of-use
- Law firm notes: the SEBI Act does not explicitly address VDAs and SEBI "is not directly responsible for regulating VDAs", though it could be if the government classifies them as securities (AZB & Partners, June 2025, from a search summary, page not opened: https://www.azbpartners.com/bank/virtual-currency-regulation-review-2025/). A 2026 guide chapter says "there is no authorisation or licensing regime for cryptoasset issuers, providers or exchanges in India" (AZB & Partners, 18 June 2026). Secondary. https://www.legal500.com/intelligence/india/corporate-commercial-law/cryptoassets-law-guide-2026-india-chapter
- No source I found states in terms that the retail algo circular does not apply to VDA venues. It is an inference from the addressees. **UNVERIFIED as a legal conclusion.**
- The SEBI framework is still the best available picture of what an Indian regulator thinks safe retail algo trading looks like (static IP, per-client key, audit trail, a named party responsible for grievances, registration for black-box strategies). If crypto is ever brought under a regulator, expect something similar.

**Legal status of crypto and crypto derivatives for residents.**
- Minister of State for Finance, written reply in the Lok Sabha reported on 5 February 2026: VDAs "are currently not regulated"; service providers must register with FIU-IND. Secondary (press report of a parliamentary reply). https://www.businesstoday.in/personal-finance/tax/story/crypto-still-unregulated-but-under-tax-and-enforcement-radar-finmin-in-parliament-514849-2026-02-05
- Cyril Amarchand Mangaldas, 25 August 2026: "VDAs remain largely unregulated outside the tax framework"; compliance and enforcement happen "on an ad-hoc basis"; a comprehensive law is still pending. Secondary. https://corporate.cyrilamarchandblogs.com/2026/08/fig-paper-no-62-vda-series-12-regulating-virtual-digital-assets-global-trends-and-indias-emergent-supervisory-architecture/
- So: not banned, not licensed, taxed, and under anti-money-laundering supervision. I found no source that deals specifically with the legality of crypto **derivatives** for residents. **UNVERIFIED: any specific rule permitting or prohibiting INR-settled crypto options for residents.** A lawyer should also be asked whether an off-exchange cash-settled derivative is an enforceable contract under the Securities Contracts (Regulation) Act and the Contract Act's wagering rule; I did not research that point and cite no source for it.

**Delta Exchange India's own status.**
- Site footer: operated by Excelium Technologies Private Limited, "a FIU (Govt. of India) registered entity with REID: VA00041101". Primary (self-declared). https://www.delta.exchange/terms-of-use
- **UNVERIFIED against FIU-IND's own list**; I did not find or open the regulator's list of registered VDA service providers.
- FIU registration is an anti-money-laundering registration, not a licence to offer derivatives and not investor protection.

## 3. Does HapieCoin need FIU-IND registration?

**What the notification lists.** Ministry of Finance notification S.O. 1072(E) of 7 March 2023 under section 2(1)(sa)(vi) of the Prevention of Money-laundering Act, 2002 makes the following activities, "when carried out for or on behalf of another natural or legal person in the course of business", a designated business:
1. exchange between virtual digital assets and fiat currencies;
2. exchange between one or more forms of virtual digital assets;
3. transfer of virtual digital assets;
4. safekeeping or administration of virtual digital assets or instruments enabling control over virtual digital assets;
5. participation in and provision of financial services related to an issuer's offer and sale of a virtual digital asset.

Source: AZB & Partners' note quoting the notification. Secondary. https://www.azbpartners.com/bank/notification-under-section-2-of-pmla . The Gazette PDF itself (https://egazette.gov.in/WriteReadData/2023/244184.pdf) would not open from here (certificate error), so the wording above is **not checked against the Gazette**.

**The guidelines.** FIU-IND issued "AML & CFT Guidelines for Reporting Entities Providing Services Related to Virtual Digital Assets" on 8 January 2026, replacing those of 10 March 2023. They have a registration chapter (Chapter 2), require a full-time Principal Officer based in India, liveness-checked KYC, tamper-proof audit trails, monthly reporting, and say the obligations are "activity-based", with possible action under section 13 of the PMLA for non-registration. Secondary (AZB & Partners client update, 14 January 2026; I read the full PDF). https://www.azbpartners.com/wp-content/uploads/2026/01/Client-Update-FIU-Guidelines-2026-AZB-January-14-2026.pdf . I did not read the guidelines themselves.

**Applying it to HapieCoin (my reasoning, not a source).**
- HapieCoin does not take custody, does not hold keys that can withdraw, does not convert rupees to crypto or crypto to crypto, and does not move assets between persons. The exchange does the exchanging and the holding, and it is the registered reporting entity. On the face of the five items, a software service that sends order instructions to a registered exchange on the customer's own account does not obviously fall in any of them.
- The weak points: (a) "transfer" is undefined in the summaries I read, and (b) item 4 covers "instruments enabling control over virtual digital assets". An API key and secret with Trading permission do give control over positions and margin, even though they cannot withdraw. Options and futures on Delta are contracts, not tokens, which helps; but Delta also offers spot, and USDT-margined balances are VDAs.
- No source I found discusses non-custodial software, order-routing tools or API-based trading platforms under the notification. **UNVERIFIED: that HapieCoin is outside the notification.** This is the single most important question for the lawyer, because the cost of being wrong is a registration regime built for exchanges (Principal Officer, KYC of every customer, transaction monitoring, monthly reports).
- Things that would push HapieCoin toward being covered and should be avoided: holding a key that can withdraw or transfer out; touching spot conversions; collecting customers' money for trading; moving funds between a customer's accounts.

## 4. Investment advice, portfolio management, collective investment scheme; advertising and consumer rules

**Securities-law licences.**
- SEBI (Investment Advisers) Regulations, 2013: "investment advice" covers advice on dealing in "securities or investment products". Secondary (law firm commentary via search summary; I could not read SEBI's own PDF, which came back unreadable). https://www.sebi.gov.in/media/press-releases/may-2013/sebi-investment-advisers-regulations-2013_24819.html . **UNVERIFIED: the exact definition text, and whether "investment products" would be read to include crypto derivatives.**
- VDAs have not been classified as securities (law firm sources in section 2). Shardul Amarchand Mangaldas in the Chambers Fintech 2026 guide (search summary, page not opened): if a digital asset behaves like a security, SEBI is likely to regulate it as one. https://chambers.com/practice-guides/guides/fintech-2026/india/trends-and-developments
- A SEBI circular of 21 October 2021 told registered investment advisers to stop dealing in unregulated products (the example was digital gold). Search summary only. **UNVERIFIED** in detail. It binds registered advisers, which HapieCoin is not, but it shows SEBI's attitude: regulated people should not sell unregulated products, and unregulated people are simply outside its help.
- Opinion pieces have argued that in the securities market, algo marketplaces look like unregistered advice or portfolio management (Business Standard opinion, 2022, search summary). https://www.business-standard.com/article/opinion/time-to-change-sebi-rules-on-advice-122091100859_1.html . SEBI's 2025 answer for securities was the framework in section 2: black-box strategy sellers register as Research Analysts.
- Portfolio management: **UNVERIFIED.** I did not find the definition in the SEBI (Portfolio Managers) Regulations, 2020 from a readable source. From general knowledge, not a citation: a portfolio manager manages a client's portfolio of securities or funds under a contract, with or without discretion. Live Autopilot is discretionary execution on a client's account for a fee, which is the same shape of activity; the only thing keeping it outside is that the assets are not securities.
- Collective investment scheme: section 11AA of the SEBI Act turns on investors' contributions being pooled and used for the scheme. Secondary (search summary of the section). https://ies.gov.in/arthapedia/concept/collective-investment-scheme-cis . HapieCoin pools nothing: each customer's money stays in their own exchange account, in their own name, and each has their own positions. On that fact the pooling condition is not met (my inference). Keep it that way: no pooled account, no shared wallet, no profit share paid out of a common pot.
- **What practitioners say specifically about a crypto strategy or bot subscription: I could not find a single law firm note on it.** Searches for crypto copy trading, bots, advice and portfolio management under Indian law returned only general background. This gap is itself a finding.

**How the comparables protect themselves** (see section 6): "does not offer financial advice or personalized trading recommendations", "You are solely responsible for your investment decisions", the user chooses the strategy and the capital. The common thread is: the same strategy for everyone, the customer opts in and sets the size, the platform executes.

**Advertising: ASCI guidelines for virtual digital assets and linked services** (a self-regulatory code, applicable to ads published on or after 1 April 2022; the copy I read is dated 29 September 2023). I read the full text. Secondary host of a primary text. https://www.khaitanco.com/sites/default/files/2026-03/ASCI%27s%20Guidelines%20for%20Advertising%20of%20Virtual%20Digital%20Assets%20and%20Linked%20Services.pdf
- Mandatory disclaimer on "All ads for VDA products and VDA exchanges, or featuring VDAs": **"Crypto products and NFTs are unregulated and can be highly risky. There may be no regulatory recourse for any loss from such transactions."**
- Format: in print or static ads at least one fifth of the space at the bottom, plain background; in video at the end with a voice-over, on screen at least five seconds; on social media in every picture or video; in the main language of the ad. Short form where characters are limited: "Crypto products and NFT's are unregulated and risky" plus a link to the full text.
- The words "currency", "securities", "custodian" and "depositories" may not be used.
- "Information on past performance shall not be provided in any partial or biased manner. Returns for periods of less than 12 months shall not be included."
- Cost or profitability claims must be "clear, accurate, sufficient and updated".
- "No advertisement shall contain statements that promise or guarantee future increase in profits."
- No ad may suggest that VDA trading solves money problems or is so easy the consumer need not think twice; nothing may "downplay the risks".
- No comparison with a regulated asset class. Advertiser's name and a contact must be shown.
- **UNVERIFIED: whether a strategy-results screen inside the signed-in product, as opposed to the public site, an email or a social post, counts as an "advertisement".** The public home page, plan pages, emails and Telegram messages that mention results clearly could.

**Consumer law.**
- The Central Consumer Protection Authority's Guidelines for Prevention of Misleading Advertisements and Endorsements for Misleading Advertisements, 2022 (notified 9 June 2022): a disclaimer may expand or clarify a claim but must not contradict the material claim or hide material information, must be in the same language and font and prominently placed; penalties up to Rs 10 lakh for a misleading ad. PIB release (primary, read through a search summary) https://pib.gov.in/PressReleasePage.aspx?PRID=1832906 and law firm summaries. **UNVERIFIED** against the notification text, and I did not confirm how the guidelines apply to a software subscription.
- Practical meaning: a headline such as "earns X % a month" cannot be rescued by small print saying results are not guaranteed.

## 5. Tax mechanics

**The statute.** Flat 30 % on "income from the transfer of any virtual digital asset" (section 115BBH of the Income-tax Act, 1961), no set-off or carry-forward of losses, and 1 % TDS on payments for the transfer of a VDA (section 194S). Income Tax Department pages (primary, from search results; the department's VDA booklet returned HTTP 403 when opened): https://www.incometaxindia.gov.in/w/tds-on-payment-for-the-transfer-of-virtual-digital-assets-vdas- . The law firm guide in section 2 confirms 30 %, 1 % TDS and 18 % GST on certain exchange fees.

**From 1 April 2026 the Income-tax Act, 2025 applies.** Secondary sources place the VDA TDS at section 393(1) of the new Act (one gives table serial 8(vi)), still 1 %, and say the 30 % treatment is retained; Budget 2026 left the rates unchanged and added reporting penalties. https://blog.tdsman.com/2026/05/tds-on-virtual-digital-assets-section-3931-194s/ and https://decrypt.co/356601 (search summaries). **UNVERIFIED: the new Act's section number for the 30 % rate and the exact table entry for TDS.** Any product copy should avoid quoting section numbers.

**Do they apply to crypto derivatives? The exchange says no.**
- Delta, on TDS: "The 1% TDS is not applicable on transactions made in the futures and options segment." Primary. https://www.delta.exchange/support/solutions/articles/80001132760-is-there-1-tds-on-trades-that-i-make-
- Delta, on the 30 %: "30% VDA tax is not applicable on the trades that you make in the Futures and Options contracts." "Your net profits will be taxed as per your income tax slab." "Please consult your tax advisor for detailed advice on taxation." Primary. https://www.delta.exchange/support/solutions/articles/80001132761-is-there-30-vda-tax-applicable-on-trading-profits-
- Delta, on spot (for contrast): 1 % TDS on the sell value, 18 % GST on the trading fee, 30 % not deducted by Delta but payable by the user. Primary. https://www.delta.exchange/support/solutions/articles/80001195458-taxes-on-delta-india-spot
- Neither Delta article shows a publication date.

**But it is a position, not a ruling.**
- Tax commentary is split. One line: cash-settled crypto futures and options are not a "transfer of a VDA", so they are business income (often argued to be speculative business income) at slab rates, with the ordinary loss rules for that head. Another line: a conservative reading could treat income from a contract linked to crypto and settled in a stablecoin as VDA income, and the government may yet classify crypto derivatives as VDAs. Secondary, from search summaries of practitioner articles; pages not opened: https://taxguru.in/income-tax/taxation-crypto-futures-options-income-tax-act-1961.html , https://www.bdo.in/en-gb/news/2024/budget-2024-why-crypto-f-o-investors-are-happy-no-stt,-no-tds,-no-30-tax
- **I found no CBDT circular, FAQ or parliamentary answer that addresses crypto futures or options.** Stated as a finding.
- Settlement currency seems to matter to the stricter view (INR-settled contracts are on firmer ground than stablecoin-settled ones). **UNVERIFIED: how each contract HapieCoin trades on Delta India is margined and settled for tax purposes**; that needs the chartered accountant and Delta's contract specifications.

**Why it matters for a high-turnover Autopilot.**
- If the exchange's position holds: no TDS drag on each trade, losses offset gains within the head, tax at slab. The customer may need books of account and possibly a tax audit at high turnover (general knowledge, **UNVERIFIED**, a point for the accountant).
- If the position were reversed: 30 % on every winning trade with no set-off of losing ones would destroy any premium-selling strategy, and 1 % TDS on turnover would be worse. The mandate should tell the customer that tax treatment is unsettled and is theirs to check.
- Fees: the paper results must be shown after the venue's fees and the GST on them, or they overstate what a live account would keep (the project already tracks the real option fee and GST in GAPS #129).

**GST.**
- Delta charges 18 % GST on the trading fee (confirmed for spot in the article above; for futures and options from press and Delta-blog summaries, secondary).
- HapieCoin's own subscription is a supply of services; GST at 18 % on software or online services with registration once turnover crosses the threshold is general knowledge here, **UNVERIFIED** from a primary source and a question for the accountant, as is the invoice wording.

## 6. How comparable Indian products handle it

| Product | What it does | Key permissions and IP | Mandate and disclaimers | Source (read 25 Nov 2026) |
|---|---|---|---|---|
| Delta Exchange India: Algo Marketplace | Mirrors automated strategies into the user's own Delta account | Inside the exchange; no key handed over | Checkbox for the "Algo Marketplace Agreement"; user sets capital and a trailing stop loss per strategy; two exit modes; "past performance is not indicative of future results"; "Delta Exchange does not offer financial advice or personalized trading recommendations"; "You are solely responsible for your investment decisions"; fee per executed trade, no upfront fee | https://www.delta.exchange/support/solutions/articles/80001185498-copy-trading-coming-soon |
| Tradetron (as described by Delta's blog) | No-code strategies and a marketplace of pre-built strategies, placed on the user's Delta key | "Ensure you enable trading and data read permissions"; "never enable withdrawals"; user whitelists the platform's fixed IP 103.216.94.212; rotate keys | The blog's only risk wording is that "a basic understanding of derivatives is worth having before putting real capital at risk". The platform's own crypto page showed no regulatory or risk disclaimer when read, and I could not find its terms page (404). **UNVERIFIED: its terms and disclaimers** | https://www.delta.exchange/blog/how-to-trade-automated-strategies-on-delta-exchange-via-tradetron , https://tradetron.tech/crypto-trading |
| AlgoTest | Backtest and automated execution on the user's Delta key | Key named for the platform; "Trading" permission; user whitelists the platform's IP 146.190.8.95; email code and 2FA at key creation; secret shown once | Setup page carries no risk disclaimer; notes KYC, fees and limits are Delta's | https://docs.algotest.in/broker/deltaexchange/ |
| Mudrex (Futures API terms) | API for the user's own bots | "Withdrawal of funds (whether fiat or digital assets) is not supported via the API" | Licence "solely for your personal or internal business use"; must "not disclose, share, or otherwise make API Credentials available to any unauthorized third party"; the exchange has "no visibility into, control over, or responsibility for the logic, parameters, or behavior of any algorithm, bot"; the API "does not constitute financial advice, investment advice, or trading recommendations"; liability capped at 12 months of fees | https://docs.trade.mudrex.com/docs/api-terms-conditions |
| CoinDCX (API docs and licence terms) | API for the user's own programs | Optional "Bind IP Address to API key"; a bound key "cannot be shared with ony other user having different IP" | Licence "non-exclusive, non-transferable, non-assignable, non-sublicensable, revocable"; the user warrants it "has the relevant licenses to conduct any High Frequency Trading or Algorithmic Trading"; termination without notice or reason; I read the first third of the page only | https://docs.coindcx.com |
| Pi42 | API trading for futures | Advertises "API Keys with IP-Whitelisting" (search snippet) | Page returned HTTP 403; **UNVERIFIED** beyond the snippet | https://pi42.com/api-trading |

Patterns worth copying:
1. A key that can trade and read but cannot withdraw, locked to the platform's published fixed IP.
2. The customer chooses each strategy, sets the money at risk and a loss limit, and ticks a specific agreement for it.
3. An exit the customer can press at any time, in two forms: finish the current trade then stop, or close everything now.
4. Plain statements that there is no advice, no guarantee, and that the customer is responsible for the decision to switch it on.
5. The exchange's API terms put all responsibility for an algorithm on the account holder. Whatever HapieCoin does on a key, the exchange will look to the customer, and the customer will look to HapieCoin.

One contrast: exchanges that only offer an API for the user's own bots tend to forbid sharing the key with others (Mudrex, CoinDCX above), while Delta actively markets third-party platforms. That is why Delta's written confirmation is worth asking for: its behaviour is friendlier than its Terms.

## What is confirmed, what is not, who can confirm it

| Point | Status | Who can confirm |
|---|---|---|
| Delta India allows automated trading by API, free of charge | Confirmed (Delta's API page) | n/a |
| Delta promotes third-party platforms trading on a user's key | Confirmed (Delta's API page and blog) | n/a |
| Delta's Terms permit a third party to place orders on an individual's account | **Not confirmed; clause 7.2 reads against it; API keys are not mentioned in the Terms** | Delta Exchange India (support or partnerships, in writing); the lawyer reading clause 7.2 in full |
| Trading keys require whitelisted IPs | Confirmed (API docs) | n/a |
| Key permissions are Read Data and Trading only | Confirmed for the part of the docs read | Delta support; test on testnet |
| No API key can withdraw; a Trading key cannot move funds out of a sub-account | **UNVERIFIED** (sub-account cannot withdraw directly: confirmed) | Delta support; reading the rest of the API docs; a testnet check |
| Rate limit 20,000 weight per 5 minutes, order weight 5, 500 operations a second per product | Confirmed (API docs) | n/a |
| Whether the quota is per key, per user or per IP | **UNVERIFIED** | Delta support |
| A published partner or broker programme for platforms | **Not found** | Delta partnerships team |
| Text of Delta's Algo Marketplace Agreement | **Not found** | Delta account (the agreement is shown at subscription) |
| Delta is FIU-IND registered (REID VA00041101) | Self-declared on Delta's site; **not checked against FIU-IND's list** | FIU-IND website; the lawyer |
| SEBI retail algo circular is addressed to stock exchanges and stock brokers | Confirmed from a reproduction; number and date confirmed on SEBI's site | The circular PDF on sebi.gov.in |
| The SEBI framework does not apply to crypto derivatives on Delta | Inference, supported by Delta's risk disclosure and law firm notes; **UNVERIFIED as law** | Lawyer |
| Full applicability of the SEBI framework from 1 April 2026; no later extension | Press reports; **later status UNVERIFIED** | sebi.gov.in circulars |
| Crypto is "not regulated" in India; FIU registration required for service providers | Confirmed (parliamentary reply via press; law firm notes of 2026) | n/a |
| A specific rule on crypto derivatives for residents | **Not found** | Lawyer |
| The five activities in the March 2023 PMLA notification | Confirmed from a law firm quotation; **Gazette text not opened** | egazette.gov.in |
| HapieCoin is outside the notification (no FIU registration needed) | **UNVERIFIED; my reading only** | Lawyer; if doubt remains, a written query to FIU-IND |
| Offering preset auto-trading strategies for a fee is not investment advice or portfolio management | **UNVERIFIED; no practitioner note found either way** | Lawyer |
| No collective investment scheme, because nothing is pooled | Inference from section 11AA's pooling condition | Lawyer |
| ASCI disclaimer text, 12-month rule, banned words, no profit promises | Confirmed (full text read) | n/a |
| Whether in-product result screens count as advertisements | **UNVERIFIED** | Lawyer; ASCI |
| CCPA 2022 guidelines: disclaimers cannot contradict the claim | Secondary summaries; **text not read** | Lawyer |
| Delta deducts no 1 % TDS on futures and options and says the 30 % does not apply | Confirmed as Delta's stated position | n/a |
| That position is correct in law | **UNVERIFIED; no government clarification found; commentary split** | Chartered accountant; CBDT |
| Section numbers under the Income-tax Act, 2025 | Partly (section 393(1) for TDS, secondary); **30 % section UNVERIFIED** | Chartered accountant |
| GST treatment of HapieCoin's subscription | **UNVERIFIED** | Chartered accountant |
| Terms and disclaimers of Tradetron and Pi42 | **UNVERIFIED** (pages unavailable) | Their sites, read by hand |

## Conditions I would put on live Autopilot

These follow from the findings above. They are product conditions, not a substitute for the lawyer's opinion.

**Before any build goes live**
1. **Written confirmation from Delta Exchange India** that a third-party platform may place orders on a customer's API key at the customer's instruction, how clause 7.2 applies, whether there is a partner agreement to sign, and how rate limits are counted when many keys share one IP. Keep the reply on file. Without it, a customer's account could be restricted under the exchange's own Terms and the loss would land on HapieCoin's name.
2. **A lawyer's written opinion** on: FIU-IND registration (section 3), investment advice and portfolio management exposure (section 4), the wording of the mandate, and the liability clauses. A chartered accountant's note on the tax position and on GST for the subscription.
3. **One real, small, manual trade** on a production key first; every live order so far went to the testnet (ADR-092).

**Keys and access**
4. Accept only a key with Read Data and Trading; never ask for, store or use anything that can withdraw. Prefer a **dedicated sub-account** per customer for Autopilot, funded by the customer with only the capital they want at risk (a sub-account cannot withdraw directly).
5. Place orders only from **published fixed IP addresses**; tell the customer exactly which IPs to whitelist and never ask them to leave the whitelist open.
6. Verify at connection, and again before each session, that the key is alive, has the expected permissions and belongs to the expected account; stop if anything changed. Keys stay in the vault (ADR-054); never in logs.
7. HapieCoin never moves funds: no transfers between accounts, no spot conversions, no deposits or withdrawals. This keeps it away from the PMLA activity list.

**Mandate (one per strategy, per customer)**
8. A **written mandate** the customer accepts for each strategy before it trades live, stored with timestamp, IP, the exact text and version, and a second factor at acceptance. It names: the strategy and its rules in plain words, the instruments, the maximum capital, the maximum number of open positions and lots, a daily and a weekly loss stop, the hours it may trade, and what happens at each limit.
9. The mandate says in plain words: HapieCoin is a technology service, not an adviser, broker or portfolio manager; it gives no personal recommendation; the same strategy runs for every subscriber; the customer decided to switch it on and can switch it off; orders are placed on the customer's own exchange account under the exchange's terms; crypto is unregulated and there may be no regulatory recourse; tax treatment of crypto derivatives is unsettled and is the customer's to check.
10. **Paper first, per customer**: a strategy can go live for a customer only after it has an approved paper record, and the customer has seen that record, including its worst day and worst run.
11. A material change to a strategy's rules needs a **fresh mandate**; it must not silently change what a live strategy does. Never move a customer from paper to live, or onto a new strategy, without their act.

**Limits and stops**
12. All limits enforced on the server, not in the browser. A limit hit turns the strategy Off and tells the customer at once.
13. **Kill switches** at three levels: per strategy, per customer, global. The customer's Stop is always one press, in two forms: stop after the current trade, or close everything now.
14. Start with small caps set by HapieCoin (capital and lots per customer per strategy), raised only with experience.
15. Refuse to act on stale prices or after a failed read (GAPS #126 and #127 must be closed first); resolve every "unknown" order by client order id before sending anything again.
16. Stay well inside Delta's rate limits with a per-customer budget; design so that many customers on one strategy cannot trade against each other or look like co-ordinated order flow (stagger, use limits inside the mark band, cap total size per strike).

**How results are shown**
17. On the public site, plan pages, emails, Telegram and social posts: the ASCI disclaimer in full and in the required prominence; no return figure for a period under 12 months; no promise, no "guaranteed", no "safe income"; never the words "currency", "securities", "custodian" or "depositories"; no comparison with fixed deposits, mutual funds or other regulated products.
18. Every result is labelled **paper** or **live**, shows the period, the number of trades, the losing trades, the worst drawdown, and is **after fees and GST**. Backtests are labelled as backtests. No headline claim that the small print contradicts.
19. No testimonials about profit and no profit screenshots in marketing.

**Money and fees**
20. A flat subscription only. **No share of profits and no fee linked to gains**, and no handling of customer funds; both would make the service look like portfolio management or a pooled scheme.
21. No tax statements in the product beyond "check with your tax adviser"; link to the exchange's own tax help pages if needed. No section numbers in copy.

**Records and complaints**
22. Keep, per customer and strategy, an append-only record of: mandate versions, every signal, every order sent with its client order id, the exchange's reply, fills, limit hits, stops and notifications, for at least five years (the period is my suggestion; **UNVERIFIED** as a legal minimum for this business; the lawyer should set it).
23. A named complaints contact and a written process, since the customer has no regulator to go to. A daily statement of what Autopilot did on the customer's account.
24. An incident plan: what the customer is told, and how fast, when an order goes wrong or the service is down with positions open. Positions must stay protected by rules that do not depend on the entry job being alive.

**Who may use it**
25. Indian residents with a KYC-complete Delta Exchange India account in their own name, connecting their own key. No keys for accounts that belong to someone else, no accounts run on behalf of others, no minors.

**Review**
26. Re-check this note when any of these change: Delta's Terms of Service or API terms, an FIU-IND circular on who must register, any SEBI or government move to regulate VDAs or classify crypto derivatives, any CBDT statement on crypto derivatives, the ASCI guidelines.
