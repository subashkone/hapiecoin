---
paths:
  - "apps/api/**"
  - "apps/gateway/**"
  - "apps/workers/**"
  - "packages/venues/**"
---
# Trading safety

## Rule 1: only the live executor places orders
- One module (the live executor in `packages/venues`) may call order-placing endpoints. Everything else uses the paper executor or the shared order model.
- Why: a stray call from a test or a worker places a real BTC option order with real money.

## Rule 2: tests never touch live endpoints
- Vitest and Playwright use recorded fixtures or the paper executor. `DELTA_API_KEY` must be absent in the test env; the venue client throws if it sees a live key while `NODE_ENV=test`.

## Rule 3: secrets
- API keys, Razorpay keys, JWT secrets: environment or secret store only. Never in code, fixtures, logs, commit messages or chat. Redact on error paths.

## Rule 4: idempotent, rate-limited, timed out
- Every order call carries a client order id; retries reuse it. Respect Delta rate limits with a token bucket; default HTTP timeout 5 s; WS reconnect with backoff and resubscribe.

## Rule 5: paper and live are visibly different
- Live mode requires an explicit switch, an IP-whitelisted key, and a confirm step; the UI shows a persistent live badge. Never default to live.
