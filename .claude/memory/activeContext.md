# Active context · HapieCoin

**Current phase**: Phase 1 "Foundation" built, verified (compose Postgres/Redis, both images) and reviewed; review fixes landed (ADR-019, GAPS #23–#29 closed). Ready for the first commit, then Phase 2 (workspace parity).
**Last updated**: 2026-09-07 (after the Phase 1 review fixes)

## Recent
- 07 Sep (later): Docker fixed by installing Windows 11 25H2; compose Postgres/Redis verified with the API and gateway; `hapiecoin-api` and `hapiecoin-gateway` images build and run (GAPS #17, #22 closed). Phase 1 `/review` (code-reviewer + fact-checker): 1 blocker, 6 majors, 8 minors → GAPS #23–#30; all but the minor batch fixed the same day under ADR-019 (trusted-proxy client IP, `BETTER_AUTH_URL` = web origin, production requires DATABASE_URL + RESEND_API_KEY, shared referral schema, feed re-watch after refresh, spec rows HC-WS-107/108 + HC-PB-065). Gate after fixes: 30/30 tasks, api 153 / gateway 59 (+1 skipped) / web 144 unit + 27 e2e.
- 07 Sep: Phase 1 delivered. Monorepo (pnpm 12 + Turborepo 2, TS 6.0.3, ESLint 10, Vitest 5). Packages: `schema` (154 tests), `pricing` (83, validated against 307 live Delta tickers, ADR-012), `venues` (94, live Delta REST+WS proven), `ui` (80, tokens generated from the v2 mock). Apps: `api` (Hono + Better Auth email OTP/Google/passkeys, Drizzle on PGlite/Postgres, vault, security headers, 149 tests), `gateway` (ws transport, coalesced deltas, 58 tests, live chain proven), `web` (Next 16, landing/auth/legal/analyse shell with live chain, 144 unit + 26 e2e, 327 KB gz on /analyse). Root gate `pnpm turbo run typecheck lint test:coverage build`: 30/30 tasks green.
- 07 Sep: real integration run web→api→gateway→Delta: sign-up, OTP from API log, verify, `/analyse` shows FEED LIVE with the nearest expiry's real strikes; session valid. Fixes found by it: web auth rewrite now targets `/v1/auth` (ADR-018), gateway CORS on `/healthz`, favicon.
- 07 Sep: product renamed to HapieCoin in every file except the reference clone and the guard/rule files; v2 mock, inventory and spec republished; ADR-011..017 and GAPS #7–21 recorded by the build agents.

## Blocked by
- Nothing. Docker fixed 07 Sep 2026 by installing Windows 11 25H2 (GAPS #22 closed); compose Postgres + Redis verified with the API and gateway the same day (docs/CLAUDE-SETUP.md → "Docker on this machine").

## Next steps
1. First commit when the user asks (`/commit`; everything is still untracked on `main`, so create `feat/phase1-foundation` first). Small follow-ups: add api/gateway services to docker-compose.yml; GAPS #30 minors.
2. Refresh `spec/fixtures/delta-tickers.json` with put tickers (GAPS #7) and re-run pricing validation.
3. Phase 2 (workspace parity): chain driven by the instrument list with shared calls/puts scrolling and fixed centre strike column (GAPS #1, #2 as first acceptance tests), builder, templates, payoff, Greeks, ladder, settings dialogs against the v2 mock.
4. Optional inputs from the user: Google OAuth client id/secret (button hidden until set), later Delta test API key (Phase 3), Razorpay test keys (Phase 4).
