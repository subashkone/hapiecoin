# Product identity

## Rule: HapieCoin is the product, CoinGreeks is the competitor
- Use "HapieCoin" in all copy, code identifiers, package names (`@hapiecoin/*`), commit messages and artifacts.
- Say "CoinGreeks" only when referring to the original site being matched.
- Why: the user's product is hapiecoin.com; shipping the competitor's name is a legal and brand defect (ADR-001).
- Exception: `mockup-clone/` deliberately keeps the CoinGreeks name because it is the reference copy (ADR-002). Never edit it.

## Rule: the user's bar is "no confusion"
- Prefer the clearer label, the fewer steps, the visible state. When two designs tie, pick the one a first-time trader understands without a tour.
