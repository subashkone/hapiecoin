---
paths:
  - "mockup-v2/**"
  - "mockup-clone/**"
---
# Mock build rules

- `mockup-clone/` is read-only (ADR-002); a PreToolUse hook denies edits. Read it to answer "what did the original do".
- In `mockup-v2/` edit sources (`parts/`, `parts-src/`, `src-trd/`, `chrome-src/`, `public-src/`, `adm-src/`, `_analytics-src/`) and rebuild with `node assemble.js`. Never edit the generated `coingreeks-v2.html` or `coingreeks-v2.local.html` by hand.
- After a rebuild run `node qa.js dark` and `node qa.js light` (Playwright) and `node inventory.js` if features changed; then `cd ../spec && node buildspec.js` so traceability stays in sync.
- The product name in v2 is HapieCoin; "CoinGreeks" in v2 copy is a defect.
