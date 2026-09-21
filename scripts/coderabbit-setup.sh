#!/usr/bin/env bash
# Setup script for a CodeRabbit coding environment.
#
# Paste this into Coding -> Environments -> your environment -> Setup script.
# It installs the Signadot CLI so the verify-in-signadot recipe can create a
# sandbox and run the guard job against it.
#
# The version is pinned on purpose. An agent that silently picks up a new CLI
# is an agent whose runs stop being comparable.
set -euo pipefail

version=v1.8.0
case "$(uname -m)" in
  x86_64) arch=amd64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

# CodeRabbit's sandbox runs setup as a user who may not own /usr/local/bin.
dir=/usr/local/bin
if [ ! -w "$dir" ]; then
  dir="$HOME/.local/bin"
  mkdir -p "$dir"
fi

curl -fsSL "https://github.com/signadot/cli/releases/download/${version}/signadot-cli_mcp_linux_${arch}.tar.gz" |
  tar -xz -C "$dir" signadot
chmod +x "$dir/signadot"
echo "installed: $dir/signadot"
"$dir/signadot" --version
