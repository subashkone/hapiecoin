# Graph Report - CoinGreeks  (2026-09-07)

## Corpus Check
- 95 files · ~1,293,143 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 748 nodes · 967 edges · 72 communities (51 shown, 11 thin omitted)
- Extraction: 91% EXTRACTED · 9% INFERRED · 0% AMBIGUOUS · INFERRED: 85 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

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
- CoinGreeks v2 · brief for the improved-UX build
- merge-v2.js
- GAPS.md
- mockup-clone/README.md
- mockup-v2/README.md
- build.sh
- test-hooks.js
- hooks
- HapieCoin (project folder "CoinGreeks")
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
- init

## God Nodes (most connected - your core abstractions)
1. `renderBuilder()` - 18 edges
2. `init()` - 16 edges
3. `pubTerminal()` - 15 edges
4. `renderTemplates()` - 14 edges
5. `HapieCoin · decision log (ADR)` - 11 edges
6. `recalc()` - 10 edges
7. `renderHeader()` - 9 edges
8. `draw()` - 8 edges
9. `renderAll()` - 8 edges
10. `renderJournal()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `bindList()` --indirect_call--> `recalc()`  [INFERRED]
  mockup-v2/src-trd/d-lists.js → mockup-v2/src-trd/b-core.js
- `sortRows()` --indirect_call--> `recalc()`  [INFERRED]
  mockup-v2/src-trd/d-lists.js → mockup-v2/src-trd/b-core.js
- `jRows()` --indirect_call--> `recalc()`  [INFERRED]
  mockup-v2/src-trd/e-journal.js → mockup-v2/src-trd/b-core.js
- `init()` --indirect_call--> `recalc()`  [INFERRED]
  mockup-v2/src-trd/f-init.js → mockup-v2/src-trd/b-core.js
- `show()` --indirect_call--> `recalc()`  [INFERRED]
  mockup-v2/src-trd/f-init.js → mockup-v2/src-trd/b-core.js

## Import Cycles
- None detected.

## Communities (72 total, 11 thin omitted)

### Community 0 - "b-core.js"
Cohesion: 0.06
Nodes (46): activeLegs(), bindBuilder(), bindTemplates(), brokerName(), brokerOf(), brokerShort(), createStrategy(), currentPrice() (+38 more)

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
Cohesion: 0.22
Nodes (16): toStratLeg(), bodyHtml(), feeLine(), footHtml(), key(), render(), renderAll(), renderBody() (+8 more)

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
Cohesion: 0.17
Nodes (11): ADR-001 · Product name and reference (2026-09-07), ADR-002 · Two mocks kept side by side (2026-09-06), ADR-003 · Design system: Obsidian Desk, dark-first (2026-09-06), ADR-004 · Stack (2026-09-04, confirmed 2026-09-07), ADR-005 · Monorepo with independently deployable apps (2026-09-07), ADR-006 · Chain driven by the exchange instrument list (2026-09-07), ADR-007 · Traceability as the definition of done (2026-09-07), ADR-008 · Knowledge graph for project memory (2026-09-07) (+3 more)

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

### Community 38 - "CoinGreeks v2 · brief for the improved-UX build"
Cohesion: 0.40
Nodes (4): CoinGreeks v2 · brief for the improved-UX build, Design system (already in shell-head.html; use the variables, never hard-code colours), Part contract reminders, Research-backed UX rules (apply where relevant)

### Community 39 - "merge-v2.js"
Cohesion: 0.50
Nodes (3): files, fs, path

### Community 47 - "test-hooks.js"
Cohesion: 0.11
Nodes (13): badJson, brand, broken, cases, fs, hadWorking, os, path (+5 more)

### Community 48 - "hooks"
Cohesion: 0.20
Nodes (9): hooks, PostToolUse, PreToolUse, SessionStart, Stop, permissions, allow, deny (+1 more)

### Community 49 - "HapieCoin (project folder "CoinGreeks")"
Cohesion: 0.22
Nodes (8): HapieCoin (project folder "CoinGreeks"), Honesty rules (read every turn), Non-negotiables, Quick commands, Repo etiquette, Verification protocol, What this is, Where to look (load only what the task needs)

### Community 50 - "TypeScript rules (real build)"
Cohesion: 0.25
Nodes (7): Rule 1: strict, no `any`, Rule 2: validate at the boundary, trust inside, Rule 3: no floating point for money, Rule 4: pricing lives in `packages/pricing`, Rule 5: server data via TanStack Query, UI state via Zustand, Rule 6: verify before you import, TypeScript rules (real build)

### Community 51 - "HapieCoin · Claude Code environment"
Cohesion: 0.22
Nodes (8): Extending, HapieCoin · Claude Code environment, Hooks: what fires when, Layout, Not set up (deliberately), Permissions, Scaling up (once the single-agent loop is boring), The daily loop

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

### Community 69 - "init"
Cohesion: 0.36
Nodes (8): applyDensity(), registerPalette(), init(), moveOrToggle(), PANELS, placePanels(), show(), tickPanels()

## Knowledge Gaps
- **331 isolated node(s):** `{ spawnSync }`, `{ readInput, deny }`, `input`, `cmd`, `rules` (+326 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 439 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `recalc()` connect `b-core.js` to `init`, `d-lists.js`, `e-journal.js`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Why does `expLabel()` connect `10-header.js` to `b-core.js`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **Why does `toStratLeg()` connect `c-dialogs.js` to `b-core.js`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **What connects `{ spawnSync }`, `{ readInput, deny }`, `input` to the rest of the system?**
  _331 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `b-core.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06400409626216078 - nodes in this community are weakly interconnected._
- **Should `routes-report2.md` be split into smaller, more focused modules?**
  _Cohesion score 0.04081632653061224 - nodes in this community are weakly interconnected._
- **Should `20-landing.js` be split into smaller, more focused modules?**
  _Cohesion score 0.10796221322537113 - nodes in this community are weakly interconnected._