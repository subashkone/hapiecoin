-- One side after a move (ADR-122): the paper record, trade by trade, beside the evening strangle with a stop at triple
-- of the same trader, coin and day. Read-only. Paper trades only.
--   ETH: the comparison is like for like (eth-evening-strangle-stop-3x sells both sides 1 % away, as the study did).
--   BTC: it is NOT like for like. evening-strangle-stop-3x sells three strikes out (about 0.7 %), not 1 % away, and no
--        BTC playbook sells both sides 1 % away with the stop alone: read the BTC columns as "the day", not as the
--        effect of the side rule.
-- The side comes from the entry's log line; when that line has been pruned (90 days) it is read from the legs.
--   docker exec -i hapiecoin-postgres psql -U hapiecoin -d hapiecoin < docs/research/scripts/autopilot-study/one-side-monitor.sql
with one_side as (
  select s.id, s.user_id, s.asset, s.started_at, s.status, s.close_reason, s.realized_pnl,
         r.detail->'move'->>'pct' as move_pct,
         coalesce(r.detail->'move'->>'side',
                  (select case when count(*) > 1 then 'both' else min(l.kind) end from strategy_legs l where l.strategy_id = s.id and not l.is_adjustment)) as side,
         (select string_agg(x.leg, ' + ' order by x.leg) from (select distinct l.kind || ' ' || l.strike as leg from strategy_legs l where l.strategy_id = s.id and not l.is_adjustment) x) as sold
  from strategies s
  left join autopilot_runs r on r.strategy_id = s.id and r.kind = 'entered'
  where s.trading_mode = 'paper' and s.autopilot_playbook_id in ('evening-strangle-one-side', 'eth-evening-strangle-one-side')
), plain as (
  select s.user_id, s.asset, (s.started_at at time zone 'utc')::date as day, s.status, s.close_reason, s.realized_pnl
  from strategies s
  where s.trading_mode = 'paper' and s.autopilot_playbook_id in ('evening-strangle-stop-3x', 'eth-evening-strangle-stop-3x')
)
select to_char(o.started_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI') as entered_ist, o.asset as coin, o.move_pct as "move 24h %", o.side, o.sold,
       case when o.status = 'paper' then 'open' else coalesce(o.close_reason, 'closed') end as ended,
       o.realized_pnl as "booked usd",
       case when p.status is null then 'not traded' when p.status = 'paper' then 'open' else coalesce(p.close_reason, 'closed') end as "both sides: ended",
       p.realized_pnl as "both sides: booked usd"
from one_side o
left join plain p on p.user_id = o.user_id and p.asset = o.asset and p.day = (o.started_at at time zone 'utc')::date
order by o.started_at, o.asset;

-- the tally so far, closed trades only, by coin and by the side sold
select o.asset as coin, o.side, count(*) as closed, round(avg(o.realized_pnl::numeric), 2) as "mean usd",
       round(100.0 * count(*) filter (where o.realized_pnl::numeric > 0) / nullif(count(*), 0)) as "positive %", min(o.realized_pnl::numeric) as worst
from (select s.asset, s.realized_pnl,
             coalesce(r.detail->'move'->>'side',
                      (select case when count(*) > 1 then 'both' else min(l.kind) end from strategy_legs l where l.strategy_id = s.id and not l.is_adjustment)) as side
      from strategies s
      left join autopilot_runs r on r.strategy_id = s.id and r.kind = 'entered'
      where s.trading_mode = 'paper' and s.status = 'archived' and s.autopilot_playbook_id in ('evening-strangle-one-side', 'eth-evening-strangle-one-side')) o
group by rollup (o.asset, o.side) order by 1, 2;
