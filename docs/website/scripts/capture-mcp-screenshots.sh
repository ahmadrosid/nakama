#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCREENSHOT_DIR="$(cd "$(dirname "$0")/.." && pwd)/public/screenshots"
TEMP_CONFIG="/tmp/nakama-docs-mcp-screenshots-$$"
COOKIE_JAR="/tmp/nakama-docs-mcp-cookies-$$.txt"
PORT=4314
BASE_URL="http://127.0.0.1:${PORT}"
SESSION=nakama-docs-mcp-screenshots
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
  $AB --session "$SESSION" close --all 2>/dev/null || true
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TEMP_CONFIG" "$COOKIE_JAR"
}
trap cleanup EXIT

mkdir -p "$SCREENSHOT_DIR" "$TEMP_CONFIG"

NAKAMA_CONFIG_DIR="$TEMP_CONFIG" NAKAMA_PORT="$PORT" \
  bun run "$ROOT/apps/server/src/index.ts" > /tmp/nakama-docs-mcp-screenshot-server.log 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 60); do
  if curl -sf "${BASE_URL}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

curl -sf "${BASE_URL}/health" >/dev/null

curl -sf -c "$COOKIE_JAR" -X POST "${BASE_URL}/v1/auth/setup" \
  -H 'Content-Type: application/json' \
  -d "{
    \"organization\": {\"name\": \"Docs Demo\", \"slug\": \"docs-demo\"},
    \"admin\": {\"name\": \"Admin\", \"email\": \"admin@docs.demo\", \"password\": \"password123\"},
    \"webPublicUrl\": \"${BASE_URL}\"
  }" >/dev/null

CSRF_VAL=$(awk '$6=="nakama_csrf"{print $7}' "$COOKIE_JAR")
SESSION_VAL=$(awk '$6=="nakama_session"{print $7}' "$COOKIE_JAR")

curl -sf -b "$COOKIE_JAR" -X POST "${BASE_URL}/v1/providers" \
  -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: ${CSRF_VAL}" \
  -d '{"type":"ollama","apiKey":"","hostMode":"local","model":"llama3.2"}' >/dev/null

$AB --session "$SESSION" close --all 2>/dev/null || true
$AB --session "$SESSION" cookies set nakama_session "$SESSION_VAL" \
  --url "${BASE_URL}/" --httpOnly --sameSite Lax
$AB --session "$SESSION" cookies set nakama_csrf "$CSRF_VAL" \
  --url "${BASE_URL}/" --sameSite Lax
$AB --session "$SESSION" open "${BASE_URL}/system?tab=mcp"
$AB --session "$SESSION" wait 3000
$AB --session "$SESSION" set viewport "$VIEWPORT_WIDTH" "$VIEWPORT_HEIGHT"
$AB --session "$SESSION" set media light
$AB --session "$SESSION" snapshot -i >/dev/null
$AB --session "$SESSION" click @e24
$AB --session "$SESSION" wait 1200
$AB --session "$SESSION" snapshot -i >/dev/null
$AB --session "$SESSION" fill @e5 "exa"
$AB --session "$SESSION" fill @e11 "https://mcp.exa.ai/mcp"
$AB --session "$SESSION" fill @e13 "x-api-key"
$AB --session "$SESSION" fill @e14 "YOUR_EXA_API_KEY"
$AB --session "$SESSION" wait 400
$AB --session "$SESSION" screenshot "$SCREENSHOT_DIR/mcp-exa-api-key.png"

echo "Screenshots saved to $SCREENSHOT_DIR"
