#!/bin/sh
# Restore a database dump into the server's database (docs/deploy.md): the one-time copy of the owner's local
# database at go-live, or a backup after a failure. Run on the server:
#   sh /opt/hapiecoin/deploy/restore.sh /path/to/hapiecoin-<stamp>.dump
# It refuses to run while the API is up, and refuses a database that already has tables unless FORCE=1 is set.
# FORCE=1 replaces everything in the server's database with the dump: the file is checked first, a backup of
# what is there is taken (backup.sh), and only then is the old content dropped.
# The restore is one transaction: either the whole dump arrives or nothing does.
# The dump is the custom format written by backup.sh. On the machine the data comes from (docs/deploy.md §6.3):
#   docker exec hapiecoin-postgres pg_dump -U hapiecoin -d hapiecoin -Fc -f /tmp/hapiecoin-local.dump
#   docker cp hapiecoin-postgres:/tmp/hapiecoin-local.dump .
set -eu

DUMP="${1:?usage: restore.sh <dump file>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
# ENV_FILE: the settings file, deploy/.env unless a trial names another
ENV_FILE="${ENV_FILE:-$HERE/.env}"

compose() { docker compose -f "$HERE/compose.prod.yml" --env-file "$ENV_FILE" "$@"; }
psql_q() { compose exec -T postgres psql -h 127.0.0.1 -U hapiecoin -d hapiecoin -v ON_ERROR_STOP=1 -qAt "$@"; }

[ -f "$DUMP" ] || { echo "restore: no such file: $DUMP" >&2; exit 1; }
if [ "$(wc -c < "$DUMP")" -lt 10000 ]; then
  echo "restore: $DUMP is $(wc -c < "$DUMP") bytes, too small to be a dump" >&2
  exit 1
fi

# The API migrates and writes as soon as it starts: it must be down for the whole restore. A restarting
# container counts as up. A compose error here stops the script (no output is thrown away).
for state in running restarting; do
  if [ -n "$(compose ps -q --status "$state" api)" ]; then
    echo "restore: the api is $state. Stop the app first: docker compose ... stop caddy web api gateway ingest" >&2
    exit 1
  fi
done

# Over TCP, not the socket: on a new volume the image first runs a socket-only server that is then restarted.
if ! compose exec -T postgres pg_isready -h 127.0.0.1 -U hapiecoin -d hapiecoin >/dev/null; then
  echo "restore: the database is not ready. Start it and wait: docker compose ... up -d --wait postgres" >&2
  exit 1
fi

# The file must be a readable dump before anything is dropped.
if ! compose exec -T postgres pg_restore -l < "$DUMP" >/dev/null; then
  echo "restore: $DUMP is not a readable dump (cut short in the copy?). Nothing was changed." >&2
  exit 1
fi

TABLES="$(psql_q -c "select count(*) from information_schema.tables where table_schema in ('public','drizzle')")"
if [ "$TABLES" != "0" ]; then
  if [ "${FORCE:-0}" != "1" ]; then
    echo "restore: the database already has $TABLES tables. To replace everything in it, run again with FORCE=1." >&2
    exit 1
  fi
  echo "restore: FORCE=1. Backing up what is there before dropping it"
  ENV_FILE="$ENV_FILE" sh "$HERE/backup.sh"
  echo "restore: dropping the $TABLES existing tables"
  psql_q -c "drop schema if exists drizzle cascade; drop schema public cascade; create schema public;"
fi

echo "restore: loading $DUMP"
# --no-owner: the dump's objects become the server role's, whatever role made them.
if ! compose exec -T postgres pg_restore -h 127.0.0.1 -U hapiecoin -d hapiecoin \
    --no-owner --no-privileges --exit-on-error --single-transaction < "$DUMP"; then
  echo "restore FAILED: pg_restore stopped on an error (above). The transaction was rolled back: nothing arrived." >&2
  exit 1
fi

AFTER="$(psql_q -c "select count(*) from information_schema.tables where table_schema = 'public'")"
MIGRATIONS="$(psql_q -c "select count(*) from drizzle.__drizzle_migrations")"
if [ "$AFTER" = "0" ]; then
  echo "restore FAILED: no tables arrived" >&2
  exit 1
fi
echo "restore ok: $AFTER tables, $MIGRATIONS migrations recorded. Start the app: docker compose ... up -d"
