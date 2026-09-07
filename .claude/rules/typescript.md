---
paths:
  - "apps/**/*.{ts,tsx}"
  - "packages/**/*.{ts,tsx}"
---
# TypeScript rules (real build)

## Rule 1: strict, no `any`
- `strict: true`, `noUncheckedIndexedAccess: true`. Use `unknown` plus narrowing instead of `any`.
- Why: option payloads from Delta change shape; a silent `any` hides it until a trader sees a wrong greek.

## Rule 2: validate at the boundary, trust inside
- Every HTTP handler, WS message, env var and localStorage read parses through a Zod schema from `packages/schema`. Inside the app pass typed objects only.

## Rule 3: no floating point for money
- INR/USD amounts as integer minor units or `decimal.js`; quantities as integer lot counts (BTC 0.001, ETH 0.01, XAUT 0.001 per lot).
- Why: `0.1 + 0.2` in a P&L table is a support ticket.
- Wrong: `total += price * qty` with floats. Correct: `totalMinor += priceMinor * lots`, format once at the edge.

## Rule 4: pricing lives in `packages/pricing`
- Black-76, greeks, IV solve: only there, pure functions, property-tested against known values. UI and API import them and never re-implement.

## Rule 5: server data via TanStack Query, UI state via Zustand
- No fetch inside components; no server data inside Zustand. Query keys are typed factories.

## Rule 6: verify before you import
- Check that workspace's `package.json` before importing a package; run `pnpm typecheck` after edits (the PostToolUse hook does a light check automatically).
