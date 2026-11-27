#!/bin/sh
# Create or refresh the read-only database login for research (docs/OPERATIONS.md). Run on the server:
#   sh /opt/hapiecoin/deploy/research-role.sh
# It asks for the login's password (typed twice, not shown; letters and digits, 24 or more), then:
#   - creates the login `research`, or changes its password when it exists
#   - limits it: read-only transactions, a query cut off after 30 seconds, at most 3 connections
#   - lets it read every table of the live database EXCEPT the ones in HIDDEN below (sign-in material, the
#     encrypted exchange keys, payments), and nothing in the test database
# Run it again after a release that adds a table: a new table is not readable until this has run, on purpose,
# so that a new table holding something private is never shown by default.
# The database's firewall must also allow the address research connects from; that is set in the provider's
# console, not here.
set -eu

HIDDEN="sessions accounts verifications two_factors passkeys broker_credentials payments"

HERE="$(cd "$(dirname "$0")" && pwd)"
# ENV_FILE: the settings file, deploy/.env unless a trial names another
ENV_FILE="${ENV_FILE:-$HERE/.env}"
[ -f "$ENV_FILE" ] || { echo "research-role: no settings file at $ENV_FILE" >&2; exit 1; }
# One name is read from the settings file; it is not sourced.
DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' "$ENV_FILE" | tail -n 1)"
[ -n "$DATABASE_URL" ] || { echo "research-role: DATABASE_URL is not set in $ENV_FILE" >&2; exit 1; }
export DATABASE_URL

if [ -z "${RESEARCH_PASSWORD:-}" ]; then
  printf 'Password for the research login (letters and digits, 24 or more): ' >&2
  stty -echo; read -r RESEARCH_PASSWORD; stty echo; printf '\n' >&2
  printf 'Again: ' >&2
  stty -echo; read -r AGAIN; stty echo; printf '\n' >&2
  [ "$RESEARCH_PASSWORD" = "$AGAIN" ] || { echo "research-role: the two do not match. Nothing was changed." >&2; exit 1; }
fi
case "$RESEARCH_PASSWORD" in
  *[!A-Za-z0-9]*) echo "research-role: letters and digits only (it goes inside an address). Nothing was changed." >&2; exit 1 ;;
esac
[ "${#RESEARCH_PASSWORD}" -ge 24 ] || { echo "research-role: 24 characters or more. Nothing was changed." >&2; exit 1; }
export RESEARCH_PASSWORD

# The SQL is fed on standard input so that psql fills in the password itself (:'pw'); neither the password nor
# the database address appears on a command line. PG_DOCKER_ARGS is for trials.
# shellcheck disable=SC2086
docker run --rm -i ${PG_DOCKER_ARGS:-} -e DATABASE_URL -e RESEARCH_PASSWORD -e HIDDEN="$HIDDEN" postgres:17-alpine \
  sh -c 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -v pw="$RESEARCH_PASSWORD" -v hidden="$HIDDEN" -f -' <<'SQL'
select not exists (select 1 from pg_roles where rolname = 'research') as is_new \gset
\if :is_new
  create role research login password :'pw';
\else
  alter role research login password :'pw';
\endif
alter role research connection limit 3;
alter role research set default_transaction_read_only = on;
alter role research set statement_timeout = '30s';
alter role research set idle_in_transaction_session_timeout = '60s';

-- Start from nothing, then grant table by table.
revoke all on all tables in schema public from research;
revoke all on all sequences in schema public from research;
select current_database() as db \gset
grant connect on database :"db" to research;
grant usage on schema public to research;

select set_config('research.hidden', :'hidden', false) \gset
do $$
declare r record;
begin
  for r in
    select tablename from pg_tables
    where schemaname = 'public'
      and tablename::text <> all (string_to_array(current_setting('research.hidden'), ' '))
  loop
    execute format('grant select on public.%I to research', r.tablename);
  end loop;
end $$;

-- The test database is a full copy: research has no business there.
select exists (select 1 from pg_database where datname = 'hapiecoin_test') as has_test \gset
\if :has_test
  revoke connect on database hapiecoin_test from public;
\endif

\echo
\echo research can read:
select string_agg(table_name, ' ' order by table_name)
from information_schema.role_table_grants
where grantee = 'research' and table_schema = 'public' and privilege_type = 'SELECT' \g (format=unaligned tuples_only=on)
\echo
\echo research cannot read:
select string_agg(tablename, ' ' order by tablename)
from pg_tables t
where schemaname = 'public'
  and not exists (select 1 from information_schema.role_table_grants g
                  where g.grantee = 'research' and g.table_schema = 'public' and g.table_name = t.tablename) \g (format=unaligned tuples_only=on)
SQL

echo
echo "research-role ok. Its address is the live one with the login and password changed:"
echo "  postgres://research:<password>@<same host>:5432/hapiecoin?sslmode=require"
