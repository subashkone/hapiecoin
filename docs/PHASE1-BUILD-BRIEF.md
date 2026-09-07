# Phase 1 engineering brief (read fully before writing code)

Repo: `e:\Subash\Projects\HapieCoin`. Product name is **HapieCoin** everywhere; the original site's name never appears in product code. Read `CLAUDE.md`, `.claude/rules/*.md`, `docs/DECISIONS.md` (ADR-001..010), `.claude/memory/systemPatterns.md`, and the Phase 1 plan summary in `.claude/memory/activeContext.md`.

## Toolchain (already installed)
- Node 24, pnpm 12 (corepack), Turborepo 2, TypeScript 7, ESLint 10 (flat config), Prettier 3, Vitest 5 with v8 coverage. Root scripts: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:coverage`, `pnpm build`, `pnpm ci`.
- Shared config: `packages/config` → `@hapiecoin/config/eslint`, `/prettier`, `/vitest` (call `base({ strict: true })` for money-math packages), `/tsconfig/library.json`, `/tsconfig/node-app.json`, `/tsconfig/next.json`.
- Docker (Postgres 17 + Timescale, Redis 7) is installed but needs a machine restart; `docker-compose.yml` is ready. Until then, nothing in Phase 1 packages may depend on a running database.
- Windows host: paths are case-insensitive, use POSIX paths in scripts; the Bash tool strips backslashes in heredocs, so write files with the Write tool.

## Package conventions
- Name `@hapiecoin/<name>`, `"type": "module"`, `src/` only, `exports` map with `"."` → `./src/index.ts` for development and `./dist/index.js` after build (use `tsc` for libraries; `tsup` is allowed if you add it). `sideEffects: false`.
- Scripts in every package: `build`, `typecheck` (`tsc --noEmit -p tsconfig.json`), `lint` (`eslint .`), `test` (`vitest run`), `test:coverage` (`vitest run --coverage`). All four must pass before you report done.
- `tsconfig.json` extends the matching `@hapiecoin/config/tsconfig/*.json`; `eslint.config.js` spreads `@hapiecoin/config/eslint`; `vitest.config.ts` merges `@hapiecoin/config/vitest`.
- Add dependencies with `pnpm add <pkg> --filter @hapiecoin/<name>` (exact versions). Do not add a dependency the plan does not name without stating why in your report. Zod is the validation library everywhere.
- Money and quantities cross package boundaries as **decimal strings** (`"0.001"`, `"79521.5"`); numbers are allowed inside pure math (pricing) only. Never `parseFloat` a currency total for storage.
- Product identity: the product is `HapieCoin`; the original site's name must not appear in code or comments (the lint guard in `packages/config/eslint.config.js` fails the build; tests and fixtures are exempt).
- Every test title starts with the traceability ID it proves when one exists (`spec/traceability.json`), otherwise a stable tag such as `[PRICING]`, `[VENUES]`, `[GAPS-1]`.
- Coverage: `strict: true` packages (schema, pricing, venues) must reach 100 % lines/functions/statements and ≥ 95 % branches; ui ≥ 90 %. `vitest run --coverage` fails otherwise — that is intended.
- No network calls in unit tests. Recorded fixtures live in `spec/fixtures/` (`delta-products.json`: 972 products from Delta India; `delta-tickers.json`: BTC call/put tickers with greeks, mark IV, OI, spot). Copy what you need into `src/fixtures/` of your package if you must import it.
- Report format at the end: package path, public API (exported names with one-line docs), commands run with the tail of their output (coverage table included), dependencies added and why, honest gaps.

## Fixture facts (verified on 04 Sep 2026)
- Delta product symbols: `C-BTC-80000-250926`, `P-ETH-2400-110926`, futures `BTCUSD`; `contract_value` "0.001" (BTC), "0.01" (ETH), "0.001" (XAUT); `settlement_time` ISO in products; options settle 12:00 UTC on the expiry date.
- Ticker fields used: `symbol`, `mark_price`, `spot_price`, `strike_price`, `oi`, `volume`, `mark_vol` (mark IV as a decimal, e.g. 0.42), `greeks: { delta, gamma, theta, vega, rho }` (strings), `quotes: { best_bid, best_ask, bid_iv, ask_iv, bid_size, ask_size }`, `timestamp` (µs). Verify against the fixture before relying on a field name.
- Strike ladders are irregular per expiry (200/400/600 daily, 500/1000 weekly, 1000 monthly). Strikes always come from the instrument list (ADR-006).
