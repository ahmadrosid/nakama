#!/usr/bin/env bash
# Capture the skill page Version history (pending suggestion + restore) for docs.
# Prerequisite: bun run --filter @nakama/web build
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
source "$(dirname "$0")/capture-common.sh"
SCREENSHOT_DIR="$(cd "$(dirname "$0")/.." && pwd)/public/screenshots"
TEMP_CONFIG="/tmp/nakama-docs-skill-versions-screenshots-$$"
COOKIE_JAR="/tmp/nakama-docs-skill-versions-cookies-$$.txt"
SERVER_LOG=/tmp/nakama-docs-skill-versions-screenshot-server.log
PORT=4316
BASE_URL="http://127.0.0.1:${PORT}"
SESSION=nakama-docs-skill-versions-screenshots
SERVER_PID=""
VIEWPORT_WIDTH=1400
VIEWPORT_HEIGHT=1150

if ! command -v agent-browser >/dev/null 2>&1; then
  echo "agent-browser is required on PATH (npm i -g agent-browser && agent-browser install)" >&2
  exit 1
fi
AB="$(command -v agent-browser)"

stop_server() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    SERVER_PID=""
  fi
}

start_server() {
  stop_server
  NAKAMA_CONFIG_DIR="$TEMP_CONFIG" NAKAMA_PORT="$PORT" \
    bun run "$ROOT/apps/server/src/index.ts" > "$SERVER_LOG" 2>&1 &
  SERVER_PID=$!

  for _ in $(seq 1 60); do
    if curl -sf "${BASE_URL}/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done

  echo "Server failed to start. Log:"
  tail -20 "$SERVER_LOG" || true
  exit 1
}

cleanup() {
  $AB --session "$SESSION" close 2>/dev/null || true
  stop_server
  rm -rf "$TEMP_CONFIG" "$COOKIE_JAR"
}
trap cleanup EXIT

mkdir -p "$SCREENSHOT_DIR" "$TEMP_CONFIG"
ensure_current_web_build "$ROOT"

start_server

SETUP_BODY=$(curl -sf -c "$COOKIE_JAR" -X POST "${BASE_URL}/v1/auth/setup" \
  -H 'Content-Type: application/json' \
  -d "{
    \"organization\": {\"name\": \"Docs Demo\", \"slug\": \"docs-demo\"},
    \"admin\": {\"name\": \"Admin\", \"email\": \"admin@docs.demo\", \"password\": \"password123\"},
    \"webPublicUrl\": \"${BASE_URL}\"
  }")

ORG_ID=$(printf '%s' "$SETUP_BODY" | bun -e 'const j=JSON.parse(await Bun.stdin.text()); process.stdout.write(j.activeOrgId ?? "");')
CSRF_VAL=$(awk '$6=="nakama_csrf"{print $7}' "$COOKIE_JAR")
SESSION_VAL=$(awk '$6=="nakama_session"{print $7}' "$COOKIE_JAR")

api() {
  local method="$1" path="$2"
  shift 2
  curl -sf -b "$COOKIE_JAR" -X "$method" "${BASE_URL}${path}" \
    -H 'Content-Type: application/json' \
    -H "X-Org-Id: ${ORG_ID}" \
    -H "X-CSRF-Token: ${CSRF_VAL}" \
    "$@"
}

api POST /v1/providers \
  -d '{"type":"ollama","apiKey":"","hostMode":"local","model":"llama3.2"}' >/dev/null

PROFILE_ID=$(api GET /v1/profiles | bun -e 'const j=JSON.parse(await Bun.stdin.text()); process.stdout.write((j.profiles ?? j)[0].id);')

# v1: create the skill. v2: edit it with a change note.
SKILL_ID=$(api POST /v1/skills -d "{
    \"name\": \"campaign-reporting\",
    \"description\": \"Weekly paid-media report: pull Meta and Google Ads, compare with HubSpot targets, and share a dashboard with the team.\",
    \"profileId\": \"${PROFILE_ID}\",
    \"body\": \"## Steps\\n1. Pull last week's results from Meta Ads.\\n2. Compare each campaign against its HubSpot target.\\n3. Write the summary in Acme's brand voice.\\n4. Post the dashboard to #marketing-weekly.\"
  }" | bun -e 'const j=JSON.parse(await Bun.stdin.text()); process.stdout.write(j.skill.id);')

api PATCH "/v1/skills/${SKILL_ID}" -d "{
    \"body\": \"## Steps\\n1. Pull last week's results from Meta Ads and Google Ads.\\n2. Compare each campaign against its HubSpot target.\\n3. Write the summary in Acme's brand voice.\\n4. Post the dashboard to #marketing-weekly.\",
    \"note\": \"Added Google Ads to the weekly pull\"
  }" >/dev/null

# Pending patch proposal, shown as "Suggested · Pending review".
stop_server
(cd "$ROOT/apps/server" && NAKAMA_CONFIG_DIR="$TEMP_CONFIG" \
  bun run scripts/seed-skill-proposal-docs.ts version-history "$PROFILE_ID")
start_server

$AB --session "$SESSION" close 2>/dev/null || true
$AB --session "$SESSION" cookies set nakama_session "$SESSION_VAL" \
  --url "${BASE_URL}/" --httpOnly --sameSite Lax
$AB --session "$SESSION" cookies set nakama_csrf "$CSRF_VAL" \
  --url "${BASE_URL}/" --sameSite Lax
$AB --session "$SESSION" set viewport "$VIEWPORT_WIDTH" "$VIEWPORT_HEIGHT"
$AB --session "$SESSION" set media light

click_version_row() {
  local label="$1"
  $AB --session "$SESSION" eval "(() => {
    const row = [...document.querySelectorAll('button[aria-expanded]')].find(
      (button) => button.textContent?.trim().startsWith('${label}'),
    );
    row?.click();
  })()"
  $AB --session "$SESSION" wait 600
}

$AB --session "$SESSION" open "${BASE_URL}/profiles/skills/${SKILL_ID}?profile=${PROFILE_ID}"
$AB --session "$SESSION" wait 2500

# Pending suggestion open, with its diff against SKILL.md
click_version_row "Suggested"
$AB --session "$SESSION" screenshot "$SCREENSHOT_DIR/skill-version-history.png"

# v1 open, with Restore this version
click_version_row "Suggested"
click_version_row "Created"
$AB --session "$SESSION" screenshot "$SCREENSHOT_DIR/skill-version-restore.png"

echo "Screenshots saved to $SCREENSHOT_DIR"
echo "  skill-version-history.png"
echo "  skill-version-restore.png"
