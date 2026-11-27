"""A monthly strangle closed early at a small profit and sold again (the owner, 26 Nov 2026: "Why don't we exit the
monthly strategies with less profits again and again and open again new monthly trades, because we are in profit?").
On the monthly cache, with the trades, fees, stops and fills of study_monthly_reentry.py (imported; its own tables
are not printed):

  hold        the strangle sold 44 days before, each sold option under the stop, the rest held to settlement.
  take        the same, but once the strangle as a whole (what the stops took, the entry costs and the open options at
              the mark) is ahead by a share of the premium it sold, what is open is bought back at the mark. Nothing
              more is sold on that expiry.
  take, again the same, and at that hour a new strangle is sold the percentage away from the spot of that hour, on the
              same expiry, with the same stop and the same take; again and again, but not in the last 7 days.

The next expiry is not used for the new strangle: the cache of an expiry does not reach back far enough to price it
on every date, and Autopilot already sells that expiry on its own day.

Columns: expiries, mean per expiry, expiries positive, total, worst and best expiry, mean premium sold per expiry,
mean number of strangles sold per expiry, mean per strangle, mean days a strangle was open before its take (takes only).

Usage: python study_monthly_take.py <cache_dir> <lot_size> <label> <percent away> [scaled] [slip]
       (run without -I from this folder)"""
import contextlib, io

with contextlib.redirect_stdout(io.StringIO()):
    import study_monthly_reentry as M

H, Q = M.H, M.Q


def scheme(x, mult, take, again):
    """Returns (result, premium sold, strangles sold, [days open before each take])."""
    t0 = x.at(M.BASE)
    legs = x.strangle(t0)
    if legs is None:
        return None
    total, prem, n, held = 0.0, M.credit(legs), 1, []
    live, cyc, cred, born, t = list(legs), -M.cost(legs), M.credit(legs), t0, t0 + H
    while t <= x.last_b and live:
        for leg in list(live):
            p = x.mark(leg, t)
            if mult is not None and p is not None and p >= mult * leg[2]:
                cyc += x.buy_back(leg, t, p)
                live.remove(leg)
        marks = [x.mark(leg, t) for leg in live]
        if take is not None and live and None not in marks:
            open_pl = sum((leg[2] - p) * Q for leg, p in zip(live, marks))
            if cyc + open_pl >= take * cred:
                cyc += sum(x.buy_back(leg, t, p) for leg, p in zip(live, marks))
                held.append((t - born).total_seconds() / 86400)
                total, live = total + cyc, []
                new = x.strangle(t) if again and x.left(t) >= M.LAST_DAYS else None
                if new is not None:
                    live, cyc, cred, born = list(new), -M.cost(new), M.credit(new), t
                    prem, n = prem + cred, n + 1
                else:
                    cyc = 0.0
        t += H
    total += cyc + sum(x.settle_leg(leg) for leg in live)
    return total, prem, n, held


def line(name, mult, take, again):
    got = [r for r in (scheme(x, mult, take, again) for x in M.data) if r is not None]
    v = [r[0] for r in got]
    n, ents = len(v), sum(r[2] for r in got)
    held = [d for r in got for d in r[3]]
    days = f"{sum(held) / len(held):6.1f} ({len(held)})" if held else "     -"
    print(f"   {name:46s} {n:3d} {sum(v) / n:+8.1f} {sum(1 for a in v if a > 0):3d} {sum(v):+8.0f} {min(v):+8.0f} {max(v):+8.0f} {sum(r[1] for r in got) / n:8.1f} {ents / n:5.1f} {sum(v) / ents:+8.1f} {days}")


print(f"## {M.LABEL}{' WITH SLIPPAGE' if M.SLIP else ''}: {len(M.data)} settled monthly expiries ({M.data[0].exp} .. {M.data[-1].exp}); first strangle {M.BASE} days before, {M.PCT * 100:g} % away{' (scaled by the days left)' if M.SCALED else ''}; {M.LOTS} lots x {M.LOT:g} a leg; net of fees; hourly marks")
for mult in (3, 2):
    print(f"\n-- stop {mult}x on every sold option")
    print(f"   {'':46s} {'exp':>3s} {'mean':>8s} {'pos':>3s} {'total':>8s} {'worst':>8s} {'best':>8s} {'premium':>8s} {'sold':>5s} {'a sale':>8s} days to a take (takes)")
    line("hold to settlement", mult, None, False)
    for take in (0.15, 0.25, 0.35, 0.5, 0.7):
        line(f"take at {take * 100:g} % of the premium, then flat", mult, take, False)
    for take in (0.15, 0.25, 0.35, 0.5, 0.7):
        line(f"take at {take * 100:g} % of the premium, sell again", mult, take, True)
print()
