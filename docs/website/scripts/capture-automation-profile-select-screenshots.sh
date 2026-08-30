#!/usr/bin/env bash
# Captures before/after Automations Edit UI for PR screenshots.
# Before = main worktree; After = current (feature) tree.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
MAIN_ROOT="${NAKAMA_MAIN_ROOT:-/tmp/nakama-main-pr-shots}"
SCREENSHOT_DIR="$ROOT/.github/pr-image"
TEMP_AFTER="/tmp/nakama-pr-auto-profile-after-$$"
TEMP_BEFORE="/tmp/nakama-pr-auto-profile-before-$$"
COOKIE_AFTER="/tmp/nakama-pr-auto-profile-after-$$.txt"
COOKIE_BEFORE="/tmp/nakama-pr-auto-profile-before-$$.txt"
PORT_AFTER=4321
PORT_BEFORE=4322
WEB_AFTER=3021
WEB_BEFORE=3022
SESSION_AFTER=nakama-pr-auto-profile-after
SESSION_BEFORE=nakama-pr-auto-profile-before
VIEWPORT_WIDTH=1280
VIEWPORT_HEIGHT=900

AFTER_SERVER_PID=""
BEFORE_SERVER_PID=""
AFTER_WEB_PID=""
BEFORE_WEB_PID=""

if command -v agent-browser >/dev/null 2>&1; then
  AB="$(command -v agent-browser)"
else
  AB="npx --yes agent-browser"
fi

cleanup() {
  $AB --session "$SESSION_AFTER" close --all 2>/dev/null || true
  $AB --session "$SESSION_BEFORE" close --all 2>/dev/null || true
  for pid in "$AFTER_WEB_PID" "$BEFORE_WEB_PID" "$AFTER_SERVER_PID" "$BEFORE_SERVER_PID"; do
    if [[ -n "$pid" ]]; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  rm -rf "$TEMP_AFTER" "$TEMP_BEFORE" "$COOKIE_AFTER" "$COOKIE_BEFORE"
}
trap cleanup EXIT

wait_health() {
  local base="$1"
  for _ in $(seq 1 80); do
    if curl -sf "${base}/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  echo "Timed out waiting for ${base}/health" >&2
  return 1
}

wait_web() {
  local base="$1"
  for _ in $(seq 1 80); do
    if curl -sf "${base}/" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  echo "Timed out waiting for ${base}/" >&2
  return 1
}

# Sets globals: CSRF SESSION_VAL via nameref-ish prefix
start_seeded_stack() {
  local root="$1"
  local port="$2"
  local web_port="$3"
  local temp="$4"
  local cookie="$5"
  local server_log="$6"
  local web_log="$7"
  local prefix="$8" # AFTER | BEFORE

  mkdir -p "$temp"
  NAKAMA_CONFIG_DIR="$temp" NAKAMA_PORT="$port" \
    bun run "$root/apps/server/src/index.ts" >"$server_log" 2>&1 &
  if [[ "$prefix" == "AFTER" ]]; then
    AFTER_SERVER_PID=$!
  else
    BEFORE_SERVER_PID=$!
  fi

  local api="http://127.0.0.1:${port}"
  wait_health "$api"

  curl -sf -c "$cookie" -X POST "${api}/v1/auth/setup" \
    -H 'Content-Type: application/json' \
    -d "{
      \"organization\": {\"name\": \"Shot Org\", \"slug\": \"shot-org\"},
      \"admin\": {\"name\": \"Admin\", \"email\": \"admin@shot.demo\", \"password\": \"password123\"},
      \"webPublicUrl\": \"${api}\"
    }" >/dev/null

  local csrf session_val org profile_id
  csrf=$(awk '$6=="nakama_csrf"{print $7}' "$cookie")
  session_val=$(awk '$6=="nakama_session"{print $7}' "$cookie")
  org=$(curl -sf -b "$cookie" "${api}/v1/auth/me" | bun -e 'console.log(JSON.parse(await Bun.stdin.text()).activeOrgId)')

  curl -sf -b "$cookie" -X POST "${api}/v1/providers" \
    -H 'Content-Type: application/json' \
    -H "X-CSRF-Token: ${csrf}" \
    -H "X-Org-Id: ${org}" \
    -d '{"type":"ollama","apiKey":"","hostMode":"local","model":"llama3.2"}' >/dev/null

  profile_id=$(curl -sf -b "$cookie" \
    -H "X-Org-Id: ${org}" \
    -H "X-CSRF-Token: ${csrf}" \
    "${api}/v1/profiles" | bun -e '
      const d = JSON.parse(await Bun.stdin.text());
      const p = d.profiles.find((x) => x.name === "Default Bot") ?? d.profiles[0];
      console.log(p.id);
    ')

  curl -sf -b "$cookie" -X POST "${api}/v1/automations" \
    -H 'Content-Type: application/json' \
    -H "X-CSRF-Token: ${csrf}" \
    -H "X-Org-Id: ${org}" \
    -d "{
      \"name\": \"Morning digest\",
      \"description\": \"Daily summary\",
      \"prompt\": \"Summarize yesterday for the team\",
      \"profileId\": \"${profile_id}\",
      \"trigger\": {\"type\": \"manual\"},
      \"enabled\": true
    }" >/dev/null

  (
    cd "$root/apps/web"
    NAKAMA_SERVER_URL="$api" bun x vite --host 127.0.0.1 --port "$web_port" --strictPort \
      >"$web_log" 2>&1
  ) &
  if [[ "$prefix" == "AFTER" ]]; then
    AFTER_WEB_PID=$!
  else
    BEFORE_WEB_PID=$!
  fi

  wait_web "http://127.0.0.1:${web_port}"

  if [[ "$prefix" == "AFTER" ]]; then
    AFTER_CSRF="$csrf"
    AFTER_SESSION="$session_val"
  else
    BEFORE_CSRF="$csrf"
    BEFORE_SESSION="$session_val"
  fi
}

