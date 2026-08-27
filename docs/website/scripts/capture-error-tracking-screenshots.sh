#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCREENSHOT_DIR="$(cd "$(dirname "$0")/.." && pwd)/public/screenshots"
TEMP_CONFIG="/tmp/nakama-docs-error-tracking-screenshots-$$"
COOKIE_JAR="/tmp/nakama-docs-error-tracking-cookies-$$.txt"
PORT=4317
INGEST_PORT=4318
BASE_URL="http://127.0.0.1:${PORT}"
SESSION=nakama-docs-error-tracking-screenshots
SERVER_PID=""
INGEST_PID=""
VIEWPORT_WIDTH=1280

if command -v agent-browser >/dev/null 2>&1; then
  AB="$(command -v agent-browser)"
else
  AB="npx --yes agent-browser"
fi

cleanup() {
  $AB --session "$SESSION" close --all 2>/dev/null || true
  for pid in "$SERVER_PID" "$INGEST_PID"; do
    if [[ -n "$pid" ]]; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  rm -rf "$TEMP_CONFIG" "$COOKIE_JAR"
}
trap cleanup EXIT

mkdir -p "$SCREENSHOT_DIR" "$TEMP_CONFIG"

# A Sentry-compatible ingest that accepts anything, so the test event in the
# second shot reports a real delivery rather than a mocked-out success.
bun -e "Bun.serve({port:${INGEST_PORT},fetch:()=>new Response('{}',{status:200})})" \
  > /tmp/nakama-docs-error-tracking-ingest.log 2>&1 &
INGEST_PID=$!

NAKAMA_CONFIG_DIR="$TEMP_CONFIG" NAKAMA_PORT="$PORT" \
  bun run "$ROOT/apps/server/src/index.ts" > /tmp/nakama-docs-error-tracking-server.log 2>&1 &
SERVER_PID=$!

# Bound on the clock, not on a retry count: curl against a closed port fails
# instantly, so a fixed loop gives up while the server is still starting.
deadline=$(( $(date +%s) + 90 ))
until curl -sf "${BASE_URL}/health" >/dev/null 2>&1; do
  if [[ "$(date +%s)" -gt "$deadline" ]]; then
    tail -20 /tmp/nakama-docs-error-tracking-server.log
    exit 1
  fi
  sleep 0.25
done

curl -sf -c "$COOKIE_JAR" -X POST "${BASE_URL}/v1/auth/setup" \
  -H 'Content-Type: application/json' \
  -d "{
    \"organization\": {\"name\": \"Docs Demo\", \"slug\": \"docs-demo\"},
    \"admin\": {\"name\": \"Admin\", \"email\": \"admin@docs.demo\", \"password\": \"password123\"},
    \"webPublicUrl\": \"${BASE_URL}\"
  }" >/dev/null

CSRF_VAL=$(awk '$6=="nakama_csrf"{print $7}' "$COOKIE_JAR")
SESSION_VAL=$(awk '$6=="nakama_session"{print $7}' "$COOKIE_JAR")

# Without a provider the SetupGuard redirects every page to the setup wizard, so
# the Integrations tab never renders. The key is a placeholder and is never used.
curl -sf -b "$COOKIE_JAR" -X POST "${BASE_URL}/v1/providers" \
  -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: ${CSRF_VAL}" \
  -d '{"type":"openai","apiKey":"sk-docs-demo-placeholder-key","model":"gpt-4o-mini"}' >/dev/null

$AB --session "$SESSION" close --all 2>/dev/null || true
$AB --session "$SESSION" cookies set nakama_session "$SESSION_VAL" \
  --url "${BASE_URL}/" --httpOnly --sameSite Lax
$AB --session "$SESSION" cookies set nakama_csrf "$CSRF_VAL" \
  --url "${BASE_URL}/" --sameSite Lax

# ---------------------------------------------------------------------------
# Shot 1: no DSN saved. The badge reads Off and nothing is sent.
# ---------------------------------------------------------------------------
$AB --session "$SESSION" open "${BASE_URL}/integrations?section=error-tracking"
$AB --session "$SESSION" wait 2500
$AB --session "$SESSION" set viewport "$VIEWPORT_WIDTH" 620
$AB --session "$SESSION" set media light
$AB --session "$SESSION" wait 400
$AB --session "$SESSION" screenshot "$SCREENSHOT_DIR/error-tracking-empty.png"

# ---------------------------------------------------------------------------
# Shot 2: DSN saved and a test event delivered. Driven through the form rather
# than the API, because the result line is component state that only a real
# click produces.
# ---------------------------------------------------------------------------
$AB --session "$SESSION" fill "#error-tracking-dsn" \
  "http://publickey@127.0.0.1:${INGEST_PORT}/42"
$AB --session "$SESSION" wait 300
$AB --session "$SESSION" find text "Save" click
$AB --session "$SESSION" wait 1500
$AB --session "$SESSION" find text "Send test event" click
$AB --session "$SESSION" wait 2500
$AB --session "$SESSION" set viewport "$VIEWPORT_WIDTH" 620
$AB --session "$SESSION" set media light
$AB --session "$SESSION" wait 400
$AB --session "$SESSION" screenshot "$SCREENSHOT_DIR/error-tracking-test-event.png"

echo "Screenshots saved to $SCREENSHOT_DIR"
