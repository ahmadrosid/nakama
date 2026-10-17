#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
source "$(dirname "$0")/capture-common.sh"
SCREENSHOT_DIR="$(cd "$(dirname "$0")/.." && pwd)/public/screenshots"
TEMP_CONFIG="/tmp/nakama-docs-acp-agents-screenshots-$$"
COOKIE_JAR="/tmp/nakama-docs-acp-agents-cookies-$$.txt"
PORT=4319
BASE_URL="http://127.0.0.1:${PORT}"
SESSION=nakama-docs-acp-agents-screenshots
SERVER_PID=""
VIEWPORT_WIDTH=1280
VIEWPORT_HEIGHT=800

if ! command -v agent-browser >/dev/null 2>&1; then
  echo "agent-browser is required on PATH (npm i -g agent-browser && agent-browser install)" >&2
  exit 1
fi
AB="$(command -v agent-browser)"

cleanup() {
  $AB --session "$SESSION" close 2>/dev/null || true
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TEMP_CONFIG" "$COOKIE_JAR"
}
trap cleanup EXIT

mkdir -p "$SCREENSHOT_DIR" "$TEMP_CONFIG"
ensure_current_web_build "$ROOT"

NAKAMA_CONFIG_DIR="$TEMP_CONFIG" NAKAMA_PORT="$PORT" \
  bun run "$ROOT/apps/server/src/index.ts" > /tmp/nakama-docs-acp-agents-server.log 2>&1 &
SERVER_PID=$!

deadline=$(( $(date +%s) + 90 ))
until curl -sf "${BASE_URL}/health" >/dev/null 2>&1; do
  if [[ "$(date +%s)" -gt "$deadline" ]]; then
    tail -20 /tmp/nakama-docs-acp-agents-server.log
    exit 1
  fi
  sleep 0.25
done

SETUP_BODY=$(curl -sf -c "$COOKIE_JAR" -X POST "${BASE_URL}/v1/auth/setup" \
  -H 'Content-Type: application/json' \
  -d "{
    \"organization\": {\"name\": \"Docs Demo\", \"slug\": \"docs-demo\"},
    \"admin\": {\"name\": \"Admin\", \"email\": \"admin@docs.demo\", \"password\": \"password123\"},
    \"webPublicUrl\": \"${BASE_URL}\"
  }")
ORG_ID=$(printf '%s' "$SETUP_BODY" | bun -e 'const j=JSON.parse(await Bun.stdin.text()); process.stdout.write(j.activeOrgId);')

CSRF_VAL=$(awk '$6=="nakama_csrf"{print $7}' "$COOKIE_JAR")
SESSION_VAL=$(awk '$6=="nakama_session"{print $7}' "$COOKIE_JAR")

# Without a provider the SetupGuard redirects every page to the setup wizard.
# The key is a placeholder and is never used.
curl -sf -b "$COOKIE_JAR" -X POST "${BASE_URL}/v1/providers" \
  -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: ${CSRF_VAL}" \
  -d '{"type":"openai","apiKey":"sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","model":"gpt-4o-mini"}' >/dev/null

$AB --session "$SESSION" close 2>/dev/null || true
$AB --session "$SESSION" cookies set nakama_session "$SESSION_VAL" \
  --url "${BASE_URL}/" --httpOnly --sameSite Lax
$AB --session "$SESSION" cookies set nakama_csrf "$CSRF_VAL" \
  --url "${BASE_URL}/" --sameSite Lax
$AB --session "$SESSION" set viewport "$VIEWPORT_WIDTH" "$VIEWPORT_HEIGHT"

shoot() {
  $AB --session "$SESSION" set viewport "$VIEWPORT_WIDTH" "$VIEWPORT_HEIGHT"
  $AB --session "$SESSION" set media light
  $AB --session "$SESSION" wait 400
  $AB --session "$SESSION" screenshot "$SCREENSHOT_DIR/$1"
}

# ---------------------------------------------------------------------------
# Shot 1: the Create agent dialog, filled in, with Claude as the agent.
# ---------------------------------------------------------------------------
$AB --session "$SESSION" open "${BASE_URL}/profiles?create=1"
$AB --session "$SESSION" wait 2500
$AB --session "$SESSION" fill "#create-profile-name" "Code Reviewer"
# Agent, Agent id, Tools and Avatar sit behind the dialog's Change link.
$AB --session "$SESSION" eval "[...document.querySelectorAll('[role=dialog] button[aria-expanded=false]')].find((el) => el.textContent.trim() === 'Change').click()"
$AB --session "$SESSION" wait "#create-profile-agent"
$AB --session "$SESSION" eval "document.querySelector('#create-profile-agent').scrollIntoView({ block: 'center' })"
$AB --session "$SESSION" click "#create-profile-agent"
$AB --session "$SESSION" wait 400
$AB --session "$SESSION" find role option click --name "Claude" --exact
$AB --session "$SESSION" wait 300
$AB --session "$SESSION" eval "document.querySelector('#create-profile-agent').scrollIntoView({ block: 'center' })"
shoot acp-create-agent.png

# ---------------------------------------------------------------------------
# Shot 2: the Chat agent menu open on the new profile.
# ---------------------------------------------------------------------------
$AB --session "$SESSION" find role button click --name "Create agent" --exact
$AB --session "$SESSION" wait 2500
PROFILE_ID=$(curl -sf -b "$COOKIE_JAR" -H "X-Org-Id: ${ORG_ID}" "${BASE_URL}/v1/profiles" | \
  bun -e 'const j=JSON.parse(await Bun.stdin.text()); process.stdout.write(j.profiles.find((p) => p.name === "Code Reviewer").id);')
$AB --session "$SESSION" open "${BASE_URL}/profiles?profile=${PROFILE_ID}"
# The model and effort menus fill in once the ACP agent reports its models.
$AB --session "$SESSION" wait 8000
$AB --session "$SESSION" click "#profile-chat-agent"
$AB --session "$SESSION" wait 600
shoot acp-chat-agent-menu.png

# ---------------------------------------------------------------------------
# Shot 3: Claude selected as the chat agent.
# ---------------------------------------------------------------------------
$AB --session "$SESSION" find role option click --name "Claude" --exact
$AB --session "$SESSION" wait 2500
shoot acp-chat-agent-claude.png

echo "Screenshots saved to $SCREENSHOT_DIR"
