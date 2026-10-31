#!/bin/sh
# Runs as the Compose "updater" service, the only service with the Docker
# socket. Nakama writes "upgrade X" or "rollback X" to /updates/request.
# Upgrade moves the nakama service to X and puts the old image and data back
# when X is not healthy or a table lost rows. Rollback returns to X, older or
# newer, with the data archived when X was left. Progress goes to /updates/status.json.
set -u

REPO=ghcr.io/ahmadrosid/nakama
UPDATES=/updates
COMPOSE_DIR=/compose
ENV_FILE="$COMPOSE_DIR/.env"
HEALTH_WAIT=${NAKAMA_UPDATER_HEALTH_WAIT:-240}
PROJECT=$(docker inspect "$(hostname)" --format '{{index .Config.Labels "com.docker.compose.project"}}')

compose() {
  docker compose --project-directory "$COMPOSE_DIR" -p "$PROJECT" "$@"
}

# The optional fourth and fifth arguments are layers done and layers in total.
status() {
  printf '{"state":"%s","version":"%s","message":"%s","at":"%s"%s}\n' \
    "$1" "$2" "$3" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "${5:+,\"progress\":{\"done\":$4,\"total\":$5\}}" > "$UPDATES/status.tmp"
  mv "$UPDATES/status.tmp" "$UPDATES/status.json"
  touch "$UPDATES/heartbeat"
  echo "updater: $1 $2 $3"
}

mount_of() {
  docker inspect "$1" --format "{{range .Mounts}}{{if eq .Destination \"$2\"}}{{.Name}}{{end}}{{end}}"
}

in_nakama() {
  docker exec "$(compose ps -q nakama)" bun -e "$1"
}

running_version() {
  in_nakama 'const r = await fetch("http://127.0.0.1:4310/health"); console.log((await r.json()).version)'
}

# One "table rows" line per table, plus the file count of the data root.
counts() {
  in_nakama '
const { Database } = require("bun:sqlite");
const db = new Database("/nakama/data/sqlite/nakama.sqlite", { readonly: true });
for (const { name } of db.query("select name from sqlite_master where type = ? and name not like ?").all("table", "sqlite_%")) {
  console.log(name, db.query(`select count(*) as n from "${name}"`).get().n);
}
console.log("__files", Number(Bun.spawnSync(["sh", "-c", "find /nakama/data -type f | wc -l"]).stdout.toString()));
' | sort
}

# Healthy means /health answers with the version we asked for. Docker's own
# health status is missing when the image was built without HEALTHCHECK.
wait_healthy() {
  waited=0
  while [ "$waited" -lt "$HEALTH_WAIT" ]; do
    touch "$UPDATES/heartbeat"
    [ "$(running_version 2>/dev/null)" = "$1" ] && return 0
    sleep 5
    waited=$((waited + 5))
  done
  return 1
}

# Without a TTY, docker pull names each layer but prints no byte counts, so
# progress is in layers. The log keeps the pull's exit status, a pipe would not.
pull() {
  docker pull "$REPO:$1" > /tmp/pull.log 2>&1 &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    total=$(grep -c 'Pulling fs layer' /tmp/pull.log)
    finished=$(grep -c 'Pull complete' /tmp/pull.log)
    if [ "$total" -gt 0 ]; then
      status running "$1" "Downloading $1." "$finished" "$total"
    fi
    sleep 2
  done
  wait "$pid"
}

set_version() {
  if grep -q '^NAKAMA_VERSION=' "$ENV_FILE" 2>/dev/null; then
    sed -i "s/^NAKAMA_VERSION=.*/NAKAMA_VERSION=$1/" "$ENV_FILE"
  else
    echo "NAKAMA_VERSION=$1" >> "$ENV_FILE"
  fi
}

restore() {
  compose stop nakama >/dev/null 2>&1
  docker run --rm --entrypoint sh -v "$DATA:/nakama/data" -v "$BACKUPS:/backup:ro" "$REPO:$FROM" \
    -c "find /nakama/data -mindepth 1 -delete && tar xzf /backup/$ARCHIVE -C /nakama/data"
  set_version "$FROM"
  compose up -d --no-deps nakama >/dev/null 2>&1
  if wait_healthy "$FROM"; then
    status rolled_back "$FROM" "$1 Restored $FROM and its data."
  else
    status failed "$FROM" "$1 Restored $FROM, but it did not report healthy."
  fi
}

