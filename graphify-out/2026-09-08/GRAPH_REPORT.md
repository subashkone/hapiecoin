# Graph Report - HapieCoin  (2026-09-08)

## Corpus Check
- 543 files · ~1,560,682 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 4018 nodes · 8643 edges · 231 communities (186 shown, 28 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 130 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `7a1c32ee`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- b-core.js
- routes-report2.md
- 20-landing.js
- anchors-trim.md
- 10-header.js
- d-lists.js
- 60-palette.js
- c-dialogs.js
- 40-assistant.js
- 40-payoff.js
- buildspec.js
- mockup-clone/core.js
- mockup-v2/core.js
- 30-auth-legal.js
- e-journal.js
- mockup-clone/assemble.js
- mockup-v2/assemble.js
- update-features.js
- 70-alerts.js
- HapieCoin · decision log (ADR)
- chunks-report.md
- mockup-clone/inventory.js
- 03-core.js
- features-v2.js
- mockup-v2/inventory.js
- feat-update.js
- _lib.js
- mockup-clone/qa.js
- 80-shortcuts.js
- mockup-v2/qa.js
- build.js
- 30-banner-flyers.js
- 50-tour.js
- CoinGreeks clone · build brief for screen agents
- 90-portfolio-bar.js
- build-chrome.js
- build-public.js
- 20-dialogs.js
- HapieCoin v2 · brief for the improved-UX build
- merge-v2.js
- mockup-clone/README.md
- mockup-v2/README.md
- build.sh
- test-hooks.js
- hooks
- HapieCoin
- TypeScript rules (real build)
- HapieCoin · Claude Code environment
- Product context · HapieCoin
- System patterns · HapieCoin
- Trading safety
- Active context · HapieCoin
- Product identity
- plan/SKILL.md
- checkpoint/SKILL.md
- commit/SKILL.md
- frontend.md
- mock-builds.md
- testing.md
- workflow.md
- recalc
- queries.ts
- api/src/app.ts
- harness.ts
- venues/src/index.ts
- Coalescer
- e2e/fixtures.ts
- transport/ws.test.ts
- AuthForms.tsx
- AppHeader.tsx
- next
- normalize.ts
- protocol.ts
- gateway/src/app.ts
- helpers.tsx
- gateway/package.json
- ThemeProvider.tsx
- auth.ts
- ui/package.json
- web/package.json
- Preview.tsx
- PayoffPanel.tsx
- devDependencies
- tokens.ts
- ui/src/index.ts
- mailer.ts
- pricing/src/index.ts
- market.ts
- api/src/config.ts
- GatewayServer
- app/page.tsx
- strategy.ts
- venues/package.json
- delta/chain.ts
- fmtPrice
- config/package.json
- pricing/package.json
- TemplatesPanel.tsx
- fixtures/chain.ts
- delta/ws.test.ts
- tasks
- api/package.json
- StrategyDetailsDialog.tsx
- schema/package.json
- accounts.ts
- BuilderPanel.tsx
- chain.test.tsx
- compilerOptions
- black76.ts
- rest.ts
- schema-adapter.test.ts
- compilerOptions
- columns.ts
- private-client.ts
- RedisPipelineLike
- builder.test.tsx
- validation.test.ts
- gateway.ts
- ReconnectingSocket
- devDependencies
- primitives.ts
- cn.ts
- DeltaWsClient
- log.ts
- MarketFeed
- FakeMarketData
- check-budget.mjs
- ChainTable.tsx
- DeltaMarketData
- config/eslint.config.js
- Button.tsx
- dependencies
- trading.ts
- package.json
- DensityProvider.tsx
- FakeWebSocket
- renderBuilder
- FakeWebSocket
- scripts
- compilerOptions
- delta/market-data.ts
- analysis.test.tsx
- Workspace · Builder, templates and the analysis pane · design pass · 2026-09-08
- gateway/tsconfig.build.json
- dependencies
- scripts
- web/tsconfig.json
- devDependencies
- expiry.ts
- Tabs.tsx
- api/tsconfig.build.json
- vitest.base.js
- RedisLike
- FakeConnection
- context.ts
- pricing/tsconfig.build.json
- schema/src/index.ts
- ui/tsconfig.json
- ui/tsconfig.build.json
- venues/tsconfig.build.json
- api/tsconfig.json
- gateway/tsconfig.json
- store.ts
- compilerOptions
- schema/tsconfig.json
- exports
- venues/tsconfig.json
- library.json
- pricing/tsconfig.json
- feed.ts
- scripts/client.ts
- AppHeader.test.tsx
- playwright.config.ts
- proxy.ts
- Phase 1 engineering brief (read fully before writing code)
- schema/tsconfig.build.json
- api/src/index.ts
- types/config-modules.d.ts
- gateway/config-modules.d.ts
- web/types/hapiecoin-config.d.ts
- pricing/config-modules.d.ts
- ui/types/hapiecoin-config.d.ts
- AGENTS.md
- next-env.d.ts
- venues/types/hapiecoin-config.d.ts
- SOURCE
- format.ts
- pricing/client.ts
- src/server.ts
- Item 2 · column set and Column Settings dialog · design pass · 2026-09-07
- scripts
- auth/page.tsx
- MEMORY.md
- devDependencies
- src/strategies.ts
- dialogs.test.tsx
- FakeDeltaTradingClient
- LegalPage.tsx
- NetPositionsPanel.tsx
- getServerUser
- inputs.tsx
- dependencies
- trading.test.ts
- GatewayClient
- routes/strategies.ts
- Phase 3 · Paper and live trading · plan and design pass · 2026-09-08
- pane-follow.test.tsx
- DeltaTradingClientImpl
- delta/page.tsx
- Providers.tsx
- trading-live.test.tsx
- DeltaTradingClient
- api/src/env-file.ts
- drizzle-kit

## God Nodes (most connected - your core abstractions)
1. `useUiStore` - 79 edges
2. `cn()` - 58 edges
3. `fmtPrice()` - 39 edges
4. `GatewayServer` - 34 edges
5. `MarketFeed` - 33 edges
6. `fmtMoney()` - 33 edges
7. `createTestApp()` - 31 edges
8. `GatewayClient` - 30 edges
9. `fmtStrike()` - 29 edges
10. `TestApp` - 28 edges

## Surprising Connections (you probably didn't know these)
- `fixtureInstruments()` --indirect_call--> `toInstrument()`  [INFERRED]
  apps/gateway/src/test-support/fixtures.ts → packages/venues/src/delta/normalize.ts
- `render()` --indirect_call--> `legs`  [INFERRED]
  mockup-v2/src-trd/c-dialogs.js → packages/pricing/src/worker/worker.test.ts
- `RootLayout()` --calls--> `publicEnv`  [EXTRACTED]
  apps/web/src/app/layout.tsx → apps/web/src/lib/env.ts
- `BuilderPanel()` --indirect_call--> `localLegToInput()`  [INFERRED]
  apps/web/src/components/builder/BuilderPanel.tsx → apps/web/src/lib/strategy/paper.ts
- `AccountMenu()` --calls--> `useUiStore`  [EXTRACTED]
  apps/web/src/components/header/AppHeader.tsx → apps/web/src/lib/store.ts

## Import Cycles
- None detected.

## Communities (231 total, 28 thin omitted)

### Community 0 - "b-core.js"
Cohesion: 0.07
Nodes (29): activeLegs(), bindTemplates(), brokerName(), brokerOf(), brokerShort(), currentPrice(), dateLabel(), feeFor() (+21 more)

### Community 1 - "routes-report2.md"
Cohesion: 0.04
Nodes (48): /admin/banners <Ant+wt>, /admin/coupons <Ent+wt>, /admin/emails <Vnt+wt>, /admin/menu-pricing <Cnt+wt>, /admin/subscriptions <Nnt+wt>, /admin/user-subscriptions <Pnt+wt>, /admin/users <Gnt+wt>, /admin <wt> (+40 more)

### Community 2 - "20-landing.js"
Cohesion: 0.11
Nodes (38): animateCounts(), hide(), init(), pubTerminal(), renderAnalytics(), renderCaps(), renderExch(), renderHero() (+30 more)

### Community 3 - "anchors-trim.md"
Cohesion: 0.06
Nodes (30): "Add a leg — try it now"  [window, 10000 chars], "Analytics sections"  [tct, 1319 chars], "Archived Strategies"  [window, 10000 chars], "Change Password" : NOT FOUND, "Chart Layers"  [window, 10000 chars], "Column Settings"  [window, 10000 chars], "Connecting to Live Prices"  [window, 10000 chars], "Draft Strategies"  [window, 10000 chars] (+22 more)

### Community 4 - "10-header.js"
Cohesion: 0.17
Nodes (21): AV_ICON, avatarSvg(), basePrice, chg24(), curExpiry(), expLabel(), feedHtml(), headerAction() (+13 more)

### Community 5 - "d-lists.js"
Cohesion: 0.18
Nodes (17): bindList(), bindLive(), bindPaper(), filterRows(), legChip(), legRow(), liveRows(), ordersHtml() (+9 more)

### Community 6 - "60-palette.js"
Cohesion: 0.16
Nodes (14): pal, PAL_GROUPS, PAL_ICON, palCompute(), palDiscoverRoutes(), palFuzzy(), palHighlight(), palHint() (+6 more)

### Community 7 - "c-dialogs.js"
Cohesion: 0.20
Nodes (17): toStratLeg(), bodyHtml(), feeLine(), footHtml(), key(), render(), renderAll(), renderBody() (+9 more)

### Community 8 - "40-assistant.js"
Cohesion: 0.23
Nodes (13): answerFor(), ANSWERS, ask(), chat, chatButton(), closeChat(), onAnalyse(), openChat() (+5 more)

### Community 9 - "40-payoff.js"
Cohesion: 0.23
Nodes (14): compute(), dayLabel(), draw(), hover(), init(), oiFromChain(), oiRebased(), renderLegend() (+6 more)

### Community 10 - "buildspec.js"
Cohesion: 0.14
Nodes (15): acceptance(), areaMeta, byPhase, byStatus, counters, csv, features, fs (+7 more)

### Community 11 - "mockup-clone/core.js"
Cohesion: 0.21
Nodes (6): close(), closeAll(), confirm(), open(), set(), toggle()

### Community 12 - "mockup-v2/core.js"
Cohesion: 0.21
Nodes (6): close(), closeAll(), confirm(), open(), set(), toggle()

### Community 13 - "30-auth-legal.js"
Cohesion: 0.29
Nodes (11): bindOtp(), bindRules(), checkEmail(), finishLogin(), init(), renderAuth(), renderTicker(), setErr() (+3 more)

### Community 14 - "e-journal.js"
Cohesion: 0.28
Nodes (12): bindJournal(), copyText(), csvOf(), equityCurve(), jClosedLegs(), JFILTERS, jLeg(), jRow() (+4 more)

### Community 15 - "mockup-clone/assemble.js"
Cohesion: 0.17
Nodes (10): byScreen, core, featDir, features, fs, head, partsDir, path (+2 more)

### Community 16 - "mockup-v2/assemble.js"
Cohesion: 0.17
Nodes (10): byScreen, core, featDir, features, fs, head, partsDir, path (+2 more)

### Community 17 - "update-features.js"
Cohesion: 0.18
Nodes (7): acc, accNew, adm, admNew, dir, fs, path

### Community 18 - "70-alerts.js"
Cohesion: 0.20
Nodes (4): AL_CHANNELS, AL_KINDS, alCurrent(), alRowHtml()

### Community 19 - "HapieCoin · decision log (ADR)"
Cohesion: 0.07
Nodes (28): ADR-001 · Product name and reference (2026-09-07), ADR-002 · Two mocks kept side by side (2026-09-06), ADR-003 · Design system: Obsidian Desk, dark-first (2026-09-06), ADR-004 · Stack (2026-09-04, confirmed 2026-09-07), ADR-005 · Monorepo with independently deployable apps (2026-09-07), ADR-006 · Chain driven by the exchange instrument list (2026-09-07), ADR-007 · Traceability as the definition of done (2026-09-07), ADR-008 · Knowledge graph for project memory (2026-09-07) (+20 more)

### Community 20 - "chunks-report.md"
Cohesion: 0.20
Nodes (9): CoinglassHomeSection-D6xN45sU.js (15282 chars, 107 strings), DerivativesSection-Dd2I6qhc.js (13540 chars, 49 strings), EtfFlowsSection-CZWJrPVX.js (8804 chars, 49 strings), LiquidationsSection-945dx5UJ.js (14552 chars, 54 strings), MarketsSection-ZpFf9Ip5.js (2637 chars, 16 strings), OptionsSection-CnwbPOBa.js (6432 chars, 40 strings), requoteLegs-CzbXBOh4.js (625 chars, 5 strings), SentimentSection-ppBTCoUp.js (13488 chars, 95 strings) (+1 more)

### Community 21 - "mockup-clone/inventory.js"
Cohesion: 0.20
Nodes (8): areaNames, areas, counts, featDir, features, fs, path, screens

### Community 22 - "03-core.js"
Cohesion: 0.31
Nodes (6): add(), clear(), ext(), panel(), strip(), toggle()

### Community 23 - "features-v2.js"
Cohesion: 0.20
Nodes (5): a, dir, fs, path, t

### Community 24 - "mockup-v2/inventory.js"
Cohesion: 0.20
Nodes (8): areaNames, areas, counts, featDir, features, fs, path, screens

### Community 25 - "feat-update.js"
Cohesion: 0.22
Nodes (6): a, add, file, fs, out, path

### Community 26 - "_lib.js"
Cohesion: 0.06
Nodes (48): cmd, input, { readInput, deny }, rules, base, input, r, { readInput, projectDir, isUnder, rel, deny, path } (+40 more)

### Community 27 - "mockup-clone/qa.js"
Cohesion: 0.25
Nodes (7): { chromium }, extra, fs, html, path, routeRe, routes

### Community 28 - "80-shortcuts.js"
Cohesion: 0.32
Nodes (5): onAnalyseRoute(), render(), scCycleExpiry(), scMap, scPretty()

### Community 29 - "mockup-v2/qa.js"
Cohesion: 0.25
Nodes (7): { chromium }, extra, fs, html, path, routeRe, routes

### Community 30 - "build.js"
Cohesion: 0.29
Nodes (6): cp, files, fs, out, path, root

### Community 31 - "30-banner-flyers.js"
Cohesion: 0.33
Nodes (3): bannerEls, bannerState(), renderBanner()

### Community 32 - "50-tour.js"
Cohesion: 0.43
Nodes (6): findTarget(), makeTour(), place(), render(), TOUR_STEPS, visible()

### Community 33 - "CoinGreeks clone · build brief for screen agents"
Cohesion: 0.33
Nodes (5): CoinGreeks clone · build brief for screen agents, Feature inventory JSON (`features/<area>.json`), Final message from you, Part file contract (STRICT), Paths

### Community 34 - "90-portfolio-bar.js"
Cohesion: 0.47
Nodes (4): pbars, pbData(), pbLocal(), pbRender()

### Community 35 - "build-chrome.js"
Cohesion: 0.40
Nodes (4): files, fs, path, src

### Community 36 - "build-public.js"
Cohesion: 0.40
Nodes (4): files, fs, path, src

### Community 38 - "HapieCoin v2 · brief for the improved-UX build"
Cohesion: 0.40
Nodes (4): Design system (already in shell-head.html; use the variables, never hard-code colours), HapieCoin v2 · brief for the improved-UX build, Part contract reminders, Research-backed UX rules (apply where relevant)

### Community 39 - "merge-v2.js"
Cohesion: 0.50
Nodes (3): files, fs, path

### Community 47 - "test-hooks.js"
Cohesion: 0.11
Nodes (13): badJson, brand, broken, cases, fs, hadWorking, os, path (+5 more)

### Community 48 - "hooks"
Cohesion: 0.20
Nodes (9): hooks, PostToolUse, PreToolUse, SessionStart, Stop, permissions, allow, deny (+1 more)

### Community 49 - "HapieCoin"
Cohesion: 0.22
Nodes (8): HapieCoin, Honesty rules (read every turn), Non-negotiables, Quick commands, Repo etiquette, Verification protocol, What this is, Where to look (load only what the task needs)

### Community 50 - "TypeScript rules (real build)"
Cohesion: 0.25
Nodes (7): Rule 1: strict, no `any`, Rule 2: validate at the boundary, trust inside, Rule 3: no floating point for money, Rule 4: pricing lives in `packages/pricing`, Rule 5: server data via TanStack Query, UI state via Zustand, Rule 6: verify before you import, TypeScript rules (real build)

### Community 51 - "HapieCoin · Claude Code environment"
Cohesion: 0.18
Nodes (10): Docker on this machine (state as of 07 Sep 2026, 08:20), Extending, HapieCoin · Claude Code environment, Hooks: what fires when, Layout, Local environment notes (07 Sep 2026), Not set up (deliberately), Permissions (+2 more)

### Community 52 - "Product context · HapieCoin"
Cohesion: 0.29
Nodes (6): Product bar (user's words), Product context · HapieCoin, Scope reference, Success, Users, Vision

### Community 53 - "System patterns · HapieCoin"
Cohesion: 0.29
Nodes (6): Conventions, Knowledge graph, Market data (see auto-memory `coingreeks-original-site-facts`), Mocks (pre-build reference), Stack (ADR-004, ADR-005), System patterns · HapieCoin

### Community 54 - "Trading safety"
Cohesion: 0.29
Nodes (6): Rule 1: only the live executor places orders, Rule 2: tests never touch live endpoints, Rule 3: secrets, Rule 4: idempotent, rate-limited, timed out, Rule 5: paper and live are visibly different, Trading safety

### Community 55 - "Active context · HapieCoin"
Cohesion: 0.40
Nodes (4): Active context · HapieCoin, Blocked by, Next steps, Recent

### Community 56 - "Product identity"
Cohesion: 0.50
Nodes (3): Product identity, Rule: HapieCoin is the product, CoinGreeks is the competitor, Rule: the user's bar is "no confusion"

### Community 57 - "plan/SKILL.md"
Cohesion: 0.40
Nodes (4): Step 0: restate, Step 1: understand, Step 2: decide, Step 3: write the plan

### Community 69 - "recalc"
Cohesion: 0.26
Nodes (11): applyDensity(), createStrategy(), guessTemplate(), recalc(), registerPalette(), init(), moveOrToggle(), PANELS (+3 more)

### Community 72 - "queries.ts"
Cohesion: 0.09
Nodes (40): ApiSettingsDialog(), BrokerForm(), DeleteConfirm(), EMPTY, FormState, validateBrokerForm(), ProfileDialog(), ProfileForm() (+32 more)

### Community 73 - "api/src/app.ts"
Cohesion: 0.09
Nodes (37): AuthOptions, createApp(), Health, BrokerCreate, BrokerList, BrokerPatch, canManage(), IdParam (+29 more)

### Community 74 - "harness.ts"
Cohesion: 0.05
Nodes (66): API_VERSION, Auth, AUTH_BASE_PATH, authOptionsPublic, sessionResolver(), Case, Role, SETTINGS (+58 more)

### Community 75 - "venues/src/index.ts"
Cohesion: 0.09
Nodes (40): BINANCE_STALE_MS, BINANCE_STREAM_URL, BinanceSpotClient, BinanceSpotClientOptions, BinanceSpotEvents, binanceStreamName(), buildBinanceStreamUrl(), parseMiniTicker() (+32 more)

### Community 77 - "e2e/fixtures.ts"
Cohesion: 0.21
Nodes (13): ADR-0006, ADR-0022, ADR-0023, ADR-0027, ADR-0019, API, fillOtp(), resetApi() (+5 more)

### Community 78 - "transport/ws.test.ts"
Cohesion: 0.11
Nodes (20): ConnState, FakeTransport, Connection, Headers, HttpRequest, HttpResponse, SocketServer, SocketServerFactory (+12 more)

### Community 79 - "AuthForms.tsx"
Cohesion: 0.22
Nodes (11): AuthFormsProps, Errors, ForgotForm(), LoginForm(), OtpLoginForm(), OtpVerifyForm(), SignupForm(), VerifyEmailForm() (+3 more)

### Community 80 - "AppHeader.tsx"
Cohesion: 0.11
Nodes (28): AccountMenu(), AppHeaderProps, AVATAR_ICON, SettingsMenu(), TABS, AssetSwitch(), ExchangeChip(), NAV (+20 more)

### Community 81 - "next"
Cohesion: 0.16
Nodes (8): nextConfig, staticHeaders, metadata, metadata, metadata, metadata, PhasePlaceholder(), next

### Community 82 - "normalize.ts"
Cohesion: 0.12
Nodes (36): canonDecimal(), DecimalFormatError, decimalToNumber(), expandExponent(), numberToDecimal(), quotes, cell(), compactToQuote() (+28 more)

### Community 83 - "protocol.ts"
Cohesion: 0.14
Nodes (26): AnalyzeOptions, AnalyzeResult, ScenarioOptions, ValuationOptions, Leg, isResponse(), Pending, PricingClient (+18 more)

### Community 84 - "gateway/src/app.ts"
Cohesion: 0.11
Nodes (15): App, AppDeps, createApp(), { FakeRedis }, GatewayConfig, make(), createLogger(), InProcessPubSub (+7 more)

### Community 85 - "helpers.tsx"
Cohesion: 0.08
Nodes (27): AuthForms(), authHref(), AuthScreen(), AuthScreenProps, PARENT_TAB, AUTH_FEATURES, CALL, rows (+19 more)

### Community 86 - "gateway/package.json"
Cohesion: 0.06
Nodes (35): dependencies, @hapiecoin/schema, @hapiecoin/venues, ioredis, ws, zod, description, devDependencies (+27 more)

### Community 87 - "ThemeProvider.tsx"
Cohesion: 0.09
Nodes (25): Toaster(), ToasterProps, applyTheme(), isTheme(), readStored(), ResolvedTheme, systemTheme(), Bad() (+17 more)

### Community 88 - "auth.ts"
Cohesion: 0.07
Nodes (22): createAuth(), findReferralCode(), generateReferralCode(), OTP_EXPIRY_SEC, OTP_LENGTH, SESSION_TTL_SEC, ADR-0019, uniqueReferralCode() (+14 more)

### Community 89 - "ui/package.json"
Cohesion: 0.05
Nodes (34): description, files, @hapiecoin/config, jsdom, react, react-dom, tailwindcss, @testing-library/dom (+26 more)

### Community 90 - "web/package.json"
Cohesion: 0.06
Nodes (32): description, better-auth, @hapiecoin/config, @hapiecoin/schema, hono, @hono/node-server, jsdom, react (+24 more)

### Community 91 - "Preview.tsx"
Cohesion: 0.13
Nodes (30): Dialog, DialogBody(), DialogClose, DialogContent(), DialogContentProps, dialogContentVariants, DialogDescription(), DialogFooter() (+22 more)

### Community 92 - "PayoffPanel.tsx"
Cohesion: 0.10
Nodes (41): LadderPanel(), PILL, LAYER_LABELS, Layers, PayoffPanel(), Tile(), ZOOMS, feeLine() (+33 more)

### Community 93 - "devDependencies"
Cohesion: 0.13
Nodes (15): devDependencies, axe-core, @hapiecoin/config, jsdom, react, react-dom, tailwindcss, @tailwindcss/node (+7 more)

### Community 94 - "tokens.ts"
Cohesion: 0.10
Nodes (24): generate(), here, ADR-0003, normalizeValue(), parseDeclarations(), ruleBody(), SOURCE, writeTokens() (+16 more)

### Community 95 - "ui/src/index.ts"
Cohesion: 0.14
Nodes (26): Field(), FieldControlProps, FieldProps, controlVariants, Input(), InputProps, Label(), LabelProps (+18 more)

### Community 96 - "mailer.ts"
Cohesion: 0.19
Nodes (10): createMailer(), MailCapture, Mailer, OTP_SUBJECT, otpBody(), OtpMail, OtpPurpose, ResendLike (+2 more)

### Community 97 - "pricing/src/index.ts"
Cohesion: 0.16
Nodes (24): expectedMove(), gammaExposure(), GammaExposureResult, GexPoint, impliedForward(), maxPain(), num(), PainPoint (+16 more)

### Community 98 - "market.ts"
Cohesion: 0.13
Nodes (23): DeltaProduct, DeltaTicker, fixturesDir, toInstrument(), toQuote(), trimDecimal(), ChainRow, ChainSnapshot (+15 more)

### Community 99 - "api/src/config.ts"
Cohesion: 0.14
Nodes (12): Base64Key32, ConfigError, LoadConfigOptions, NodeEnv, RawEnv, stripEmpty(), BASE, ADR-0019 (+4 more)

### Community 100 - "GatewayServer"
Cohesion: 0.17
Nodes (4): GatewayServer, Subscription, make(), boot()

### Community 101 - "app/page.tsx"
Cohesion: 0.16
Nodes (14): metadata, FeatureTabs(), Footer(), CAPABILITIES, EXCHANGES, FEATURE_LIST, FEATURE_TABS, HERO_BULLETS (+6 more)

### Community 102 - "strategy.ts"
Cohesion: 0.22
Nodes (24): analyze(), assertPrice(), breakevens(), defaultPriceRange(), expiryExtremes(), legIv(), legValueAtExpiry(), MIN_IV (+16 more)

### Community 103 - "venues/package.json"
Cohesion: 0.08
Nodes (25): dependencies, @hapiecoin/schema, zod, description, devDependencies, @hapiecoin/config, tsx, exports (+17 more)

### Community 104 - "delta/chain.ts"
Cohesion: 0.22
Nodes (12): compareDecimal(), buildChain(), isOption(), listExpiries(), makeExpiry(), quoteLookup(), settlementFor(), StrikeStepReport (+4 more)

### Community 105 - "fmtPrice"
Cohesion: 0.20
Nodes (20): TickerItem(), FutureDialog(), FeedStatus(), FuturesPrice(), LiveMarkets(), sparkPath(), Tile(), fmtPct() (+12 more)

### Community 106 - "config/package.json"
Cohesion: 0.08
Nodes (24): description, exports, ./eslint, ./prettier, ./tsconfig/base.json, ./tsconfig/library.json, ./tsconfig/next.json, ./tsconfig/node-app.json (+16 more)

### Community 107 - "pricing/package.json"
Cohesion: 0.08
Nodes (24): description, devDependencies, @hapiecoin/config, exports, ./worker, files, @hapiecoin/config, main (+16 more)

### Community 108 - "TemplatesPanel.tsx"
Cohesion: 0.09
Nodes (41): ChainPickerDialog(), templateSketch(), TemplatesPanel(), ADR-0027, useTemplateLoader(), OUTLOOKS, TemplatesStrip(), ADR-0027 (+33 more)

### Community 109 - "fixtures/chain.ts"
Cohesion: 0.19
Nodes (18): FakeGateway, FakeGatewayOptions, startFakeGateway(), buildChain(), dec(), expiriesOf(), FIXTURE, FixtureInstrument (+10 more)

### Community 110 - "delta/ws.test.ts"
Cohesion: 0.10
Nodes (18): client(), products, Reply, tickers, DELTA_HEARTBEAT_TIMEOUT_MS, make(), Recorded, SYMBOLS (+10 more)

### Community 111 - "tasks"
Cohesion: 0.08
Nodes (23): dependsOn, outputs, cache, persistent, globalEnv, outputs, $schema, tasks (+15 more)

### Community 112 - "api/package.json"
Cohesion: 0.08
Nodes (23): description, exports, files, better-auth, @hapiecoin/config, @hapiecoin/schema, @hapiecoin/venues, hono (+15 more)

### Community 113 - "StrategyDetailsDialog.tsx"
Cohesion: 0.06
Nodes (73): SaveDraftDialog(), SaveDraftDialogProps, BatchLiveDialog(), ADR-0010, PaperPanel(), SortKey, sortStrategies(), exitLots() (+65 more)

### Community 114 - "schema/package.json"
Cohesion: 0.09
Nodes (22): dependencies, zod, description, devDependencies, @hapiecoin/config, exports, files, @hapiecoin/config (+14 more)

### Community 115 - "accounts.ts"
Cohesion: 0.14
Nodes (20): API_KEY_MASKED_RE, ApiKeyMasked, Avatar, Broker, BrokerCredentialPublic, BrokerScope, Density, Id (+12 more)

### Community 116 - "BuilderPanel.tsx"
Cohesion: 0.09
Nodes (42): BuilderPanel(), moneyness(), NEW_STRATEGY_LEGS, ADR-0022, QuoteLookup, useLegQuotes(), useAnalysis(), LegPriceSource (+34 more)

### Community 117 - "chain.test.tsx"
Cohesion: 0.13
Nodes (23): rows, tableProps(), TOPIC, quoteFlashes(), ConnectionStatus, GatewayClientOptions, GatewayEvents, WebSocketFactory (+15 more)

### Community 118 - "compilerOptions"
Cohesion: 0.09
Nodes (21): compilerOptions, declaration, declarationMap, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, isolatedModules, lib (+13 more)

### Community 119 - "black76.ts"
Cohesion: 0.23
Nodes (18): black76Greeks(), black76Price(), Greeks, impliedVol(), ImpliedVolOptions, intrinsicValue(), rawVega(), validInputs() (+10 more)

### Community 120 - "rest.ts"
Cohesion: 0.09
Nodes (23): instruments, NOW, quoteMap, compactCell, decimal, numberish, RawAsset, RawCandle (+15 more)

### Community 121 - "schema-adapter.test.ts"
Cohesion: 0.20
Nodes (18): isSchemaInstrument(), ivOrOmit(), latestSpot(), SCHEMA_CURRENCIES, SCHEMA_UNDERLYINGS, SCHEMA_VENUE, SchemaAdapterError, schemaInstrumentId() (+10 more)

### Community 122 - "compilerOptions"
Cohesion: 0.09
Nodes (21): compilerOptions, declaration, declarationMap, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, isolatedModules, lib (+13 more)

### Community 123 - "columns.ts"
Cohesion: 0.10
Nodes (36): callColumns(), COLUMN_GROUPS, COLUMN_IDS, COLUMN_PX, columnById(), ColumnGroup, ColumnId, COLUMNS (+28 more)

### Community 124 - "private-client.ts"
Cohesion: 0.17
Nodes (9): DeltaCredentialErrorCode, DeltaPrivateClientOptions, describe(), FakeDeltaPrivateClient, FetchLike, KNOWN_CODES, safeJson(), CREDS (+1 more)

### Community 125 - "RedisPipelineLike"
Cohesion: 0.14
Nodes (3): RedisLike, RedisPipelineLike, FakeRedis

### Community 126 - "builder.test.tsx"
Cohesion: 0.13
Nodes (13): serveMarket(), rows, serveMarket(), subscribedToChain(), TOPIC, PriceCell(), serveMarket(), mine() (+5 more)

### Community 127 - "validation.test.ts"
Cohesion: 0.16
Nodes (16): DAYS_PER_YEAR, daysToExpiry(), DEFAULT_SETTLEMENT_HOUR_UTC, expiryMs(), MS_PER_DAY, MS_PER_YEAR, yearFraction(), calls (+8 more)

### Community 128 - "gateway.ts"
Cohesion: 0.15
Nodes (18): CHAIN_TOPIC_RE, chainTopic(), ClientMessage, FUT_TOPIC_RE, futTopic(), MAX_TOPICS_PER_MESSAGE, ParsedTopic, parseTopic() (+10 more)

### Community 129 - "ReconnectingSocket"
Cohesion: 0.16
Nodes (3): Emitter, ReconnectingSocket, resolveCtor()

### Community 130 - "devDependencies"
Cohesion: 0.11
Nodes (19): devDependencies, babel-plugin-react-compiler, @hapiecoin/config, hono, @hono/node-server, jsdom, @playwright/test, tailwindcss (+11 more)

### Community 131 - "primitives.ts"
Cohesion: 0.20
Nodes (17): compareDecimal(), compareMagnitude(), Currency, DECIMAL_STRING_RE, DecimalParts, DecimalString, isNonNegativeDecimal(), IsoDate (+9 more)

### Community 132 - "cn.ts"
Cohesion: 0.10
Nodes (22): Checkbox(), CheckboxProps, EmptyState(), EmptyStateProps, Kbd(), KbdProps, Stat(), StatProps (+14 more)

### Community 133 - "DeltaWsClient"
Cohesion: 0.22
Nodes (3): formatIssues(), DeltaWsClient, VenueWsError

### Community 134 - "log.ts"
Cohesion: 0.13
Nodes (13): ConfigError, GatewayEnv, loadConfig(), LOG_LEVELS, LogLevel, loadRepoEnv(), repoRootEnvPath(), cleanups (+5 more)

### Community 135 - "MarketFeed"
Cohesion: 0.14
Nodes (3): isUnderlying(), MarketFeed, underlyingForSpotSymbol()

### Community 136 - "FakeMarketData"
Cohesion: 0.09
Nodes (9): products, tickers, FakeMarketData, ADR-0006, FIXTURE_DIR, fixtureInstruments(), fixtureQuotes(), loadJson() (+1 more)

### Community 137 - "check-budget.mjs"
Cohesion: 0.11
Nodes (14): args, buildManifest, first, firstLoad, later, limitKb, nextDir, onDemand (+6 more)

### Community 138 - "ChainTable.tsx"
Cohesion: 0.08
Nodes (45): Pick, ChainHeader(), ChainHeaderProps, Track(), CellProps, ChainTable(), ChainTableProps, NO_MARKS (+37 more)

### Community 139 - "DeltaMarketData"
Cohesion: 0.12
Nodes (10): fmt(), main(), RUN_MS, BuildChainInput, strikeStep(), DeltaMarketData, DeltaRestClient, snippet() (+2 more)

### Community 140 - "config/eslint.config.js"
Cohesion: 0.15
Nodes (7): ADR-0001, identityGuard, ADR-0003, tokenGuard, eslint-config-prettier, @eslint/js, typescript-eslint

### Community 141 - "Button.tsx"
Cohesion: 0.17
Nodes (13): Badge(), BadgeProps, badgeVariants, ADR-0003, Button(), ButtonProps, buttonVariants, ADR-0003 (+5 more)

### Community 142 - "dependencies"
Cohesion: 0.13
Nodes (15): dependencies, better-auth, @better-auth/passkey, drizzle-orm, @hapiecoin/schema, @hapiecoin/venues, hono, @hono/node-server (+7 more)

### Community 143 - "trading.ts"
Cohesion: 0.11
Nodes (18): DeltaCredentials, DeltaTradingClientOptions, Envelope, FINAL_ORDER_ERRORS, OrderSide, OrderState, PlaceOrderInput, PlaceOrderResult (+10 more)

### Community 144 - "package.json"
Cohesion: 0.13
Nodes (14): description, engines, node, eslint, typescript, vitest, @vitest/coverage-v8, name (+6 more)

### Community 145 - "DensityProvider.tsx"
Cohesion: 0.22
Nodes (12): applyDensity(), Density, DENSITY_STORAGE_KEY, DensityContext, DensityContextValue, DensityProvider(), DensityProviderProps, isDensity() (+4 more)

### Community 146 - "FakeWebSocket"
Cohesion: 0.13
Nodes (3): FakeWebSocket, Handler, WebSocketLike

### Community 147 - "renderBuilder"
Cohesion: 0.22
Nodes (14): bindBuilder(), dteOf(), expPretty(), insCell(), isActiveEdit(), legGreeks(), legsChanged(), limitCheck() (+6 more)

### Community 149 - "scripts"
Cohesion: 0.15
Nodes (13): scripts, build, ci, db:down, db:up, dev, format, format:check (+5 more)

### Community 150 - "compilerOptions"
Cohesion: 0.15
Nodes (12): compilerOptions, allowJs, declaration, declarationMap, incremental, jsx, lib, noEmit (+4 more)

### Community 151 - "delta/market-data.ts"
Cohesion: 0.18
Nodes (16): createDeltaMarketData(), DEFAULT_CONTRACT_TYPES, DeltaMarketDataEvents, DeltaMarketDataOptions, MarketDataStatus, fetchFixtures(), make(), NOW (+8 more)

### Community 152 - "analysis.test.tsx"
Cohesion: 0.21
Nodes (13): ctxCalls, rows, TOPIC, FALLBACK, PayoffChart(), PayoffChartFrame, token(), useCanvasColors() (+5 more)

### Community 153 - "Workspace · Builder, templates and the analysis pane · design pass · 2026-09-08"
Cohesion: 0.14
Nodes (13): 10. Confusion check, 1. Job, 2. Layout (desktop 1440), 3. Hierarchy, 4. States, 5. Numbers, 6. Interaction, 7. Traceability (+5 more)

### Community 154 - "gateway/tsconfig.build.json"
Cohesion: 0.18
Nodes (10): compilerOptions, outDir, rootDir, sourceMap, types, exclude, extends, include (+2 more)

### Community 155 - "dependencies"
Cohesion: 0.17
Nodes (12): dependencies, better-auth, @hapiecoin/pricing, @hapiecoin/schema, @hapiecoin/ui, next, react, react-dom (+4 more)

### Community 156 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, check:budget, dev, lint, mock:servers, start, test (+3 more)

### Community 157 - "web/tsconfig.json"
Cohesion: 0.18
Nodes (10): compilerOptions, module, paths, target, types, exclude, extends, include (+2 more)

### Community 158 - "devDependencies"
Cohesion: 0.18
Nodes (11): devDependencies, eslint, eslint-config-prettier, @eslint/js, prettier, turbo, @types/node, typescript (+3 more)

### Community 159 - "expiry.ts"
Cohesion: 0.38
Nodes (9): dateToExpiryCode(), daysInMonth(), EXPIRY_CODE_RE, EXPIRY_MONTHS, ExpiryCode, expiryCodeToDate(), isRealDate(), isValidCalendarDate() (+1 more)

### Community 160 - "Tabs.tsx"
Cohesion: 0.25
Nodes (8): Tabs(), TabsContent(), TabsList(), TabsProps, TabsTrigger(), TabsVariant, TabsVariantContext, @radix-ui/react-tabs

### Community 161 - "api/tsconfig.build.json"
Cohesion: 0.20
Nodes (9): compilerOptions, outDir, rootDir, types, exclude, extends, include, @hapiecoin/config/tsconfig/node-app.json (+1 more)

### Community 163 - "RedisLike"
Cohesion: 0.22
Nodes (3): RedisLike, { FakeRedis }, SPOT

### Community 165 - "context.ts"
Cohesion: 0.11
Nodes (28): AuditEntry, writeAudit(), createLogger(), CreateLoggerOptions, isSecretKey(), Logger, REDACTED, scrub() (+20 more)

### Community 166 - "pricing/tsconfig.build.json"
Cohesion: 0.20
Nodes (9): compilerOptions, noEmit, outDir, rootDir, exclude, extends, include, ./tsconfig.json (+1 more)

### Community 167 - "schema/src/index.ts"
Cohesion: 0.27
Nodes (5): ApiError, ApiErrorCode, Paginated, exportedSchemas, FORBIDDEN

### Community 168 - "ui/tsconfig.json"
Cohesion: 0.20
Nodes (9): compilerOptions, jsx, lib, rootDir, types, extends, include, @hapiecoin/config/tsconfig/library.json (+1 more)

### Community 169 - "ui/tsconfig.build.json"
Cohesion: 0.20
Nodes (9): compilerOptions, outDir, rootDir, types, exclude, extends, include, ./tsconfig.json (+1 more)

### Community 170 - "venues/tsconfig.build.json"
Cohesion: 0.20
Nodes (9): compilerOptions, outDir, rootDir, types, exclude, extends, include, @hapiecoin/config/tsconfig/library.json (+1 more)

### Community 171 - "api/tsconfig.json"
Cohesion: 0.22
Nodes (8): compilerOptions, noEmit, rootDir, types, extends, include, @hapiecoin/config/tsconfig/node-app.json, $schema

### Community 172 - "gateway/tsconfig.json"
Cohesion: 0.22
Nodes (8): compilerOptions, noEmit, rootDir, types, extends, include, @hapiecoin/config/tsconfig/node-app.json, $schema

### Community 173 - "store.ts"
Cohesion: 0.06
Nodes (48): metadata, ANALYSIS_TABS, AnalysisPane(), PaneSourceBar(), ADR-0026, ChainPickerProps, PAGE, Sparkline() (+40 more)

### Community 174 - "compilerOptions"
Cohesion: 0.22
Nodes (8): compilerOptions, declaration, declarationMap, lib, types, extends, ./base.json, $schema

### Community 175 - "schema/tsconfig.json"
Cohesion: 0.22
Nodes (8): compilerOptions, outDir, rootDir, types, extends, include, $schema, ../config/tsconfig/library.json

### Community 176 - "exports"
Cohesion: 0.22
Nodes (9): exports, ./fonts/*, ./fonts.css, ./preview, ./theme.css, ./tokens.css, development, import (+1 more)

### Community 177 - "venues/tsconfig.json"
Cohesion: 0.22
Nodes (8): compilerOptions, noEmit, rootDir, types, extends, include, @hapiecoin/config/tsconfig/library.json, $schema

### Community 178 - "library.json"
Cohesion: 0.25
Nodes (7): compilerOptions, composite, emitDeclarationOnly, lib, extends, ./base.json, $schema

### Community 179 - "pricing/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, noEmit, rootDir, extends, include, @hapiecoin/config/tsconfig/library.json, $schema

### Community 180 - "feed.ts"
Cohesion: 0.09
Nodes (18): CoalescerOptions, SpotTick, mergeDelta(), quoteDelta(), sameGreeks(), SCALAR_FIELDS, ScalarField, setField() (+10 more)

### Community 181 - "scripts/client.ts"
Cohesion: 0.40
Nodes (5): Health, HTTP_URL, main(), RUN_MS, stamp()

### Community 182 - "AppHeader.test.tsx"
Cohesion: 0.15
Nodes (9): user, navigationModule, pathnameMock, resetNextMocks(), routerMock, searchParamsMock, MqlListener, mqlListeners (+1 more)

### Community 183 - "playwright.config.ts"
Cohesion: 0.40
Nodes (4): API_PORT, GATEWAY_PORT, WEB_PORT, @playwright/test

### Community 184 - "proxy.ts"
Cohesion: 0.60
Nodes (3): buildCsp(), config, proxy()

### Community 185 - "Phase 1 engineering brief (read fully before writing code)"
Cohesion: 0.40
Nodes (4): Fixture facts (verified on 04 Sep 2026), Package conventions, Phase 1 engineering brief (read fully before writing code), Toolchain (already installed)

### Community 186 - "schema/tsconfig.build.json"
Cohesion: 0.40
Nodes (4): exclude, extends, ./tsconfig.json, $schema

### Community 187 - "api/src/index.ts"
Cohesion: 0.10
Nodes (35): AuthDeps, Config, Db, DbKind, DeltaPrivateClient, DeltaPrivateClientImpl, MePatch, registerMeRoutes() (+27 more)

### Community 203 - "format.ts"
Cohesion: 0.28
Nodes (17): GreeksPanel(), MEANING, GreeksStrip(), Cell(), OptionDetailsDialog(), ConfirmAdjustmentDialog(), fmtChange(), fmtDelta() (+9 more)

### Community 204 - "pricing/client.ts"
Cohesion: 0.20
Nodes (7): AnalysisState, EMPTY, getPricingClient(), setPricingClientForTests(), FakeWorker, LEGS, OPTS

### Community 205 - "src/server.ts"
Cohesion: 0.13
Nodes (11): FrameEncoder, jsonEncoder, FeedStatus, Snapshot, SpotState, FeedLike, GatewayServerOptions, LOCAL_HOSTS (+3 more)

### Community 206 - "Item 2 · column set and Column Settings dialog · design pass · 2026-09-07"
Cohesion: 0.06
Nodes (33): 10. Confusion check, 10. Confusion check, 10. Confusion check, 1. Job, 1. Job, 1. Job, 2. Layout, 2. Layout (+25 more)

### Community 207 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, db:generate, db:migrate, db:seed, dev, lint, start (+3 more)

### Community 208 - "auth/page.tsx"
Cohesion: 0.22
Nodes (10): AuthPage(), first(), generateMetadata(), SearchParams, TABS, metadata, SsoPage(), SsoReturn() (+2 more)

### Community 210 - "devDependencies"
Cohesion: 0.40
Nodes (5): devDependencies, drizzle-kit, @electric-sql/pglite, @hapiecoin/config, tsx

### Community 211 - "src/strategies.ts"
Cohesion: 0.05
Nodes (45): AddLegsBody, CloseAllBody, CloseLegBody, LegExpiry, LiveBatchBody, LiveBatchResult, LivePlaceBody, LivePosition (+37 more)

### Community 212 - "dialogs.test.tsx"
Cohesion: 0.26
Nodes (12): CurrencyDialog(), currencyNote(), ExchangeManagementDialog(), LogoutDialog(), LotSizeDialog(), OPTIONS, PnlDialog(), DialogProps (+4 more)

### Community 214 - "LegalPage.tsx"
Cohesion: 0.14
Nodes (7): metadata, metadata, metadata, LegalPage(), LEGAL, LEGAL_UPDATED, LegalSection

### Community 215 - "NetPositionsPanel.tsx"
Cohesion: 0.23
Nodes (14): ASSET_FILTERS, NetPositionsPanel(), positionLabel(), ADR-0026, useLiveExitPositions(), useCredential(), isAsset(), lotsFor() (+6 more)

### Community 216 - "getServerUser"
Cohesion: 0.18
Nodes (15): Layout(), AnalyseLayout(), Layout(), Layout(), Layout(), SettingsDialogs, SettingsDialogsLoader(), AppHeader() (+7 more)

### Community 217 - "inputs.tsx"
Cohesion: 0.20
Nodes (12): ResetPasswordForm(), OtpInput(), OtpInputProps, PasswordInput(), PasswordRules(), ResendCountdown(), ResendCountdownProps, EMAIL_RE (+4 more)

### Community 218 - "dependencies"
Cohesion: 0.14
Nodes (14): dependencies, class-variance-authority, clsx, lucide-react, @radix-ui/react-checkbox, @radix-ui/react-dialog, @radix-ui/react-label, @radix-ui/react-select (+6 more)

### Community 219 - "trading.test.ts"
Cohesion: 0.18
Nodes (10): contractsFor(), describeOrderError(), CREDS, json(), reply(), signDeltaRequest(), CREDS, ORDER (+2 more)

### Community 220 - "GatewayClient"
Cohesion: 0.15
Nodes (3): GatewayClient, GatewayProviderProps, RenderWithProvidersOptions

### Community 221 - "routes/strategies.ts"
Cohesion: 0.09
Nodes (44): auditFrom(), applyEntryResult(), DEFAULT_LOTS, describeResult(), exchangeError(), LegRow, lotSizeFor(), nextAttempt() (+36 more)

### Community 222 - "Phase 3 · Paper and live trading · plan and design pass · 2026-09-08"
Cohesion: 0.13
Nodes (14): 1. Job, 2. Items and order (one PR each), 3. Data model (item 1), 4. API (item 1), 5. Web (item 1), 6. Numbers, 7. Safety (both items), 8. Traceability and tests (+6 more)

### Community 223 - "pane-follow.test.tsx"
Cohesion: 0.36
Nodes (7): acc(), CALL, connect(), liveStrat(), mine(), strat(), ADR-0026

### Community 224 - "DeltaTradingClientImpl"
Cohesion: 0.29
Nodes (3): dec(), DeltaTradingClientImpl, toOrder()

### Community 226 - "Providers.tsx"
Cohesion: 0.24
Nodes (8): metadata, RootLayout(), makeQueryClient(), Providers(), ProvidersProps, ADR-0003, THEME_INIT_SCRIPT, THEME_STORAGE_KEY

### Community 227 - "trading-live.test.tsx"
Cohesion: 0.24
Nodes (7): acc(), CALL, connect(), mine(), rows, TOPIC, ADR-0025

### Community 229 - "api/src/env-file.ts"
Cohesion: 0.70
Nodes (3): loadRepoEnv(), repoRootEnvPath(), cleanups

## Knowledge Gaps
- **1415 isolated node(s):** `{ spawnSync }`, `{ readInput, deny }`, `input`, `cmd`, `rules` (+1410 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1807 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **28 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `MemoryRateStore` connect `auth.ts` to `harness.ts`, `api/src/index.ts`, `context.ts`?**
  _High betweenness centrality (0.121) - this node is a cross-community bridge._
- **Why does `isNonNegativeDecimal()` connect `primitives.ts` to `api/src/app.ts`, `accounts.ts`, `src/strategies.ts`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Why does `useUiStore` connect `store.ts` to `ChainTable.tsx`, `analysis.test.tsx`, `AppHeader.test.tsx`, `format.ts`, `AppHeader.tsx`, `dialogs.test.tsx`, `helpers.tsx`, `NetPositionsPanel.tsx`, `getServerUser`, `PayoffPanel.tsx`, `pane-follow.test.tsx`, `trading-live.test.tsx`, `fmtPrice`, `TemplatesPanel.tsx`, `StrategyDetailsDialog.tsx`, `BuilderPanel.tsx`, `chain.test.tsx`, `columns.ts`, `builder.test.tsx`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **What connects `{ spawnSync }`, `{ readInput, deny }`, `input` to the rest of the system?**
  _1415 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `b-core.js` be split into smaller, more focused modules?**
  _Cohesion score 0.07053140096618357 - nodes in this community are weakly interconnected._
- **Should `routes-report2.md` be split into smaller, more focused modules?**
  _Cohesion score 0.04081632653061224 - nodes in this community are weakly interconnected._
- **Should `20-landing.js` be split into smaller, more focused modules?**
  _Cohesion score 0.10796221322537113 - nodes in this community are weakly interconnected._