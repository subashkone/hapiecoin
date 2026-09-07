---
name: frontend-design
description: Design pass for a HapieCoin screen or component before building it. Produces an intentional layout, states, and token usage that match the Obsidian Desk system, and checks the user's "no confusion" bar. Use before creating any new screen, panel, table or chart in apps/web or mockup-v2.
argument-hint: [screen or component name] [traceability IDs]
allowed-tools: Read, Grep, Glob
---
Design: $ARGUMENTS

Read first: `docs/DECISIONS.md` ADR-003 and ADR-006, `.claude/rules/frontend.md`, and the nearest existing implementation in `mockup-v2/` (Grep for the screen name in `mockup-v2/parts`, `src-trd`, `chrome-src`). Reuse its tokens and patterns; do not invent a second style.

Produce, in this order:
1. **Job of the screen** in one sentence, and the trader's first question it must answer within 2 seconds.
2. **Layout** as an ASCII sketch for desktop (1440) and the change for narrow (390) widths. Name the fixed and scrolling regions (for the chain: fixed centre strike column, shared scroll).
3. **Hierarchy**: what is primary (one amber element at most), secondary, tertiary. Where green/red appear (P&L and side only).
4. **States**: loading, empty, error, stale data (WS disconnected), paper vs live badge, light and dark.
5. **Numbers**: every figure with unit and basis (mark or bid/ask; USD or INR); alignment and formatting rules.
6. **Interaction**: keyboard path, focus order, command-palette entries, shortcuts (must not clash with `mockup-v2` shortcut list).
7. **Traceability**: list the HC-XX-nnn IDs this covers and the Playwright visual test names.
8. **Real-data check**: how it looks with 5 rows and with 500, with a 6-digit BTC price and a 3-digit XAUT price, with long strategy names, with no positions. Name the breakpoint where the layout would fail and the fix.
9. **Generic-pattern check**: no evenly balanced card grids, no three identical feature tiles, no two buttons competing for primary, no decorative icons without meaning. Every element earns its place by answering a trader's question.
10. **Confusion check**: three things a first-time user could misread and how the design prevents each.

Keep it under 80 lines. Do not write component code in this skill; the plan or implementation step does that.