# Checks the request and archives the current data with nakama stopped. Sets
# NAKAMA, DATA, BACKUPS, FROM and ARCHIVE for the caller.
prepare() {
  TO=$1
  case "$TO" in
    *[!0-9.]* | "" | .* | *. | *..*) status failed "$TO" "Not a release version."; return 1 ;;
  esac
  [ "$(echo "$TO" | tr -cd . | wc -c)" -eq 2 ] || { status failed "$TO" "Not a release version."; return 1; }

  NAKAMA=$(compose ps -q nakama)
  [ -n "$NAKAMA" ] || { status failed "$TO" "The nakama service is not running."; return 1; }
  DATA=$(mount_of "$NAKAMA" /nakama/data)
  BACKUPS=$(mount_of "$NAKAMA" /nakama/backups)
  [ -n "$DATA" ] && [ -n "$BACKUPS" ] || { status failed "$TO" "Nakama needs named data and backup volumes."; return 1; }
  FROM=$(running_version)
  [ "$FROM" != "$TO" ] || { status failed "$TO" "Already on $TO."; return 1; }

  status running "$TO" "Downloading $TO."
  docker image inspect "$REPO:$TO" >/dev/null 2>&1 || pull "$TO" ||
    { status failed "$TO" "Could not download $TO. Nothing was changed."; return 1; }
  # Going back names the old version, so make sure that tag exists even on :latest.
  docker tag "$(docker inspect "$NAKAMA" --format '{{.Image}}')" "$REPO:$FROM"

  status running "$TO" "Backing up the data."
  BEFORE=$(counts) || { status failed "$TO" "Could not read the database. Nothing was changed."; return 1; }
  compose stop nakama >/dev/null 2>&1
  ARCHIVE="pre-upgrade-$FROM-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
  if ! docker run --rm --entrypoint tar -v "$DATA:/nakama/data:ro" -v "$BACKUPS:/backup" "$REPO:$FROM" \
    czf "/backup/$ARCHIVE" -C /nakama/data .; then
    compose start nakama >/dev/null 2>&1
    status failed "$TO" "Backup failed. Nothing was changed."
    return 1
  fi
}

start() {
  status running "$TO" "Starting $TO."
  set_version "$TO"
  compose up -d --no-deps nakama >/dev/null 2>&1
  wait_healthy "$TO"
}

# Each archive is a full copy of the data, so keep only the newest three.
prune() {
  docker run --rm --entrypoint sh -v "$BACKUPS:/backup" "$REPO:$TO" \
    -c 'ls -1t /backup/pre-upgrade-*.tar.gz | tail -n +4 | xargs -r rm -f'
}

# This container outlives the upgrade, so without this it keeps the script of
# the version it started on and a fix here never reaches the Update button.
run_shipped_script() {
  docker run --rm --entrypoint cat "$REPO:$TO" /app/scripts/nakama-updater.sh > /tmp/next.sh &&
    exec sh /tmp/next.sh
}

upgrade() {
  prepare "$1" || return
  start || { restore "$TO did not become healthy."; return; }

  AFTER=$(counts) || { restore "Could not read the database on $TO."; return; }
  LOST=$(printf '%s\n' "$BEFORE" | while read -r name before; do
    after=$(printf '%s\n' "$AFTER" | awk -v n="$name" '$1 == n { print $2 }')
    [ "${after:-0}" -lt "$before" ] && echo "$name"
  done)
  [ -z "$LOST" ] || { restore "$TO lost rows in: $(echo $LOST)."; return; }

  prune
  status done "$TO" "Updated from $FROM to $TO."
  run_shipped_script
}

# The data goes back to the archive taken when $1 was left, so anything written
# since then is only in the archive prepare() just made of the current state.
rollback() {
  SOURCE=$(docker run --rm --entrypoint sh -v "$(mount_of "$(compose ps -q nakama)" /nakama/backups):/backup:ro" \
    "$REPO:$(running_version)" -c "ls -1t /backup/pre-upgrade-$1-*.tar.gz 2>/dev/null | head -1")
  [ -n "$SOURCE" ] || { status failed "$1" "No archive of $1 to return to."; return; }
  prepare "$1" || return

  docker run --rm --entrypoint sh -v "$DATA:/nakama/data" -v "$BACKUPS:/backup:ro" "$REPO:$TO" \
    -c "find /nakama/data -mindepth 1 -delete && tar xzf $SOURCE -C /nakama/data"
  start || { restore "$TO did not become healthy."; return; }

  prune
  status done "$TO" "Restored $TO with its data from when it was left. $FROM is archived."
  run_shipped_script
}

mkdir -p "$UPDATES"
echo "updater: watching $UPDATES for project $PROJECT"
while true; do
  touch "$UPDATES/heartbeat"
  if [ -f "$UPDATES/request" ]; then
    read -r action version < "$UPDATES/request"
    # Before the request goes, so the page never sees neither of them.
    status running "$version" "Starting."
    rm -f "$UPDATES/request"
    case "$action" in
      rollback) rollback "$version" ;;
      *) upgrade "$version" ;;
    esac
  fi
  sleep 2
done
