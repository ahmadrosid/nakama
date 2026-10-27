#!/bin/sh
# Runs as the Compose "updater" service, the only service with the Docker
# socket. Nakama writes a version to /updates/request; this script upgrades the
# nakama service to it and puts the old image and data back when the new one is
# not healthy or a table lost rows. Progress goes to /updates/status.json.
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

status() {
  printf '{"state":"%s","version":"%s","message":"%s","at":"%s"}\n' \
    "$1" "$2" "$3" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$UPDATES/status.tmp"
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

upgrade() {
  TO=$1
  case "$TO" in
    *[!0-9.]* | "" | .* | *. | *..*) status failed "$TO" "Not a release version."; return ;;
  esac
  [ "$(echo "$TO" | tr -cd . | wc -c)" -eq 2 ] || { status failed "$TO" "Not a release version."; return; }

  NAKAMA=$(compose ps -q nakama)
  [ -n "$NAKAMA" ] || { status failed "$TO" "The nakama service is not running."; return; }
  DATA=$(mount_of "$NAKAMA" /nakama/data)
  BACKUPS=$(mount_of "$NAKAMA" /nakama/backups)
  [ -n "$DATA" ] && [ -n "$BACKUPS" ] || { status failed "$TO" "Nakama needs named data and backup volumes."; return; }
  FROM=$(running_version)

  status running "$TO" "Downloading $TO."
  docker image inspect "$REPO:$TO" >/dev/null 2>&1 || docker pull -q "$REPO:$TO" >/dev/null ||
    { status failed "$TO" "Could not download $TO. Nothing was changed."; return; }
  # Rollback names the old version, so make sure that tag exists even on :latest.
  docker tag "$(docker inspect "$NAKAMA" --format '{{.Image}}')" "$REPO:$FROM"

  status running "$TO" "Backing up the data."
  BEFORE=$(counts) || { status failed "$TO" "Could not read the database. Nothing was changed."; return; }
  compose stop nakama >/dev/null 2>&1
  ARCHIVE="pre-upgrade-$FROM-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
  if ! docker run --rm --entrypoint tar -v "$DATA:/nakama/data:ro" -v "$BACKUPS:/backup" "$REPO:$FROM" \
    czf "/backup/$ARCHIVE" -C /nakama/data .; then
    compose start nakama >/dev/null 2>&1
    status failed "$TO" "Backup failed. Nothing was changed."
    return
  fi

  status running "$TO" "Starting $TO."
  set_version "$TO"
  compose up -d --no-deps nakama >/dev/null 2>&1
  wait_healthy "$TO" || { restore "$TO did not become healthy."; return; }

  AFTER=$(counts) || { restore "Could not read the database on $TO."; return; }
  LOST=$(printf '%s\n' "$BEFORE" | while read -r name before; do
    after=$(printf '%s\n' "$AFTER" | awk -v n="$name" '$1 == n { print $2 }')
    [ "${after:-0}" -lt "$before" ] && echo "$name"
  done)
  [ -z "$LOST" ] || { restore "$TO lost rows in: $(echo $LOST)."; return; }

  # Each archive is a full copy of the data, so keep only the newest three.
  docker run --rm --entrypoint sh -v "$BACKUPS:/backup" "$REPO:$TO" \
    -c 'ls -1t /backup/pre-upgrade-*.tar.gz | tail -n +4 | xargs -r rm -f'
  status done "$TO" "Updated from $FROM to $TO."
}

mkdir -p "$UPDATES"
echo "updater: watching $UPDATES for project $PROJECT"
while true; do
  touch "$UPDATES/heartbeat"
  if [ -f "$UPDATES/request" ]; then
    version=$(tr -d ' \n' < "$UPDATES/request")
    rm -f "$UPDATES/request"
    upgrade "$version"
  fi
  sleep 2
done
