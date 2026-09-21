#!/usr/bin/env bash
# Optional Linux CLI installer for an intentionally authenticated CI/developer environment.
# The MCP + hosted-trigger recipe does not need this installer or shell credentials.
# If installed to ~/.local/bin, add that directory to PATH in the calling environment.
set -euo pipefail

[[ "$(uname -s)" == Linux ]] || { echo "This installer targets Linux" >&2; exit 1; }
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
