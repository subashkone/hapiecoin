#!/bin/sh
# Try a release's database changes on a copy of the live data before the release touches the live system
# (docs/OPERATIONS.md, docs/deploy.md §6.4). Run on the server, with the app up as usual:
#   sh /opt/hapiecoin/deploy/test-release.sh <full commit id of main>
# What it does:
#   1. a fresh dump of the live database (backup.sh)
#   2. loads it into the test database hapiecoin_test, replacing what was there (restore.sh, TARGET=test)
#   3. starts that commit's api against the test database alone: trading off, background jobs off, no Redis,
#      no Telegram, no port published. The api applies its migrations as it starts.
#   4. says whether it came up healthy, and how many migrations it applied; then removes it
# The live database is only read (step 1). The running app is not touched.
# A pass means: the new version's migrations apply to a copy of the real data and the api starts on the result.
# It does not open the screens.
set -eu

COMMIT="${1:?usage: test-release.sh <full commit id>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
# ENV_FILE: the settings file, deploy/.env unless a trial names another
ENV_FILE="${ENV_FILE:-$HERE/.env}"
NAME="hapiecoin-test-api"

[ -f "$ENV_FILE" ] || { echo "test-release: no settings file at $ENV_FILE" >&2; exit 1; }
# One name is read from the settings file; it is not sourced.
LIVE_URL="$(sed -n 's/^DATABASE_URL=//p' "$ENV_FILE" | tail -n 1)"
[ -n "$LIVE_URL" ] || { echo "test-release: DATABASE_URL is not set in $ENV_FILE" >&2; exit 1; }
TEST_URL="$(printf '%s' "$LIVE_URL" | sed 's|/hapiecoin\(?[^/]*\)\{0,1\}$|/hapiecoin_test\1|')"
case "$TEST_URL" in
  "$LIVE_URL") echo "test-release: DATABASE_URL does not end in /hapiecoin, so the test database's address cannot be worked out." >&2; exit 1 ;;
  */hapiecoin_test|*/hapiecoin_test\?*) ;;
  *) echo "test-release: the test database's address did not come out right." >&2; exit 1 ;;
esac

compose() { docker compose -f "$HERE/compose.prod.yml" --env-file "$ENV_FILE" "$@"; }
# shellcheck disable=SC2086
pg_test() { DATABASE_URL="$TEST_URL" docker run --rm -i ${PG_DOCKER_ARGS:-} -e DATABASE_URL postgres:17-alpine "$@"; }
migrations() { pg_test sh -c 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qAt -c "select count(*) from drizzle.__drizzle_migrations"'; }

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "test-release: 1/4 a fresh dump of the live database"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/hapiecoin}"
export BACKUP_DIR
ENV_FILE="$ENV_FILE" sh "$HERE/backup.sh"
DUMP="$(ls -1t "$BACKUP_DIR"/hapiecoin-*.dump | head -n 1)"

echo "test-release: 2/4 loading it into the test database"
ENV_FILE="$ENV_FILE" TARGET=test FORCE=1 sh "$HERE/restore.sh" "$DUMP"
BEFORE="$(migrations)"

echo "test-release: 3/4 starting the api of $COMMIT on the test database"
# Values in this shell win over the settings file when compose fills in compose.prod.yml, so the api gets the
# test database and the new image; everything else comes from the settings file as on a real start.
if [ "${SKIP_PULL:-0}" != "1" ]; then
  if ! RELEASE="$COMMIT" compose pull -q api; then
    echo "test-release FAILED: there is no api image for $COMMIT. Is it the full commit id of main, and has its image job finished?" >&2
    exit 1
  fi
fi
if ! DATABASE_URL="$TEST_URL" RELEASE="$COMMIT" TRADING_DISABLED=true TELEGRAM_BOT_TOKEN="" ERROR_SINK_DSN="" \
  compose run -d --no-deps --name "$NAME" -e API_JOBS_ROLE=off -e REDIS_URL= api >/dev/null; then
  echo "test-release FAILED: the api of $COMMIT could not be started (above). The live database and the running app were not touched." >&2
  exit 1
fi

STATE="starting"
i=0
while [ "$i" -lt 60 ]; do
  i=$((i + 1))
  if [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null || echo false)" != "true" ]; then
    STATE="stopped"; break
  fi
  STATE="$(docker inspect -f '{{.State.Health.Status}}' "$NAME" 2>/dev/null || echo unknown)"
  [ "$STATE" = "healthy" ] && break
  sleep 5
done

echo "test-release: 4/4 result"
if [ "$STATE" != "healthy" ]; then
  echo "test-release FAILED: the api of $COMMIT did not come up on the test database (state: $STATE). Its last lines:" >&2
  docker logs "$NAME" 2>&1 | tail -n 40 >&2 || true
  echo "The live database and the running app were not touched. Do not release $COMMIT." >&2
  exit 1
fi
AFTER="$(migrations)"
echo "test-release PASSED: the api of $COMMIT is healthy on a copy of the live data; migrations recorded $BEFORE before, $AFTER after ($((AFTER - BEFORE)) applied by this release)."
echo "The live database and the running app were not touched. To release: docs/deploy.md §6.4."
