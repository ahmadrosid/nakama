#!/usr/bin/env bash
set -euo pipefail

DATE_CUTOFF="${1:-2026-05-16}"
PER_PAGE="${2:-5}"

curl -sG "https://api.github.com/search/repositories" \
  --data-urlencode "q=created:>${DATE_CUTOFF}" \
  --data-urlencode "sort=stars" \
  --data-urlencode "order=desc" \
  --data-urlencode "per_page=${PER_PAGE}" \
  -H "Accept: application/vnd.github+json"