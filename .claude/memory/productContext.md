# Product context · HapieCoin

## Vision
A crypto options strategy builder and trading terminal for Delta Exchange India. Indian retail and semi-pro traders trade BTC, ETH and XAUT options priced in USD but pay in INR. Today they use coingreeks.com, a single-bundle SPA with no backtesting, volatility analytics or alerts. HapieCoin reaches feature parity first, then beats it on speed, clarity and analytics.

## Users
- Retail options traders on Delta India who build multi-leg strategies (up to 10 legs), compare payoff and greeks, and paper-trade before going live.
- Power users who want alerts, journal, share links, scenario and volatility views, and a command palette.
- Admin (the owner) managing plans, coupons, referrals, users and support.

## Product bar (user's words)
"Best website, good user experience, no confusion, easily understandable." Dark-first Obsidian Desk design (ADR-003), light theme first-class.

## Scope reference
- 922 feature IDs (HC-XX-nnn) in `spec/traceability.json`, derived from the v2 mock inventory; 6 build phases with exit gates in `spec/hapiecoin-build-spec.html`.
- Monetisation: INR plans (monthly/quarterly/yearly) via Razorpay with per-feature limits, coupons, referrals.

## Success
- Phase gates pass: all IDs of a phase have passing tests and visual diffs within tolerance.
- Chain, payoff and greeks update within one WS tick; first paint under 1 s on a mid-range laptop.
- A first-time user can build and understand a strategy without a tour.
