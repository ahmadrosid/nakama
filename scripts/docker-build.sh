#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -eq 0 ]]; then
  set -- --platform=linux/amd64 -t nakama
fi

# buildx handles cross-platform builds; legacy `docker build` fails on Apple Silicon
# when forcing linux/amd64. Custom DOCKER_CONFIG disables the buildx CLI plugin.
exec docker buildx build --load "$@" "${ROOT}"
