"""Every Neutral template of the Builder on the daily history (the owner, 24 Nov 2026: "goto builder ... click on
neutral ... need to explore about each of the strategy"). The legs are copied from packages/pricing/src/templates.ts
(category "Neutral", 21 templates) as (kind, side, rows from the at-the-money row, lots multiple, later expiry):
`k` counts the strikes in this cache's ladder for the expiry (the lab's download keeps one step: BTC 200, ETH 10;
the venue's own ladder may differ, which the Builder uses), the at-the-money row is the strike nearest the spot.

One trade per expiry, entered <entry_hours_before> the settlement at the MARK close, 100 lots times the multiple a
leg, nothing done until the settlement: every option of the expiry settles at its intrinsic value on the spot of the
last bar; an option of the NEXT daily expiry (the calendars) is closed at its mark of that last bar by a market
order; the perpetual (Synthetic Straddle) is opened and closed at the spot. Fees as study_exits.py (imported; run
without -I from this folder) for options, 0.05 % of the notional plus GST a fill for the perpetual. With "slip"
every market fill of an option is worse than the mark by the share measured on real fills (study_stack.py); the
perpetual is given none (not measured). A day on which a leg has no mark at the entry is left out (the "days" column is what was traded).

Columns: days traded, the mean net premium at the entry (+ collected, - paid), mean result per day, share of days
positive, total, the best and the worst day, the worst three, the largest drawdown, the two halves, named expiries.

Usage: python study_templates.py <cache_dir> <lot_size> <bar_minutes> <entry_hours_before> 1 "" "" <label> <expiries to show, comma> [slip or ""] [Neutral | Bullish | Bearish | Others]
       (the other three categories were added the same day: "explore the other templates"; 48 templates in all)"""
import os, sys
import study_exits as X

LABEL = sys.argv[8]
SHOW = [x for x in sys.argv[9].split(",") if x] if len(sys.argv) > 9 else []
SLIP = len(sys.argv) > 10 and sys.argv[10] == "slip"
Q = X.Q
C, P, F, B, S = "C", "P", "F", 1, -1
FUT_FEE = 0.0005 * (1 + X.GST)

TEMPLATES = [
    ("Long Straddle", [(C, B, 0, 1, 0), (P, B, 0, 1, 0)]),
    ("Short Straddle", [(C, S, 0, 1, 0), (P, S, 0, 1, 0)]),
    ("Long Strangle", [(C, B, 2, 1, 0), (P, B, -2, 1, 0)]),
    ("Short Strangle", [(C, S, 2, 1, 0), (P, S, -2, 1, 0)]),
    ("Iron Condor", [(P, B, -4, 1, 0), (P, S, -2, 1, 0), (C, S, 2, 1, 0), (C, B, 4, 1, 0)]),
    ("Reverse Iron Condor", [(P, S, -4, 1, 0), (P, B, -2, 1, 0), (C, B, 2, 1, 0), (C, S, 4, 1, 0)]),
    ("Iron Butterfly", [(P, B, -3, 1, 0), (P, S, 0, 1, 0), (C, S, 0, 1, 0), (C, B, 3, 1, 0)]),
    ("Reverse Iron Butterfly", [(P, S, -3, 1, 0), (P, B, 0, 1, 0), (C, B, 0, 1, 0), (C, S, 3, 1, 0)]),
    ("Long Call Butterfly", [(C, B, -2, 1, 0), (C, S, 0, 2, 0), (C, B, 2, 1, 0)]),
    ("Long Put Butterfly", [(P, B, 2, 1, 0), (P, S, 0, 2, 0), (P, B, -2, 1, 0)]),
    ("Long Call Condor", [(C, B, -3, 1, 0), (C, S, -1, 1, 0), (C, S, 1, 1, 0), (C, B, 3, 1, 0)]),
    ("Long Calendar with Calls", [(C, S, 0, 1, 0), (C, B, 0, 1, 1)]),
    ("Long Calendar with Puts", [(P, S, 0, 1, 0), (P, B, 0, 1, 1)]),
    ("Long Gut", [(C, B, -2, 1, 0), (P, B, 2, 1, 0)]),
    ("Strip", [(C, B, 0, 1, 0), (P, B, 0, 2, 0)]),
    ("Strap", [(C, B, 0, 2, 0), (P, B, 0, 1, 0)]),
    ("Synthetic Straddle", [(F, B, 0, 1, 0), (P, B, 0, 2, 0)]),
    ("Broken-Wing Put Butterfly", [(P, B, 0, 1, 0), (P, S, -2, 2, 0), (P, B, -5, 1, 0)]),
    ("Broken-Wing Call Butterfly", [(C, B, 0, 1, 0), (C, S, 2, 2, 0), (C, B, 5, 1, 0)]),
    ("Double Diagonal", [(P, S, -2, 1, 0), (P, B, -4, 1, 1), (C, S, 2, 1, 0), (C, B, 4, 1, 1)]),
    ("Calendar Strangle", [(P, S, -2, 1, 0), (P, B, -2, 1, 1), (C, S, 2, 1, 0), (C, B, 2, 1, 1)]),
]

