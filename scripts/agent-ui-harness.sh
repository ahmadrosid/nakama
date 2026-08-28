#!/usr/bin/env bash
# Isolated API + Vite stack for agent-browser UI checks.
# Usage: agent-ui-harness.sh start | stop
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PREFIX="${NAKAMA_AGENT_UI_PREFIX:-/tmp/nakama-agent-ui}"
LATEST="${PREFIX}-latest"

usage() {
  echo "Usage: $0 start|stop" >&2
  exit 2
}

die() {
  echo "agent-ui: $*" >&2
  exit 1
}

allowed_run_dir() {
  local path="$1"
  case "$path" in
    "${PREFIX}"-*) return 0 ;;
    *) return 1 ;;
  esac
}

port_listening() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

nakama_healthy() {
  local url="$1"
  local body
  body="$(curl -sf --max-time 2 "${url}/health" 2>/dev/null || true)"
  [[ "$body" == *'"ok":true'* ]] || [[ "$body" == *'"ok": true'* ]]
}

pick_port() {
  local start="$1"
  local skip="$2"
  local port="$start"
  local max=$((start + 80))
  while ((port < max)); do
    if [[ "$port" -eq "$skip" ]] && port_listening "$port"; then
      port=$((port + 1))
      continue
    fi
    if port_listening "$port"; then
      port=$((port + 1))
      continue
    fi
    if nakama_healthy "http://127.0.0.1:${port}"; then
      port=$((port + 1))
      continue
    fi
    echo "$port"
    return 0
  done
  die "no free port from ${start}"
}

pid_alive() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

pgid_of() {
  ps -o pgid= -p "$1" 2>/dev/null | tr -d ' '
}

# New session so stop can TERM the group. Python setsid works on Darwin; setsid(1) does not.
spawn_detached() {
  local cwd="$1"
  local log="$2"
  shift 2
  python3 -c '
import os, sys
cwd, log = sys.argv[1], sys.argv[2]
cmd = sys.argv[3:]
os.chdir(cwd)
pid = os.fork()
if pid:
    print(pid)
    raise SystemExit(0)
os.setsid()
devnull = os.open("/dev/null", os.O_RDONLY)
logfd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
os.dup2(devnull, 0)
os.dup2(logfd, 1)
os.dup2(logfd, 2)
os.execvp(cmd[0], cmd)
' "$cwd" "$log" "$@"
}

kill_group() {
  local pgid="$1"
  local pid="$2"
  if [[ -n "$pgid" && "$pgid" != "0" && "$pgid" != "1" ]]; then
    kill -TERM -- "-${pgid}" 2>/dev/null || true
  fi
  if [[ -n "$pid" ]]; then
    kill -TERM "$pid" 2>/dev/null || true
    local kids
    kids="$(pgrep -P "$pid" 2>/dev/null || true)"
    if [[ -n "$kids" ]]; then
      # shellcheck disable=SC2086
      kill -TERM $kids 2>/dev/null || true
    fi
  fi
}

