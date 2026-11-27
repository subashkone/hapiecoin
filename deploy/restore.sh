#!/bin/sh
# Load a database dump into the database named by DATABASE_URL in deploy/.env (docs/deploy.md): the one-time
# copy of the owner's local database at go-live, or a dump from backup.sh. Run on the server:
#   sh /opt/hapiecoin/deploy/restore.sh /path/to/hapiecoin-<stamp>.dump
# It refuses to run while the API is up, and refuses a database that already has tables unless FORCE=1 is set.
# FORCE=1 replaces everything in the database with the dump: the file is checked first, a dump of what is
# there is taken (backup.sh), and only then are the old tables dropped.
# The restore is one transaction: either the whole dump arrives or nothing does.
# The database is a managed PostgreSQL without the TimescaleDB extension (ADR-152), so a dump taken from the
# development database must leave that extension out (docs/deploy.md §6.3):
#   docker exec hapiecoin-postgres pg_dump -U hapiecoin -d hapiecoin -Fc --exclude-extension=timescaledb -f /tmp/hapiecoin-local.dump
#   docker cp hapiecoin-postgres:/tmp/hapiecoin-local.dump .
set -eu

DUMP="${1:?usage: restore.sh <dump file>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
# ENV_FILE: the settings file, deploy/.env unless a trial names another
ENV_FILE="${ENV_FILE:-$HERE/.env}"

[ -f "$ENV_FILE" ] || { echo "restore: no settings file at $ENV_FILE" >&2; exit 1; }
# One name is read from the settings file; it is not sourced, so nothing else in it reaches this shell.
DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' "$ENV_FILE" | tail -n 1)"
[ -n "$DATABASE_URL" ] || { echo "restore: DATABASE_URL is not set in $ENV_FILE" >&2; exit 1; }
# TARGET=test loads the dump into the test database beside the live one (hapiecoin_test, same server, same
# login) and never touches the live database: test-release.sh uses it. The app may stay up, because nothing
# that runs uses the test database, and nothing is dumped first, because a test copy is not worth keeping.
TARGET="${TARGET:-live}"
if [ "$TARGET" = "test" ]; then
  LIVE_URL="$DATABASE_URL"
  DATABASE_URL="$(printf '%s' "$LIVE_URL" | sed 's|/hapiecoin\(?[^/]*\)\{0,1\}$|/hapiecoin_test\1|')"
  case "$DATABASE_URL" in
    "$LIVE_URL") echo "restore: DATABASE_URL does not end in /hapiecoin, so the test database's address cannot be worked out. Nothing was changed." >&2; exit 1 ;;
    */hapiecoin_test|*/hapiecoin_test\?*) ;;
    *) echo "restore: the test database's address did not come out right. Nothing was changed." >&2; exit 1 ;;
  esac
elif [ "$TARGET" != "live" ]; then
  echo "restore: TARGET is live or test" >&2; exit 1
fi
export DATABASE_URL

compose() { docker compose -f "$HERE/compose.prod.yml" --env-file "$ENV_FILE" "$@"; }
# The PostgreSQL tools run in a throwaway container of the server's own version. The address (it holds the
# password) is handed over in the environment, never on a command line. PG_DOCKER_ARGS is for trials.
# shellcheck disable=SC2086
pg() { docker run --rm -i ${PG_DOCKER_ARGS:-} -e DATABASE_URL postgres:17-alpine "$@"; }
psql_q() { pg sh -c 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qAt -c "$1"' sh "$1"; }

[ -f "$DUMP" ] || { echo "restore: no such file: $DUMP" >&2; exit 1; }
if [ "$(wc -c < "$DUMP")" -lt 10000 ]; then
  echo "restore: $DUMP is $(wc -c < "$DUMP") bytes, too small to be a dump" >&2
  exit 1
fi

# The API migrates and writes as soon as it starts: it must be down for the whole restore. A restarting
# container counts as up. A compose error here stops the script (no output is thrown away).
for state in running restarting; do
  [ "$TARGET" = "test" ] && break
  if [ -n "$(compose ps -q --status "$state" api)" ]; then
    echo "restore: the api is $state. Stop the app first: docker compose ... stop caddy web api gateway ingest" >&2
    exit 1
  fi
done

if ! psql_q "select 1" >/dev/null; then
  echo "restore: the database does not answer. Check DATABASE_URL and that this server's address is allowed in the database's firewall." >&2
  exit 1
fi

# The file must be a readable dump before anything is dropped.
if ! pg pg_restore -l < "$DUMP" >/dev/null; then
  echo "restore: $DUMP is not a readable dump (cut short in the copy?). Nothing was changed." >&2
  exit 1
fi
if pg pg_restore -l < "$DUMP" | grep -q "EXTENSION - timescaledb"; then
  echo "restore: $DUMP carries the TimescaleDB extension, which this database does not have. Take the dump again with --exclude-extension=timescaledb. Nothing was changed." >&2
  exit 1
fi

TABLES="$(psql_q "select count(*) from information_schema.tables where table_schema in ('public','drizzle') and table_type = 'BASE TABLE'")"
if [ "$TABLES" != "0" ]; then
  if [ "${FORCE:-0}" != "1" ]; then
    echo "restore: the database already has $TABLES tables. To replace everything in it, run again with FORCE=1." >&2
    exit 1
  fi
  if [ "$TARGET" = "live" ]; then
    echo "restore: FORCE=1. Taking a dump of what is there before dropping it"
    ENV_FILE="$ENV_FILE" sh "$HERE/backup.sh"
  fi
  echo "restore: dropping the $TABLES existing tables"
  # Object by object, not `drop schema public`: on a managed server the public schema is not ours to drop.
  psql_q "set client_min_messages = warning; do \$\$ declare r record; begin
    for r in select tablename from pg_tables where schemaname = 'public' loop
      execute format('drop table if exists public.%I cascade', r.tablename); end loop;
    for r in select sequencename from pg_sequences where schemaname = 'public' loop
      execute format('drop sequence if exists public.%I cascade', r.sequencename); end loop;
    for r in select t.typname from pg_type t join pg_namespace n on n.oid = t.typnamespace
             where n.nspname = 'public' and t.typtype = 'e' loop
      execute format('drop type if exists public.%I cascade', r.typname); end loop;
  end \$\$; drop schema if exists drizzle cascade;"
fi

echo "restore: loading $DUMP"
# --no-owner: the dump's objects become this role's, whatever role made them.
if ! pg sh -c 'pg_restore -d "$DATABASE_URL" --no-owner --no-privileges --exit-on-error --single-transaction' < "$DUMP"; then
  echo "restore FAILED: pg_restore stopped on an error (above). The transaction was rolled back: nothing arrived." >&2
  exit 1
fi

AFTER="$(psql_q "select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")"
MIGRATIONS="$(psql_q "select count(*) from drizzle.__drizzle_migrations")"
if [ "$AFTER" = "0" ]; then
  echo "restore FAILED: no tables arrived" >&2
  exit 1
fi
echo "restore ok: $AFTER tables, $MIGRATIONS migrations recorded. Start the app: docker compose ... up -d"
