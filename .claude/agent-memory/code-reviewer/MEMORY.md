# Memory index
- [Phase 1 review patterns](review-patterns-phase1.md) — defect classes from the 2026-09-07 foundation review to check first on later phases (prod env gaps, proxy IP trust, web/api contract drift, phantom trace IDs)
- [Trading review patterns](review-patterns-trading.md) — live-leg / drift / reconcile defect classes from the 2026-09-11 lifecycle review (pending entry = open+null entryPrice, proxy fixtures, unknown-as-zero, no-order test on live)
- [CI / hardening review patterns](review-patterns-ci.md) — non-turbo jobs never build dist, Dockerfile COPY drift vs workspace deps, order routes outside live.ts, body-limit header branch untested, zod-openapi middleware runs before validators
