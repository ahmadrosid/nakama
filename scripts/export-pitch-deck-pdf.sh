#!/usr/bin/env bash
# Export a public HTML deck to docs/deck/<basename>.pdf (one page per slide, 16:9).
# Usage: scripts/export-pitch-deck-pdf.sh [basename]
#   basename defaults to investor-pitch.
#   Example: scripts/export-pitch-deck-pdf.sh investor-pitch
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DECK="${1:-investor-pitch}"

if [[ ! "${DECK}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  echo "Invalid deck basename: ${DECK}" >&2
  exit 1
fi

SRC="${ROOT}/docs/website/public/${DECK}.html"
OUT="${ROOT}/docs/deck/${DECK}.pdf"
PRINT_HTML="${ROOT}/docs/website/public/.${DECK}-print.html"

find_chrome() {
  if [[ -n "${CHROME_PATH:-}" && -x "${CHROME_PATH}" ]]; then
    printf '%s\n' "${CHROME_PATH}"
    return 0
  fi

  local candidate
  for candidate in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium" \
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"; do
    if [[ -x "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done

  for candidate in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge; do
    if command -v "${candidate}" >/dev/null 2>&1; then
      command -v "${candidate}"
      return 0
    fi
  done

  return 1
}

if [[ ! -f "${SRC}" ]]; then
  echo "Missing pitch deck HTML: ${SRC}" >&2
  exit 1
fi

if ! CHROME="$(find_chrome)"; then
  echo "Chrome/Chromium not found. Set CHROME_PATH to the browser binary." >&2
  exit 1
fi

chrome_log="$(mktemp)"
cleanup() {
  rm -f "${PRINT_HTML}" "${chrome_log}"
}
trap cleanup EXIT

# Keep the print HTML next to the source so relative assets (logo) resolve.
python3 - "${SRC}" "${PRINT_HTML}" <<'PY'
from pathlib import Path
import sys

src = Path(sys.argv[1])
dst = Path(sys.argv[2])
html = src.read_text(encoding="utf-8")
if "</head>" not in html:
    raise SystemExit(f"{src.name} has no </head>")

print_css = r"""
<style id="print-export">
@page { size: 10in 5.625in; margin: 0; }
@media print, screen {
  html, body {
    height: auto !important;
    overflow: visible !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  body.export-print .footer-bar { display: none !important; }
  body.export-print .deck {
    position: static !important;
    width: 100% !important;
    height: auto !important;
  }
  body.export-print .slide {
    position: relative !important;
    inset: auto !important;
    display: grid !important;
    visibility: visible !important;
    pointer-events: auto !important;
    opacity: 1 !important;
    transform: none !important;
    animation: none !important;
    transition: none !important;
    width: 10in !important;
    height: 5.625in !important;
    min-height: 5.625in !important;
    max-height: 5.625in !important;
    overflow: hidden !important;
    page-break-after: always !important;
    break-after: page !important;
    page-break-inside: avoid !important;
    break-inside: avoid !important;
    box-sizing: border-box !important;
  }
  body.export-print .slide:last-child {
    page-break-after: auto !important;
    break-after: auto !important;
  }
  body.export-print .reveal {
    animation: none !important;
    opacity: 1 !important;
    transform: none !important;
  }
}
</style>
<script>
document.addEventListener("DOMContentLoaded", () => {
  document.body.classList.add("export-print");
  document.querySelectorAll(".slide").forEach((s) => s.classList.add("active"));
});
</script>
"""

dst.write_text(html.replace("</head>", print_css + "\n</head>", 1), encoding="utf-8")
PY

echo "Exporting ${SRC}"
echo "  → ${OUT}"

"${CHROME}" --headless=new --disable-gpu --no-pdf-header-footer \
  --virtual-time-budget=10000 \
  --print-to-pdf="${OUT}" \
  "file://${PRINT_HTML}" \
  >"${chrome_log}" 2>&1 || true

if [[ ! -f "${OUT}" ]]; then
  cat "${chrome_log}" >&2
  echo "PDF was not created." >&2
  exit 1
fi

echo "Wrote ${OUT} ($(du -h "${OUT}" | awk '{print $1}'))"
