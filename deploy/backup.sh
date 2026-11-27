#!/bin/sh
# Database backup for the single-server deployment. Run nightly from cron on the server, and by hand before
# every update (docs/deploy.md):
#   15 21 * * * sh /opt/hapiecoin/deploy/backup.sh >> /var/log/hapiecoin-backup.log 2>&1
# Writes a compressed dump to BACKUP_DIR and keeps the newest KEEP files. When BACKUP_COPY_TO is set (in the
# environment or in deploy/.env) each good dump is also copied there with rsync: a backup on the same disk does
# not survive losing the server. Any failure exits non-zero, so cron's mail or a wrapper can raise the alarm.
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

# Only this one name is read from deploy/.env; the file is not sourced, so nothing else in it reaches this shell.
if [ -z "${BACKUP_COPY_TO:-}" ] && [ -f "$ENV_FILE" ]; then
  BACKUP_COPY_TO="$(sed -n 's/^BACKUP_COPY_TO=//p' "$ENV_FILE" | tail -n 1)"
fi

mkdir -p "$BACKUP_DIR"
# a dump that stops half way leaves no partial file behind
trap 'rm -f "$OUT.part"' EXIT
# custom format: compressed, restorable with pg_restore (deploy/restore.sh)
docker compose -f "$HERE/compose.prod.yml" --env-file "$ENV_FILE" exec -T postgres \
  pg_dump -h 127.0.0.1 -U hapiecoin -d hapiecoin -Fc > "$OUT.part"
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
  echo "$STAMP no off-server copy: BACKUP_COPY_TO is not set"
fi
