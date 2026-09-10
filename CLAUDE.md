# HapieCoin

## Honesty rules (read every turn)
- Before claiming a function, class, file, import or API exists, verify it: read the file, Grep, or check the manifest. Never fabricate symbols.
- If you cannot verify something, say "I haven't verified this" and do not write code that depends on it.
- Do not add a library the project has never referenced without asking first.
- Never claim a build, test or QA run passed unless you ran the command in this session and saw the output.
- Never invent error messages, API responses, market data or stack traces. If you did not see it, say so.
- "I don't know" or "I need to check first" beats a confident guess.

## Verification protocol
- Before using any symbol: read its definition, or Grep for it, or check package.json / pnpm-workspace. If you skip this, prefix the code with `// UNVERIFIED`.
- Grep proves a string exists, not that it is callable. For TypeScript run `npx tsc --noEmit`; for Python run `pyright` or import it.
- Any task touching more than one file: use the `/plan` skill (or plan mode, Shift+Tab) first. No edits until the plan is agreed. Skip planning only when the diff fits in one sentence.
- Before any commit or user-facing summary of what code does, run the `fact-checker` subagent (`/review` does this).
- Memory files and auto-memory are a map, not the territory: confirm paths, commands and symbols against the repo before acting on them.
- Noisy commands (tests, QA, builds, logs) go through `/digest` so only the signal enters this context.

## What this is
HapieCoin is a crypto options strategy builder for Delta Exchange India (BTC/ETH/XAUT options): chain, payoff, greeks, paper and live trading, alerts, analytics. coingreeks.com is the competitor we cloned for parity; it is never the product name. Mocks are done; Phase 1 (foundation: monorepo, packages schema/pricing/venues/ui, apps api/gateway/web) is built and verified; Phase 2 (workspace parity) is next.

## Quick commands
- Rebuild v2 mock: `cd mockup-v2 && node assemble.js` · QA: `node qa.js dark|light` (Playwright)
- Regenerate spec traceability: `cd spec && node buildspec.js`
- Refresh knowledge graph after changes: `graphify update .` (query with `/graphify`)
- Real build: `pnpm install` · `pnpm ci` (typecheck+lint+coverage+build) · `pnpm dev` · `pnpm db:up` (Postgres+Redis via Docker) · web e2e: `pnpm --filter @hapiecoin/web test:e2e` · real-API smoke (needs Delta network): `pnpm --filter @hapiecoin/web test:smoke`

## Where to look (load only what the task needs)
- Product and users: `.claude/memory/productContext.md`
- Stack, architecture, conventions: `.claude/memory/systemPatterns.md`
- Where we are, blockers, next steps: `.claude/memory/activeContext.md` (injected at session start; update it with `/checkpoint`)
- Decisions (ADRs): `docs/DECISIONS.md` · Review gaps: `GAPS.md` · Build spec and traceability: `spec/`
- Reference-only faithful clone of the original: `mockup-clone/` (read-only, hook-enforced) · Improved HapieCoin mock: `mockup-v2/`
- How this Claude Code setup works: `docs/CLAUDE-SETUP.md`

## Repo etiquette
- Branches: `feat/<area>-<short>`, `fix/<area>-<short>`, `chore/<short>`; never commit directly on `main` once the monorepo exists. Commits: conventional prefix + traceability IDs (`/commit` formats this). PRs: one phase item per PR, description lists IDs and the verification run.
- Env vars (names only; values never in the repo): `DATABASE_URL`, `REDIS_URL`, `BETTER_AUTH_SECRET`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RESEND_API_KEY`, `CREDENTIALS_ENC_KEY` + `CREDENTIALS_ENC_KEYS_PREVIOUS` (vault key and the previous keys after a rotation, ADR-054), `COINGECKO_API_KEY` (optional, analytics ingest), `DELTA_API_KEY`, `DELTA_API_SECRET` (live only, absent in test).

## Non-negotiables
- Product name is HapieCoin everywhere except when referring to the original site. Package scope `@hapiecoin/*`.
- Strikes always come from the venue instrument list per expiry, never a fixed step (ADR-006).
- Every feature maps to an ID in `spec/traceability.json`; a phase closes only when its IDs have passing tests (ADR-007).
- Record decisions in `docs/DECISIONS.md` and review gaps in `GAPS.md`, never only in chat (ADR-008).
- No real orders from tests or dev tooling. Exchange API keys only via environment or secret store, never in code, logs or chat.
