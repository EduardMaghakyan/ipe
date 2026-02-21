#!/usr/bin/env bash
set -euo pipefail

IPE_DIR="$HOME/.ipe"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"
REPO="eduardmaghakyan/ipe"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}==>${NC} $1"; }
warn()  { echo -e "${YELLOW}==>${NC} $1"; }
error() { echo -e "${RED}==>${NC} $1"; exit 1; }

# Check prerequisites
command -v curl >/dev/null 2>&1 || error "curl is required but not installed."
command -v python3 >/dev/null 2>&1 || error "python3 is required but not installed."

# Detect platform
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin) OS_TAG="darwin" ;;
  Linux)  OS_TAG="linux" ;;
  *)      error "Unsupported OS: $OS" ;;
esac

case "$ARCH" in
  arm64|aarch64) ARCH_TAG="arm64" ;;
  x86_64)        ARCH_TAG="x64" ;;
  *)             error "Unsupported architecture: $ARCH" ;;
esac

TARGET="ipe-${OS_TAG}-${ARCH_TAG}"

# Determine download URL
if [ -n "${IPE_VERSION:-}" ]; then
  DOWNLOAD_URL="https://github.com/$REPO/releases/download/$IPE_VERSION/$TARGET"
else
  DOWNLOAD_URL="https://github.com/$REPO/releases/latest/download/$TARGET"
fi

# Download binary
info "Downloading IPE ($TARGET)..."
mkdir -p "$IPE_DIR"
curl -fSL "$DOWNLOAD_URL" -o "$IPE_DIR/ipe"
chmod +x "$IPE_DIR/ipe"

# Register Claude Code hook
info "Configuring Claude Code hook..."
mkdir -p "$HOME/.claude"

python3 -c "
import json, os

path = os.path.expanduser('$CLAUDE_SETTINGS')
hook_cmd = os.path.expanduser('$IPE_DIR/ipe')

try:
    with open(path) as f:
        settings = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    settings = {}

hooks = settings.setdefault('hooks', {})
perm = hooks.setdefault('PermissionRequest', [])

# Remove any existing IPE hook to avoid duplicates
perm[:] = [
    h for h in perm
    if not (h.get('matcher') == 'ExitPlanMode' and
            any('.ipe/' in x.get('command', '') for x in h.get('hooks', [])))
]

perm.append({
    'matcher': 'ExitPlanMode',
    'hooks': [{'type': 'command', 'command': hook_cmd, 'timeout': 345600}]
})

with open(path, 'w') as f:
    json.dump(settings, f, indent=2)
    f.write('\n')
"

info "Done! IPE is installed and configured."
echo ""
echo "  Verify with: claude and run /hooks"
echo "  Uninstall:   rm -rf ~/.ipe"
echo "               (then remove the ExitPlanMode hook from ~/.claude/settings.json)"
