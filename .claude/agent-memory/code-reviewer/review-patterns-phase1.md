---
name: review-patterns-phase1
description: Defect classes found in the Phase 1 foundation review (2026-09-07) that are likely to recur in generated code; check these first on later phases
metadata:
  type: project
---

Recurring defect classes from the Phase 1 (api/gateway/web/packages) review on 2026-09-07:

1. Production-only requirements not enforced in config: optional env (RESEND_API_KEY, DATABASE_URL) silently degrades to the dev path (OTP-to-log mailer, in-memory PGlite) when NODE_ENV=production.
2. Proxy headers trusted unconditionally (`x-forwarded-for`, `cf-connecting-ip`) for rate limiting and audit IP, with no trusted-proxy setting.
3. Cross-app contract drift between apps/web and apps/api on formats the schema package already defines (referral code regex duplicated in web with a different shape than ADR-015 / `ReferralCode`).
4. Traceability IDs invented in tests (HC-CH-*) that do not exist in `spec/traceability.json`; and implemented phase-1 features left untagged (HC-SH-018/035/039).
5. Same-origin-by-rewrite design (ADR-017/018) breaks for browser-redirect flows (Google OAuth callback lands on the API origin because Better Auth uses BETTER_AUTH_URL).
6. Live-feed refresh paths that update state but not subscriptions (instrument refresh does not resubscribe new symbols on watched topics).

**Why:** these were the majors of the first full review; each one passed unit tests because the tests mirrored the implementation rather than the contract.
**How to apply:** on every later review, grep config for `optional()` fields and ask "what happens in prod if unset", grep for header-derived IPs, diff web validators against `@hapiecoin/schema`, and run the ID-coverage check (IDs in code vs `spec/traceability.json`) before reading the diff in detail. See [[hapiecoin-review-checklist]] if it exists later.