capture_edit_dialog() {
  local session="$1"
  local web_base="$2"
  local out="$3"
  local label="$4"
  local csrf="$5"
  local session_val="$6"

  $AB --session "$session" close --all 2>/dev/null || true

  $AB --session "$session" cookies set nakama_session "$session_val" \
    --url "${web_base}/" --httpOnly --sameSite Lax
  $AB --session "$session" cookies set nakama_csrf "$csrf" \
    --url "${web_base}/" --sameSite Lax
  $AB --session "$session" open "${web_base}/automations"
  $AB --session "$session" wait 3000
  $AB --session "$session" set viewport "$VIEWPORT_WIDTH" "$VIEWPORT_HEIGHT"
  $AB --session "$session" set media light

  local snap edit_ref
  snap=$($AB --session "$session" snapshot -i 2>/dev/null || true)
  edit_ref=$(echo "$snap" | bun -e '
    const t = await Bun.stdin.text();
    // Prefer exact Edit button: button "Edit" [ref=e25]
    const m = t.match(/button\s+"Edit"\s+\[ref=(e\d+)\]/i);
    if (m) { console.log(m[1]); process.exit(0); }
    const lines = t.split("\n");
    for (const line of lines) {
      if (!/button\s+"Edit"/i.test(line)) continue;
      const r = line.match(/\[ref=(e\d+)\]/);
      if (r) { console.log(r[1]); process.exit(0); }
    }
    console.error(lines.filter((l) => /edit|Morning|automation/i.test(l)).slice(0, 40).join("\n"));
    process.exit(1);
  ') || {
    echo "Could not find Edit control (${label}). Relevant snapshot:" >&2
    echo "$snap" | rg -i 'edit|morning|button|dialog' | head -40 >&2
    echo "$snap" | head -60 >&2
    return 1
  }

  $AB --session "$session" click "@${edit_ref}"
  $AB --session "$session" wait 1500
  $AB --session "$session" screenshot "$out"
  echo "Saved ${label}: $out"
}

mkdir -p "$SCREENSHOT_DIR"

if [[ ! -d "$MAIN_ROOT/apps/web" ]]; then
  echo "Missing main worktree at $MAIN_ROOT (git worktree add … main)" >&2
  exit 1
fi

stop_prefix() {
  local prefix="$1"
  if [[ "$prefix" == "AFTER" ]]; then
    $AB --session "$SESSION_AFTER" close --all 2>/dev/null || true
    for pid in "$AFTER_WEB_PID" "$AFTER_SERVER_PID"; do
      if [[ -n "$pid" ]]; then
        kill "$pid" 2>/dev/null || true
        wait "$pid" 2>/dev/null || true
      fi
    done
    AFTER_WEB_PID=""
    AFTER_SERVER_PID=""
  else
    $AB --session "$SESSION_BEFORE" close --all 2>/dev/null || true
    for pid in "$BEFORE_WEB_PID" "$BEFORE_SERVER_PID"; do
      if [[ -n "$pid" ]]; then
        kill "$pid" 2>/dev/null || true
        wait "$pid" 2>/dev/null || true
      fi
    done
    BEFORE_WEB_PID=""
    BEFORE_SERVER_PID=""
  fi
  sleep 0.5
}

AFTER_CSRF=""
AFTER_SESSION=""
BEFORE_CSRF=""
BEFORE_SESSION=""

# One stack at a time — dual vite/API on the same host confused auth/cookies.
echo "Capturing AFTER (feature)…"
start_seeded_stack "$ROOT" "$PORT_AFTER" "$WEB_AFTER" "$TEMP_AFTER" "$COOKIE_AFTER" \
  /tmp/nakama-pr-auto-profile-after-server.log \
  /tmp/nakama-pr-auto-profile-after-web.log \
  AFTER
capture_edit_dialog "$SESSION_AFTER" "http://127.0.0.1:${WEB_AFTER}" \
  "$SCREENSHOT_DIR/automation-profile-select-after.png" "after" \
  "$AFTER_CSRF" "$AFTER_SESSION"
stop_prefix AFTER

echo "Capturing BEFORE (main)…"
start_seeded_stack "$MAIN_ROOT" "$PORT_BEFORE" "$WEB_BEFORE" "$TEMP_BEFORE" "$COOKIE_BEFORE" \
  /tmp/nakama-pr-auto-profile-before-server.log \
  /tmp/nakama-pr-auto-profile-before-web.log \
  BEFORE
capture_edit_dialog "$SESSION_BEFORE" "http://127.0.0.1:${WEB_BEFORE}" \
  "$SCREENSHOT_DIR/automation-profile-select-before.png" "before" \
  "$BEFORE_CSRF" "$BEFORE_SESSION"
stop_prefix BEFORE

echo "Done."
