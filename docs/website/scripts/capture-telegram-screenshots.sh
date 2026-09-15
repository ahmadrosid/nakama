#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCREENSHOT_DIR="$(cd "$(dirname "$0")/.." && pwd)/public/screenshots"
TEMP_CONFIG="/tmp/nakama-docs-telegram-screenshots-$$"
COOKIE_JAR="/tmp/nakama-docs-telegram-cookies-$$.txt"
PORT=4316
BASE_URL="http://127.0.0.1:${PORT}"
SESSION=nakama-docs-telegram-screenshots
SERVER_PID=""
VIEWPORT_WIDTH=1280
VIEWPORT_HEIGHT=900

if command -v agent-browser >/dev/null 2>&1; then
  AB="$(command -v agent-browser)"
elif [[ -x "/Users/ahmadrosid/Library/pnpm/nodejs/22.23.1/bin/agent-browser" ]]; then
  AB="/Users/ahmadrosid/Library/pnpm/nodejs/22.23.1/bin/agent-browser"
else
  AB="npx --yes agent-browser"
fi

cleanup() {
  $AB --session "$SESSION" close 2>/dev/null || true
  # Kill the isolated PM2 daemon and its workers so they don't keep respawning
  # a server on the test port after the script exits.
  if [[ -n "${PM2_HOME:-}" ]]; then
    ( PM2_HOME="$PM2_HOME" npx --yes pm2 kill >/dev/null 2>&1 ) || true
  fi
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TEMP_CONFIG" "$COOKIE_JAR"
}
trap cleanup EXIT

mkdir -p "$SCREENSHOT_DIR" "$TEMP_CONFIG"

# Isolate the PM2 daemon so the screenshot worker does not collide with any
# real "telegram" PM2 process already running on this machine. PM2 namespaces
# its daemon + logs by PM2_HOME, so this keeps the captured logs isolated.
export PM2_HOME="$TEMP_CONFIG/pm2"

NAKAMA_CONFIG_DIR="$TEMP_CONFIG" NAKAMA_PORT="$PORT" \
  bun run "$ROOT/apps/server/src/index.ts" > /tmp/nakama-docs-telegram-screenshot-server.log 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 60); do
  if curl --fail-with-body -sS "${BASE_URL}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

curl --fail-with-body -sS "${BASE_URL}/health" >/dev/null

SETUP_BODY=$(curl --fail-with-body -sS -c "$COOKIE_JAR" -X POST "${BASE_URL}/v1/auth/setup" \
  -H 'Content-Type: application/json' \
  -d "{
    \"organization\": {\"name\": \"Docs Demo\", \"slug\": \"docs-demo\"},
    \"admin\": {\"name\": \"Admin\", \"email\": \"admin@docs.demo\", \"password\": \"password123\"},
    \"webPublicUrl\": \"${BASE_URL}\"
  }")
ORG_ID=$(printf '%s' "$SETUP_BODY" | bun -e 'const j=JSON.parse(await Bun.stdin.text()); process.stdout.write(j.activeOrgId);')

CSRF_VAL=$(awk '$6=="nakama_csrf"{print $7}' "$COOKIE_JAR")
SESSION_VAL=$(awk '$6=="nakama_session"{print $7}' "$COOKIE_JAR")

# OpenAI provider so the audio transcription model picker becomes available.
curl --fail-with-body -sS -b "$COOKIE_JAR" -X POST "${BASE_URL}/v1/providers" \
  -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: ${CSRF_VAL}" \
  -d '{"type":"openai","apiKey":"sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","model":"gpt-4o-mini"}' >/dev/null

$AB --session "$SESSION" close 2>/dev/null || true
$AB --session "$SESSION" cookies set nakama_session "$SESSION_VAL" \
  --url "${BASE_URL}/" --httpOnly --sameSite Lax
$AB --session "$SESSION" cookies set nakama_csrf "$CSRF_VAL" \
  --url "${BASE_URL}/" --sameSite Lax

# ---------------------------------------------------------------------------
# Step 2: Integrations -> Telegram, bot token entry (not yet saved).
# ---------------------------------------------------------------------------
$AB --session "$SESSION" open "${BASE_URL}/integrations"
$AB --session "$SESSION" wait 2500
$AB --session "$SESSION" set viewport "$VIEWPORT_WIDTH" 560
$AB --session "$SESSION" set media light
$AB --session "$SESSION" wait 400
$AB --session "$SESSION" fill "#telegram-bot-token" "123456789:AAH-example-token-from-botfather"
$AB --session "$SESSION" wait 300
$AB --session "$SESSION" screenshot "$SCREENSHOT_DIR/telegram-bot-token.png"

