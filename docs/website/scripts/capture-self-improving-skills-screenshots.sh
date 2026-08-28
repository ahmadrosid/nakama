#!/usr/bin/env bash
# Capture System → Organization skill write approval UI for docs.
# Prerequisite: bun run --filter @nakama/web build
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCREENSHOT_DIR="$(cd "$(dirname "$0")/.." && pwd)/public/screenshots"
TEMP_CONFIG="/tmp/nakama-docs-skills-screenshots-$$"
COOKIE_JAR="/tmp/nakama-docs-skills-cookies-$$.txt"
PORT=4315
BASE_URL="http://127.0.0.1:${PORT}"
SESSION=nakama-docs-skills-screenshots
SERVER_PID=""
VIEWPORT_WIDTH=1280
VIEWPORT_HEIGHT=720

if command -v agent-browser >/dev/null 2>&1; then
  AB="$(command -v agent-browser)"
elif [[ -x "/Users/ahmadrosid/Library/pnpm/nodejs/22.23.1/bin/agent-browser" ]]; then
  AB="/Users/ahmadrosid/Library/pnpm/nodejs/22.23.1/bin/agent-browser"
else
  AB="npx --yes agent-browser"
fi

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
    bun run "$ROOT/apps/server/src/index.ts" > /tmp/nakama-docs-skills-screenshot-server.log 2>&1 &
  SERVER_PID=$!

  for _ in $(seq 1 60); do
    if curl -sf "${BASE_URL}/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done

  echo "Server failed to start. Log:"
  tail -20 /tmp/nakama-docs-skills-screenshot-server.log || true
  exit 1
}

cleanup() {
  $AB --session "$SESSION" close --all 2>/dev/null || true
  stop_server
  rm -rf "$TEMP_CONFIG" "$COOKIE_JAR"
}
trap cleanup EXIT

mkdir -p "$SCREENSHOT_DIR" "$TEMP_CONFIG"

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

curl -sf -b "$COOKIE_JAR" -X POST "${BASE_URL}/v1/providers" \
  -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: ${CSRF_VAL}" \
  -d '{"type":"ollama","apiKey":"","hostMode":"local","model":"llama3.2"}' >/dev/null

curl -sf -b "$COOKIE_JAR" -X PATCH "${BASE_URL}/v1/orgs/${ORG_ID}" \
  -H 'Content-Type: application/json' \
  -H "X-Org-Id: ${ORG_ID}" \
  -H "X-CSRF-Token: ${CSRF_VAL}" \
  -d '{"skillsWriteApproval": true}' >/dev/null

stop_server
(cd "$ROOT/apps/server" && NAKAMA_CONFIG_DIR="$TEMP_CONFIG" bun run scripts/seed-skill-proposal-docs.ts)
start_server

$AB --session "$SESSION" close --all 2>/dev/null || true
$AB --session "$SESSION" cookies set nakama_session "$SESSION_VAL" \
  --url "${BASE_URL}/" --httpOnly --sameSite Lax
$AB --session "$SESSION" cookies set nakama_csrf "$CSRF_VAL" \
  --url "${BASE_URL}/" --sameSite Lax
$AB --session "$SESSION" set viewport "$VIEWPORT_WIDTH" "$VIEWPORT_HEIGHT"
$AB --session "$SESSION" set media light

scroll_to_skill_card() {
  $AB --session "$SESSION" eval "(() => {
    const heading = [...document.querySelectorAll('p')].find(
      (node) => node.textContent?.trim() === 'Skill write approval',
    );
    const card = heading?.closest('.overflow-hidden');
    card?.scrollIntoView({ block: 'start', behavior: 'instant' });
  })()"
  $AB --session "$SESSION" wait 600
}

open_org_page() {
  local query="$1"
  $AB --session "$SESSION" open "${BASE_URL}/organization${query}"
  $AB --session "$SESSION" wait 2500
  scroll_to_skill_card
}

# Gate settings tab — org toggle on
open_org_page ""
$AB --session "$SESSION" screenshot "$SCREENSHOT_DIR/skill-write-approval-gate.png"

# Proposals tab with pending deploy-checklist row
open_org_page "?skillProposals=proposals"
$AB --session "$SESSION" screenshot "$SCREENSHOT_DIR/skill-write-approval-proposals.png"

# Review dialog for the seeded proposal
$AB --session "$SESSION" eval "(() => {
  const card = [...document.querySelectorAll('p')]
    .find((node) => node.textContent?.trim() === 'Skill write approval')
    ?.closest('.overflow-hidden');
  const review = card?.querySelector('button');
  const buttons = card ? [...card.querySelectorAll('button')] : [];
  const target = buttons.find((btn) => btn.textContent?.trim() === 'Review');
  target?.click();
})()"
$AB --session "$SESSION" wait 800
$AB --session "$SESSION" screenshot "$SCREENSHOT_DIR/skill-write-approval-review.png"

echo "Screenshots saved to $SCREENSHOT_DIR"
echo "  skill-write-approval-gate.png"
echo "  skill-write-approval-proposals.png"
echo "  skill-write-approval-review.png"
