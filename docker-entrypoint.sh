#!/bin/sh
set -e

cd /app

case "${1:-server}" in
  server)
    exec bun run apps/server/src/index.ts
    ;;
  cli)
    export TINYCLAW_SERVER_URL="${TINYCLAW_SERVER_URL:-http://127.0.0.1:4310}"
    exec bun run apps/cli/src/index.ts
    ;;
  *)
    exec "$@"
    ;;
esac
