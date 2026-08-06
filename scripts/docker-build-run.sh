#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER_NAME="${NAKAMA_CONTAINER_NAME:-nakama}"
IMAGE_NAME="${NAKAMA_IMAGE_NAME:-nakama}"
HOST_PORT="${NAKAMA_HOST_PORT:-4310}"
VOLUME_NAME="${NAKAMA_DATA_VOLUME:-nakama-data}"

echo "Building ${IMAGE_NAME}..."
# buildx handles cross-platform builds; legacy `docker build` fails on Apple Silicon
# when forcing linux/amd64. Custom DOCKER_CONFIG disables the buildx CLI plugin.
# Build before stopping the running container so a failed build leaves the old service up.
if [[ "${IMAGE_NAME}" == "nakama" && "$#" -eq 0 ]]; then
  docker buildx build --load --platform=linux/amd64 -t nakama "${ROOT}"
else
  docker buildx build --load --platform=linux/amd64 -t "${IMAGE_NAME}" "$@" "${ROOT}"
fi

echo "Stopping ${CONTAINER_NAME}..."
docker rm -f "${CONTAINER_NAME}" 2>/dev/null || true

echo "Starting ${CONTAINER_NAME}..."
docker run -d \
  -p "${HOST_PORT}:4310" \
  -v "${VOLUME_NAME}:/nakama/data" \
  --name "${CONTAINER_NAME}" \
  "${IMAGE_NAME}"

for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://localhost:${HOST_PORT}/" 2>/dev/null; then
    echo "Nakama is up: http://localhost:${HOST_PORT}"
    docker ps --filter "name=${CONTAINER_NAME}" --format '{{.Names}}\t{{.Status}}'
    exit 0
  fi
  sleep 1
done

echo "Container started but health check timed out. Check: docker logs ${CONTAINER_NAME}"
docker ps --filter "name=${CONTAINER_NAME}" --format '{{.Names}}\t{{.Status}}'
exit 1
