// The Autopilot PAPER trades of the live database, written in the shape fetch_paper.py, track_paper.py and
// review_paper.py read (the shape of the build thread's earlier export from the local database).
//
// Read-only: the login `research` of docs/OPERATIONS.md section 6b, inside a read-only transaction. The address is
// taken from the environment variable HAPIECOIN_RESEARCH_DATABASE_URL and is never printed or written anywhere.
// No user id, name or e-mail is written to the file; `owners` counts the users whose trades are in it.
//
// Usage: node export_paper.mjs <folder with the `postgres` package, e.g. E:/Subash/Projects/HapieCoin/apps/api> <out.json>
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import path from "node:path";

const [pkgDir, out] = process.argv.slice(2);
const url = process.env.HAPIECOIN_RESEARCH_DATABASE_URL;
if (!pkgDir || !out || !url) {
  console.log("usage: node export_paper.mjs <folder with postgres> <out.json>; HAPIECOIN_RESEARCH_DATABASE_URL must be set");
  process.exit(2);
}
const postgres = createRequire(path.join(pkgDir, "package.json"))("postgres");
const TS = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`;
const ts = (c) => `to_char(${c} at time zone 'utc', ${TS})`;

const QUERY = `
select s.asset as coin, s.name, s.venue, s.status, s.autopilot_playbook_id as playbook,
       ${ts("s.closed_at")} as closed_at, s.autopilot_structure as structure, ${ts("s.started_at")} as started_at,
       s.close_reason, s.realized_pnl as realized_pnl_usd,
       coalesce((select json_agg(json_build_object(
           'kind', l.kind, 'lots', l.lots, 'side', l.side, 'expiry', l.expiry, 'status', l.status, 'strike', l.strike,
           'symbol', l.symbol, 'closed_at', ${ts("l.closed_at")}, 'opened_at', ${ts("l.opened_at")},
           'exit_price', l.exit_price, 'entry_price', l.entry_price, 'close_reason', l.close_reason)
           order by l.position, l.created_at) from strategy_legs l where l.strategy_id = s.id), '[]'::json) as legs,
       coalesce((select json_agg(json_build_object(
           'kind', r.kind, 'note', r.note, 'basis', r.basis, 'scope', r.scope, 'state', r.state, 'value', r.value,
           'outcome', r.outcome, 'trigger', r.trigger, 'fired_at', ${ts("r.fired_at")}, 'peak_pnl', r.peak_pnl,
           'basis_usd', r.basis_usd, 'fired_pnl', r.fired_pnl,
           'leg_symbol', (select l2.symbol from strategy_legs l2 where l2.id = r.leg_id),
           'close_share', r.close_share, 'trail_value', r.trail_value, 'threshold_usd', r.threshold_usd,
           'trail_trigger', r.trail_trigger)
           order by r.created_at) from strategy_rules r where r.strategy_id = s.id), '[]'::json) as rules
from strategies s
where s.autopilot_playbook_id is not null and s.trading_mode = 'paper'
order by s.started_at, s.id`;

let sql;
try {
  sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 20, onnotice: () => {} });
  const [trades, meta] = await sql.begin("read only", async (tx) => [
    await tx.unsafe(QUERY),
    await tx.unsafe(`select ${ts("now()")} as now, count(distinct user_id)::int as owners,
                            count(*) filter (where trading_mode <> 'paper')::int as not_paper
                     from strategies where autopilot_playbook_id is not null`),
  ]);
  const doc = {
    note: "Autopilot PAPER trades only, read from the live database with the read-only research login (docs/OPERATIONS.md 6b). No user data.",
    owners: meta[0].owners,
    trades,
    exported_at_utc: meta[0].now,
  };
  writeFileSync(out, JSON.stringify(doc, null, 1), "utf8");
  const by = {};
  for (const t of trades) by[`${t.status} ${t.coin}`] = (by[`${t.status} ${t.coin}`] ?? 0) + 1;
  console.log(`exported_at_utc ${doc.exported_at_utc}; ${trades.length} paper trades of ${doc.owners} user(s); Autopilot trades not on paper (left out): ${meta[0].not_paper}`);
  console.log(Object.entries(by).sort().map(([k, v]) => `${k} ${v}`).join("; "));
} catch (e) {
  // only the error code: a message can carry the host, the port or the login
  console.log("ERROR", e?.code ?? e?.name ?? "unknown");
  process.exitCode = 1;
} finally {
  if (sql) await sql.end({ timeout: 5 });
}
