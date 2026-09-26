#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
source "$(dirname "$0")/capture-common.sh"
SCREENSHOT_DIR="$(cd "$(dirname "$0")/.." && pwd)/public/screenshots"
TEMP_CONFIG="/tmp/nakama-docs-screenshots-$$"
PORT=4312
BASE_URL="http://127.0.0.1:${PORT}"
SESSION=nakama-docs-screenshots
SERVER_PID=""
# Per-step heights: account has 5 fields; org/provider need less vertical space.
VIEWPORT_WIDTH=1280

cleanup() {
  agent-browser --session "$SESSION" close 2>/dev/null || true
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TEMP_CONFIG"
}
trap cleanup EXIT

mkdir -p "$SCREENSHOT_DIR" "$TEMP_CONFIG"
ensure_current_web_build "$ROOT"
NAKAMA_CONFIG_DIR="$TEMP_CONFIG" NAKAMA_PORT="$PORT" \
  bun run "$ROOT/apps/server/src/index.ts" > /tmp/nakama-docs-screenshot-server.log 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 60); do
  if curl -sf "${BASE_URL}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

curl -sf "${BASE_URL}/health" >/dev/null

agent-browser --session "$SESSION" close 2>/dev/null || true
agent-browser --session "$SESSION" open "${BASE_URL}/setup"
agent-browser --session "$SESSION" wait 2000

capture_step() {
  local height="$1"
  local output="$2"
  agent-browser --session "$SESSION" set viewport "$VIEWPORT_WIDTH" "$height"
  agent-browser --session "$SESSION" wait 300
  agent-browser --session "$SESSION" snapshot -i >/dev/null
  agent-browser --session "$SESSION" screenshot "$output"
}
capture_step 740 "$SCREENSHOT_DIR/setup-step-account.png"
agent-browser --session "$SESSION" fill "#setup-name" "Admin"
agent-browser --session "$SESSION" fill "#setup-email" "admin@docs.demo"
agent-browser --session "$SESSION" fill "#setup-password" "password123"
agent-browser --session "$SESSION" fill "#setup-confirm" "password123"
agent-browser --session "$SESSION" find text "Continue" click --exact
agent-browser --session "$SESSION" wait 1500
capture_step 600 "$SCREENSHOT_DIR/setup-step-organization.png"
agent-browser --session "$SESSION" fill "#setup-org-name" "Docs Demo"
agent-browser --session "$SESSION" fill "#setup-org-slug" "docs-demo"
agent-browser --session "$SESSION" find text "Create Organization" click --exact
agent-browser --session "$SESSION" wait 4000

capture_step 600 "$SCREENSHOT_DIR/setup-step-provider.png"

echo "Screenshots saved to $SCREENSHOT_DIR"