wait_url() {
  local url="$1"
  local pid="$2"
  local max="${3:-120}"
  local i
  for i in $(seq 1 "$max"); do
    if [[ -n "$pid" ]] && ! pid_alive "$pid"; then
      return 1
    fi
    if curl -sf --max-time 1 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

source_env() {
  local file="$1"
  # shellcheck disable=SC1090
  set -a
  source "$file"
  set +a
}

fail_started() {
  local run_dir="$1"
  local api_pid="${2:-}"
  local api_pgid="${3:-}"
  local web_pid="${4:-}"
  local web_pgid="${5:-}"
  kill_group "$api_pgid" "$api_pid"
  kill_group "$web_pgid" "$web_pid"
  if [[ -n "${PM2_HOME:-}" ]]; then
    PM2_HOME="$PM2_HOME" bun x pm2 kill >/dev/null 2>&1 || true
  fi
  if allowed_run_dir "$run_dir"; then
    rm -rf "$run_dir"
  fi
  if [[ -L "$LATEST" && "$(readlink "$LATEST" 2>/dev/null || true)" == "$run_dir" ]]; then
    rm -f "$LATEST"
  fi
  exit 1
}

reuse_if_live() {
  [[ -f "${LATEST}/harness.env" ]] || return 1
  source_env "${LATEST}/harness.env"
  if [[ -n "${BASE_URL:-}" ]] && nakama_healthy "$BASE_URL"; then
    local body
    body="$(curl -sf --max-time 2 "${BASE_URL}/health" 2>/dev/null || true)"
    if [[ "$body" == *'"providerConfigured":true'* || "$body" == *'"providerConfigured": true'* ]]; then
      echo "agent-ui: already running"
      echo "  BASE_URL=${BASE_URL}"
      echo "  source ${LATEST}/harness.env"
      echo "  agent-browser open ${BASE_URL}/chat"
      return 0
    fi
  fi
  return 1
}

port_owned_by_pgid() {
  local port="$1"
  local expected="$2"
  local pids pid
  [[ -n "$expected" && "$expected" != "0" && "$expected" != "1" ]] || return 1
  pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
  [[ -n "$pids" ]] || return 1
  for pid in $pids; do
    if [[ "$(pgid_of "$pid")" == "$expected" ]]; then
      return 0
    fi
  done
  return 1
}

pm2_kill_home() {
  local home="$1"
  if [[ -n "$home" && -d "$home" ]]; then
    PM2_HOME="$home" bun x pm2 kill >/dev/null 2>&1 || true
  fi
}

reap_dead_latest() {
  [[ -e "$LATEST" ]] || return 0
  local target
  target="$(readlink "$LATEST" 2>/dev/null || echo "$LATEST")"
  if [[ -f "${target}/harness.env" ]]; then
    source_env "${target}/harness.env"
    if pid_alive "${API_PID:-}" || pid_alive "${WEB_PID:-}"; then
      die "a harness is already live at ${BASE_URL:-unknown}. Run: bun run agent:ui:stop"
    fi
    if [[ "${STARTING:-}" == "1" && -z "${API_PID:-}" ]]; then
      die "a harness is already starting at ${BASE_URL:-$target}. Wait or: bun run agent:ui:stop"
    fi
    pm2_kill_home "${PM2_HOME:-}"
  fi
  if allowed_run_dir "$target"; then
    rm -rf "$target"
  fi
  rm -f "$LATEST"
}

cmd_start() {
  if reuse_if_live; then
    exit 0
  fi
  reap_dead_latest

  local run_id run_dir
  run_id="$(date +%s)-$$"
  run_dir="${PREFIX}-${run_id}"
  allowed_run_dir "$run_dir" || die "refusing run dir ${run_dir}"

  local data_dir="${run_dir}/nakama-data"
  mkdir -p "${data_dir}/runtime" "${run_dir}/logs" "${run_dir}/pm2"
  printf '%s\n' '{"automation":false,"discord":false,"telegram":false,"whatsapp":false}' \
    >"${data_dir}/runtime/worker-desired-state.json"

  local api_port web_port
  api_port="$(pick_port 4320 4310)"
  web_port="$(pick_port 3010 3003)"

  local api_url base_url
  api_url="http://127.0.0.1:${api_port}"
  base_url="http://127.0.0.1:${web_port}"

  local api_log web_log cookie_jar
  api_log="${run_dir}/logs/api.log"
  web_log="${run_dir}/logs/web.log"
  cookie_jar="${run_dir}/cookies.txt"

  umask 077
  cat >"${run_dir}/harness.env" <<EOF
RUN_DIR=${run_dir}
NAKAMA_CONFIG_DIR=${data_dir}
BASE_URL=${base_url}
API_URL=${api_url}
API_PORT=${api_port}
WEB_PORT=${web_port}
STARTING=1
PM2_HOME=${run_dir}/pm2
EOF
  chmod 600 "${run_dir}/harness.env"
  ln -sfn "$run_dir" "$LATEST"

  local api_pid web_pid api_pgid web_pgid
  api_pid="$(
    unset NAKAMA_PROVIDER OPENAI_API_KEY ANTHROPIC_API_KEY \
      NAKAMA_SEED_ADMIN_EMAIL NAKAMA_SEED_ADMIN_NAME \
      NAKAMA_SEED_ADMIN_PASSWORD NAKAMA_SEED_ORG_NAME
    export NAKAMA_HOST=127.0.0.1
    export NAKAMA_CONFIG_DIR="$data_dir"
    export NAKAMA_PORT="$api_port"
    export PM2_HOME="${run_dir}/pm2"
    spawn_detached "$ROOT" "$api_log" \
      bun --no-env-file run "$ROOT/apps/server/src/index.ts"
  )"
  api_pgid="$(pgid_of "$api_pid")"
  {
    echo "API_PID=${api_pid}"
    echo "API_PGID=${api_pgid}"
  } >>"${run_dir}/harness.env"

  if ! wait_url "${api_url}/health" "$api_pid"; then
    echo "agent-ui: API failed to become healthy" >&2
    tail -n 40 "$api_log" >&2 || true
    PM2_HOME="${run_dir}/pm2" fail_started "$run_dir" "$api_pid" "$api_pgid"
  fi
  if ! pid_alive "$api_pid"; then
    echo "agent-ui: API exited (port may already be a Nakama instance)" >&2
    PM2_HOME="${run_dir}/pm2" fail_started "$run_dir" "$api_pid" "$api_pgid"
  fi
  if ! port_owned_by_pgid "$api_port" "$api_pgid"; then
    echo "agent-ui: ${api_port} is not our API process" >&2
    PM2_HOME="${run_dir}/pm2" fail_started "$run_dir" "$api_pid" "$api_pgid"
  fi

  web_pid="$(
    export nakama_SERVER_URL="$api_url"
    spawn_detached "$ROOT/apps/web" "$web_log" \
      bun --no-env-file x vite --host 127.0.0.1 --port "$web_port" --strictPort
  )"
  {
    echo "WEB_PID=${web_pid}"
    echo "WEB_PGID=$(pgid_of "$web_pid")"
  } >>"${run_dir}/harness.env"

  if ! wait_url "${base_url}/" "$web_pid" 480; then
    echo "agent-ui: Vite failed to become ready" >&2
    tail -n 40 "$web_log" >&2 || true
    PM2_HOME="${run_dir}/pm2" fail_started "$run_dir" "$api_pid" "$(pgid_of "$api_pid")" "$web_pid" "$(pgid_of "$web_pid")"
  fi

  if ! curl -sf -c "$cookie_jar" -X POST "${api_url}/v1/auth/setup" \
    -H 'Content-Type: application/json' \
    -d "{
      \"organization\": {\"name\": \"Docs Demo\", \"slug\": \"docs-demo\"},
      \"admin\": {\"name\": \"Admin\", \"email\": \"admin@docs.demo\", \"password\": \"password123\"},
      \"webPublicUrl\": \"${base_url}\"
    }" >/dev/null; then
    echo "agent-ui: setup failed" >&2
    PM2_HOME="${run_dir}/pm2" fail_started "$run_dir" "$api_pid" "$(pgid_of "$api_pid")" "$web_pid" "$(pgid_of "$web_pid")"
  fi

  local csrf session_val org_id
  csrf="$(awk '$6=="nakama_csrf"{print $7}' "$cookie_jar")"
  session_val="$(awk '$6=="nakama_session"{print $7}' "$cookie_jar")"
  org_id="$(
    curl -sf -b "$cookie_jar" "${api_url}/v1/auth/me" \
      | bun -e 'console.log(JSON.parse(await Bun.stdin.text()).activeOrgId ?? "")'
  )"

  if ! curl -sf -b "$cookie_jar" -X POST "${api_url}/v1/providers" \
    -H 'Content-Type: application/json' \
    -H "X-CSRF-Token: ${csrf}" \
    -H "X-Org-Id: ${org_id}" \
    -d '{"type":"ollama","apiKey":"","hostMode":"local","model":"llama3.2"}' >/dev/null; then
    echo "agent-ui: provider seed failed" >&2
    PM2_HOME="${run_dir}/pm2" fail_started "$run_dir" "$api_pid" "$(pgid_of "$api_pid")" "$web_pid" "$(pgid_of "$web_pid")"
  fi

  local i body
  body=""
  for i in $(seq 1 40); do
    body="$(curl -sf --max-time 2 "${base_url}/health" 2>/dev/null || true)"
    if [[ "$body" == *'"providerConfigured":true'* || "$body" == *'"providerConfigured": true'* ]]; then
      break
    fi
    sleep 0.25
  done
  if [[ "$body" != *'"providerConfigured":true'* && "$body" != *'"providerConfigured": true'* ]]; then
    echo "agent-ui: web origin never reported providerConfigured" >&2
    PM2_HOME="${run_dir}/pm2" fail_started "$run_dir" "$api_pid" "$(pgid_of "$api_pid")" "$web_pid" "$(pgid_of "$web_pid")"
  fi

  web_pgid="$(pgid_of "$web_pid")"
  api_pgid="$(pgid_of "$api_pid")"

  umask 077
  cat >"${run_dir}/harness.env" <<EOF