OTHER = {
    "Bullish": [
        ("Buy Call", [(C, B, 0, 1, 0)]),
        ("Sell Put", [(P, S, 0, 1, 0)]),
        ("Bull Call Spread", [(C, B, 0, 1, 0), (C, S, 2, 1, 0)]),
        ("Bull Put Spread", [(P, S, 0, 1, 0), (P, B, -2, 1, 0)]),
        ("Long Synthetic Future", [(C, B, 0, 1, 0), (P, S, 0, 1, 0)]),
        ("Long Perp", [(F, B, 0, 1, 0)]),
        ("Covered Call", [(F, B, 0, 1, 0), (C, S, 2, 1, 0)]),
        ("Protective Put", [(F, B, 0, 1, 0), (P, B, -2, 1, 0)]),
        ("Collar", [(F, B, 0, 1, 0), (P, B, -2, 1, 0), (C, S, 2, 1, 0)]),
        ("Call Back Spread 1x2", [(C, S, 0, 1, 0), (C, B, 2, 2, 0)]),
        ("Diagonal Call", [(C, S, 2, 1, 0), (C, B, 0, 1, 1)]),
        ("Risk Reversal", [(P, S, -2, 1, 0), (C, B, 2, 1, 0)]),
    ],
    "Bearish": [
        ("Buy Put", [(P, B, 0, 1, 0)]),
        ("Sell Call", [(C, S, 0, 1, 0)]),
        ("Bear Put Spread", [(P, B, 0, 1, 0), (P, S, -2, 1, 0)]),
        ("Bear Call Spread", [(C, S, 0, 1, 0), (C, B, 2, 1, 0)]),
        ("Short Synthetic Future", [(C, S, 0, 1, 0), (P, B, 0, 1, 0)]),
        ("Short Perp", [(F, S, 0, 1, 0)]),
        ("Covered Put", [(F, S, 0, 1, 0), (P, S, -2, 1, 0)]),
        ("Put Back Spread 1x2", [(P, S, 0, 1, 0), (P, B, -2, 2, 0)]),
        ("Diagonal Put", [(P, S, -2, 1, 0), (P, B, 0, 1, 1)]),
    ],
    "Others": [
        ("Jade Lizard", [(P, B, -4, 1, 0), (P, S, -2, 1, 0), (C, S, 2, 1, 0)]),
        ("Reverse Jade Lizard", [(C, B, 4, 1, 0), (C, S, 2, 1, 0), (P, S, -2, 1, 0)]),
        ("Call Ratio Spread 1x2", [(C, B, 0, 1, 0), (C, S, 2, 2, 0)]),
        ("Put Ratio Spread 1x2", [(P, B, 0, 1, 0), (P, S, -2, 2, 0)]),
        ("Short Call Ladder", [(C, S, 0, 1, 0), (C, B, 2, 1, 0), (C, B, 4, 1, 0)]),
        ("Short Put Ladder", [(P, S, 0, 1, 0), (P, B, -2, 1, 0), (P, B, -4, 1, 0)]),
    ],
}
CATEGORY = sys.argv[11] if len(sys.argv) > 11 else "Neutral"
if CATEGORY != "Neutral":
    TEMPLATES = OTHER[CATEGORY]


