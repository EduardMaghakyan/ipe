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

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version|-v)
      if [[ $# -lt 2 || -z "${2:-}" ]]; then
        error "--version requires a value"
      fi
      IPE_VERSION="$2"; shift 2 ;;
    *) error "Unknown argument: $1" ;;
  esac
done

# Self-redirect: re-fetch install.sh from the target version's branch/tag
if [ -n "${IPE_VERSION:-}" ] && [ -z "${_IPE_REDIRECTED:-}" ]; then
  info "Fetching installer for version: $IPE_VERSION..."
  export _IPE_REDIRECTED=1
  export IPE_VERSION
  curl -fsSL "https://raw.githubusercontent.com/$REPO/$IPE_VERSION/install.sh" | bash
  exit $?
fi

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

# Ad-hoc sign on macOS to satisfy Gatekeeper/provenance checks
if [ "$OS" = "Darwin" ] && command -v codesign >/dev/null 2>&1; then
  codesign -f -s - "$IPE_DIR/ipe" 2>/dev/null || warn "Ad-hoc signing failed — binary may be blocked by macOS"
fi

# Install /diff-review command
info "Installing /diff-review command..."
COMMANDS_DIR="$HOME/.claude/commands"
mkdir -p "$COMMANDS_DIR"

cat > "$COMMANDS_DIR/diff-review.md" << 'CMD_EOF'
---
description: Review code diffs interactively using IPE
argument-hint: [--staged] [--all]
---

Run IPE's interactive diff review. This opens a browser UI where you can review
changed files side-by-side with inline commenting, then submit feedback.

## Your task

Run the IPE diff-review command. Pass through any arguments the user provided.
The command will open a browser window — wait for it to complete (the user will
approve or deny in the browser). Then relay the feedback output to the user.

```bash
~/.ipe/ipe diff-review $ARGUMENTS
```

After the command completes, relay the feedback output to the user.
If the binary is not found, tell the user to install IPE:
curl -fsSL https://raw.githubusercontent.com/eduardmaghakyan/ipe/main/install.sh | bash
CMD_EOF

# Register Claude Code hook + clean up stale plugin entries
info "Configuring Claude Code..."

python3 -c "
import json, os

settings_path = os.path.expanduser('$CLAUDE_SETTINGS')
plugins_path = os.path.expanduser('$HOME/.claude/plugins/installed_plugins.json')
hook_cmd = os.path.expanduser('$IPE_DIR/ipe')

# --- settings.json: hook ---
try:
    with open(settings_path) as f:
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

# Clean up stale plugin entries from previous installs
if 'enabledPlugins' in settings:
    settings['enabledPlugins'].pop('ipe@local', None)
    if not settings['enabledPlugins']:
        del settings['enabledPlugins']

with open(settings_path, 'w') as f:
    json.dump(settings, f, indent=2)
    f.write('\n')

# --- Clean up stale installed_plugins.json entries ---
try:
    with open(plugins_path) as f:
        plugins_data = json.load(f)
    if 'plugins' in plugins_data and 'ipe@local' in plugins_data['plugins']:
        del plugins_data['plugins']['ipe@local']
        with open(plugins_path, 'w') as f:
            json.dump(plugins_data, f, indent=2)
            f.write('\n')
except (FileNotFoundError, json.JSONDecodeError):
    pass
"

# Clean up stale plugin directory from previous installs
rm -rf "$IPE_DIR/plugin"

info "Done! IPE is installed and configured."
echo ""
echo "  Hook:     ExitPlanMode → ~/.ipe/ipe"
echo "  Command:  /diff-review → ~/.ipe/ipe diff-review"
echo ""
echo "  Verify:   claude and run /hooks or /diff-review"
echo "  Uninstall: rm -rf ~/.ipe && rm -f ~/.claude/commands/diff-review.md"
echo "             (then remove IPE hook from ~/.claude/settings.json)"