RUN_DIR=${run_dir}
NAKAMA_CONFIG_DIR=${data_dir}
BASE_URL=${base_url}
API_URL=${api_url}
API_PORT=${api_port}
WEB_PORT=${web_port}
ORG_ID=${org_id}
SESSION_COOKIE=nakama_session
CSRF_COOKIE=nakama_csrf
NAKAMA_SESSION=${session_val}
NAKAMA_CSRF=${csrf}
API_PID=${api_pid}
WEB_PID=${web_pid}
API_PGID=${api_pgid}
WEB_PGID=${web_pgid}
PM2_HOME=${run_dir}/pm2
EOF
  chmod 600 "${run_dir}/harness.env"

  ln -sfn "$run_dir" "$LATEST"

  if command -v agent-browser >/dev/null 2>&1; then
    agent-browser cookies set nakama_session "$session_val" \
      --url "${base_url}/" --httpOnly --sameSite Lax >/dev/null 2>&1 || true
    agent-browser cookies set nakama_csrf "$csrf" \
      --url "${base_url}/" --sameSite Lax >/dev/null 2>&1 || true
  fi

  echo "agent-ui: ready"
  echo "  BASE_URL=${base_url}"
  echo "  API_URL=${api_url}"
  echo "  source ${run_dir}/harness.env"
  echo "  Dummy ollama only satisfies SetupGuard. A failed model turn is not a harness defect."
  if ! command -v agent-browser >/dev/null 2>&1; then
    echo "  agent-browser cookies set nakama_session \$NAKAMA_SESSION --url ${base_url}/ --httpOnly --sameSite Lax"
    echo "  agent-browser cookies set nakama_csrf \$NAKAMA_CSRF --url ${base_url}/ --sameSite Lax"
  fi
  echo "  agent-browser open ${base_url}/chat"
  echo "  bun run agent:ui:stop"
}

