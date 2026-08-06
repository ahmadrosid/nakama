#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMP_CONFIG="/tmp/nakama-thinking-effort-screenshot-$$"
COOKIE_JAR="/tmp/nakama-thinking-effort-cookies-$$.txt"
PORT=4314
BASE_URL="http://127.0.0.1:${PORT}"
SESSION=nakama-thinking-effort-screenshot
SERVER_PID=""
OUTPUT="${ROOT}/docs/website/public/screenshots/chat-thinking-effort-preview.png"
VIEWPORT_WIDTH=1280
VIEWPORT_HEIGHT=900

cleanup() {
  npx --yes agent-browser --session "$SESSION" close --all 2>/dev/null || true
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TEMP_CONFIG" "$COOKIE_JAR"
}
trap cleanup EXIT

mkdir -p "$TEMP_CONFIG" "$(dirname "$OUTPUT")"

NAKAMA_CONFIG_DIR="$TEMP_CONFIG" NAKAMA_PORT="$PORT" \
  bun run "$ROOT/apps/server/src/index.ts" > /tmp/nakama-thinking-effort-server.log 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 80); do
  if curl -sf "${BASE_URL}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

curl -sf "${BASE_URL}/health" >/dev/null

curl -sf -c "$COOKIE_JAR" -X POST "${BASE_URL}/v1/auth/setup" \
  -H 'Content-Type: application/json' \
  -d "{
    \"organization\": {\"name\": \"Thinking Demo\", \"slug\": \"thinking-demo\"},
    \"admin\": {\"name\": \"Admin\", \"email\": \"admin@thinking.demo\", \"password\": \"password123\"},
    \"webPublicUrl\": \"${BASE_URL}\"
  }" >/dev/null

CSRF_VAL=$(awk '$6=="nakama_csrf"{print $7}' "$COOKIE_JAR")
SESSION_VAL=$(awk '$6=="nakama_session"{print $7}' "$COOKIE_JAR")
ORG_ID=$(curl -sf -b "$COOKIE_JAR" "${BASE_URL}/v1/auth/me" | python3 -c 'import json,sys; print(json.load(sys.stdin)["activeOrgId"])')

curl -sf -b "$COOKIE_JAR" -X POST "${BASE_URL}/v1/providers" \
  -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: ${CSRF_VAL}" \
  -H "X-Org-Id: ${ORG_ID}" \
  -d '{
    "type": "openai_compatible",
    "label": "Reasoning Demo",
    "apiKey": "demo-key",
    "baseUrl": "https://example.com/v1",
    "customModels": [
      {"id": "reasoner-demo", "name": "Reasoner Demo", "supportsThinking": true}
    ]
  }' >/dev/null

PROVIDER_ID=$(curl -sf -b "$COOKIE_JAR" -H "X-Org-Id: ${ORG_ID}" "${BASE_URL}/v1/providers" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["defaultProviderId"])')
MODEL_SELECTION="${PROVIDER_ID}::reasoner-demo"

PROFILE_ID=$(curl -sf -b "$COOKIE_JAR" -H "X-Org-Id: ${ORG_ID}" "${BASE_URL}/v1/profiles" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["profiles"][0]["id"])')

curl -sf -b "$COOKIE_JAR" -X PUT "${BASE_URL}/v1/profiles/${PROFILE_ID}" \
  -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: ${CSRF_VAL}" \
  -H "X-Org-Id: ${ORG_ID}" \
  -d "{\"model\": \"${MODEL_SELECTION}\"}" >/dev/null

curl -sf -b "$COOKIE_JAR" -X PUT "${BASE_URL}/v1/settings/thinking" \
  -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: ${CSRF_VAL}" \
  -H "X-Org-Id: ${ORG_ID}" \
  -d '{"enabled": true, "effort": "medium"}' >/dev/null

npx --yes agent-browser --session "$SESSION" close --all 2>/dev/null || true
npx --yes agent-browser --session "$SESSION" cookies set nakama_session "$SESSION_VAL" \
  --url "${BASE_URL}/" --httpOnly --sameSite Lax
npx --yes agent-browser --session "$SESSION" cookies set nakama_csrf "$CSRF_VAL" \
  --url "${BASE_URL}/" --sameSite Lax
npx --yes agent-browser --session "$SESSION" open "${BASE_URL}/chat"
npx --yes agent-browser --session "$SESSION" wait 2500
npx --yes agent-browser --session "$SESSION" set viewport "$VIEWPORT_WIDTH" "$VIEWPORT_HEIGHT"
npx --yes agent-browser --session "$SESSION" set media dark
npx --yes agent-browser --session "$SESSION" wait 500
npx --yes agent-browser --session "$SESSION" screenshot "$OUTPUT"

echo "Screenshot saved to $OUTPUT"
