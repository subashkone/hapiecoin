# Graph Report - HapieCoin  (2026-09-08)

## Corpus Check
- 578 files · ~1,595,572 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 4249 nodes · 9247 edges · 231 communities (186 shown, 28 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 136 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `4e3791e0`
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
- src/server.ts
- BuilderPanel.tsx
- AppHeader.tsx
- analytics/page.tsx
- normalize.ts
- protocol.ts
- gateway/src/app.ts
- helpers.tsx
- gateway/package.json
- ThemeProvider.tsx
- MemoryRateStore
- ui/package.json
- web/package.json
- Preview.tsx
- PayoffPanel.tsx
- devDependencies
- tokens.ts
- ui/src/index.ts
- src/billing.ts
- pricing/src/index.ts
- market.ts
- api/src/index.ts
- GatewayServer
- app/page.tsx
- strategy.ts
- venues/package.json
- fmtMoney
- fmtPrice
- config/package.json
- pricing/package.json
- TemplatesPanel.tsx
- fixtures/chain.ts
- rest.ts
- tasks
- api/package.json
- StrategyDetailsDialog.tsx
- schema/package.json
- accounts.ts
- store.ts
- GatewayClient
- compilerOptions
- black76.ts
- ticketHtml
- schema-adapter.test.ts
- compilerOptions
- SubscriptionPage.tsx
- private-client.ts
- RedisPipelineLike
- FakeSocket
- validation.test.ts
- gateway.ts
- ReconnectingSocket
- devDependencies
- primitives.ts
- cn.ts
- DeltaWsClient
- gateway/src/config.ts
- MarketFeed
- FakeMarketData
- check-budget.mjs
- ChainTable.tsx
- DeltaMarketData
- config/eslint.config.js
- Button.tsx
- dependencies
- delta/ws.test.ts
- package.json
- DensityProvider.tsx
- FakeWebSocket
- renderBuilder
- feed.test.ts
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
- api/billing.ts
- FakeConnection
- logger.ts
- pricing/tsconfig.build.json
- schema/src/index.ts
- ui/tsconfig.json
- ui/tsconfig.build.json
- venues/tsconfig.build.json
- api/tsconfig.json
- gateway/tsconfig.json
- PlansAdmin.tsx
- compilerOptions
- schema/tsconfig.json
- exports
- venues/tsconfig.json
- library.json
- pricing/tsconfig.json
- feed.ts
- scripts/client.ts
- auth/page.tsx
- playwright.config.ts
- proxy.ts
- Phase 1 engineering brief (read fully before writing code)
- schema/tsconfig.build.json
- next
- types/config-modules.d.ts
- gateway/config-modules.d.ts
- web/types/hapiecoin-config.d.ts
- pricing/config-modules.d.ts
- ui/types/hapiecoin-config.d.ts
- AGENTS.md
- next-env.d.ts
- venues/types/hapiecoin-config.d.ts
- SOURCE
- lib/format.ts
- pricing/client.ts
- server.test.ts
- Item 2 · column set and Column Settings dialog · design pass · 2026-09-07
- scripts
- entitlements.ts
- MEMORY.md
- devDependencies
- src/strategies.ts
- trading.ts
- FakeDeltaTradingClient
- LegalPage.tsx
- useStrategyAnalysis.ts
- getServerUser
- AuthForms.tsx
- delta/chain.ts
- trading.test.ts
- Billing, plans and admin · design (Phase 4 item 1, 08 Sep 2026)
- routes/strategies.ts
- Phase 3 · Paper and live trading · plan and design pass · 2026-09-08
- MenuItemsAdmin.tsx
- DeltaTradingClientImpl
- DeltaTradingClient
- Providers.tsx
- PlanBanner.tsx
- analyse.spec.ts
- api/src/env-file.ts
- drizzle-kit

## God Nodes (most connected - your core abstractions)
1. `useUiStore` - 85 edges
2. `cn()` - 58 edges
3. `fmtPrice()` - 39 edges
4. `GatewayServer` - 34 edges
5. `MarketFeed` - 33 edges
6. `fmtMoney()` - 33 edges
7. `createTestApp()` - 32 edges
8. `fmtStrike()` - 31 edges
9. `HapieCoin · decision log (ADR)` - 31 edges
10. `TestApp` - 30 edges

## Surprising Connections (you probably didn't know these)
- `fixtureInstruments()` --indirect_call--> `toInstrument()`  [INFERRED]
  apps/gateway/src/test-support/fixtures.ts → packages/venues/src/delta/normalize.ts
- `render()` --indirect_call--> `legs`  [INFERRED]
  mockup-v2/src-trd/c-dialogs.js → packages/pricing/src/worker/worker.test.ts
- `AppVariables` --references--> `Logger`  [EXTRACTED]
  apps/api/src/security/context.ts → apps/api/src/logger.ts
- `registerBillingRoutes()` --indirect_call--> `MenuItem()`  [INFERRED]
  apps/api/src/routes/billing.ts → apps/web/src/components/shell/Menu.tsx
- `RootLayout()` --calls--> `publicEnv`  [EXTRACTED]
  apps/web/src/app/layout.tsx → apps/web/src/lib/env.ts

## Import Cycles
- None detected.

## Communities (231 total, 28 thin omitted)

### Community 0 - "b-core.js"
Cohesion: 0.08
Nodes (19): activeLegs(), bindTemplates(), brokerName(), brokerOf(), feeFor(), fmtDate(), modePill(), myList() (+11 more)

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
Cohesion: 0.06
Nodes (31): ADR-001 · Product name and reference (2026-09-07), ADR-002 · Two mocks kept side by side (2026-09-06), ADR-003 · Design system: Obsidian Desk, dark-first (2026-09-06), ADR-004 · Stack (2026-09-04, confirmed 2026-09-07), ADR-005 · Monorepo with independently deployable apps (2026-09-07), ADR-006 · Chain driven by the exchange instrument list (2026-09-07), ADR-007 · Traceability as the definition of done (2026-09-07), ADR-008 · Knowledge graph for project memory (2026-09-07) (+23 more)

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
Nodes (44): ApiSettingsDialog(), CurrencyDialog(), currencyNote(), BrokerForm(), DeleteConfirm(), EMPTY, ExchangeManagementDialog(), FormState (+36 more)

### Community 73 - "api/src/app.ts"
Cohesion: 0.06
Nodes (76): API_VERSION, AuthOptions, createApp(), Health, AuditEntry, auditFrom(), writeAudit(), menuItems (+68 more)

### Community 74 - "harness.ts"
Cohesion: 0.04
Nodes (68): Auth, sessionResolver(), Case, Role, SETTINGS, createDb(), CreateDbOptions, DbHandle (+60 more)

### Community 75 - "venues/src/index.ts"
Cohesion: 0.09
Nodes (40): BINANCE_STALE_MS, BINANCE_STREAM_URL, BinanceSpotClient, BinanceSpotClientOptions, BinanceSpotEvents, binanceStreamName(), buildBinanceStreamUrl(), parseMiniTicker() (+32 more)

### Community 77 - "e2e/fixtures.ts"
Cohesion: 0.27
Nodes (10): ADR-0030, ADR-0019, API, fillOtp(), resetApi(), SeedOptions, seedUser(), signIn() (+2 more)

### Community 78 - "src/server.ts"
Cohesion: 0.11
Nodes (21): ConnState, LOCAL_HOSTS, FakeTransport, Connection, Headers, HttpRequest, HttpResponse, SocketServer (+13 more)

### Community 79 - "BuilderPanel.tsx"
Cohesion: 0.10
Nodes (36): BuilderPanel(), moneyness(), NEW_STRATEGY_LEGS, ADR-0022, SaveDraftDialog(), SaveDraftDialogProps, BatchLiveDialog(), ADR-0010 (+28 more)

### Community 80 - "AppHeader.tsx"
Cohesion: 0.13
Nodes (24): AccountMenu(), AppHeaderProps, AVATAR_ICON, SettingsMenu(), TABS, AssetSwitch(), NAV, PublicHeader() (+16 more)

### Community 81 - "analytics/page.tsx"
Cohesion: 0.22
Nodes (3): metadata, metadata, PhasePlaceholder()

### Community 82 - "normalize.ts"
Cohesion: 0.12
Nodes (36): canonDecimal(), DecimalFormatError, decimalToNumber(), expandExponent(), numberToDecimal(), quotes, cell(), compactToQuote() (+28 more)

### Community 83 - "protocol.ts"
Cohesion: 0.14
Nodes (26): AnalyzeOptions, AnalyzeResult, ScenarioOptions, ValuationOptions, Leg, isResponse(), Pending, PricingClient (+18 more)

### Community 84 - "gateway/src/app.ts"
Cohesion: 0.08
Nodes (17): App, AppDeps, createApp(), { FakeRedis }, GatewayConfig, make(), InProcessPubSub, PONG (+9 more)

### Community 85 - "helpers.tsx"
Cohesion: 0.08
Nodes (32): ADR-0030, Avatar(), user, acc(), CALL, connect(), liveStrat(), mine() (+24 more)

### Community 86 - "gateway/package.json"
Cohesion: 0.06
Nodes (35): dependencies, @hapiecoin/schema, @hapiecoin/venues, ioredis, ws, zod, description, devDependencies (+27 more)

### Community 87 - "ThemeProvider.tsx"
Cohesion: 0.09
Nodes (25): Toaster(), ToasterProps, applyTheme(), isTheme(), readStored(), ResolvedTheme, systemTheme(), Bad() (+17 more)

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
Cohesion: 0.12
Nodes (32): ANALYSIS_TABS, AnalysisPane(), PaneSourceBar(), ADR-0026, LadderPanel(), PILL, LAYER_LABELS, Layers (+24 more)

### Community 93 - "devDependencies"
Cohesion: 0.07
Nodes (29): dependencies, class-variance-authority, clsx, lucide-react, @radix-ui/react-checkbox, @radix-ui/react-dialog, @radix-ui/react-label, @radix-ui/react-select (+21 more)

### Community 94 - "tokens.ts"
Cohesion: 0.10
Nodes (24): generate(), here, ADR-0003, normalizeValue(), parseDeclarations(), ruleBody(), SOURCE, writeTokens() (+16 more)

### Community 95 - "ui/src/index.ts"
Cohesion: 0.14
Nodes (26): Field(), FieldControlProps, FieldProps, controlVariants, Input(), InputProps, Label(), LabelProps (+18 more)

### Community 96 - "src/billing.ts"
Cohesion: 0.09
Nodes (33): ActivateBody, AdminUserPatch, AdminUserRow, AdminUsersPage, BILLING_INTERVALS, BillingInterval, BulkActiveBody, CurrentSubscription (+25 more)

### Community 97 - "pricing/src/index.ts"
Cohesion: 0.16
Nodes (24): expectedMove(), gammaExposure(), GammaExposureResult, GexPoint, impliedForward(), maxPain(), num(), PainPoint (+16 more)

### Community 98 - "market.ts"
Cohesion: 0.13
Nodes (23): DeltaProduct, DeltaTicker, fixturesDir, toInstrument(), toQuote(), trimDecimal(), ChainRow, ChainSnapshot (+15 more)

### Community 99 - "api/src/index.ts"
Cohesion: 0.04
Nodes (66): AUTH_BASE_PATH, AuthDeps, authOptionsPublic, createAuth(), findReferralCode(), generateReferralCode(), OTP_EXPIRY_SEC, OTP_LENGTH (+58 more)

### Community 100 - "GatewayServer"
Cohesion: 0.17
Nodes (4): GatewayServer, Subscription, make(), boot()

### Community 101 - "app/page.tsx"
Cohesion: 0.12
Nodes (18): metadata, FeatureTabs(), Footer(), ROWS, TerminalIllustration(), LogoMark(), AUTH_FEATURES, CAPABILITIES (+10 more)

### Community 102 - "strategy.ts"
Cohesion: 0.22
Nodes (24): analyze(), assertPrice(), breakevens(), defaultPriceRange(), expiryExtremes(), legIv(), legValueAtExpiry(), MIN_IV (+16 more)

### Community 103 - "venues/package.json"
Cohesion: 0.08
Nodes (25): dependencies, @hapiecoin/schema, zod, description, devDependencies, @hapiecoin/config, tsx, exports (+17 more)

### Community 104 - "fmtMoney"
Cohesion: 0.21
Nodes (18): ConfirmAdjustmentDialog(), feeLine(), netPremium(), TradeLegView, TradeModeDialog(), TradeModeProps, legLabel(), TradePreviewDialog() (+10 more)

### Community 105 - "fmtPrice"
Cohesion: 0.16
Nodes (24): AuthScreenProps, TickerItem(), PriceIv(), FeedStatus(), FuturesPrice(), LiveMarkets(), sparkPath(), Tile() (+16 more)

### Community 106 - "config/package.json"
Cohesion: 0.08
Nodes (24): description, exports, ./eslint, ./prettier, ./tsconfig/base.json, ./tsconfig/library.json, ./tsconfig/next.json, ./tsconfig/node-app.json (+16 more)

### Community 107 - "pricing/package.json"
Cohesion: 0.08
Nodes (24): description, devDependencies, @hapiecoin/config, exports, ./worker, files, @hapiecoin/config, main (+16 more)

### Community 108 - "TemplatesPanel.tsx"
Cohesion: 0.08
Nodes (44): ChainPickerDialog(), InstrumentPatch, InstrumentQuote, LegInstrument(), ADR-0006, ADR-0028, templateSketch(), TemplatesPanel() (+36 more)

### Community 109 - "fixtures/chain.ts"
Cohesion: 0.16
Nodes (20): rows, TOPIC, FakeGateway, FakeGatewayOptions, startFakeGateway(), buildChain(), dec(), expiriesOf() (+12 more)

### Community 110 - "rest.ts"
Cohesion: 0.09
Nodes (23): instruments, NOW, quoteMap, compactCell, decimal, numberish, RawAsset, RawCandle (+15 more)

### Community 111 - "tasks"
Cohesion: 0.08
Nodes (23): dependsOn, outputs, cache, persistent, globalEnv, outputs, $schema, tasks (+15 more)

### Community 112 - "api/package.json"
Cohesion: 0.08
Nodes (23): description, exports, files, better-auth, @hapiecoin/config, @hapiecoin/schema, @hapiecoin/venues, hono (+15 more)

### Community 113 - "StrategyDetailsDialog.tsx"
Cohesion: 0.05
Nodes (71): metadata, PAGE, PaperPanel(), SortKey, sortStrategies(), Sparkline(), ADR-0029, exitLots() (+63 more)

### Community 114 - "schema/package.json"
Cohesion: 0.09
Nodes (22): dependencies, zod, description, devDependencies, @hapiecoin/config, exports, files, @hapiecoin/config (+14 more)

### Community 115 - "accounts.ts"
Cohesion: 0.14
Nodes (20): API_KEY_MASKED_RE, ApiKeyMasked, Avatar, Broker, BrokerCredentialPublic, BrokerScope, Density, Id (+12 more)

### Community 116 - "store.ts"
Cohesion: 0.07
Nodes (56): ChainPickerProps, Pick, FutureDialog(), RowControls(), RowControlsProps, ChainLayout, LegPriceSource, BuilderSubTab (+48 more)

### Community 117 - "GatewayClient"
Cohesion: 0.05
Nodes (47): rows, tableProps(), TOPIC, columnById(), ColumnSettingsDialog(), PRESETS, applyPreset(), defaultLayout() (+39 more)

### Community 118 - "compilerOptions"
Cohesion: 0.09
Nodes (21): compilerOptions, declaration, declarationMap, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, isolatedModules, lib (+13 more)

### Community 119 - "black76.ts"
Cohesion: 0.23
Nodes (18): black76Greeks(), black76Price(), Greeks, impliedVol(), ImpliedVolOptions, intrinsicValue(), rawVega(), validInputs() (+10 more)

### Community 120 - "ticketHtml"
Cohesion: 0.22
Nodes (10): brokerShort(), currentPrice(), dateLabel(), legPnl(), netLineHtml(), pnlClass(), quoteLeg(), renderTicket() (+2 more)

### Community 121 - "schema-adapter.test.ts"
Cohesion: 0.20
Nodes (18): isSchemaInstrument(), ivOrOmit(), latestSpot(), SCHEMA_CURRENCIES, SCHEMA_UNDERLYINGS, SCHEMA_VENUE, SchemaAdapterError, schemaInstrumentId() (+10 more)

### Community 122 - "compilerOptions"
Cohesion: 0.09
Nodes (21): compilerOptions, declaration, declarationMap, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames, isolatedModules, lib (+13 more)

### Community 123 - "SubscriptionPage.tsx"
Cohesion: 0.14
Nodes (20): metadata, DiffPanel(), LimitsList(), LimitsMatrix(), PlanCard(), SubscribeDialog(), SubscriptionPage(), ADR-0030 (+12 more)

### Community 124 - "private-client.ts"
Cohesion: 0.16
Nodes (10): DeltaCredentialErrorCode, DeltaPrivateClientImpl, DeltaPrivateClientOptions, describe(), FakeDeltaPrivateClient, FetchLike, KNOWN_CODES, safeJson() (+2 more)

### Community 125 - "RedisPipelineLike"
Cohesion: 0.14
Nodes (3): RedisLike, RedisPipelineLike, FakeRedis

### Community 126 - "FakeSocket"
Cohesion: 0.06
Nodes (22): serveMarket(), rows, serveMarket(), subscribedToChain(), TOPIC, PriceCell(), acc(), CALL (+14 more)

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

### Community 134 - "gateway/src/config.ts"
Cohesion: 0.20
Nodes (9): ConfigError, GatewayEnv, loadConfig(), LOG_LEVELS, LogLevel, loadRepoEnv(), repoRootEnvPath(), cleanups (+1 more)

### Community 135 - "MarketFeed"
Cohesion: 0.14
Nodes (3): isUnderlying(), MarketFeed, underlyingForSpotSymbol()

### Community 137 - "check-budget.mjs"
Cohesion: 0.11
Nodes (14): args, buildManifest, first, firstLoad, later, limitKb, nextDir, onDemand (+6 more)

### Community 138 - "ChainTable.tsx"
Cohesion: 0.07
Nodes (53): ChainHeader(), ChainHeaderProps, Track(), CellProps, ChainTable(), ChainTableProps, NO_MARKS, quoteFlashes() (+45 more)

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

### Community 143 - "delta/ws.test.ts"
Cohesion: 0.10
Nodes (18): client(), products, Reply, tickers, DELTA_HEARTBEAT_TIMEOUT_MS, make(), Recorded, SYMBOLS (+10 more)

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

### Community 148 - "feed.test.ts"
Cohesion: 0.11
Nodes (10): products, tickers, ADR-0006, FakeWebSocket, Handler, FIXTURE_DIR, fixtureInstruments(), fixtureQuotes() (+2 more)

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
Cohesion: 0.20
Nodes (14): ctxCalls, rows, TOPIC, ADR-0028, FALLBACK, PayoffChart(), PayoffChartFrame, token() (+6 more)

### Community 153 - "Workspace · Builder, templates and the analysis pane · design pass · 2026-09-08"
Cohesion: 0.13
Nodes (14): 10. Confusion check, 1. Job, 2. Layout (desktop 1440), 3. Hierarchy, 4. States, 5. Numbers, 6. Interaction, 7. Traceability (+6 more)

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

### Community 163 - "api/billing.ts"
Cohesion: 0.16
Nodes (17): metadata, expiryText(), LimitsDialog(), LotSizesDialog(), UserSubscriptionsAdmin(), billingFetchers(), billingKeys, f (+9 more)

### Community 165 - "logger.ts"
Cohesion: 0.13
Nodes (16): createLogger(), CreateLoggerOptions, isSecretKey(), REDACTED, scrub(), scrubPath(), SECRET_KEY_RE, createMailer() (+8 more)

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

### Community 173 - "PlansAdmin.tsx"
Cohesion: 0.18
Nodes (16): metadata, ADMIN_NAV, AdminHeader(), AdminShell(), BulkBar(), Rail(), emptyForm(), emptyInterval() (+8 more)

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
Cohesion: 0.07
Nodes (22): CoalescerOptions, SpotTick, mergeDelta(), quoteDelta(), sameGreeks(), SCALAR_FIELDS, ScalarField, setField() (+14 more)

### Community 181 - "scripts/client.ts"
Cohesion: 0.40
Nodes (5): Health, HTTP_URL, main(), RUN_MS, stamp()

### Community 182 - "auth/page.tsx"
Cohesion: 0.08
Nodes (22): metadata, AuthPage(), first(), generateMetadata(), SearchParams, TABS, metadata, SsoPage() (+14 more)

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

### Community 187 - "next"
Cohesion: 0.16
Nodes (8): nextConfig, staticHeaders, metadata, metadata, metadata, metadata, AdminLater(), next

### Community 203 - "lib/format.ts"
Cohesion: 0.26
Nodes (19): GreeksPanel(), MEANING, GreeksStrip(), Tile(), Cell(), OptionDetailsDialog(), fmtChange(), fmtDate() (+11 more)

### Community 204 - "pricing/client.ts"
Cohesion: 0.21
Nodes (8): AnalysisState, EMPTY, getPricingClient(), setPricingClientForTests(), FakeWorker, LEGS, OPTS, useAnalysis()

### Community 205 - "server.test.ts"
Cohesion: 0.13
Nodes (11): FrameEncoder, jsonEncoder, createLogger(), LogFields, LogSink, ORDER, silentLogger, GatewayServerOptions (+3 more)

### Community 206 - "Item 2 · column set and Column Settings dialog · design pass · 2026-09-07"
Cohesion: 0.06
Nodes (33): 10. Confusion check, 10. Confusion check, 10. Confusion check, 1. Job, 1. Job, 1. Job, 2. Layout, 2. Layout (+25 more)

### Community 207 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, db:generate, db:migrate, db:seed, dev, lint, start (+3 more)

### Community 208 - "entitlements.ts"
Cohesion: 0.18
Nodes (14): users, activeSubscription(), effectivePlan, entitlementsFor(), FEATURE_NAMES, freePlan(), monthStart(), monthUsage() (+6 more)

### Community 210 - "devDependencies"
Cohesion: 0.40
Nodes (5): devDependencies, drizzle-kit, @electric-sql/pglite, @hapiecoin/config, tsx

### Community 211 - "src/strategies.ts"
Cohesion: 0.05
Nodes (46): AddLegsBody, CloseAllBody, CloseLegBody, LegExpiry, LiveBatchBody, LiveBatchResult, LivePlaceBody, LivePosition (+38 more)

### Community 212 - "trading.ts"
Cohesion: 0.11
Nodes (18): DeltaCredentials, DeltaTradingClientOptions, Envelope, FINAL_ORDER_ERRORS, OrderSide, OrderState, PlaceOrderInput, PlaceOrderResult (+10 more)

### Community 214 - "LegalPage.tsx"
Cohesion: 0.18
Nodes (7): metadata, metadata, metadata, LegalPage(), LEGAL, LEGAL_UPDATED, LegalSection

### Community 215 - "useStrategyAnalysis.ts"
Cohesion: 0.10
Nodes (30): ExchangeChip(), WalletChip(), ASSET_FILTERS, NetPositionsPanel(), positionLabel(), ADR-0026, liveFetchers(), CALL (+22 more)

### Community 216 - "getServerUser"
Cohesion: 0.18
Nodes (15): Layout(), AnalyseLayout(), Layout(), Layout(), Layout(), SettingsDialogs, SettingsDialogsLoader(), AppHeader() (+7 more)

### Community 217 - "AuthForms.tsx"
Cohesion: 0.12
Nodes (24): AuthForms(), AuthFormsProps, Errors, ForgotForm(), LoginForm(), OtpLoginForm(), OtpVerifyForm(), ResetPasswordForm() (+16 more)

### Community 218 - "delta/chain.ts"
Cohesion: 0.22
Nodes (12): compareDecimal(), buildChain(), isOption(), listExpiries(), makeExpiry(), quoteLookup(), settlementFor(), StrikeStepReport (+4 more)

### Community 219 - "trading.test.ts"
Cohesion: 0.18
Nodes (10): contractsFor(), describeOrderError(), CREDS, json(), reply(), signDeltaRequest(), CREDS, ORDER (+2 more)

### Community 220 - "Billing, plans and admin · design (Phase 4 item 1, 08 Sep 2026)"
Cohesion: 0.17
Nodes (11): 10. Confusion check, 1. Job, 2. Layout, 3. Hierarchy, 4. States, 5. Numbers, 6. Interaction, 7. Traceability (+3 more)

### Community 221 - "routes/strategies.ts"
Cohesion: 0.09
Nodes (50): brokers, strategies, strategyLegs, assertEntitled(), applyEntryResult(), DEFAULT_LOTS, describeResult(), exchangeError() (+42 more)

### Community 222 - "Phase 3 · Paper and live trading · plan and design pass · 2026-09-08"
Cohesion: 0.12
Nodes (15): 1. Job, 2. Items and order (one PR each), 3. Data model (item 1), 4. API (item 1), 5. Web (item 1), 6. Numbers, 7. Safety (both items), 8. Traceability and tests (+7 more)

### Community 223 - "MenuItemsAdmin.tsx"
Cohesion: 0.36
Nodes (7): metadata, MenuItemDialog(), MenuItemsAdmin(), useAdminMutation(), useBulkMenuItems(), useCreateMenuItem(), useUpdateMenuItem()

### Community 224 - "DeltaTradingClientImpl"
Cohesion: 0.29
Nodes (3): dec(), DeltaTradingClientImpl, toOrder()

### Community 226 - "Providers.tsx"
Cohesion: 0.24
Nodes (8): metadata, RootLayout(), makeQueryClient(), Providers(), ProvidersProps, ADR-0003, THEME_INIT_SCRIPT, THEME_STORAGE_KEY

### Community 227 - "PlanBanner.tsx"
Cohesion: 0.52
Nodes (5): bannerFor(), BannerView, PlanBanner(), PlanBannerView(), usePlan()

### Community 228 - "analyse.spec.ts"
Cohesion: 0.33
Nodes (5): ADR-0006, ADR-0022, ADR-0023, ADR-0027, strikesOf()

### Community 229 - "api/src/env-file.ts"
Cohesion: 0.70
Nodes (3): loadRepoEnv(), repoRootEnvPath(), cleanups

## Knowledge Gaps
- **1500 isolated node(s):** `{ spawnSync }`, `{ readInput, deny }`, `input`, `cmd`, `rules` (+1495 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1908 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **28 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `registerBillingRoutes()` connect `api/src/app.ts` to `entitlements.ts`, `AppHeader.tsx`, `routes/strategies.ts`?**
  _High betweenness centrality (0.100) - this node is a cross-community bridge._
- **Why does `MenuItem()` connect `AppHeader.tsx` to `api/src/app.ts`, `api/billing.ts`?**
  _High betweenness centrality (0.099) - this node is a cross-community bridge._
- **Why does `isNonNegativeDecimal()` connect `primitives.ts` to `src/billing.ts`, `api/src/app.ts`, `accounts.ts`, `src/strategies.ts`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **What connects `{ spawnSync }`, `{ readInput, deny }`, `input` to the rest of the system?**
  _1500 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `b-core.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08095238095238096 - nodes in this community are weakly interconnected._
- **Should `routes-report2.md` be split into smaller, more focused modules?**
  _Cohesion score 0.04081632653061224 - nodes in this community are weakly interconnected._
- **Should `20-landing.js` be split into smaller, more focused modules?**
  _Cohesion score 0.10796221322537113 - nodes in this community are weakly interconnected._