def slip(p, sp, q):
    if not SLIP:
        return 0.0
    r = p / sp
    return p * q * (0.01 if r >= 0.004 else 0.025 if r >= 0.0007 else 0.065)


def fee(sp, p, q):
    return X.fee(sp, p) * q / Q


trades = sorted(X.trades, key=lambda x: x[0])
expiries = sorted(e for e in os.listdir(X.CACHE) if os.path.isdir(os.path.join(X.CACHE, e)))
opts_of = {}


def opts(e):
    if e not in opts_of:
        opts_of[e] = X.load(e)[1]
    return opts_of[e]


def one(e, tr, legs):
    """(result, net premium) or None when a leg cannot be priced at the entry."""
    sp0, sp1 = tr.spot[tr.t0], tr.settle_spot
    near = opts(e)
    ladder = sorted({k for _, k in near})
    atm = min(range(len(ladder)), key=lambda i: abs(ladder[i] - sp0))
    nxt = expiries.index(e) + 1
    result = premium = 0.0
    for kind, side, k, lots, later in legs:
        q = Q * lots
        if kind == F:
            result += side * (sp1 - sp0) * q - FUT_FEE * (sp0 + sp1) * q
            continue
        row = atm + k
        if row < 0 or row >= len(ladder):
            return None
        strike = ladder[row]
        if later:
            if nxt >= len(expiries):
                return None
            series = opts(expiries[nxt]).get((kind, strike))
            if series is None or tr.t0 not in series or tr.last_b not in series:
                return None
            p0, p1 = series[tr.t0], series[tr.last_b]
            out_cost = fee(sp1, p1, q) + slip(p1, sp1, q)
        else:
            series = near.get((kind, strike))
            if series is None or tr.t0 not in series:
                return None
            p0, p1 = series[tr.t0], X.intrinsic(kind, strike, sp1)
            out_cost = fee(sp1, p1, q)
        result += side * (p1 - p0) * q - fee(sp0, p0, q) - slip(p0, sp0, q) - out_cost
        premium += -side * p0 * q
    return result, premium


n_all = len(trades)
print(f"## {LABEL}, {CATEGORY} templates{' WITH SLIPPAGE' if SLIP else ''}: {n_all} expiries ({trades[0][0]} .. {trades[-1][0]}), entered {X.ENTRY:g} h before settlement, held to settlement; 100 lots a leg")
print(f"   {'':28s} {'days':>4s} {'premium':>8s} {'mean':>7s} {'win':>4s} {'total':>7s} {'best':>7s} {'worst':>7s} {'worst 3':>8s} {'drawdown':>8s} {'halves':>13s}  " + "  ".join(f"{e[5:]:>7s}" for e in SHOW))
for name, legs in TEMPLATES:
    rows = [(e, one(e, tr, legs)) for e, tr in trades]
    rows = [(e, r) for e, r in rows if r is not None]
    n = len(rows)
    if not n:
        print(f"   {name:28s} {0:4d}   no day could be priced")
        continue
    vals = [r[0] for _, r in rows]
    mid = rows[n // 2][0]
    cum = peak = dd = 0.0
    for v in vals:
        cum += v
        peak = max(peak, cum)
        dd = max(dd, peak - cum)
    h = f"{sum(r[0] for e, r in rows if e < mid):+.0f}/{sum(r[0] for e, r in rows if e >= mid):+.0f}"
    by = {e: r[0] for e, r in rows}
    print(f"   {name:28s} {n:4d} {sum(r[1] for _, r in rows) / n:+8.1f} {sum(vals) / n:+7.2f} {100 * sum(1 for v in vals if v > 0) / n:3.0f}% {sum(vals):+7.0f} {max(vals):+7.1f} {min(vals):+7.1f} {sum(sorted(vals)[:3]):+8.1f} {-dd:+8.1f} {h:>13s}  "
          + "  ".join(f"{by[e]:+7.1f}" if e in by else f"{'':>7s}" for e in SHOW))
print()
