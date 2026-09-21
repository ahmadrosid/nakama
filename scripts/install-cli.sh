#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/install-cli.sh [install-directory]
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
install_dir="${1:-$HOME/.local/bin}"

(
  cd "$repo_root"
  bun build --compile apps/cli/src/index.ts --outfile dist/nakama
)
mkdir -p "$install_dir"
install -m 755 "$repo_root/dist/nakama" "$install_dir/nakama"
echo "Installed $install_dir/nakama. Add $install_dir to PATH, then run nakama."
