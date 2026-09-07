---
paths:
  - "apps/web/**"
  - "packages/ui/**"
---
# Frontend rules (HapieCoin web)

- **Design system**: Obsidian Desk tokens (ADR-003), dark-first with a first-class light theme. Amber only for spot/ATM/primary action; green/red only for P&L and side. Reference implementation: `mockup-v2/` (palette and chrome in `src-trd/` and `chrome-src/`).
- **Chain**: strikes come from the instrument list per expiry, never a step constant. One table, fixed centre strike column, shared vertical and horizontal scroll (ADR-006; GAPS #1, #2).
- **Performance**: virtualise the chain (TanStack Virtual), charts on canvas (uPlot), pricing in a Web Worker. Batch WS updates per animation frame; no layout thrash per tick.
- **Clarity**: every number has a unit and a basis (mark vs bid/ask, USD vs INR). Empty and error states are designed, not blank.
- **Accessibility**: keyboard reachable, focus visible, contrast AA in both themes, `prefers-reduced-motion` honoured.
- **Traceability**: each screen or component lists its HC-XX-nnn IDs in a comment header; Playwright visual tests use the same IDs.
- Run `/frontend-design` before building a new screen.
