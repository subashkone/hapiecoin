#!/bin/sh
# A dump of the database, as one file. The database is a managed PostgreSQL outside this server (ADR-152), which
# keeps its own backups and restores to a point in time; this dump is the second copy, taken by hand before
# every update and nightly from cron on the server (docs/deploy.md):
#   15 21 * * * sh /opt/hapiecoin/deploy/backup.sh >> /var/log/hapiecoin-backup.log 2>&1
# Writes a compressed dump to BACKUP_DIR and keeps the newest KEEP files. When BACKUP_COPY_TO is set (in the
# environment or in deploy/.env) each good dump is also copied there with rsync. Any failure exits non-zero,
# so cron's mail or a wrapper can raise the alarm.
set -eu
# a dump holds every user, session and the encrypted exchange keys: readable by this user only
umask 077

BACKUP_DIR="${BACKUP_DIR:-/var/backups/hapiecoin}"
KEEP="${KEEP:-14}"
[ "$KEEP" -ge 1 ] || { echo "backup: KEEP must be 1 or more" >&2; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
# ENV_FILE: the settings file, deploy/.env unless a trial names another
ENV_FILE="${ENV_FILE:-$HERE/.env}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/hapiecoin-$STAMP.dump"

# Two names are read from the settings file; it is not sourced, so nothing else in it reaches this shell.
[ -f "$ENV_FILE" ] || { echo "backup: no settings file at $ENV_FILE" >&2; exit 1; }
DATABASE_URL="$(sed -n 's/^DATABASE_URL=//p' "$ENV_FILE" | tail -n 1)"
[ -n "$DATABASE_URL" ] || { echo "backup: DATABASE_URL is not set in $ENV_FILE" >&2; exit 1; }
export DATABASE_URL
if [ -z "${BACKUP_COPY_TO:-}" ]; then
  BACKUP_COPY_TO="$(sed -n 's/^BACKUP_COPY_TO=//p' "$ENV_FILE" | tail -n 1)"
fi

# The PostgreSQL tools run in a throwaway container of the server's own version. The address (it holds the
# password) is handed over in the environment, never on a command line. PG_DOCKER_ARGS is for trials.
# shellcheck disable=SC2086
pg() { docker run --rm -i ${PG_DOCKER_ARGS:-} -e DATABASE_URL postgres:17-alpine "$@"; }

mkdir -p "$BACKUP_DIR"
# a dump that stops half way leaves no partial file behind
trap 'rm -f "$OUT.part"' EXIT
# custom format: compressed, restorable with pg_restore (deploy/restore.sh)
pg sh -c 'pg_dump "$DATABASE_URL" -Fc' > "$OUT.part"
# an empty or tiny file means the dump failed: keep the older backups and say so
if [ "$(wc -c < "$OUT.part")" -lt 10000 ]; then
  echo "$STAMP backup FAILED: dump is $(wc -c < "$OUT.part") bytes" >&2
  rm -f "$OUT.part"
  exit 1
fi
mv "$OUT.part" "$OUT"
ls -1t "$BACKUP_DIR"/hapiecoin-*.dump | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f "$old"; done
echo "$STAMP backup ok: $OUT ($(wc -c < "$OUT") bytes)"

if [ -n "${BACKUP_COPY_TO:-}" ]; then
  if rsync -a "$OUT" "$BACKUP_COPY_TO/"; then
    echo "$STAMP copy ok: $BACKUP_COPY_TO"
  else
    echo "$STAMP copy FAILED: $BACKUP_COPY_TO (the dump on this server is good)" >&2
    exit 1
  fi
else
  echo "$STAMP no copy off this server: BACKUP_COPY_TO is not set"
fi
