#!/usr/bin/env bash
# Prove @firecrawl/anydoc's native binary loads under the production Bun image.
# Usage:
#   ./scripts/docker-build-run.sh
#   ./scripts/docker-smoke-anydoc.sh [image-tag]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${1:-nakama}"
FIXTURE_PDF="${ROOT}/packages/core/src/__fixtures__/sample.pdf"
FIXTURE_XLSX="${ROOT}/packages/core/src/__fixtures__/sample.xlsx"

if [[ ! -f "${FIXTURE_PDF}" || ! -f "${FIXTURE_XLSX}" ]]; then
  echo "Missing anydoc fixtures under packages/core/src/__fixtures__/" >&2
  exit 1
fi

if ! docker image inspect "${IMAGE}" >/dev/null 2>&1; then
  echo "Docker image '${IMAGE}' not found. Build it first with ./scripts/docker-build-run.sh" >&2
  exit 1
fi

# Resolve workspace deps from packages/core (production install is filter-scoped).
docker run --rm --platform=linux/amd64 \
  -v "${FIXTURE_PDF}:/tmp/sample.pdf:ro" \
  -v "${FIXTURE_XLSX}:/tmp/sample.xlsx:ro" \
  -w /app/packages/core \
  "${IMAGE}" \
  bun -e '
import { readFileSync } from "node:fs";
import { toMarkdownBytes } from "@firecrawl/anydoc";

const pdf = readFileSync("/tmp/sample.pdf");
const xlsx = readFileSync("/tmp/sample.xlsx");
const pdfMd = await toMarkdownBytes(new Uint8Array(pdf), "pdf");
const xlsxMd = await toMarkdownBytes(new Uint8Array(xlsx), "xlsx");

if (!pdfMd.toLowerCase().includes("dummy")) {
  throw new Error(`PDF conversion missing expected text: ${JSON.stringify(pdfMd)}`);
}
if (!xlsxMd.includes("Widget") || !xlsxMd.includes("42")) {
  throw new Error(`XLSX conversion missing expected cells: ${JSON.stringify(xlsxMd)}`);
}

console.log("anydoc smoke ok");
'