# ---------------------------------------------------------------------------
# Step 4: Save Telegram settings + generate a pairing code, then screenshot.
# ---------------------------------------------------------------------------
# Seed only the isolated demo config: saving through HTTP validates the fake
# token against Telegram and correctly rejects it.
(cd "$ROOT" && NAKAMA_CONFIG_DIR="$TEMP_CONFIG" DOCS_ORG_ID="$ORG_ID" bun -e '
  const { saveTelegramConfig } = await import("./packages/core/src/telegram-config.ts");
  await saveTelegramConfig(process.env.DOCS_ORG_ID, {
    botToken: "123456789:AAH-example-token-from-botfather",
  });
')

# Start the bridge worker against the fake token so it emits real 401 errors
# into its stderr log — exactly what a misconfigured bot looks like in prod.
curl --fail-with-body -sS -b "$COOKIE_JAR" -X POST "${BASE_URL}/v1/workers/telegram/start" \
  -H "X-CSRF-Token: ${CSRF_VAL}" >/dev/null

$AB --session "$SESSION" open "${BASE_URL}/integrations"
$AB --session "$SESSION" wait 2500
$AB --session "$SESSION" set viewport "$VIEWPORT_WIDTH" 1100
$AB --session "$SESSION" set media light
$AB --session "$SESSION" wait 400
$AB --session "$SESSION" screenshot "$SCREENSHOT_DIR/telegram-pairing.png"

# ---------------------------------------------------------------------------
# Debugging: Bridge worker -> View logs (stderr shows token / config errors).
# Give the worker time to poll Telegram with the fake token and record 401s.
# ---------------------------------------------------------------------------
$AB --session "$SESSION" wait 8000
$AB --session "$SESSION" eval "(() => { const button = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === 'View logs'); if (!button) throw new Error('Missing View logs button'); button.click(); })()"
$AB --session "$SESSION" wait 1500
$AB --session "$SESSION" set viewport "$VIEWPORT_WIDTH" 760
# The dialog only fetches once on open, so click Refresh to pull the latest
# stderr (which now contains the 401 errors from the fake token).
$AB --session "$SESSION" eval "(() => { const button = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === 'Refresh'); if (!button) throw new Error('Missing Refresh button'); button.click(); })()"
$AB --session "$SESSION" wait 1500
$AB --session "$SESSION" eval "(() => { const button = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === 'Stderr'); if (!button) throw new Error('Missing Stderr button'); button.click(); })()"
$AB --session "$SESSION" wait 1000
$AB --session "$SESSION" screenshot "$SCREENSHOT_DIR/telegram-worker-logs.png"

# ---------------------------------------------------------------------------
# Step 3: Customize -> LLM providers -> Audio transcription model picker.
# ---------------------------------------------------------------------------
$AB --session "$SESSION" open "${BASE_URL}/customize/providers"
$AB --session "$SESSION" wait 2500
$AB --session "$SESSION" set viewport "$VIEWPORT_WIDTH" 1000
$AB --session "$SESSION" set media light
$AB --session "$SESSION" wait 400
$AB --session "$SESSION" eval "document.querySelector('[aria-label=\"Audio transcription model\"]')?.scrollIntoView({block:'center'})"
$AB --session "$SESSION" wait 400
$AB --session "$SESSION" screenshot "$SCREENSHOT_DIR/telegram-audio-transcription.png"

# ---------------------------------------------------------------------------
# Outbound notifications: Integrations -> Notifications destination form.
# ---------------------------------------------------------------------------
$AB --session "$SESSION" open "${BASE_URL}/integrations?section=notifications"
$AB --session "$SESSION" wait 2500
$AB --session "$SESSION" set viewport "$VIEWPORT_WIDTH" 760
$AB --session "$SESSION" set media light
$AB --session "$SESSION" wait 400
$AB --session "$SESSION" screenshot "$SCREENSHOT_DIR/telegram-notifications.png"

echo "Screenshots saved to $SCREENSHOT_DIR"
