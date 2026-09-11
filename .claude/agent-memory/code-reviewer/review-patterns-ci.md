---
name: review-patterns-ci
description: Defect classes from the 2026-09-11 CI / hardening review (ADR-061) that recur in workflow, Dockerfile and middleware diffs; check these on any .github, Dockerfile or security/* change
metadata:
  type: project
---

Recurring defect classes from the CI + body-limit + order-limiter review (ADR-061, 2026-09-11):

1. A workflow step that calls a package script directly (`pnpm --filter X test:e2e`) bypasses turbo's `dependsOn: build`. Workspace packages export `dist/` under the `import` condition (only `next dev`/webpack sees the `development` → `src` condition; tsx/Node do not), so any tsx-run helper (e2e mock servers, `real-servers.ts`, `tsx src/main.ts`) importing `@hapiecoin/*` dies on a fresh checkout. Ask "who builds dist before this step?" for every non-turbo job.
2. Dockerfile COPY lists drift from `package.json` workspace deps: a `workspace:*` dependency added later (e.g. `@hapiecoin/venues` to the api on 2026-09-08) is not copied, so `pnpm install --filter app...` fails. Diff the COPY lines against the app's `@hapiecoin/*` deps on every Dockerfile or deps change.
3. "Routes that send orders" is wider than the list in the GAP: `strategies.ts` `/close`, `/legs/{legId}/close` and `/adjust` call `placeExit` / `placeEntries` on live strategies. Any per-route trading guard must be checked against a grep for `placeExit(|placeEntries(` outside `routes/live.ts`, and deferrals must be written into GAPS, not only the ADR.
4. Hono `app.request()` with a string body sets no Content-Length, so tests of `hono/body-limit` only exercise the streaming branch; the header branch (real clients) needs an explicit `content-length` header case.
5. `@hono/zod-openapi` runs `middleware: [...]` before the request validators (index.mjs `this.on(..., ...middleware, ...validators, handler)`), so route middleware sees unvalidated bodies and rate budgets are consumed by invalid requests. State this in any review of route-level middleware.
6. Workflow-level `env: NODE_ENV=test` leaks into `pnpm install`, `next build` and `next dev`; vitest sets it itself. Flag global NODE_ENV in workflows.

**Why:** the e2e and docker jobs of the first CI workflow would have gone red on the first PR / push; the tests passed locally only because `dist/` already existed on the author's machine.
**How to apply:** on `.github/**` or Dockerfile diffs, trace each job from a clean checkout (what exists on disk before each step); on trading-guard diffs grep the executor entry points. See also [[review-patterns-trading]] and [[review-patterns-phase1]].
