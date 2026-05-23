#!/usr/bin/env bash
set -euo pipefail

DAYS_BACK="${1:-7}"
PER_PAGE="${2:-5}"

if ! [[ "$DAYS_BACK" =~ ^[0-9]+$ ]]; then
  echo "DAYS_BACK must be an integer" >&2
  exit 1
fi

if ! [[ "$PER_PAGE" =~ ^[0-9]+$ ]]; then
  echo "PER_PAGE must be an integer" >&2
  exit 1
fi

DATE_CUTOFF="$(date -u -d "-${DAYS_BACK} days" +%F 2>/dev/null || python3 - <<'PY'
from datetime import datetime, timedelta, timezone
import os
print((datetime.now(timezone.utc) - timedelta(days=int(os.environ.get('DAYS_BACK_FALLBACK','7')))).date().isoformat())
PY
)"

if [[ -z "$DATE_CUTOFF" ]]; then
  export DAYS_BACK_FALLBACK="$DAYS_BACK"
  DATE_CUTOFF="$(python3 - <<'PY'
from datetime import datetime, timedelta, timezone
import os
print((datetime.now(timezone.utc) - timedelta(days=int(os.environ['DAYS_BACK_FALLBACK']))).date().isoformat())
PY
)"
fi

curl -sS -G "https://api.github.com/search/repositories" \
  --data-urlencode "q=created:>${DATE_CUTOFF}" \
  --data-urlencode "sort=stars" \
  --data-urlencode "order=desc" \
  --data-urlencode "per_page=${PER_PAGE}" \
  -H "Accept: application/vnd.github+json"