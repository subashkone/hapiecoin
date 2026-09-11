---
name: review-patterns-trading
description: Defect classes seen in the trade-lifecycle / live-trading reviews (Sep 2026) that recur in generated trading code; check these on any diff touching live legs, positions or reconcile-style bookkeeping
metadata:
  type: project
---

Recurring defect classes from the trade-lifecycle reviews (roadmap A2, 2026-09-11):

1. A live leg with `status: "open"` and `entryPrice: null` is a *pending or failed entry* (the order rests or was refused), not a filled position. Any "compare app vs exchange" logic that sums open legs must exclude these, or every resting limit entry is reported as drift.
2. Test fixtures that reuse an existing state as a proxy for a different scenario (e.g. `entryPrice: null` standing in for "the exchange closed it") lock the wrong semantics into the test suite. Ask what the fixture state means in production before accepting it.
3. "Cannot size it" collapsed into "holds zero": positions with a null `contractValue` or a non-whole lot count were dropped and then read as the exchange holding nothing. Unknown must stay unknown, never become 0.
4. Bookkeeping-only routes that close *live* legs (reconcile, settlement) are the first paths that bypass `placeExit`; require an api test on a live strategy asserting the fake trading client received no order, not just a paper-strategy test.
5. Default prices sourced from a venue position mark are empty in exactly the case the feature exists for (the position is gone); fall back to the app's own quote before the entry price.
6. (second pass, same day) "Unknown as zero" recurs one layer down: the venue client returns `[]` on transport / non-success / parse failure, the route answers 200 with an empty list, and a drift check reads that as "the exchange holds nothing" for every contract. Trace any "exchange holds X" figure back to the venue client's failure branches, not just the web helper.
7. Two queries feeding one comparison (strategies vs venue positions) go stale independently: a mutation that invalidates only one side produces a transient, actionable false drift. Check every mutation hook that can change live legs invalidates both, and that a "book it closed" confirm refetches the venue side first.
8. (third pass) Fixing "unknown as zero" by making a venue helper *throw* moves the defect to its other callers: a pre-existing `try/catch` upstream (live-exec `preview`) written for vault/network errors absorbed the new throw as a blocking reason, so a positions outage silently started refusing live placement while a balances outage still passed. When a soft-fail helper becomes a throw, grep every caller and read the enclosing try/catch; each one needs a decided behaviour and a `positionsDown`-style test. Also: `loading={query.isFetching}` on an action button disables it during every background poll of a shared key; use local pending state.

**Why:** all of these passed unit tests because the tests mirrored the implementation and the fixture encoded the wrong state.
**How to apply:** on diffs touching `lib/strategy/drift*`, `positions*`, live legs or any route that squares off without a venue call, grep for `entryPrice` handling, for `?? 0` / `continue` / `return []` on unsizeable or failed data (web *and* `packages/venues`), for the invalidation set of every strategy mutation hook, and for a live-strategy no-order test. See also [[review-patterns-phase1]].