cmd_stop() {
  local run_dir=""
  if [[ -n "${RUN_DIR:-}" ]]; then
    run_dir="$RUN_DIR"
  elif [[ -e "$LATEST" ]]; then
    run_dir="$(readlink "$LATEST" 2>/dev/null || echo "$LATEST")"
  else
    die "no harness to stop"
  fi

  allowed_run_dir "$run_dir" || die "refusing to stop path outside ${PREFIX}-*"

  if [[ ! -f "${run_dir}/harness.env" ]]; then
    if allowed_run_dir "$run_dir"; then
      rm -rf "$run_dir"
      rm -f "$LATEST"
      return 0
    fi
    die "no harness.env in ${run_dir}"
  fi

  source_env "${run_dir}/harness.env"

  case "${NAKAMA_CONFIG_DIR:-}" in
    "${run_dir}"/*) ;;
    *) die "refusing to delete NAKAMA_CONFIG_DIR outside the run dir" ;;
  esac
  if [[ "${NAKAMA_CONFIG_DIR:-}" == "${HOME}/.nakama" || "${NAKAMA_CONFIG_DIR:-}" == "${HOME}/.nakama/"* ]]; then
    die "refusing to delete operator ~/.nakama"
  fi

  if [[ -n "${PM2_HOME:-}" ]]; then
    PM2_HOME="$PM2_HOME" bun x pm2 kill >/dev/null 2>&1 || true
  fi

  kill_group "${API_PGID:-}" "${API_PID:-}"
  kill_group "${WEB_PGID:-}" "${WEB_PID:-}"

  local i
  for i in $(seq 1 40); do
    if ! port_listening "${API_PORT:-0}" && ! port_listening "${WEB_PORT:-0}"; then
      break
    fi
    sleep 0.15
  done

  rm -rf "$run_dir"
  if [[ -L "$LATEST" && "$(readlink "$LATEST" 2>/dev/null || true)" == "$run_dir" ]]; then
    rm -f "$LATEST"
  fi
}

case "${1:-}" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  *) usage ;;
esac
